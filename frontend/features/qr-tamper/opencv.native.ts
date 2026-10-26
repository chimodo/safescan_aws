import {
  BorderTypes,
  ColorConversionCodes,
  DataTypes,
  DecompTypes,
  InterpolationFlags,
  LineTypes,
  Mat,
  OpenCV,
  Point,
  Point2f,
  Point2fVector,
  PointVector,
  Scalar,
  Size,
} from 'react-native-fast-opencv';
import type { GlossMeasurements, PolygonPoint } from './types';

const OUTPUT_SIZE = 400;
const MARGIN_RATIO = 0.24;
const STICKER_BORDER_RATIO = 0.12;
const VALUE_THRESHOLD = 220;
const SATURATION_THRESHOLD = 70;

function track<T extends { release: () => void }>(resources: { release: () => void }[], value: T): T {
  resources.push(value);
  return value;
}

function orderedQuad(polygon: PolygonPoint[]) {
  if (polygon.length < 4) throw new Error('The QR corners were not available in this camera frame.');
  const points = polygon.slice(0, 4);
  const center = points.reduce(
    (result, point) => ({ x: result.x + point.x / 4, y: result.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const ordered = [...points].sort(
    (a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );
  const start = ordered.reduce((bestIndex, point, index) => {
    const best = ordered[bestIndex];
    return point.x + point.y < best.x + best.y ? index : bestIndex;
  }, 0);
  return [...ordered.slice(start), ...ordered.slice(0, start)];
}

function pointVector(points: PolygonPoint[], resources: { release: () => void }[]) {
  if (points.length !== 4 || points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error('The QR corners could not be mapped reliably. Center the code in the camera and try again.');
  }
  const vector = track(resources, Point2fVector.create());
  points.forEach(({ x, y }) => {
    vector.push(track(resources, Point2f.create(x, y)));
  });
  return vector;
}

function warpToStableView(
  source: Mat,
  polygon: PolygonPoint[],
  resources: { release: () => void }[],
) {
  const margin = Math.round(OUTPUT_SIZE * MARGIN_RATIO);
  const edge = OUTPUT_SIZE - margin - 1;
  const sourcePoints = pointVector(orderedQuad(polygon), resources);
  const destinationPoints = pointVector([
    { x: margin, y: margin },
    { x: edge, y: margin },
    { x: edge, y: edge },
    { x: margin, y: edge },
  ], resources);
  const transform = track(
    resources,
    OpenCV.getPerspectiveTransform(sourcePoints, destinationPoints, DecompTypes.DECOMP_LU),
  );
  const view = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_8UC3));
  OpenCV.warpPerspective(
    source,
    view,
    transform,
    track(resources, Size.create(OUTPUT_SIZE, OUTPUT_SIZE)),
    InterpolationFlags.INTER_LINEAR,
    BorderTypes.BORDER_CONSTANT,
    track(resources, Scalar.create(0, 0, 0)),
  );
  const sourceValid = track(
    resources,
    Mat.createFromBuffer(
      'uint8',
      source.rows,
      source.cols,
      1,
      new Uint8Array(source.rows * source.cols).fill(255),
    ),
  );
  const valid = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_8UC1));
  OpenCV.warpPerspective(
    sourceValid,
    valid,
    transform,
    track(resources, Size.create(OUTPUT_SIZE, OUTPUT_SIZE)),
    InterpolationFlags.INTER_NEAREST,
    BorderTypes.BORDER_CONSTANT,
    track(resources, Scalar.create(0, 0, 0)),
  );
  return { view, valid, margin, edge };
}

function blankMask(resources: { release: () => void }[]) {
  return track(
    resources,
    Mat.createFromBuffer('uint8', OUTPUT_SIZE, OUTPUT_SIZE, 1, new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE)),
  );
}

function andMasks(
  first: Mat,
  second: Mat,
  resources: { release: () => void }[],
) {
  const output = blankMask(resources);
  OpenCV.bitwise_and(first, second, output);
  return output;
}

function fraction(mask: Mat, region: Mat, resources: { release: () => void }[]) {
  const area = OpenCV.countNonZero(region).value;
  if (area === 0) return 0;
  const selected = andMasks(mask, region, resources);
  return OpenCV.countNonZero(selected).value / area;
}

function maskedMean(channel: Mat, region: Mat, resources: { release: () => void }[]) {
  return track(resources, OpenCV.mean(channel, region)).a;
}

export function measureSpecularResponse(
  frameOffBase64: string,
  frameOnBase64: string,
  polygonOff: PolygonPoint[],
  polygonOn: PolygonPoint[],
): GlossMeasurements {
  if (!frameOffBase64 || !frameOnBase64) throw new Error('The camera did not return both image captures.');

  const resources: { release: () => void }[] = [];
  try {
    const frameOff = track(resources, Mat.createFromBase64(frameOffBase64));
    const frameOn = track(resources, Mat.createFromBase64(frameOnBase64));
    if (frameOff.rows !== frameOn.rows || frameOff.cols !== frameOn.cols) {
      throw new Error('The camera capture dimensions changed during the check. Please try again.');
    }

    const off = warpToStableView(frameOff, polygonOff, resources);
    const on = warpToStableView(frameOn, polygonOn, resources);
    const commonValid = andMasks(off.valid, on.valid, resources);
    const qrRegion = blankMask(resources);
    const qrVertices = track(resources, PointVector.create());
    [
      { x: off.margin, y: off.margin },
      { x: off.edge, y: off.margin },
      { x: off.edge, y: off.edge },
      { x: off.margin, y: off.edge },
    ].forEach(({ x, y }) => qrVertices.push(track(resources, Point.create(x, y))));
    OpenCV.fillConvexPoly(qrRegion, qrVertices, track(resources, Scalar.create(255)), LineTypes.LINE_8);

    const qrValid = andMasks(qrRegion, commonValid, resources);
    const borderPx = Math.max(1, Math.round((off.edge - off.margin + 1) * STICKER_BORDER_RATIO));
    const outerBox = blankMask(resources);
    OpenCV.rectangle(
      outerBox,
      track(resources, Point.create(Math.max(0, off.margin - borderPx), Math.max(0, off.margin - borderPx))),
      track(resources, Point.create(Math.min(OUTPUT_SIZE - 1, off.edge + borderPx), Math.min(OUTPUT_SIZE - 1, off.edge + borderPx))),
      track(resources, Scalar.create(255)),
      LineTypes.FILLED,
      LineTypes.LINE_8,
    );
    const outerValid = andMasks(outerBox, commonValid, resources);
    const inverseQr = blankMask(resources);
    OpenCV.bitwise_not(qrRegion, inverseQr);
    const stickerBorderRegion = andMasks(andMasks(inverseQr, outerValid, resources), commonValid, resources);
    const inverseOuter = blankMask(resources);
    OpenCV.bitwise_not(outerBox, inverseOuter);
    const backgroundRegion = andMasks(inverseOuter, commonValid, resources);

    const offHsv = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_8UC3));
    const onHsv = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_8UC3));
    OpenCV.cvtColor(off.view, offHsv, ColorConversionCodes.COLOR_BGR2HSV);
    OpenCV.cvtColor(on.view, onHsv, ColorConversionCodes.COLOR_BGR2HSV);
    const offHighlights = blankMask(resources);
    const onHighlights = blankMask(resources);
    OpenCV.inRange(
      offHsv,
      track(resources, Scalar.create(0, 0, VALUE_THRESHOLD)),
      track(resources, Scalar.create(180, SATURATION_THRESHOLD, 255)),
      offHighlights,
    );
    OpenCV.inRange(
      onHsv,
      track(resources, Scalar.create(0, 0, VALUE_THRESHOLD)),
      track(resources, Scalar.create(180, SATURATION_THRESHOLD, 255)),
      onHighlights,
    );
    const offChannels = blankMask(resources);
    const onChannels = blankMask(resources);
    OpenCV.extractChannel(offHsv, offChannels, 2);
    OpenCV.extractChannel(onHsv, onChannels, 2);
    const inverseOffHighlights = blankMask(resources);
    OpenCV.bitwise_not(offHighlights, inverseOffHighlights);
    const newHighlights = andMasks(onHighlights, inverseOffHighlights, resources);
    const qrAndBorder = blankMask(resources);
    OpenCV.bitwise_or(qrValid, stickerBorderRegion, qrAndBorder);

    const qrHighlightFractionOff = fraction(offHighlights, qrValid, resources);
    const qrHighlightFractionOn = fraction(onHighlights, qrValid, resources);
    const qrNewHighlightFraction = fraction(newHighlights, qrValid, resources);
    const borderHighlightFractionOff = fraction(offHighlights, stickerBorderRegion, resources);
    const borderHighlightFractionOn = fraction(onHighlights, stickerBorderRegion, resources);
    const borderNewHighlightFraction = fraction(newHighlights, stickerBorderRegion, resources);
    const backgroundHighlightFractionOff = fraction(offHighlights, backgroundRegion, resources);
    const backgroundHighlightFractionOn = fraction(onHighlights, backgroundRegion, resources);
    const backgroundNewHighlightFraction = fraction(newHighlights, backgroundRegion, resources);
    const stickerAreaNew = fraction(newHighlights, qrAndBorder, resources);
    const meanOff = track(resources, OpenCV.mean(offChannels));
    const meanOn = track(resources, OpenCV.mean(onChannels));
    const qrMeanOff = maskedMean(offChannels, qrValid, resources);
    const qrMeanOn = maskedMean(onChannels, qrValid, resources);
    const backgroundMeanOff = maskedMean(offChannels, backgroundRegion, resources);
    const backgroundMeanOn = maskedMean(onChannels, backgroundRegion, resources);

    if (OpenCV.countNonZero(qrValid).value === 0 || OpenCV.countNonZero(backgroundRegion).value === 0) {
      throw new Error('The QR needs more visible space around it. Move it toward the center and try again.');
    }

    return {
      qr_highlight_fraction_off: qrHighlightFractionOff,
      qr_highlight_fraction_on: qrHighlightFractionOn,
      qr_new_highlight_fraction: qrNewHighlightFraction,
      sticker_border_highlight_fraction_off: borderHighlightFractionOff,
      sticker_border_highlight_fraction_on: borderHighlightFractionOn,
      sticker_border_new_highlight_fraction: borderNewHighlightFraction,
      background_highlight_fraction_off: backgroundHighlightFractionOff,
      background_highlight_fraction_on: backgroundHighlightFractionOn,
      background_new_highlight_fraction: backgroundNewHighlightFraction,
      response_index: Math.max(0, stickerAreaNew - backgroundNewHighlightFraction),
      qr_mean_value_off: qrMeanOff,
      qr_mean_value_on: qrMeanOn,
      background_mean_value_off: backgroundMeanOff,
      background_mean_value_on: backgroundMeanOn,
      rectified_mean_value_off: meanOff.a,
      rectified_mean_value_on: meanOn.a,
      rectified_highlight_fraction_off: fraction(offHighlights, commonValid, resources),
      rectified_highlight_fraction_on: fraction(onHighlights, commonValid, resources),
    };
  } finally {
    resources.forEach((resource) => resource.release());
  }
}
