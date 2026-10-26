import React from 'react';
import { Pressable, View } from 'react-native';
import AppIcon from '../../components/AppIcon';
import Text from '../../components/AppText';
import type { ColorPalette } from '../../constants/colors';
import type { TamperFeedback, TamperTrial } from './types';

export default function TamperResultCard({
  trial,
  colors,
  onFeedback,
}: {
  trial: TamperTrial;
  colors: ColorPalette;
  onFeedback: (id: string, feedback: TamperFeedback) => void;
}) {
  const elevated = trial.status === 'complete' && trial.predictedSticker;
  const tint = elevated ? colors.amberLight : colors.paleBlue;
  const title = trial.status === 'complete'
    ? elevated ? 'Possible sticker or glossy surface' : 'No elevated glare signal'
    : trial.status === 'inconclusive' ? 'Sticker check inconclusive' : 'Sticker check unavailable';

  return (
    <View style={{ marginTop: 14, padding: 15, borderRadius: 17, backgroundColor: tint }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <AppIcon
          name={elevated ? 'warning' : trial.status === 'complete' ? 'checkmark-circle' : 'help-circle'}
          size={20}
          color={elevated ? colors.amber : colors.navy}
        />
        <Text style={{ flex: 1, color: colors.navy, fontSize: 14, fontWeight: '800' }}>{title}</Text>
      </View>
      {trial.responseIndex !== null && (
        <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 8 }}>
          Experimental response index: {trial.responseIndex.toFixed(5)} (not a probability)
        </Text>
      )}
      <Text style={{ color: colors.secondaryText, fontSize: 12, lineHeight: 18, marginTop: 8 }}>
        {trial.message ??
          'This visual signal cannot confirm that a sticker is present. Stickers can be used to tamper with QR codes; verify that any sticker is meant to be there before scanning.'}
      </Text>
      {trial.status === 'complete' && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.navy, fontSize: 12, fontWeight: '700', marginBottom: 7 }}>Was this correct?</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {([
              ['correct', 'Yes'],
              ['incorrect', 'No'],
              ['unsure', 'Not sure'],
            ] as const).map(([feedback, label]) => {
              const selected = trial.feedback === feedback;
              return (
                <Pressable
                  key={feedback}
                  onPress={() => onFeedback(trial.id, selected ? null : feedback)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: selected ? colors.buttonPrimary : colors.border, backgroundColor: selected ? colors.buttonPrimary : colors.surface }}
                >
                  <Text style={{ color: selected ? '#FFFFFF' : colors.secondaryText, fontSize: 12, fontWeight: '700' }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}
