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
import { useEffect } from 'react';
import { FontsLoadedContext } from '../components/FontsLoadedContext';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
    Orbitron_600SemiBold,
  });

  useEffect(() => {
    if (fontError) console.error('SafeScan could not load its custom fonts.', fontError);
  }, [fontError]);

  return (
    <FontsLoadedContext.Provider value={fontsLoaded}>
      <Stack screenOptions={{ headerShown: false }} />
    </FontsLoadedContext.Provider>
  );
}
