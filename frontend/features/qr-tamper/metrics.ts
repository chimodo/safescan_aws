import type { ConfusionMetrics, TamperTrial } from './types';

export function calculateConfusionMetrics(trials: TamperTrial[]): ConfusionMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const trial of trials) {
    if (trial.status !== 'complete' || trial.feedback === null || trial.feedback === 'unsure' || trial.predictedSticker === null) {
      continue;
    }
    const actualSticker = trial.feedback === 'correct'
      ? trial.predictedSticker
      : !trial.predictedSticker;
    if (trial.predictedSticker && actualSticker) truePositive += 1;
    else if (trial.predictedSticker) falsePositive += 1;
    else if (actualSticker) falseNegative += 1;
    else trueNegative += 1;
  }

  const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : 0;
  const labeled = truePositive + falsePositive + trueNegative + falseNegative;
  return {
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    labeled,
    accuracy: ratio(truePositive + trueNegative, labeled),
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative),
    specificity: ratio(trueNegative, trueNegative + falsePositive),
  };
}
