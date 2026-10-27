export interface ShadowMeasurements {
  mode: 'textured_gray' | 'white_or_low_texture';
  activeCheck: 'gray_dark_box' | 'white_boundary';
  candidate: boolean;
  insideQrMedianGradient: number;
  insideQrLowGradientFraction: number;
  outerAnnulusMedianGradient: number;
  outerAnnulusLowGradientFraction: number;
  lowGradientFractionDelta: number;
  texturedBackground: boolean;
  grayDarkBoxPassed: boolean;
  whiteBoundaryCoverage: number;
  whiteBoundarySideCoverage: [number, number, number, number];
  whiteBoundarySideGradient: [number, number, number, number];
  whiteBoundarySideContrast: [number, number, number, number];
  whiteBoundaryEdgeStrength: number;
  whiteBoundaryBackgroundGradient: number;
  whiteBoundaryGradientExcess: number;
  whiteBoundaryPassed: boolean;
}

export interface PolygonPoint {
  x: number;
  y: number;
}

export type TamperFeedback = 'correct' | 'incorrect' | 'unsure' | null;

export interface TamperTrial {
  id: string;
  capturedAt: string;
  status: 'complete' | 'inconclusive' | 'unavailable';
  predictedSticker: boolean | null;
  captureMs: number;
  processingMs: number;
  totalMs: number;
  message?: string;
  measurements?: ShadowMeasurements;
  feedback: TamperFeedback;
}

export type TamperCapture = Omit<TamperTrial, 'id' | 'capturedAt' | 'feedback'>;

export interface ConfusionMetrics {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  labeled: number;
  accuracy: number;
  precision: number;
  recall: number;
  specificity: number;
}
