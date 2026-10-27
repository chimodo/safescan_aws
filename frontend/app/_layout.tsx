// React Native's built-in URL lacks hostname, searchParams and more; the shared URL modules need them
import 'react-native-url-polyfill/auto';
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold,
} from '@expo-google-fonts/montserrat';
import { Orbitron_600SemiBold } from '@expo-google-fonts/orbitron';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { FontsLoadedContext } from '../components/FontsLoadedContext';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
    Orbitron_600SemiBold,
  });
  if (!fontsLoaded) return null;
  return (
    <FontsLoadedContext.Provider value={fontsLoaded}>
      <Stack />
    </FontsLoadedContext.Provider>
  );
}
