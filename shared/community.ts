// Shared by the app, the community website and the Lambda, so all three agree on what a submission can contain.

/** The seven threat types a person can pick when sharing a link */
export const THREAT_TYPES = {
  phishing: 'Phishing',
  malware: 'Malware or virus',
  spam: 'Spam',
  adware: 'Adware',
  inappropriate: 'Inappropriate content',
  tampered_qr: 'Tampered QR code',
  other: 'Other',
} as const;

export type ThreatType = keyof typeof THREAT_TYPES;

export function isThreatType(value: unknown): value is ThreatType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THREAT_TYPES, value);
}

/** Free-text details on a submission; checked again on the server */
export const DETAILS_MAX_LENGTH = 1000;

/**
 * Result of on-device sticker detection. "unchecked" means detection didn't run,
 * so a submission never claims that no sticker was found.
 */
export type TamperWarning = 'unchecked' | 'none' | 'possible' | 'likely';

export const TAMPER_WARNINGS: readonly TamperWarning[] = ['unchecked', 'none', 'possible', 'likely'];

/** Screenshot limits. The server enforces them again: S3 refuses larger uploads, and the processor checks the file's real type. */
export const SCREENSHOT_MAX_COUNT = 3;
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SCREENSHOT_TYPES = ['image/jpeg', 'image/png'] as const;
export type ScreenshotType = (typeof SCREENSHOT_TYPES)[number];

export function isScreenshotType(value: unknown): value is ScreenshotType {
  return typeof value === 'string' && (SCREENSHOT_TYPES as readonly string[]).includes(value);
}
