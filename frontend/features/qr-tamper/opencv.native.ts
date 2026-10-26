import {
  BorderTypes,
  ColorConversionCodes,
  DataTypes,
  DecompTypes,
  InterpolationFlags,
  Mat,
  OpenCV,
  Point2f,
  Point2fVector,
  Scalar,
  Size,
} from 'react-native-fast-opencv';
import type { PolygonPoint, ShadowMeasurements } from './types';

const OUTPUT_SIZE = 960;
const QR_SIZE = 640;
const MARGIN = (OUTPUT_SIZE - QR_SIZE) / 2;
const LOW_GRADIENT_MAX = 12;
const TEXTURED_ANNULUS_MEDIAN_MIN = 5;
const GRAY_ANNULUS_MEDIAN_MIN = 15;
const DARK_FRACTION_DELTA_MIN = 0.4;
const WHITE_EDGE_COVERAGE_MIN = 0.5;
const WHITE_EDGE_EXCESS_MIN = 3;
const WHITE_PROFILE_CENTER = 1.14;
const WHITE_PROFILE_HALF_WIDTH = 0.02;

function requireOpenCVFunction(name: keyof typeof OpenCV) {
  if (typeof OpenCV[name] !== 'function') {
    throw new Error(
      `The native OpenCV binding "${String(name)}" is unavailable. Rebuild the development app with the current native dependencies.`,
    );
  }
}

function track<T extends { release: () => void }>(resources: { release: () => void }[], value: T): T {
  resources.push(value);
  return value;
}

function orderedQuad(polygon: PolygonPoint[]) {
  if (polygon.length < 4) throw new Error('The QR corners were not available in this camera frame.');
  const points = polygon.slice(0, 4);
  const sums = points.map(({ x, y }) => x + y);
  const differences = points.map(({ x, y }) => y - x);
  const ordered = [
    points[sums.indexOf(Math.min(...sums))],
    points[differences.indexOf(Math.min(...differences))],
    points[sums.indexOf(Math.max(...sums))],
    points[differences.indexOf(Math.max(...differences))],
  ];
  if (new Set(ordered.map(({ x, y }) => `${x},${y}`)).size !== 4) {
    throw new Error('The QR corners were ambiguous. Center the code in the camera and try again.');
  }
  return ordered;
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
  if (
    polygon.length !== 4 ||
    polygon.some(({ x, y }) =>
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x >= source.cols ||
      y < 0 ||
      y >= source.rows,
    )
  ) {
    throw new Error('QR corner detection returned invalid points for the captured image.');
  }
  const margin = MARGIN;
  const edge = margin + QR_SIZE;
  const sourcePoints = pointVector(orderedQuad(polygon), resources);
  const destinationPoints = pointVector([
    { x: margin, y: margin },
    { x: edge, y: margin },
    { x: edge, y: edge },
    { x: margin, y: edge },
  ], resources);
  requireOpenCVFunction('getPerspectiveTransform');
  const transform = track(
    resources,
    OpenCV.getPerspectiveTransform(sourcePoints, destinationPoints, DecompTypes.DECOMP_LU),
  );
  const view = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_8UC3));
  requireOpenCVFunction('warpPerspective');
  OpenCV.warpPerspective(
    source,
    view,
    transform,
    track(resources, Size.create(OUTPUT_SIZE, OUTPUT_SIZE)),
    InterpolationFlags.INTER_LINEAR,
    BorderTypes.BORDER_CONSTANT,
    track(resources, Scalar.create(0, 0, 0)),
  );
  return { view, margin, edge };
}

function gradientMagnitude(gray: Mat, resources: { release: () => void }[]) {
  const xGradient = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_32FC1));
  const yGradient = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_32FC1));
  const magnitude = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_32FC1));
  const angle = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_32FC1));
  requireOpenCVFunction('Sobel');
  OpenCV.Sobel(gray, xGradient, DataTypes.CV_32F, 1, 0, 3, 0.25, 0, BorderTypes.BORDER_DEFAULT);
  OpenCV.Sobel(gray, yGradient, DataTypes.CV_32F, 0, 1, 3, 0.25, 0, BorderTypes.BORDER_DEFAULT);
  requireOpenCVFunction('cartToPolar');
  OpenCV.cartToPolar(xGradient, yGradient, magnitude, angle);
  const { buffer: magnitudeValues } = magnitude.toBuffer('float32');
  return magnitudeValues;
}

function pythonRound(value: number) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function histogramPercentile(histogram: number[], rank: number) {
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative > rank) return value;
  }
  throw new Error('The captured image has no valid pixels to normalize.');
}

function normalizeByPercentiles(gray: Mat, resources: { release: () => void }[]) {
  const { buffer: grayPixels } = gray.toBuffer('uint8');
  const histogram = new Array<number>(256).fill(0);
  for (const value of grayPixels) histogram[value] += 1;

  const lower = histogramPercentile(histogram, Math.floor(0.02 * (grayPixels.length - 1)));
  const upper = histogramPercentile(histogram, Math.floor(0.98 * (grayPixels.length - 1)));
  const scale = 255 / Math.max(1, upper - lower);
  const normalizedPixels = new Uint8Array(grayPixels.length);
  for (let index = 0; index < grayPixels.length; index += 1) {
    normalizedPixels[index] = Math.max(
      0,
      Math.min(255, pythonRound(Math.fround((grayPixels[index] - lower) * scale))),
    );
  }
  return track(
    resources,
    Mat.createFromBuffer('uint8', OUTPUT_SIZE, OUTPUT_SIZE, 1, normalizedPixels),
  );
}

function squareMask(scale: number) {
  const half = QR_SIZE * scale / 2;
  const mask = new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE);
  for (let y = 0; y < OUTPUT_SIZE; y += 1) {
    for (let x = 0; x < OUTPUT_SIZE; x += 1) {
      if (Math.abs(y - OUTPUT_SIZE / 2) < half && Math.abs(x - OUTPUT_SIZE / 2) < half) {
        mask[y * OUTPUT_SIZE + x] = 1;
      }
    }
  }
  return mask;
}

function ringMask(inner: number, outer: number) {
  const innerMask = squareMask(inner);
  const outerMask = squareMask(outer);
  const mask = new Uint8Array(outerMask.length);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = outerMask[index] && !innerMask[index] ? 1 : 0;
  }
  return mask;
}

function maskedGradientStats(values: Float32Array, mask: Uint8Array) {
  const selected: number[] = [];
  let lowCount = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const value = values[index];
    selected.push(value);
    if (value <= LOW_GRADIENT_MAX) lowCount += 1;
  }
  if (!selected.length) throw new Error('The QR or surrounding Sobel region is not visible enough. Center the QR and try again.');
  selected.sort((a, b) => a - b);
  const middle = Math.floor(selected.length / 2);
  return {
    median: selected.length % 2 === 0
      ? (selected[middle - 1] + selected[middle]) / 2
      : selected[middle],
    lowGradientFraction: lowCount / selected.length,
  };
}

function meanMaskedGradient(values: Float32Array, mask: Uint8Array) {
  let total = 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    total += values[index];
    count += 1;
  }
  return count ? total / count : 0;
}

function boundaryMetrics(
  gray: Mat,
  magnitude: Float32Array,
  centerScale: number,
  width: number,
) {
  const center = OUTPUT_SIZE / 2;
  const half = pythonRound(QR_SIZE * centerScale / 2);
  const extent = pythonRound(QR_SIZE * centerScale);
  const thickness = Math.max(2, pythonRound(QR_SIZE * width));
  const { buffer: grayPixels } = gray.toBuffer('uint8');
  const sideGradients: number[] = [];
  const sideContrasts: number[] = [];
  const sideCoverages: number[] = [];

  for (let side = 0; side < 4; side += 1) {
    const sideMagnitudes: number[] = [];
    let hits = 0;
    let count = 0;
    const profiles: number[] = [];
    for (let distance = -Math.floor(extent / 2); distance <= Math.floor(extent / 2); distance += 1) {
      const x = side === 0 || side === 2
        ? center + distance
        : side === 1 ? center + half : center - half;
      const y = side === 1 || side === 3
        ? center + distance
        : side === 0 ? center - half : center + half;
      let maxMagnitude = Number.NEGATIVE_INFINITY;
      for (let delta = -thickness; delta <= thickness; delta += 1) {
        const sampleX = x + (side === 1 || side === 3 ? delta : 0);
        const sampleY = y + (side === 0 || side === 2 ? delta : 0);
        if (sampleX < 1 || sampleX >= OUTPUT_SIZE - 1 || sampleY < 1 || sampleY >= OUTPUT_SIZE - 1) continue;
        maxMagnitude = Math.max(maxMagnitude, magnitude[sampleY * OUTPUT_SIZE + sampleX]);
      }
      if (Number.isFinite(maxMagnitude)) {
        sideMagnitudes.push(maxMagnitude);
        count += 1;
        if (maxMagnitude >= 12) hits += 1;
      }

      let profileSum = 0;
      let profileCount = 0;
      for (let offset = -4; offset <= 4; offset += 1) {
        const sampleX = x + (side === 1 || side === 3 ? offset : 0);
        const sampleY = y + (side === 0 || side === 2 ? offset : 0);
        if (sampleX < 1 || sampleX >= OUTPUT_SIZE - 1 || sampleY < 1 || sampleY >= OUTPUT_SIZE - 1) continue;
        profileSum += grayPixels[sampleY * OUTPUT_SIZE + sampleX];
        profileCount += 1;
      }
      profiles.push(profileSum / Math.max(1, profileCount));
    }

    let outside = (profiles[0] + profiles[1]) / 2;
    let inside = (profiles[7] + profiles[8]) / 2;
    if (side === 1 || side === 2) [outside, inside] = [inside, outside];
    sideGradients.push(sideMagnitudes.reduce((sum, value) => sum + value, 0) / Math.max(1, sideMagnitudes.length));
    sideCoverages.push(hits / Math.max(1, count));
    sideContrasts.push(Math.abs(outside - inside));
  }

  const coverage = sideCoverages.reduce((sum, value) => sum + value, 0) / 4;
  return {
    edgeStrength: sideGradients.reduce((sum, value) => sum + value, 0) / 4,
    coverage,
    sideCoverage: sideCoverages as [number, number, number, number],
    sideGradients: sideGradients as [number, number, number, number],
    sideContrasts: sideContrasts as [number, number, number, number],
  };
}

function measureShadowPattern(gray: Mat, resources: { release: () => void }[]) {
  const rawGradient = gradientMagnitude(gray, resources);
  const inside = maskedGradientStats(rawGradient, squareMask(1));
  const outer = maskedGradientStats(rawGradient, ringMask(1.08, 1.25));
  const lowGradientFractionDelta = inside.lowGradientFraction - outer.lowGradientFraction;
  const texturedBackground = outer.median >= TEXTURED_ANNULUS_MEDIAN_MIN;
  const grayDarkBoxPassed =
    texturedBackground &&
    outer.median >= GRAY_ANNULUS_MEDIAN_MIN &&
    lowGradientFractionDelta >= DARK_FRACTION_DELTA_MIN;

  const normalized = normalizeByPercentiles(gray, resources);
  const normalizedGradient = gradientMagnitude(normalized, resources);
  const profile = boundaryMetrics(
    normalized,
    normalizedGradient,
    WHITE_PROFILE_CENTER,
    WHITE_PROFILE_HALF_WIDTH,
  );
  const backgroundGradient = meanMaskedGradient(normalizedGradient, ringMask(1.34, 1.48));
  const gradientExcess = profile.edgeStrength - backgroundGradient;
  const coverage = profile.coverage;
  const whiteBoundaryPassed =
    coverage >= WHITE_EDGE_COVERAGE_MIN && gradientExcess >= WHITE_EDGE_EXCESS_MIN;
  const mode = texturedBackground ? 'textured_gray' : 'white_or_low_texture';

  return {
    mode,
    activeCheck: texturedBackground ? 'gray_dark_box' : 'white_boundary',
    candidate: texturedBackground ? grayDarkBoxPassed : whiteBoundaryPassed,
    insideQrMedianGradient: inside.median,
    insideQrLowGradientFraction: inside.lowGradientFraction,
    outerAnnulusMedianGradient: outer.median,
    outerAnnulusLowGradientFraction: outer.lowGradientFraction,
    lowGradientFractionDelta,
    texturedBackground,
    grayDarkBoxPassed,
    whiteBoundaryCoverage: coverage,
    whiteBoundarySideCoverage: profile.sideCoverage,
    whiteBoundarySideGradient: profile.sideGradients,
    whiteBoundarySideContrast: profile.sideContrasts,
    whiteBoundaryEdgeStrength: profile.edgeStrength,
    whiteBoundaryBackgroundGradient: backgroundGradient,
    whiteBoundaryGradientExcess: gradientExcess,
    whiteBoundaryPassed,
  } as const;
}

export function measureStickerBoundary(
  frameBase64: string,
  polygon: PolygonPoint[],
): ShadowMeasurements {
  if (!frameBase64) throw new Error('The camera did not return image data for sticker analysis.');

  const resources: { release: () => void }[] = [];
  let stage = 'decoding the captured image';
  try {
    const frame = track(resources, Mat.createFromBase64(frameBase64));
    stage = 'rectifying the detected QR';
    const rectified = warpToStableView(frame, polygon, resources);
    const gray = track(resources, Mat.create(OUTPUT_SIZE, OUTPUT_SIZE, DataTypes.CV_8UC1));
    stage = 'converting the image to grayscale';
    requireOpenCVFunction('cvtColor');
    OpenCV.cvtColor(rectified.view, gray, ColorConversionCodes.COLOR_BGR2GRAY);
    stage = 'measuring the QR boundary';
    return measureShadowPattern(gray, resources);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Sticker analysis failed while ${stage}: ${message}`, { cause: error });
  } finally {
    resources.forEach((resource) => resource.release());
  }
}
