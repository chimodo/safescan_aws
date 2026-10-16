import { useFonts } from 'expo-font';
import { useCameraPermissions } from 'expo-camera';
import { Orbitron_900Black } from '@expo-google-fonts/orbitron';
import { ShareTechMono_400Regular } from '@expo-google-fonts/share-tech-mono';
import { StatusBar, View, Text, Pressable } from 'react-native';
import styles from './styles';
import COLORS from '../constants/colors';
import useQRScanner from '../hooks/useQRScanner';
import Navbar from '../components/Navbar';
import ScannerFrame from '../components/ScannerFrame';
import ResultCard from '../components/ResultCard';
import ActionButtons from '../components/ActionButtons';
import BottomNav from '../components/BottomNav';

export default function Scanner() {
  const [fontsLoaded] = useFonts({ Orbitron_900Black, ShareTechMono_400Regular });
  const [permission, requestPermission] = useCameraPermissions();

  const { scannedUrl, scanResult, handleScan } = useQRScanner();

  if (!fontsLoaded) return <View style={styles.container} />;
  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <Text style={styles.navLogo}>SAFESCAN</Text>
        <Text style={[styles.textSecondary, { textAlign: 'center', marginVertical: 20 }]}>Camera access is required to scan QR codes.</Text>
        <Pressable style={styles.btnPrimary} onPress={requestPermission}>
          <Text style={styles.btnPrimaryText}>ENABLE CAMERA</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <Navbar />
      <ScannerFrame onScan={handleScan} />
      <ResultCard url={scannedUrl} result={scanResult} />
      <ActionButtons />
      <BottomNav />
    </View>
  );
}