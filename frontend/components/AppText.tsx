import React, { ComponentProps, useContext } from 'react';
import { StyleSheet, Text as NativeText } from 'react-native';
import type { TextStyle } from 'react-native';
import { FontsLoadedContext } from './FontsLoadedContext';

type AppTextProps = ComponentProps<typeof NativeText> & {
  variant?: 'body' | 'heading';
};

function fontForWeight(weight: TextStyle['fontWeight']) {
  if (weight === '500' || weight === 'medium') return 'Montserrat_500Medium';
  if (weight === '600' || weight === 'semibold') return 'Montserrat_600SemiBold';
  if (weight === '700' || weight === 'bold') return 'Montserrat_700Bold';
  if (weight === '800' || weight === '900') return 'Montserrat_800ExtraBold';
  return 'Montserrat_400Regular';
}

export default function AppText({ variant = 'body', style, ...props }: AppTextProps) {
  const fontsLoaded = useContext(FontsLoadedContext);
  const flattenedStyle = StyleSheet.flatten(style);
  const fontFamily = variant === 'heading'
    ? 'Orbitron_600SemiBold'
    : fontForWeight(flattenedStyle?.fontWeight);

  return (
    <NativeText
      {...props}
      style={[fontsLoaded ? { fontFamily } : undefined, style]}
    />
  );
}
