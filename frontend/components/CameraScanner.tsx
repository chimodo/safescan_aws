import { BarcodeScanningResult, BarcodeType, CameraView } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Platform, Pressable, View } from 'react-native';
import AppIcon from './AppIcon';
import Text from './AppText';
import { ColorPalette } from '../constants/colors';
import { supportedBarcodeTypes } from '../hooks/scanCodeImage';

export default function CameraScanner({
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
}: {
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
}) {
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const scanLineProgress = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    if (!active) {
      setTorchEnabled(false);
      setCameraReady(false);
    }
  }, [active]);

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

  const translateY = scanLineProgress.interpolate({ inputRange: [0, 1], outputRange: [5, 212] });
  const barcodeTypes = Platform.OS === 'web' ? ['qr'] as BarcodeType[] : supportedBarcodeTypes;

  return (
    <View style={styles.homeCameraCard}>
      {active && permission?.granted && !cameraError ? (
        <>
          <CameraView
            key={cameraKey}
            style={styles.homeCameraPreview}
            facing="back"
            active={active}
            enableTorch={Platform.OS !== 'web' && torchEnabled}
            barcodeScannerSettings={{ barcodeTypes }}
            onBarcodeScanned={hasPendingCode ? undefined : onCode}
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
}
