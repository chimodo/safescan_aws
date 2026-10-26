import type { GlossMeasurements, PolygonPoint } from './types';

export function measureSpecularResponse(
  _frameOffBase64: string,
  _frameOnBase64: string,
  _polygonOff: PolygonPoint[],
  _polygonOn: PolygonPoint[],
): GlossMeasurements {
  throw new Error('On-device sticker analysis requires the SafeScan native development build.');
}
