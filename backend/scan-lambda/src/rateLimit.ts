import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb, TABLES } from './db';

/**
 * Fixed one-hour window per caller. Returns false once the caller is over the limit.
 * One conditional write per request; rows expire via TTL an hour after the window ends.
 */
export async function withinLimit(action: 'scan' | 'report', callerHash: string, limit: number): Promise<boolean> {
  const hour = Math.floor(Date.now() / 3_600_000);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLES.rateLimits,
        Key: { key: `${action}#${callerHash}#${hour}` },
        UpdateExpression: 'ADD #count :one SET #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
        ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':ttl': (hour + 2) * 3600 },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}
