import React from 'react';
import { View, Text } from 'react-native';
import styles from '../app/styles';
import COLORS from '../constants/colors';
import SignalRow from './SignalRow';
import { Signal } from '../types';

interface Props {
  url: string | null;
  result: any;
  signals?: Signal[];
}

export default function ResultCard({ url, result, signals = [] }: Props) {
  const getVerdictColor = (verdict?: string) => {
    switch (verdict) {
      case 'SAFE':
        return COLORS.safe;
      case 'SUSPICIOUS':
        return COLORS.suspicious;
      case 'MALICIOUS':
        return COLORS.malicious;
      default:
        return COLORS.textDim;
    }
  };

  return (
    <View style={styles.resultCard}>
      <View style={styles.resultHeader}>
        <Text style={styles.resultUrl} numberOfLines={1}>
          {url ?? 'No QR scanned yet'}
        </Text>
        <Text style={styles.resultTime}>0.0s</Text>
      </View>
      <View style={styles.resultBody}>
        <View style={styles.verdictRow}>
          <Text style={[styles.verdictScore, { color: getVerdictColor(result?.verdict) }]}>
            {result ? result.score : '—'}
          </Text>
          <View style={styles.verdictInfo}>
            <Text style={[styles.verdictLabel, { color: getVerdictColor(result?.verdict) }]}>
              {result ? result.verdict : url ? 'ANALYZING...' : 'IDLE'}
            </Text>
            <Text style={styles.verdictSub}>THREAT SCORE / 100</Text>
          </View>
        </View>

        <View style={styles.scoreBar}>
          <View style={[styles.scoreFill, { width: '0%' }]} />
        </View>

        {signals.length > 0
          ? signals.map((s) => (
              <SignalRow key={s.label} label={s.label} value={s.val} level={s.level} />
            ))
          : [
              { label: 'DOMAIN AGE', val: '—', level: 'low' },
              { label: 'BRAND IMPERSONATION', val: '—', level: 'low' },
              { label: 'REDIRECT CHAIN', val: '—', level: 'low' },
              { label: 'DATABASE MATCH', val: '—', level: 'low' },
            ].map((signal) => (
              <SignalRow key={signal.label} label={signal.label} value={signal.val} level={signal.level as any} />
            ))}
      </View>
    </View>
  );
}
