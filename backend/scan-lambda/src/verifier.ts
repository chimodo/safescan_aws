// Triggered by the Reports DynamoDB stream.
// INSERT: evaluate the reported URL's verification state.
// MODIFY into or out of "verified": update the URL's UrlVerdicts row, so a cached
// clean result can't hide a confirmed threat.
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from 'aws-lambda';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { ddb, TABLES, verdictRow, type ReportRow } from './db';
import { CONFIG } from './config';
import { evaluateUrl } from './verification';

const image = (img: unknown) =>
  img ? (unmarshall(img as Record<string, AttributeValue>) as ReportRow) : undefined;

export const handler = async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const next = image(record.dynamodb?.NewImage);
      const prev = image(record.dynamodb?.OldImage);

      if (record.eventName === 'INSERT' && next) {
        await evaluateUrl(next.urlHash);
      } else if (record.eventName === 'MODIFY' && next && prev && next.urlStatus !== prev.urlStatus) {
        if (next.urlStatus === 'verified') await markDangerous(next);
        else if (prev.urlStatus === 'verified') await clearCommunityVerdict(next.urlHash);
      }
    } catch (err) {
      console.error('Failed to process stream record', record.eventID, err);
      batchItemFailures.push({ itemIdentifier: record.dynamodb!.SequenceNumber! });
    }
  }
  return { batchItemFailures };
};

async function markDangerous(report: ReportRow) {
  const row = verdictRow(
    {
      urlHash: report.urlHash,
      url: report.url,
      verdict: 'DANGEROUS',
      threatTypes: ['COMMUNITY_REPORT'],
      source: 'community',
    },
    CONFIG.communityVerdictMs
  );
  await ddb.send(new PutCommand({ TableName: TABLES.verdicts, Item: row }));
}

/** A maintainer reversed a verification: drop the community verdict so the next scan re-checks */
async function clearCommunityVerdict(urlHash: string) {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLES.verdicts,
        Key: { urlHash },
        ConditionExpression: '#source = :community',
        ExpressionAttributeNames: { '#source': 'source' },
        ExpressionAttributeValues: { ':community': 'community' },
      })
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}
