import React from 'react';
import { View, Text } from 'react-native';
import styles from '../app/styles';
import COLORS from '../constants/colors';
import { SignalLevel } from '../types';

interface Props {
  label: string;
  value: string;
  level: SignalLevel;
}

export default function SignalRow({ label, value, level }: Props) {
  const borderColor =
    level === 'low' ? COLORS.border : level === 'medium' ? COLORS.suspicious : COLORS.malicious;
  const valueColor = level === 'low' ? COLORS.textDim : level === 'medium' ? COLORS.suspicious : COLORS.malicious;

  return (
    <View style={[styles.signal, { borderLeftColor: borderColor }]}>
      <Text style={styles.signalName}>{label}</Text>
      <View style={styles.signalValLow}>
        <Text style={[styles.signalValTextLow, { color: valueColor }]}>{value}</Text>
      </View>
    </View>
  );
}
