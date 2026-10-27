import type { ScreenshotType, ThreatType } from '../../shared/community';
import { getInstallId, SCANNER_ENDPOINT } from './useURLScanner';

// Community website (InfraStack output "SiteUrl"). Override with EXPO_PUBLIC_COMMUNITY_URL in frontend/.env.
export const COMMUNITY_SITE_URL = (process.env.EXPO_PUBLIC_COMMUNITY_URL ?? 'https://dyyaknu678lsn.cloudfront.net').replace(/\/+$/, '');
export const CAPTCHA_PAGE_URL = `${COMMUNITY_SITE_URL}/captcha.html`;

export function communityLinkUrl(urlHash: string) {
  return `${COMMUNITY_SITE_URL}/link/${encodeURIComponent(urlHash)}`;
}

export interface UploadSlot {
  slot: number;
  contentType: ScreenshotType;
  url: string;
  fields: Record<string, string>;
}

export interface ReportResult {
  reportId: string;
  urlHash: string;
  linkPath: string;
  uploads: UploadSlot[];
}

export interface ReportInput {
  url: string;
  threatType: ThreatType;
  details: string;
  screenshotTypes: ScreenshotType[];
  captchaToken: string;
}

/** An error the API sent, with the message written for the person */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function fallbackMessage(status: number) {
  if (status === 403) return 'The human check failed or expired. Please try again.';
  if (status === 429) return 'You’ve reached the hourly limit for sharing. Please try again later.';
  if (status >= 500) return 'SafeScan’s community service is unavailable. Please try again in a few minutes.';
  return `SafeScan couldn’t accept this (error ${status}).`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function submitReport(input: ReportInput): Promise<ReportResult> {
  const installId = await getInstallId();
  let response: Response;
  try {
    response = await fetch(new URL('report', SCANNER_ENDPOINT).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Install-Id': installId },
      body: JSON.stringify({ ...input, tamperWarning: 'unchecked' }),
    });
  } catch {
    throw new ApiError(0, 'SafeScan couldn’t reach its service. Check your connection and try again.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.status !== 201) {
    const message = isRecord(payload) && typeof payload.error === 'string' && payload.error
      ? payload.error
      : fallbackMessage(response.status);
    throw new ApiError(response.status, message);
  }
  if (!isRecord(payload) || typeof payload.linkPath !== 'string' || typeof payload.reportId !== 'string') {
    throw new ApiError(response.status, 'SafeScan sent an unexpected response. Please try again.');
  }
  return {
    reportId: payload.reportId,
    urlHash: String(payload.urlHash ?? ''),
    linkPath: payload.linkPath,
    uploads: Array.isArray(payload.uploads) ? (payload.uploads as UploadSlot[]) : [],
  };
}

/** S3 presigned POST: every policy field first, then the file. Resolves true on 204. */
export async function uploadScreenshot(slot: UploadSlot, uri: string): Promise<boolean> {
  const form = new FormData();
  for (const [key, value] of Object.entries(slot.fields)) form.append(key, value);
  const extension = slot.contentType === 'image/png' ? 'png' : 'jpg';
  // React Native's FormData accepts a { uri, name, type } file descriptor
  form.append('file', { uri, name: `screenshot-${slot.slot}.${extension}`, type: slot.contentType } as unknown as Blob);
  try {
    const response = await fetch(slot.url, { method: 'POST', body: form });
    return response.status === 204;
  } catch {
    return false;
  }
}
