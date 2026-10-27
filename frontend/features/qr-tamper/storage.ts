import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShadowMeasurements, TamperTrial } from './types';

const STORAGE_KEY = '@safescan/tamper-trials-v1';
const MAX_TRIALS = 500;

function isShadowMeasurements(value: unknown): value is ShadowMeasurements {
  if (typeof value !== 'object' || value === null) return false;
  const measurements = value as Record<string, unknown>;
  const sideCoverage = measurements.whiteBoundarySideCoverage;
  const sideGradient = measurements.whiteBoundarySideGradient;
  const sideContrast = measurements.whiteBoundarySideContrast;
  return (
    (measurements.mode === 'textured_gray' || measurements.mode === 'white_or_low_texture') &&
    (measurements.activeCheck === 'gray_dark_box' || measurements.activeCheck === 'white_boundary') &&
    typeof measurements.candidate === 'boolean' &&
    typeof measurements.insideQrMedianGradient === 'number' &&
    typeof measurements.insideQrLowGradientFraction === 'number' &&
    typeof measurements.outerAnnulusMedianGradient === 'number' &&
    typeof measurements.outerAnnulusLowGradientFraction === 'number' &&
    typeof measurements.lowGradientFractionDelta === 'number' &&
    typeof measurements.texturedBackground === 'boolean' &&
    typeof measurements.grayDarkBoxPassed === 'boolean' &&
    typeof measurements.whiteBoundaryCoverage === 'number' &&
    Array.isArray(sideCoverage) &&
    sideCoverage.length === 4 &&
    sideCoverage.every((coverage) => typeof coverage === 'number') &&
    Array.isArray(sideGradient) &&
    sideGradient.length === 4 &&
    sideGradient.every((gradient) => typeof gradient === 'number') &&
    Array.isArray(sideContrast) &&
    sideContrast.length === 4 &&
    sideContrast.every((contrast) => typeof contrast === 'number') &&
    typeof measurements.whiteBoundaryEdgeStrength === 'number' &&
    typeof measurements.whiteBoundaryBackgroundGradient === 'number' &&
    typeof measurements.whiteBoundaryGradientExcess === 'number' &&
    typeof measurements.whiteBoundaryPassed === 'boolean'
  );
}

function isTamperTrial(value: unknown): value is TamperTrial {
  if (typeof value !== 'object' || value === null) return false;
  const trial = value as Record<string, unknown>;
  return (
    typeof trial.id === 'string' &&
    typeof trial.capturedAt === 'string' &&
    (trial.status === 'complete' || trial.status === 'inconclusive' || trial.status === 'unavailable') &&
    (typeof trial.predictedSticker === 'boolean' || trial.predictedSticker === null) &&
    typeof trial.captureMs === 'number' &&
    typeof trial.processingMs === 'number' &&
    typeof trial.totalMs === 'number' &&
    (trial.measurements === undefined || isShadowMeasurements(trial.measurements)) &&
    (trial.feedback === 'correct' || trial.feedback === 'incorrect' || trial.feedback === 'unsure' || trial.feedback === null)
  );
}

export async function loadTamperTrials(): Promise<TamperTrial[]> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY);
  if (!saved) return [];
  const parsed: unknown = JSON.parse(saved);
  if (!Array.isArray(parsed)) throw new Error('Saved sticker diagnostics have an invalid format.');
  return parsed.filter(isTamperTrial).slice(0, MAX_TRIALS);
}

export async function saveTamperTrials(trials: TamperTrial[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trials.slice(0, MAX_TRIALS)));
}
