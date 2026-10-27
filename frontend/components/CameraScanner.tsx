import { BarcodeScanningResult, BarcodeType, CameraView, scanFromURLAsync } from 'expo-camera';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Platform, Pressable, View } from 'react-native';
import AppIcon from './AppIcon';
import Text from './AppText';
import { ColorPalette } from '../constants/colors';
import type { PolygonPoint, TamperCapture } from '../features/qr-tamper/types';
import { supportedBarcodeTypes } from '../hooks/scanCodeImage';

export interface CameraScannerHandle {
  runTamperCheck(expectedData: string): Promise<TamperCapture>;
}

const CAPTURE_SETTLE_MS = 250;

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
  const layoutSize = useRef({ width: 0, height: 0 });
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
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

  // Adjusting state during render when a prop changes avoids an extra effect render.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) {
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
    setCameraKey((key) => key + 1);
  };

  const onCameraError = (event: { message: string }) => {
    setCameraReady(false);
    setCameraError(event.message || 'The camera could not be started.');
  };

  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    if (!hasPendingCode) onCode(result);
  };

  useImperativeHandle(ref, () => ({
    async runTamperCheck(expectedData) {
      const startedAt = Date.now();
      if (Platform.OS === 'web') {
        return {
          status: 'unavailable',
          predictedSticker: null,
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
          captureMs: 0,
          processingMs: 0,
          totalMs: Date.now() - startedAt,
          message: 'The camera is not ready to capture the QR code.',
        };
      }
      let captureMs = 0;
      let stage = 'capturing the still image';
      try {
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_SETTLE_MS));
        const picture = await camera.takePictureAsync({ base64: true, quality: 1 });
        if (!picture.base64) throw new Error('The camera did not return image data for sticker analysis.');
        captureMs = Date.now() - startedAt;

        stage = 'detecting QR corners in the captured image';
        const processingStartedAt = Date.now();
        if (!picture.uri) throw new Error('The camera did not provide a saved image for QR corner detection.');
        const detectedCodes = await scanFromURLAsync(picture.uri, ['qr']);
        if (!Array.isArray(detectedCodes)) {
          throw new Error('The still-image QR scanner returned an invalid result.');
        }
        const qr = detectedCodes.find(({ data }) => data === expectedData) ??
          (detectedCodes.length === 1 ? detectedCodes[0] : undefined);
        if (!qr || qr.cornerPoints.length !== 4) {
          throw new Error('Could not find all four QR corners in the captured image. Please hold the code steady and try again.');
        }
        const imagePoints: PolygonPoint[] = qr.cornerPoints.map(({ x, y }) => ({
          x,
          y: Platform.OS === 'ios' ? picture.height - y : y,
        }));
        stage = 'loading the native OpenCV analyzer';
        const { measureStickerBoundary } = await import('../features/qr-tamper/opencv');
        stage = 'running the native OpenCV analyzer';
        const measurements = measureStickerBoundary(picture.base64, imagePoints);
        const processingMs = Date.now() - processingStartedAt;
        const totalMs = Date.now() - startedAt;

        return {
          status: 'complete',
          predictedSticker: measurements.candidate,
          captureMs,
          processingMs,
          totalMs,
          message: measurements.candidate
            ? undefined
            : 'No elevated QR-edge pattern was detected. This does not rule out a sticker; try another angle or lighting condition.',
          measurements,
        };
      } catch (error) {
        console.error('Sticker analysis failed', { stage, error });
        const errorMessage = error instanceof Error
          ? error.message
          : String(error);
        const message = `Sticker analysis failed while ${stage}: ${errorMessage}`;
        return {
          status: 'unavailable',
          predictedSticker: null,
          captureMs,
          processingMs: 0,
          totalMs: Date.now() - startedAt,
          message,
        };
      }
    },
  }), [cameraReady]);

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
            enableTorch={false}
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
