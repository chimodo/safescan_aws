import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
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
  captchaSecret: '/safescan/captcha-secret',
};

// DynamoDB free tier: 25 RCU and 25 WCU shared by every table and index.
// Current split: reads 21, writes 24. Auto scaling stays off so usage can't grow past it.
const CAPACITY = {
  urlVerdicts: { readCapacity: 5, writeCapacity: 6 }, // nightly feed ingest writes here
  reports: { readCapacity: 3, writeCapacity: 3 },
  reportsByUrl: { readCapacity: 2, writeCapacity: 2 },
  reportsByArea: { readCapacity: 1, writeCapacity: 1 },
  reportsByStatus: { readCapacity: 2, writeCapacity: 2 },
  reportsByVisibility: { readCapacity: 1, writeCapacity: 1 },
  hotspots: { readCapacity: 1, writeCapacity: 2 },
  rateLimits: { readCapacity: 3, writeCapacity: 4 }, // one write per scan, report or vote
  community: { readCapacity: 3, writeCapacity: 3 }, // link counts read on every scan; vote records
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

    // Community submissions. Each also carries a maintainer review state (urlStatus).
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
    reports.addGlobalSecondaryIndex({
      indexName: 'byVisibility', // recent submissions for the community home page
      partitionKey: { name: 'visibility', type: dynamodb.AttributeType.STRING },
      sortKey: createdAt,
      ...CAPACITY.reportsByVisibility,
    });

    // Per-link submission and vote counts (link#<urlHash>) and one record per vote (vote#<reportId>#<voter>)
    const community = new dynamodb.Table(this, 'Community', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      ...CAPACITY.community,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
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
    const captchaSecret = param('CaptchaSecret', PARAMS.captchaSecret);

    // ---- Community website: static files in a private bucket, served by CloudFront ----

    const siteBucket = new s3.Bucket(this, 'CommunitySite', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const site = new cloudfront.Distribution(this, 'CommunitySiteCdn', {
      comment: 'SafeScan community website',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      // Paths like /link/<hash> have no file; serve index.html and let the page route
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: cdk.Duration.minutes(5),
      })),
    });
    const siteOrigin = `https://${site.distributionDomainName}`;

    // Origins allowed to call the API and upload screenshots from a browser: the community site,
    // plus any for local development: `-c corsOrigins=http://localhost:8080,http://localhost:5173`
    const extraOrigins = String(this.node.tryGetContext('corsOrigins') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    // ---- Screenshots: private; raw uploads in uploads/, checked copies in pending/, shown from approved/ ----

    const screenshots = new s3.Bucket(this, 'Screenshots', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // Browsers upload with a pre-signed POST, which needs CORS; the app doesn't
      cors: [{ allowedMethods: [s3.HttpMethods.POST], allowedOrigins: [siteOrigin, ...extraOrigins], allowedHeaders: ['*'], maxAge: 3600 }],
      lifecycleRules: [
        { id: 'drop-unprocessed-uploads', prefix: 'uploads/', expiration: cdk.Duration.days(1) },
        { id: 'drop-unreviewed-screenshots', prefix: 'pending/', expiration: cdk.Duration.days(30) },
        { id: 'drop-incomplete-uploads', abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
      ],
    });

    // ---- Functions ----

    const environment = {
      TABLE_VERDICTS: urlVerdicts.tableName,
      TABLE_REPORTS: reports.tableName,
      TABLE_HOTSPOTS: hotspots.tableName,
      TABLE_RATE_LIMITS: rateLimits.tableName,
      TABLE_COMMUNITY: community.tableName,
      SCREENSHOTS_BUCKET: screenshots.bucketName,
      SB_KEY_PARAM: PARAMS.safeBrowsingKey,
      PEPPER_PARAM: PARAMS.hashPepper,
      GITHUB_TOKEN_PARAM: PARAMS.githubToken,
      CAPTCHA_SECRET_PARAM: PARAMS.captchaSecret,
      // turnstile (default) or hcaptcha: `npx cdk deploy -c captchaProvider=hcaptcha`
      CAPTCHA_PROVIDER: this.node.tryGetContext('captchaProvider') === 'hcaptcha' ? 'hcaptcha' : 'turnstile',
      // Submissions and votes that raise a link's level; a demo setting kept in one value:
      // `npx cdk deploy -c communityRule='{"minSubmissions":1,"minVotes":10}'`
      COMMUNITY_RULE: this.node.tryGetContext('communityRule') ?? '{"minSubmissions":1,"minVotes":10}',
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

    // POST /scan, POST /report, POST /vote, GET /link/{hash}, GET /recent
    const scanFn = fn('ScanFn', 'handler.ts', 'ScanLogs', {
      // reservedConcurrentExecutions: 5,  // only if your account limit is above 10
      // The S3 presigning helpers may not ship with the Lambda runtime, so bundle the SDK
      bundling: { bundleAwsSDK: true },
    });
    urlVerdicts.grantReadWriteData(scanFn);
    reports.grantReadWriteData(scanFn);
    community.grantReadWriteData(scanFn);
    rateLimits.grantReadWriteData(scanFn);
    sbKey.grantRead(scanFn);
    pepper.grantRead(scanFn);
    captchaSecret.grantRead(scanFn);
    screenshots.grantPut(scanFn, 'uploads/*'); // signs upload slots
    screenshots.grantRead(scanFn, 'approved/*'); // signs viewing links

    // New upload -> type and size checks, metadata removed -> pending/ for a maintainer
    const shotProcessorFn = fn('ShotProcessorFn', 'shotProcessor.ts', 'ShotProcessorLogs', {
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      bundling: { bundleAwsSDK: true },
    });
    screenshots.grantRead(shotProcessorFn, 'uploads/*');
    screenshots.grantDelete(shotProcessorFn, 'uploads/*');
    screenshots.grantPut(shotProcessorFn, 'pending/*');
    reports.grantReadWriteData(shotProcessorFn);
    screenshots.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(shotProcessorFn), {
      prefix: 'uploads/',
    });

    // Reports stream -> maintainer review states -> UrlVerdicts
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
        // GitHub publishing stays off until Pages is set up: `npx cdk deploy -c publish=true`
        PUBLISH_ENABLED: this.node.tryGetContext('publish') === 'true' ? 'true' : 'false',
      },
    });
    urlVerdicts.grantReadWriteData(nightlyFn);
    reports.grantReadWriteData(nightlyFn);
    hotspots.grantWriteData(nightlyFn);
    githubToken.grantRead(nightlyFn);

    new scheduler.Schedule(this, 'NightlySchedule', {
      description: 'SafeScan nightly feed ingest, hotspot counts and public export',
      schedule: scheduler.ScheduleExpression.cron({ minute: '0', hour: '3' }), // 03:00 UTC
      // The default is 185 retries over 24 hours; one retry is enough for a nightly batch job
      target: new schedulerTargets.LambdaInvoke(nightlyFn, {
        retryAttempts: 1,
        maxEventAge: cdk.Duration.hours(1),
      }),
    });

    // ---- Public API ----

    // Browsers on the community website call the API directly, so it needs CORS
    const fnUrl = scanFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [siteOrigin, ...extraOrigins],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
        allowedHeaders: ['content-type', 'x-install-id'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // ---- Budget alert against the grant ----

    // Tracks usage before credits, so it warns as the grant is being spent.
    // `npx cdk deploy -c budgetEmail=you@example.com -c budgetUsd=20`
    const budgetEmail = this.node.tryGetContext('budgetEmail');
    if (budgetEmail) {
      const alert = (notificationType: 'ACTUAL' | 'FORECASTED', threshold: number) => ({
        notification: { notificationType, comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
        subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
      });
      new budgets.CfnBudget(this, 'GrantBudget', {
        budget: {
          budgetName: 'safescan-monthly-usage',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: Number(this.node.tryGetContext('budgetUsd') ?? 10), unit: 'USD' },
          costTypes: { includeCredit: false },
        },
        notificationsWithSubscribers: [alert('ACTUAL', 50), alert('ACTUAL', 100), alert('FORECASTED', 100)],
      });
    }

    // ---- Outputs ----

    new cdk.CfnOutput(this, 'ScanUrl', { value: fnUrl.url });
    new cdk.CfnOutput(this, 'UrlVerdictsTable', { value: urlVerdicts.tableName });
    new cdk.CfnOutput(this, 'ReportsTable', { value: reports.tableName });
    new cdk.CfnOutput(this, 'CommunityTable', { value: community.tableName });
    new cdk.CfnOutput(this, 'NightlyFunction', { value: nightlyFn.functionName });
    new cdk.CfnOutput(this, 'SiteUrl', { value: siteOrigin });
    new cdk.CfnOutput(this, 'SiteBucket', { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, 'SiteDistributionId', { value: site.distributionId });
    new cdk.CfnOutput(this, 'ScreenshotsBucket', { value: screenshots.bucketName });
  }
}
