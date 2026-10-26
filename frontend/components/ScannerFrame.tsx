import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View, Text } from 'react-native';
import { CameraView } from 'expo-camera';
import styles from '../app/styles';

type OnScanPayload = { data: string };

interface Props {
  onScan: (payload: OnScanPayload) => void;
}

export default function ScannerFrame({ onScan }: Props) {
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [scanLineAnim]);

  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 180],
  });

  return (
    <View style={styles.scannerSection}>
      <View style={styles.scannerFrame}>
        <CameraView
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          facing="back"
          onBarcodeScanned={onScan}
        />
        <View style={styles.scannerInner} pointerEvents="none">
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          <Animated.View
            style={[
              styles.scanLine,
              { transform: [{ translateY: scanLineTranslateY }] },
            ]}
          />
        </View>
        <Text style={styles.scanLabel}>POINT CAMERA AT QR CODE</Text>
      </View>
    </View>
  );
}
