import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TamperTrial } from './types';

const STORAGE_KEY = '@safescan/tamper-trials-v1';
const MAX_TRIALS = 500;

function isTamperTrial(value: unknown): value is TamperTrial {
  if (typeof value !== 'object' || value === null) return false;
  const trial = value as Record<string, unknown>;
  return (
    typeof trial.id === 'string' &&
    typeof trial.capturedAt === 'string' &&
    (trial.status === 'complete' || trial.status === 'inconclusive' || trial.status === 'unavailable') &&
    (typeof trial.predictedSticker === 'boolean' || trial.predictedSticker === null) &&
    (typeof trial.responseIndex === 'number' || trial.responseIndex === null) &&
    typeof trial.captureMs === 'number' &&
    typeof trial.processingMs === 'number' &&
    typeof trial.totalMs === 'number' &&
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
