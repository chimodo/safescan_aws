export interface GlossMeasurements {
  qr_highlight_fraction_off: number;
  qr_highlight_fraction_on: number;
  qr_new_highlight_fraction: number;
  sticker_border_highlight_fraction_off: number;
  sticker_border_highlight_fraction_on: number;
  sticker_border_new_highlight_fraction: number;
  background_highlight_fraction_off: number;
  background_highlight_fraction_on: number;
  background_new_highlight_fraction: number;
  response_index: number;
  qr_mean_value_off: number;
  qr_mean_value_on: number;
  background_mean_value_off: number;
  background_mean_value_on: number;
  rectified_mean_value_off: number;
  rectified_mean_value_on: number;
  rectified_highlight_fraction_off: number;
  rectified_highlight_fraction_on: number;
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
  responseIndex: number | null;
  captureMs: number;
  processingMs: number;
  totalMs: number;
  message?: string;
  measurements?: GlossMeasurements;
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
