import React from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from '../app/styles';

export default function ActionButtons() {
  return (
    <View style={styles.btnRow}>
      <Pressable style={styles.btnPrimary}>
        <Text style={styles.btnPrimaryText}>BLOCK + REPORT</Text>
      </Pressable>
      <Pressable style={styles.btnSecondary}>
        <Text style={styles.btnSecondaryText}>DETAILS</Text>
      </Pressable>
    </View>
  );
}
