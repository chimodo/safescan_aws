import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import AppIcon from '../../components/AppIcon';
import Text from '../../components/AppText';
import type { ColorPalette } from '../../constants/colors';
import type { ConfusionMetrics, TamperFeedback, TamperTrial } from './types';

function percentage(value: number) {
  return `${Math.round(value * 100)}%`;
}

function timestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Time unavailable' : parsed.toLocaleString();
}

function Metric({
  title,
  value,
  colors,
}: {
  title: string;
  value: string;
  colors: ColorPalette;
}) {
  return (
    <View style={{ flex: 1, minWidth: 120, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, padding: 13 }}>
      <Text style={{ color: colors.secondaryText, fontSize: 11 }}>{title}</Text>
      <Text style={{ color: colors.navy, fontSize: 20, fontWeight: '800', marginTop: 5 }}>{value}</Text>
    </View>
  );
}

function LabeledRate({
  title,
  value,
  colors,
}: {
  title: string;
  value: number;
  colors: ColorPalette;
}) {
  return (
    <View style={{ flex: 1, minWidth: 125, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: colors.background }}>
      <Text style={{ color: colors.secondaryText, fontSize: 11 }}>{title}</Text>
      <Text style={{ color: colors.navy, fontSize: 14, fontWeight: '700', marginTop: 3 }}>{percentage(value)}</Text>
    </View>
  );
}

function TrialFeedback({
  trial,
  onFeedback,
  colors,
}: {
  trial: TamperTrial;
  onFeedback: (id: string, feedback: TamperFeedback) => void;
  colors: ColorPalette;
}) {
  const options: { value: TamperFeedback; label: string }[] = [
    { value: 'correct', label: 'Correct' },
    { value: 'incorrect', label: 'Incorrect' },
    { value: 'unsure', label: 'Not sure' },
  ];
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: colors.secondaryText, fontSize: 11, marginBottom: 6 }}>
        {trial.feedback ? 'Your feedback' : 'Was this correct?'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
        {options.map(({ value, label }) => {
          const selected = trial.feedback === value;
          return (
            <Pressable
              key={value}
              onPress={() => onFeedback(trial.id, selected ? null : value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: selected ? colors.buttonPrimary : colors.border, backgroundColor: selected ? colors.buttonPrimary : colors.surface }}
            >
              <Text style={{ color: selected ? '#FFFFFF' : colors.secondaryText, fontSize: 11, fontWeight: '700' }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function DeveloperMetricsScreen({
  trials,
  metrics,
  colors,
  onBack,
  onFeedback,
  onClear,
}: {
  trials: TamperTrial[];
  metrics: ConfusionMetrics;
  colors: ColorPalette;
  onBack: () => void;
  onFeedback: (id: string, feedback: TamperFeedback) => void;
  onClear: () => void;
}) {
  const completed = trials.filter((trial) => trial.status === 'complete');
  const averageProcessingMs = completed.length
    ? completed.reduce((sum, trial) => sum + trial.processingMs, 0) / completed.length
    : 0;
  const capturedTrials = trials.filter((trial) => trial.captureMs > 0);
  const averageCaptureMs = capturedTrials.length
    ? capturedTrials.reduce((sum, trial) => sum + trial.captureMs, 0) / capturedTrials.length
    : 0;
  const averageTotalMs = completed.length
    ? completed.reduce((sum, trial) => sum + trial.totalMs, 0) / completed.length
    : 0;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <View style={{ paddingTop: 22, paddingBottom: 17 }}>
        <Pressable onPress={onBack} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 13 }}>
          <AppIcon name="arrow-back" size={17} color={colors.secondaryText} />
          <Text style={{ color: colors.secondaryText, fontSize: 13, fontWeight: '600' }}>Back to settings</Text>
        </Pressable>
        <Text style={{ color: colors.navy, fontSize: 27, fontWeight: '800' }} variant="heading">Sticker diagnostics</Text>
        <Text style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 19, marginTop: 7 }}>
          On-device OpenCV measurements over time. Images are not saved. This experimental glare response is not a probability or a validated sticker detector.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
        <Metric title="Checks recorded" value={String(trials.length)} colors={colors} />
        <Metric title="Capture avg." value={`${averageCaptureMs.toFixed(0)} ms`} colors={colors} />
        <Metric title="OpenCV avg. time" value={`${averageProcessingMs.toFixed(1)} ms`} colors={colors} />
        <Metric title="Full check avg." value={`${averageTotalMs.toFixed(0)} ms`} colors={colors} />
      </View>

      <View style={{ marginTop: 15, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
        <Text style={{ color: colors.navy, fontSize: 15, fontWeight: '800' }}>Feedback metrics</Text>
        <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 16, marginTop: 5 }}>
          Based only on scans marked Correct or Incorrect. Not sure responses are excluded; user feedback is not laboratory ground truth.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
          <LabeledRate title={`Accuracy · ${metrics.labeled} labeled`} value={metrics.accuracy} colors={colors} />
          <LabeledRate title="Precision" value={metrics.precision} colors={colors} />
          <LabeledRate title="Recall" value={metrics.recall} colors={colors} />
          <LabeledRate title="Specificity" value={metrics.specificity} colors={colors} />
        </View>
        <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 16, marginTop: 10 }}>
          TP {metrics.truePositive} · FP {metrics.falsePositive} · TN {metrics.trueNegative} · FN {metrics.falseNegative}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 23, marginBottom: 9 }}>
        <Text style={{ color: colors.navy, fontSize: 16, fontWeight: '800' }}>Recent checks</Text>
        {trials.length > 0 && (
          <Pressable onPress={onClear} accessibilityRole="button">
            <Text style={{ color: colors.red, fontSize: 12, fontWeight: '700' }}>Clear</Text>
          </Pressable>
        )}
      </View>
      {trials.length === 0 ? (
        <View style={{ padding: 20, alignItems: 'center', borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.secondaryText, fontSize: 13 }}>No sticker checks recorded yet.</Text>
        </View>
      ) : trials.map((trial) => (
        <View key={trial.id} style={{ marginBottom: 9, padding: 14, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.navy, fontSize: 13, fontWeight: '700' }}>
                {trial.status === 'complete'
                  ? trial.predictedSticker ? 'Elevated sticker/gloss signal' : 'No elevated signal'
                  : trial.status === 'inconclusive' ? 'Inconclusive capture' : 'Analysis unavailable'}
              </Text>
              <Text style={{ color: colors.secondaryText, fontSize: 11, marginTop: 4 }}>{timestamp(trial.capturedAt)}</Text>
              {(trial.captureMs > 0 || trial.processingMs > 0) && (
                <Text style={{ color: colors.secondaryText, fontSize: 11, marginTop: 5 }}>
                  {trial.responseIndex !== null ? `Response index ${trial.responseIndex.toFixed(5)} · ` : ''}
                  Capture {trial.captureMs.toFixed(0)} ms · OpenCV {trial.processingMs.toFixed(1)} ms · total {trial.totalMs.toFixed(0)} ms
                </Text>
              )}
              {trial.message && <Text style={{ color: colors.secondaryText, fontSize: 11, lineHeight: 16, marginTop: 5 }}>{trial.message}</Text>}
            </View>
            <AppIcon
              name={trial.status === 'complete' ? 'analytics-outline' : 'help-circle-outline'}
              size={19}
              color={trial.status === 'complete' ? colors.green : colors.amber}
            />
          </View>
          {trial.measurements && (
            <Text style={{ color: colors.secondaryText, fontSize: 10, lineHeight: 15, marginTop: 8 }}>
              QR new highlights {trial.measurements.qr_new_highlight_fraction.toFixed(5)} · border {trial.measurements.sticker_border_new_highlight_fraction.toFixed(5)} · background {trial.measurements.background_new_highlight_fraction.toFixed(5)}
            </Text>
          )}
          {trial.status === 'complete' && <TrialFeedback trial={trial} onFeedback={onFeedback} colors={colors} />}
        </View>
      ))}
    </ScrollView>
  );
}
