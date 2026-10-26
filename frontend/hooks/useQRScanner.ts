import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export default function useQRScanner() {
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any>(null);
  const qrLock = useRef(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        qrLock.current = false;
      }
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, []);

  const handleScan = async ({ data }: { data: string }) => {
    if (data && !qrLock.current) {
      qrLock.current = true;
      setScannedUrl(data);
      try {
        const response = await fetch(
          `https://safescan-worker.tinenyashadev.workers.dev/?url=${encodeURIComponent(
            data
          )}`
        );
        const result = await response.json();
        setScanResult(result);
      } catch (err) {
        setScanResult({ verdict: 'UNKNOWN', score: -1, cached: false, error: 'Failed to reach scanner backend' });
      }
    }
  };

  return { scannedUrl, scanResult, qrLock, handleScan } as const;
}
