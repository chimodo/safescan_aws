import type { PolygonPoint, ShadowMeasurements } from './types';

export function measureStickerBoundary(
  _frameBase64: string,
  _polygon: PolygonPoint[],
): ShadowMeasurements {
  throw new Error('On-device sticker analysis requires the SafeScan native development build.');
}
