// Screenshots on community submissions. The bucket is private and has three folders:
//   uploads/<reportId>/<slot>         raw uploads, written by the phone or browser through a pre-signed POST
//   pending/<reportId>/<slot>.<ext>   checked and metadata-free copies, waiting for a maintainer
//   approved/<reportId>/<slot>.<ext>  shown on the link page through short-lived links
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SCREENSHOT_MAX_BYTES, type ScreenshotType } from '../../../shared/community';

export const s3 = new S3Client({});
export const SCREENSHOTS_BUCKET = process.env.SCREENSHOTS_BUCKET!;

/** How long an upload slot stays usable, and how long a link to an approved image works */
const UPLOAD_WINDOW_SECONDS = 600;
const VIEW_SECONDS = 900;

export type ScreenshotStatus = 'awaiting_upload' | 'pending' | 'approved' | 'rejected' | 'invalid';

/** One entry in a submission's `screenshots` list; the list index is the slot */
export interface Screenshot {
  slot: number;
  status: ScreenshotStatus;
  contentType: string;
  key?: string; // set once processed
  width?: number;
  height?: number;
  bytes?: number;
  reason?: string; // why an upload was refused
}

export const uploadKey = (reportId: string, slot: number) => `uploads/${reportId}/${slot}`;
export const UPLOAD_KEY = /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9])$/;

/** A pre-signed POST that only accepts one file of the declared type, up to the size limit, for 10 minutes */
export async function uploadSlot(reportId: string, slot: number, contentType: ScreenshotType) {
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: SCREENSHOTS_BUCKET,
    Key: uploadKey(reportId, slot),
    Conditions: [['content-length-range', 1, SCREENSHOT_MAX_BYTES]],
    Fields: { 'Content-Type': contentType },
    Expires: UPLOAD_WINDOW_SECONDS,
  });
  return { slot, contentType, url, fields, expiresInSeconds: UPLOAD_WINDOW_SECONDS };
}

/** A temporary link to an approved image. The forced content type stops a disguised file from running as a page. */
export async function viewUrl(shot: Screenshot): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: SCREENSHOTS_BUCKET,
      Key: shot.key!,
      ResponseContentType: shot.contentType,
      ResponseContentDisposition: 'inline',
      ResponseCacheControl: `private, max-age=${VIEW_SECONDS}`,
    }),
    { expiresIn: VIEW_SECONDS }
  );
}

/** Approved screenshots as public links, in slot order */
export async function approvedScreenshotLinks(shots: Screenshot[] | undefined) {
  const approved = (shots ?? []).filter((s) => s.status === 'approved' && s.key);
  return Promise.all(approved.map(async (s) => ({ url: await viewUrl(s), width: s.width, height: s.height })));
}
