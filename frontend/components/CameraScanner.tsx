import { BarcodeScanningResult, BarcodeType, CameraView } from 'expo-camera';
import type { BarcodePoint } from 'expo-camera';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Platform, Pressable, View } from 'react-native';
import AppIcon from './AppIcon';
import Text from './AppText';
import { ColorPalette } from '../constants/colors';
import type { PolygonPoint, TamperCapture } from '../features/qr-tamper/types';
import { supportedBarcodeTypes } from '../hooks/scanCodeImage';

export interface CameraScannerHandle {
  runTamperCheck(cornerPoints: BarcodePoint[]): Promise<TamperCapture>;
}

const CAMERA_SETTLE_MS = 1400;
const BASELINE_SETTLE_MS = 250;
const RESPONSE_THRESHOLD = 0.005;

const CameraScanner = forwardRef<CameraScannerHandle, {
  active: boolean;
  permission: { granted: boolean; canAskAgain: boolean } | null;
  requestPermission: () => Promise<{ granted: boolean }>;
  colors: ColorPalette;
  styles: ReturnType<typeof import('../app/styles').default>;
  reduceMotion: boolean;
  hasPendingCode: boolean;
  onCode: (result: BarcodeScanningResult) => void;
  onGallery: () => void;
  galleryBusy: boolean;
  onNotice: (message: string) => void;
}>(function CameraScanner({
  active,
  permission,
  requestPermission,
  colors,
  styles,
  reduceMotion,
  hasPendingCode,
  onCode,
  onGallery,
  galleryBusy,
  onNotice,
}, ref) {
  const cameraRef = useRef<CameraView>(null);
  const latestBarcode = useRef<BarcodeScanningResult | null>(null);
  const layoutSize = useRef({ width: 0, height: 0 });
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  // Lazy state, not a ref: the value is created once and is safe to read during render
  const [scanLineProgress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active || !cameraReady || reduceMotion || cameraError) {
      scanLineProgress.stopAnimation();
      scanLineProgress.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineProgress, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanLineProgress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [active, cameraError, cameraReady, reduceMotion, scanLineProgress]);

  // Turn the torch off and wait for a fresh camera when scanning is paused.
  // Adjusting state during render when a prop changes avoids an extra effect render.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) {
      setTorchEnabled(false);
      setCameraReady(false);
    }
  }

  const askForPermission = async () => {
    setPermissionLoading(true);
    try {
      const result = await requestPermission();
      if (!result.granted) onNotice('Camera access wasn’t allowed. You can change this in your device settings.');
    } catch {
      onNotice('SafeScan couldn’t request camera access. Please check your device settings.');
    } finally {
      setPermissionLoading(false);
    }
  };

  const openSettings = async () => {
    if (Platform.OS === 'web') {
      onNotice('Allow camera access in your browser’s site settings, then return to SafeScan.');
      return;
    }
    try {
      await Linking.openSettings();
    } catch {
      onNotice('Device settings could not be opened. Allow camera access in your device settings, then try again.');
    }
  };

  const retryCamera = () => {
    setCameraError('');
    setCameraReady(false);
    setTorchEnabled(false);
    setCameraKey((key) => key + 1);
  };

  const onCameraError = (event: { message: string }) => {
    setCameraReady(false);
    setCameraError(event.message || 'The camera could not be started.');
  };

  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    latestBarcode.current = result;
    if (!hasPendingCode) onCode(result);
  };

  useImperativeHandle(ref, () => ({
    async runTamperCheck(cornerPoints) {
      const startedAt = Date.now();
      if (Platform.OS === 'web') {
        return {
          status: 'unavailable',
          predictedSticker: null,
          responseIndex: null,
          captureMs: 0,
          processingMs: 0,
          totalMs: Date.now() - startedAt,
          message: 'On-device sticker analysis is available in an iOS or Android development build.',
        };
      }
      const camera = cameraRef.current;
      if (!cameraReady || !camera) {
        return {
          status: 'unavailable',
          predictedSticker: null,
          responseIndex: null,
          captureMs: 0,
          processingMs: 0,
          totalMs: Date.now() - startedAt,
          message: 'The camera is not ready to capture the QR code.',
        };
      }
      if (cornerPoints.length < 4 || layoutSize.current.width <= 0 || layoutSize.current.height <= 0) {
        return {
          status: 'unavailable',
          predictedSticker: null,
          responseIndex: null,
          captureMs: 0,
          processingMs: 0,
          totalMs: Date.now() - startedAt,
          message: 'The camera did not provide the QR code corners needed for visual analysis.',
        };
      }

      const previousTorch = torchEnabled;
      let captureMs = 0;
      try {
        setTorchEnabled(false);
        await new Promise((resolve) => setTimeout(resolve, BASELINE_SETTLE_MS));
        const offPicture = await camera.takePictureAsync({ base64: true, quality: 0.8 });
        if (!offPicture.base64) throw new Error('The camera did not return image data for the baseline capture.');

        setTorchEnabled(true);
        await new Promise((resolve) => setTimeout(resolve, CAMERA_SETTLE_MS));
        const onPicture = await camera.takePictureAsync({ base64: true, quality: 0.8 });
        if (!onPicture.base64) throw new Error('The camera did not return image data for the flashlight capture.');
        captureMs = Date.now() - startedAt;

        const currentPoints = latestBarcode.current?.cornerPoints;
        const mapPoints = (points: BarcodePoint[], width: number, height: number): PolygonPoint[] =>
          points.slice(0, 4).map(({ x, y }) => ({
            x: x * width / layoutSize.current.width,
            y: y * height / layoutSize.current.height,
          }));
        const offPoints = mapPoints(cornerPoints, offPicture.width, offPicture.height);
        const onPoints = mapPoints(
          currentPoints && currentPoints.length >= 4 ? currentPoints : cornerPoints,
          onPicture.width,
          onPicture.height,
        );

        setTorchEnabled(previousTorch);
        const processingStartedAt = Date.now();
        const { measureSpecularResponse } = await import('../features/qr-tamper/opencv');
        const measurements = measureSpecularResponse(
          offPicture.base64,
          onPicture.base64,
          offPoints,
          onPoints,
        );
        const processingMs = Date.now() - processingStartedAt;
        const lightValueChange =
          measurements.rectified_mean_value_on - measurements.rectified_mean_value_off;
        const lightHighlightChange =
          measurements.rectified_highlight_fraction_on - measurements.rectified_highlight_fraction_off;
        const enoughLightChange = lightValueChange >= 12 || lightHighlightChange >= 0.015;
        const totalMs = Date.now() - startedAt;

        return {
          status: enoughLightChange ? 'complete' : 'inconclusive',
          predictedSticker: enoughLightChange
            ? measurements.response_index >= RESPONSE_THRESHOLD
            : null,
          responseIndex: measurements.response_index,
          captureMs,
          processingMs,
          totalMs,
          message: enoughLightChange
            ? undefined
            : 'The flashlight did not produce a clear lighting change. Keep the QR centered and try again.',
          measurements,
        };
      } catch (error) {
        setTorchEnabled(previousTorch);
        const message = error instanceof Error
          ? error.message
          : 'The sticker analysis could not complete on this device.';
        return {
          status: 'unavailable',
          predictedSticker: null,
          responseIndex: null,
          captureMs,
          processingMs: 0,
          totalMs: Date.now() - startedAt,
          message,
        };
      }
    },
  }), [cameraReady, torchEnabled]);

  const translateY = scanLineProgress.interpolate({ inputRange: [0, 1], outputRange: [5, 212] });
  const barcodeTypes = Platform.OS === 'web' ? ['qr'] as BarcodeType[] : supportedBarcodeTypes;

  return (
    <View
      style={styles.homeCameraCard}
      onLayout={(event) => {
        layoutSize.current = {
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        };
      }}
    >
      {active && permission?.granted && !cameraError ? (
        <>
          <CameraView
            ref={cameraRef}
            key={cameraKey}
            style={styles.homeCameraPreview}
            facing="back"
            active={active}
            enableTorch={Platform.OS !== 'web' && torchEnabled}
            barcodeScannerSettings={{ barcodeTypes }}
            onBarcodeScanned={onBarcodeScanned}
            onCameraReady={() => setCameraReady(true)}
            onMountError={onCameraError}
          />
          <View pointerEvents="none" style={styles.cameraHomeOverlay}>
            <View style={styles.cameraFrame}>
              <View style={[styles.cameraCorner, styles.cameraCornerTopLeft]} />
              <View style={[styles.cameraCorner, styles.cameraCornerTopRight]} />
              <View style={[styles.cameraCorner, styles.cameraCornerBottomLeft]} />
              <View style={[styles.cameraCorner, styles.cameraCornerBottomRight]} />
              {cameraReady && !hasPendingCode && !reduceMotion && (
                <Animated.View style={[styles.cameraScanLine, { transform: [{ translateY }] }]} />
              )}
            </View>
          </View>
          <View style={styles.cameraHomeHeader}>
            <View style={styles.cameraStatus}>
              <View style={[styles.cameraStatusDot, { backgroundColor: hasPendingCode ? colors.amberStrong : colors.green }]} />
              <Text style={styles.cameraStatusText} variant="heading">
                {hasPendingCode ? 'CODE READY' : cameraReady ? 'READY TO SCAN' : 'STARTING CAMERA'}
              </Text>
            </View>
            <View style={styles.cameraTools}>
              <Pressable
                onPress={() => {
                  if (Platform.OS === 'web') {
                    onNotice('Flashlight control is available on supported mobile cameras.');
                  } else {
                    setTorchEnabled((enabled) => !enabled);
                  }
                }}
                style={styles.cameraToolButton}
                accessibilityRole="button"
                accessibilityLabel={torchEnabled ? 'Turn flashlight off' : 'Turn flashlight on'}
              >
                <AppIcon name={torchEnabled ? 'flash' : 'flash-outline'} color={torchEnabled ? colors.amberStrong : '#FFFFFF'} size={20} />
              </Pressable>
              <Pressable
                onPress={onGallery}
                disabled={galleryBusy}
                style={styles.cameraToolButton}
                accessibilityRole="button"
                accessibilityLabel="Choose an image to scan"
              >
                {galleryBusy
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <AppIcon name="images-outline" color="#FFFFFF" size={20} />}
              </Pressable>
            </View>
          </View>
          <View style={styles.cameraHomeInstruction}>
            <Text style={styles.cameraInstructionText}>
              {hasPendingCode
                ? 'Code detected. Tap below when you’re ready to continue.'
                : 'Position a QR code or barcode inside the frame.'}
            </Text>
          </View>
          {!cameraReady && (
            <View pointerEvents="none" style={styles.cameraHomeLoading}>
              <ActivityIndicator color="#FFFFFF" size="large" />
            </View>
          )}
        </>
      ) : null}

      {!permission?.granted && (
        <View style={styles.cameraPermissionPanel}>
          <View style={styles.cameraRecoveryIcon}>
            <AppIcon name="camera-outline" color={colors.navy} size={30} />
          </View>
          <Text style={styles.cameraRecoveryTitle} variant="heading">Camera access needed</Text>
          <Text style={styles.cameraRecoveryText}>
            Allow camera access to scan QR codes and barcodes. SafeScan uses the camera only while Home is open.
          </Text>
          <Pressable
            onPress={() => permission?.canAskAgain === false ? void openSettings() : void askForPermission()}
            disabled={permissionLoading}
            style={[styles.primaryButton, styles.cameraPermissionButton]}
            accessibilityRole="button"
          >
            {permissionLoading
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.primaryButtonText}>
                  {permission?.canAskAgain === false ? 'Open camera settings' : 'Allow camera access'}
                </Text>}
          </Pressable>
        </View>
      )}

      {active && permission?.granted && !!cameraError && (
        <View style={styles.cameraPermissionPanel}>
          <View style={[styles.cameraRecoveryIcon, { backgroundColor: colors.redLight }]}>
            <AppIcon name="camera-reverse-outline" color={colors.red} size={30} />
          </View>
          <Text style={styles.cameraRecoveryTitle} variant="heading">Camera unavailable</Text>
          <Text style={styles.cameraRecoveryText}>
            The camera could not start. Check that another app isn’t using it, or choose an image to scan.
          </Text>
          <Pressable onPress={retryCamera} style={[styles.primaryButton, styles.cameraPermissionButton]} accessibilityRole="button">
            <AppIcon name="refresh-outline" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
          <Pressable onPress={onGallery} style={[styles.secondaryButton, styles.cameraPermissionButton]} accessibilityRole="button">
            <AppIcon name="images-outline" size={18} color={colors.navy} />
            <Text style={styles.secondaryButtonText}>Choose an image</Text>
          </Pressable>
        </View>
      )}

      {!active && permission?.granted && !cameraError && (
        <View style={styles.cameraPaused}>
          <AppIcon name="scan-outline" color="#FFFFFF" size={29} />
          <Text style={styles.cameraPausedText}>Camera paused while SafeScan isn’t on Home.</Text>
        </View>
      )}
    </View>
  );
});

export default CameraScanner;
