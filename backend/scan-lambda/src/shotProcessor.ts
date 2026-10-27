// Runs when a file lands in uploads/. Checks it really is a JPEG or PNG within the limits,
// removes its metadata, stores the clean copy in pending/ for a maintainer, and deletes the raw upload.
import type { S3Event } from 'aws-lambda';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { SCREENSHOT_MAX_BYTES } from '../../../shared/community';
import { ddb, TABLES } from './db';
import { getReport } from './community';
import { cleanImage } from './imageClean';
import { s3, SCREENSHOTS_BUCKET, UPLOAD_KEY, type Screenshot } from './screenshots';

export const handler = async (event: S3Event) => {
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    // An error here (not a refused file) throws, so S3 retries with the upload still in place;
    // anything left behind is removed after a day by the bucket's lifecycle rule
    await processUpload(key, record.s3.object.size);
    await s3.send(new DeleteObjectCommand({ Bucket: SCREENSHOTS_BUCKET, Key: key }));
  }
};

async function processUpload(key: string, size: number) {
  const match = UPLOAD_KEY.exec(key);
  if (!match) return console.warn('Ignoring unexpected upload key', key);
  const [, reportId, slotText] = match;
  const slot = Number(slotText);

  const report = await getReport(reportId);
  const shot = report?.screenshots?.[slot];
  if (!shot || shot.status !== 'awaiting_upload') return console.warn('No open slot for upload', key);

  if (size > SCREENSHOT_MAX_BYTES) return markSlot(reportId, slot, { ...shot, status: 'invalid', reason: 'file too large' });

  const object = await s3.send(new GetObjectCommand({ Bucket: SCREENSHOTS_BUCKET, Key: key }));
  const cleaned = cleanImage(Buffer.from(await object.Body!.transformToByteArray()));
  if (!cleaned.ok) {
    console.warn('Refused upload', key, cleaned.reason);
    return markSlot(reportId, slot, { ...shot, status: 'invalid', reason: cleaned.reason });
  }

  const cleanKey = `pending/${reportId}/${slot}.${cleaned.ext}`;
  await s3.send(
    new PutObjectCommand({ Bucket: SCREENSHOTS_BUCKET, Key: cleanKey, Body: cleaned.bytes, ContentType: cleaned.type })
  );
  await markSlot(reportId, slot, {
    slot,
    status: 'pending',
    contentType: cleaned.type,
    key: cleanKey,
    width: cleaned.width,
    height: cleaned.height,
    bytes: cleaned.bytes.length,
  });
}

/** Updates one slot, only if it is still waiting for its upload, so a second upload can't replace the first */
async function markSlot(reportId: string, slot: number, value: Screenshot) {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLES.reports,
        Key: { reportId },
        UpdateExpression: `SET #shots[${slot}] = :value`,
        ConditionExpression: `#shots[${slot}].#status = :awaiting`,
        ExpressionAttributeNames: { '#shots': 'screenshots', '#status': 'status' },
        ExpressionAttributeValues: { ':value': value, ':awaiting': 'awaiting_upload' },
      })
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    console.warn('Slot already used', reportId, slot);
  }
}
