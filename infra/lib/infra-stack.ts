import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import { NodejsFunction, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

const LAMBDA_DIR = path.join(__dirname, '../../backend/scan-lambda');

// SecureString parameters, created by hand with `aws ssm put-parameter` (CloudFormation can't create them)
const PARAMS = {
  safeBrowsingKey: '/safescan/safe-browsing-key',
  hashPepper: '/safescan/hash-pepper',
  githubToken: '/safescan/github-token',
};

// DynamoDB free tier: 25 RCU and 25 WCU shared by every table and index.
// Current split: reads 17, writes 20. Auto scaling stays off so usage can't grow past it.
const CAPACITY = {
  urlVerdicts: { readCapacity: 5, writeCapacity: 6 }, // nightly feed ingest writes here
  reports: { readCapacity: 3, writeCapacity: 3 },
  reportsByUrl: { readCapacity: 2, writeCapacity: 2 },
  reportsByArea: { readCapacity: 1, writeCapacity: 1 },
  reportsByStatus: { readCapacity: 2, writeCapacity: 2 },
  hotspots: { readCapacity: 1, writeCapacity: 2 },
  rateLimits: { readCapacity: 3, writeCapacity: 4 }, // one write per scan or report
};

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---- Tables ----

    const urlVerdicts = new dynamodb.Table(this, 'UrlVerdicts', {
      partitionKey: { name: 'urlHash', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      ...CAPACITY.urlVerdicts,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const reports = new dynamodb.Table(this, 'Reports', {
      partitionKey: { name: 'reportId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      ...CAPACITY.reports,
      // Old and new images let the verifier see status transitions
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const createdAt = { name: 'createdAt', type: dynamodb.AttributeType.STRING };
    reports.addGlobalSecondaryIndex({
      indexName: 'byUrl',
      partitionKey: { name: 'urlHash', type: dynamodb.AttributeType.STRING },
      sortKey: createdAt,
      ...CAPACITY.reportsByUrl,
    });
    reports.addGlobalSecondaryIndex({
      indexName: 'byArea', // sparse: only reports that include a location
      partitionKey: { name: 'geohash5', type: dynamodb.AttributeType.STRING },
      sortKey: createdAt,
      ...CAPACITY.reportsByArea,
    });
    reports.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'urlStatus', type: dynamodb.AttributeType.STRING },
      sortKey: createdAt,
      ...CAPACITY.reportsByStatus,
    });

    const hotspots = new dynamodb.Table(this, 'HotspotAggregates', {
      partitionKey: { name: 'geohash5', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      ...CAPACITY.hotspots,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // rebuilt every night
    });

    const rateLimits = new dynamodb.Table(this, 'RateLimits', {
      partitionKey: { name: 'key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      ...CAPACITY.rateLimits,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // hourly counters only
    });

    const param = (id: string, name: string) =>
      ssm.StringParameter.fromSecureStringParameterAttributes(this, id, { parameterName: name });
    const sbKey = param('SbKey', PARAMS.safeBrowsingKey);
    const pepper = param('HashPepper', PARAMS.hashPepper);
    const githubToken = param('GithubToken', PARAMS.githubToken);

    // ---- Functions ----

    const environment = {
      TABLE_VERDICTS: urlVerdicts.tableName,
      TABLE_REPORTS: reports.tableName,
      TABLE_HOTSPOTS: hotspots.tableName,
      TABLE_RATE_LIMITS: rateLimits.tableName,
      SB_KEY_PARAM: PARAMS.safeBrowsingKey,
      PEPPER_PARAM: PARAMS.hashPepper,
      GITHUB_TOKEN_PARAM: PARAMS.githubToken,
      NEGATIVE_TTL_SECONDS: '300',
    };

    const fn = (id: string, file: string, logId: string, extra: Partial<NodejsFunctionProps> = {}) =>
      new NodejsFunction(this, id, {
        entry: path.join(LAMBDA_DIR, 'src', file),
        // Bundle with scan-lambda's own esbuild and lockfile, not infra's
        projectRoot: LAMBDA_DIR,
        depsLockFilePath: path.join(LAMBDA_DIR, 'package-lock.json'),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        environment,
        logGroup: new logs.LogGroup(this, logId, { retention: logs.RetentionDays.ONE_WEEK }),
        ...extra,
      });

    // POST /scan and POST /report
    const scanFn = fn('ScanFn', 'handler.ts', 'ScanLogs', {
      // reservedConcurrentExecutions: 5,  // only if your account limit is above 10
    });
    urlVerdicts.grantReadWriteData(scanFn);
    reports.grantWriteData(scanFn);
    rateLimits.grantReadWriteData(scanFn);
    sbKey.grantRead(scanFn);
    pepper.grantRead(scanFn);

    // Reports stream -> verification states -> UrlVerdicts
    const verifierFn = fn('VerifierFn', 'verifier.ts', 'VerifierLogs', { timeout: cdk.Duration.seconds(30) });
    urlVerdicts.grantReadWriteData(verifierFn);
    reports.grantReadWriteData(verifierFn);
    verifierFn.addEventSource(
      new DynamoEventSource(reports, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
      })
    );

    // Feeds, hotspot counts, public export
    const nightlyFn = fn('NightlyFn', 'nightly.ts', 'NightlyLogs', {
      memorySize: 512,
      timeout: cdk.Duration.minutes(15),
      environment: {
        ...environment,
        GITHUB_REPO: this.node.tryGetContext('githubRepo') ?? 'Langton49/safescan_aws',
        GITHUB_BRANCH: this.node.tryGetContext('githubBranch') ?? 'main',
        GITHUB_DATA_DIR: 'docs/data',
      },
    });
    urlVerdicts.grantReadWriteData(nightlyFn);
    reports.grantReadWriteData(nightlyFn);
    hotspots.grantWriteData(nightlyFn);
    githubToken.grantRead(nightlyFn);

    new scheduler.Schedule(this, 'NightlySchedule', {
      description: 'SafeScan nightly feed ingest, hotspot counts and public export',
      schedule: scheduler.ScheduleExpression.cron({ minute: '0', hour: '3' }), // 03:00 UTC
      target: new schedulerTargets.LambdaInvoke(nightlyFn),
    });

    // ---- Outputs ----

    const fnUrl = scanFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    new cdk.CfnOutput(this, 'ScanUrl', { value: fnUrl.url });
    new cdk.CfnOutput(this, 'UrlVerdictsTable', { value: urlVerdicts.tableName });
    new cdk.CfnOutput(this, 'ReportsTable', { value: reports.tableName });
    new cdk.CfnOutput(this, 'NightlyFunction', { value: nightlyFn.functionName });
  }
}
