import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Platform,
  Linking,
  Pressable,
  ScrollView,
  Share,
  useColorScheme,
  View,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import createStyles from './styles';
import AppIcon from '../components/AppIcon';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import type { IconName } from '../components/AppIcon';
import CameraScanner from '../components/CameraScanner';
import { ColorPalette, COLORS, DARK_COLORS } from '../constants/colors';
import { scanCodeImage } from '../hooks/scanCodeImage';
import { scanURL } from '../hooks/useURLScanner';
import { ScanReport, StoredScan, ThreatLevel } from '../types';

type Tab = 'home' | 'history' | 'settings';
type Screen = Tab | 'scanning' | 'result' | 'report' | 'code';
type AppearancePreference = 'system' | 'light' | 'dark';
type ActiveCode = { value: string; type: string; scannedAt: string; historical?: boolean };
type ModalContent = {
  title: string;
  body: string;
  kind?: 'clear-history' | 'url';
  url?: string;
};

const HISTORY_KEY = '@safescan/history-v1';
const APPEARANCE_KEY = '@safescan/appearance-v1';

interface LegacyStoredScan {
  id: string;
  url: string;
  domain: string;
  finalVerdict: ThreatLevel;
  checks: ScanReport['checks'];
  scannedAt: string;
  cached?: boolean;
}

const checkNames: Record<string, string> = {
  heuristics: 'URL pattern checks',
  typosquatting: 'Lookalike domain check',
  ml: 'Risk pattern check',
  reputation: 'Known threat database',
  redirects: 'Redirect check',
  domainage: 'Domain age check',
  deepscan: 'Extended scan',
};

function isThreatLevel(value: unknown): value is ThreatLevel {
  return value === 'safe' || value === 'suspicious' || value === 'malicious' || value === 'unknown';
}

function isStoredScan(value: unknown): value is StoredScan | LegacyStoredScan {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const checksAreValid = (checks: unknown) =>
    Array.isArray(checks) &&
    checks.every(
      (check) =>
        typeof check === 'object' &&
        check !== null &&
        typeof (check as Record<string, unknown>).checkName === 'string' &&
        isThreatLevel((check as Record<string, unknown>).threatLevel) &&
        ((check as Record<string, unknown>).score === undefined ||
          typeof (check as Record<string, unknown>).score === 'number')
    );

  return (
    typeof candidate.id === 'string' &&
    isThreatLevel(candidate.finalVerdict) &&
    typeof candidate.scannedAt === 'string' &&
    checksAreValid(candidate.checks) &&
    ((candidate.scanType === 'url' && typeof candidate.displayValue === 'string') ||
      (candidate.scanType === 'barcode' &&
        typeof candidate.displayValue === 'string' &&
        typeof candidate.barcodeType === 'string') ||
      (typeof candidate.domain === 'string' && typeof candidate.url === 'string'))
  );
}

function normalizeHistoryItem(value: unknown): StoredScan | null {
  if (!isStoredScan(value)) return null;
  if ('scanType' in value) return value;
  const parsed = parseUserUrl(value.url || value.domain);
  if (!parsed) return null;
  return {
    id: value.id,
    scanType: 'url',
    displayValue: parsed.hostname,
    finalVerdict: value.finalVerdict,
    checks: value.checks,
    scannedAt: value.scannedAt,
    cached: value.cached,
  };
}

function parseUserUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseScannedWebUrl(value: string, barcodeType: string): URL | null {
  if (barcodeType.toLowerCase() !== 'qr') return null;
  const trimmed = value.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  if (hasScheme) {
    try {
      const parsed = new URL(trimmed);
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password
        ? parsed
        : null;
    } catch {
      return null;
    }
  }
  if (!/^(?:[^\s./]+\.)+[^\s./]+(?::\d+)?(?:[/?#][^\s]*)?$/u.test(trimmed)) return null;
  return parseUserUrl(trimmed);
}

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 'Time unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

function barcodeTypeLabel(type: string) {
  switch (type.toLowerCase()) {
    case 'qr': return 'QR code';
    case 'ean13': return 'EAN-13 product code';
    case 'ean8': return 'EAN-8 product code';
    case 'upc_a': return 'UPC-A product code';
    case 'upc_e': return 'UPC-E product code';
    case 'code128': return 'Code 128 barcode';
    case 'code39': return 'Code 39 barcode';
    case 'code93': return 'Code 93 barcode';
    case 'itf14': return 'ITF-14 barcode';
    case 'pdf417': return 'PDF417 barcode';
    case 'datamatrix': return 'Data Matrix code';
    case 'aztec': return 'Aztec code';
    case 'codabar': return 'Codabar barcode';
    default: return 'Barcode';
  }
}

// History IDs are created in event handlers, never during render
function historyId(suffix: string) {
  return `${Date.now()}-${suffix}`;
}

function shouldStoreBarcodeValue(type: string) {
  return ['ean13', 'ean8', 'upc_a', 'upc_e'].includes(type.toLowerCase());
}

function displayName(checkName: string) {
  return checkNames[checkName.replace(/[^a-z]/gi, '').toLowerCase()] ??
    checkName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
}

function verdictDetails(verdict: ThreatLevel, colors: ColorPalette) {
  switch (verdict) {
    case 'safe':
      return {
        title: 'No known threats detected',
        summary: 'The checks that completed did not report a known threat. No scan can guarantee that a link is safe.',
        action: 'No known threats were reported. Stay alert for unexpected requests for passwords or payment details.',
        color: colors.green,
        tint: colors.greenLight,
        icon: 'shield-checkmark' as const,
      };
    case 'suspicious':
      return {
        title: 'Proceed with caution',
        summary: 'Some signals need a closer look. A warning is not proof that this link is malicious.',
        action: 'Avoid entering personal or payment information until you can verify the destination independently.',
        color: colors.amber,
        tint: colors.amberLight,
        icon: 'warning' as const,
      };
    case 'malicious':
      return {
        title: 'This link appears dangerous',
        summary: 'The scanner reported a high-risk signal for this link.',
        action: 'We recommend not opening this link. If it came from someone you know, confirm with them another way.',
        color: colors.red,
        tint: colors.redLight,
        icon: 'shield' as const,
      };
    default:
      return {
        title: 'We couldn’t fully verify this link',
        summary: 'Some checks are unavailable or could not confirm the link’s status. Treat it carefully.',
        action: 'If you were not expecting this link, do not open it. Try again later or verify it with the sender.',
        color: colors.secondaryText,
        tint: colors.paleBlue,
        icon: 'help-circle' as const,
      };
  }
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function verdictLabel(verdict: ThreatLevel) {
  switch (verdict) {
    case 'safe': return 'No known threats';
    case 'suspicious': return 'Use caution';
    case 'malicious': return 'High risk';
    default: return 'Not verified';
  }
}

function levelColor(level: ThreatLevel, colors: ColorPalette) {
  if (level === 'safe') return colors.green;
  if (level === 'suspicious') return colors.amber;
  if (level === 'malicious') return colors.red;
  return colors.muted;
}

export default function Scanner() {
  const systemScheme = useColorScheme();
  const [appearance, setAppearance] = useState<AppearancePreference>('system');
  const isDark = appearance === 'dark' || (appearance === 'system' && systemScheme === 'dark');
  const colors: ColorPalette = isDark ? DARK_COLORS : COLORS;
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [screen, setScreen] = useState<Screen>('home');
  const [url, setUrl] = useState('');
  const [activeScan, setActiveScan] = useState<ScanReport | null>(null);
  const [activeCode, setActiveCode] = useState<ActiveCode | null>(null);
  const [isHistoricalReport, setIsHistoricalReport] = useState(false);
  const [history, setHistory] = useState<StoredScan[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | ThreatLevel>('all');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<ModalContent | null>(null);
  const [expandedChecks, setExpandedChecks] = useState<string[]>([]);
  const [pendingCode, setPendingCode] = useState<Pick<BarcodeScanningResult, 'data' | 'type'> | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const pendingCodeRef = useRef<Pick<BarcodeScanningResult, 'data' | 'type'> | null>(null);
  const rejectedCodeRef = useRef<string | null>(null);
  const scanLock = useRef(false);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState === 'background' ? 'background' : 'active'
  );

  useEffect(() => {
    let mounted = true;
    AsyncStorage.multiGet([HISTORY_KEY, APPEARANCE_KEY])
      .then((entries) => {
        if (!mounted) return;
        const savedHistory = entries[0][1];
        const savedAppearance = entries[1][1];
        if (savedHistory) {
          const parsed: unknown = JSON.parse(savedHistory);
          if (Array.isArray(parsed)) {
            const normalized = parsed
              .map(normalizeHistoryItem)
              .filter((entry): entry is StoredScan => entry !== null);
            setHistory(normalized);
          }
        }
        if (savedAppearance === 'system' || savedAppearance === 'light' || savedAppearance === 'dark') {
          setAppearance(savedAppearance);
        }
      })
      .catch(() => {
        if (mounted) setToast('Saved preferences could not be loaded on this device.');
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      if (nextState === 'active') {
        void getPermission().catch(() => {
          setToast('Camera permission status could not be refreshed. Check your device settings.');
        });
      }
    });
    return () => subscription.remove();
  }, [getPermission]);

  const currentTab: Tab = screen === 'history' || screen === 'settings'
    ? screen
    : (screen === 'report' || screen === 'code') && isHistoricalReport ? 'history' : 'home';

  const persistHistory = async (nextHistory: StoredScan[]) => {
    setHistory(nextHistory);
    try {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
      setToast('The scan is ready, but your history could not be saved.');
    }
  };

  const startScan = async (providedUrl = url) => {
    const parsed = parseUserUrl(providedUrl);
    if (!parsed) {
      setModal({ title: 'This link could not be checked', body: 'The QR code did not contain a valid web address. SafeScan will not open it.' });
      return;
    }

    const normalized = parsed.toString();
    setUrl(normalized);
    setExpandedChecks([]);
    setIsHistoricalReport(false);
    setActiveCode(null);
    pendingCodeRef.current = null;
    setPendingCode(null);
    setScreen('scanning');
    try {
      const report = await scanURL(normalized);
      setActiveScan(report);
      setScreen('result');

      const safeDomain = parsed.hostname;
      const storedReport: StoredScan = {
        id: historyId(safeDomain),
        scanType: 'url',
        displayValue: safeDomain,
        finalVerdict: report.finalVerdict,
        scannedAt: report.scannedAt,
        cached: report.cached,
        checks: report.checks.map(({ checkName, threatLevel }) => ({ checkName, threatLevel })),
      };
      await persistHistory([storedReport, ...history.filter((item) => item.scanType !== 'url' || item.displayValue !== safeDomain)].slice(0, 30));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The scanner could not complete this check.';
      resetCodeDetection();
      setScreen('home');
      setModal({ title: 'Could not verify this link', body: message });
    }
  };

  const handleCodeDetected = (result: Pick<BarcodeScanningResult, 'data' | 'type'>) => {
    const data = result.data.trim();
    if (!data || pendingCodeRef.current || scanLock.current) return;
    if (data.length > 4096) {
      if (rejectedCodeRef.current !== data) {
        rejectedCodeRef.current = data;
        setToast('This code contains too much data to display safely.');
      }
      return;
    }
    rejectedCodeRef.current = null;
    const candidate = { data, type: result.type };
    pendingCodeRef.current = candidate;
    setPendingCode(candidate);
  };

  const processDecodedCode = (result: Pick<BarcodeScanningResult, 'data' | 'type'>) => {
    const webUrl = parseScannedWebUrl(result.data, result.type);
    if (webUrl) {
      setUrl(webUrl.toString());
      void startScan(webUrl.toString());
      return;
    }

    const scannedAt = new Date().toISOString();
    const productCode = shouldStoreBarcodeValue(result.type);
    const displayValue = productCode ? result.data : barcodeTypeLabel(result.type);
    setActiveCode({ value: result.data, type: result.type, scannedAt });
    setActiveScan(null);
    setIsHistoricalReport(false);
    setScreen('code');
    const historyItem: StoredScan = {
      id: historyId(result.type),
      scanType: 'barcode',
      displayValue,
      barcodeType: result.type,
      finalVerdict: 'unknown',
      checks: [],
      scannedAt,
    };
    void persistHistory([historyItem, ...history].slice(0, 30));
  };

  const confirmPendingCode = () => {
    const code = pendingCodeRef.current;
    if (!code) {
      setToast('Align a QR code or barcode within the frame.');
      return;
    }
    if (scanLock.current) return;
    scanLock.current = true;
    pendingCodeRef.current = null;
    setPendingCode(null);
    processDecodedCode(code);
  };

  const resetCodeDetection = () => {
    scanLock.current = false;
    rejectedCodeRef.current = null;
    pendingCodeRef.current = null;
    setPendingCode(null);
  };

  const openGallery = async () => {
    setGalleryBusy(true);
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      const image = selection.assets?.[0];
      if (selection.canceled || !image) return;
      resetCodeDetection();
      const results = await scanCodeImage(image.uri);
      if (!results.length) {
        setToast('No QR code or barcode was found in that image. Try another image.');
        return;
      }
      handleCodeDetected(results[0]);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'The image could not be scanned. Please try another image.');
    } finally {
      setGalleryBusy(false);
    }
  };

  const manageCameraPermission = async () => {
    if (permission?.granted) {
      if (Platform.OS === 'web') {
        setModal({
          title: 'Camera permission',
          body: 'Use your browser’s site settings to allow or revoke camera access for SafeScan.',
        });
        return;
      }
      try {
        await Linking.openSettings();
      } catch {
        setToast('Device settings could not be opened. Manage camera access in your device settings.');
      }
      return;
    }
    if (permission?.canAskAgain !== false) {
      try {
        await requestPermission();
      } catch {
        setToast('SafeScan could not request camera permission. Please check your device settings.');
      }
      return;
    }
    if (Platform.OS === 'web') {
      setModal({
        title: 'Camera permission',
        body: 'Use your browser’s site settings to allow camera access for SafeScan, then reopen the scanner.',
      });
      return;
    }
    try {
      await Linking.openSettings();
    } catch {
      setToast('Device settings could not be opened. Allow camera access in your device settings.');
    }
  };

  const clearHistory = async () => {
    try {
      await AsyncStorage.removeItem(HISTORY_KEY);
      setHistory([]);
      setModal(null);
      setToast('Scan history cleared.');
    } catch {
      setToast('History could not be cleared. Please try again.');
    }
  };

  const changeAppearance = async (value: AppearancePreference) => {
    setAppearance(value);
    try {
      await AsyncStorage.setItem(APPEARANCE_KEY, value);
    } catch {
      setToast('Appearance changed for now, but could not be saved.');
    }
  };

  const openHistoryReport = (entry: StoredScan) => {
    if (entry.scanType === 'barcode') {
      setActiveCode({ value: entry.displayValue, type: entry.barcodeType ?? 'barcode', scannedAt: entry.scannedAt, historical: true });
      setActiveScan(null);
      setIsHistoricalReport(true);
      setScreen('code');
      return;
    }
    setActiveScan({
      url: `https://${entry.displayValue}`,
      finalVerdict: entry.finalVerdict,
      checks: entry.checks,
      scannedAt: entry.scannedAt,
      cached: entry.cached,
    });
    setIsHistoricalReport(true);
    setScreen('report');
    setExpandedChecks([]);
  };

  const shareResult = async () => {
    if (!activeScan) return;
    const hostname = parseUserUrl(activeScan.url)?.hostname ?? activeScan.url;
    const message = `SafeScan checked ${hostname}: ${verdictLabel(activeScan.finalVerdict)}. Scan links before opening them.`;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ text: message });
      } else if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(message);
        setToast('Result copied to your clipboard.');
      } else {
        await Share.share({ message });
      }
    } catch {
      setToast('The result could not be shared from this device.');
    }
  };

  const toggleCheck = (checkName: string, index: number) => {
    const key = `${checkName}-${index}`;
    setExpandedChecks((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]
    );
  };

  const showUrlDetails = (scan: ScanReport) => {
    setModal({
      title: 'Link details',
      body: 'This is the link SafeScan submitted for checking. SafeScan does not open the destination.',
      url: scan.url,
      kind: 'url',
    });
  };

  const renderCheck = (check: ScanReport['checks'][number], index: number) => {
    const key = `${check.checkName}-${index}`;
    const expanded = expandedChecks.includes(key);
    const checkColor = levelColor(check.threatLevel, colors);
    const statusText =
      check.threatLevel === 'safe' ? 'No match reported' :
      check.threatLevel === 'suspicious' ? 'Review' :
      check.threatLevel === 'malicious' ? 'Threat reported' : 'Unavailable';
    const detail = check.detail?.trim() ||
      (check.threatLevel === 'unknown'
        ? 'This check did not return a result. It is not counted as a pass.'
        : 'No additional evidence details were provided by the scanner.');

    return (
      <Pressable
        key={key}
        onPress={() => toggleCheck(check.checkName, index)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.checkCard}
      >
        <View style={styles.checkRow}>
          <AppIcon
            name={check.threatLevel === 'safe' ? 'checkmark-circle' : check.threatLevel === 'unknown' ? 'help-circle' : 'alert-circle'}
            color={checkColor}
            size={21}
          />
          <Text style={styles.checkName}>{displayName(check.checkName)}</Text>
          <Text style={[styles.checkState, { color: checkColor }]}>{statusText}</Text>
          <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={colors.muted} />
        </View>
        {expanded && <Text style={styles.checkDetail}>{detail}</Text>}
      </Pressable>
    );
  };

  const renderHome = () => (
    <View style={styles.homeScreen}>
      <CameraScanner
        active={appState === 'active' && !galleryBusy}
        permission={permission}
        requestPermission={requestPermission}
        colors={colors}
        styles={styles}
        reduceMotion={reduceMotion}
        hasPendingCode={pendingCode !== null}
        onCode={handleCodeDetected}
        onGallery={() => void openGallery()}
        galleryBusy={galleryBusy}
        onNotice={setToast}
      />
      <Pressable
        onPress={confirmPendingCode}
        disabled={galleryBusy}
        accessibilityRole="button"
        accessibilityLabel={
          pendingCode
            ? parseScannedWebUrl(pendingCode.data, pendingCode.type) ? 'Verify detected link' : 'View scanned code'
            : 'Scan QR code'
        }
        style={({ pressed }) => [
          styles.primaryButton,
          styles.homeScanButton,
          pressed ? { opacity: 0.88 } : null,
          galleryBusy ? { opacity: 0.6 } : null,
        ]}
      >
        <AppIcon
          name={pendingCode ? 'shield-checkmark' : 'scan-outline'}
          color="#FFFFFF"
          size={20}
        />
        <Text style={styles.primaryButtonText}>
          {pendingCode
            ? parseScannedWebUrl(pendingCode.data, pendingCode.type) ? 'Verify Link' : 'View Scanned Code'
            : 'Scan QR Code'}
        </Text>
      </Pressable>
      <View style={styles.homeRecent}>
        <View style={styles.sectionHeadingRow}>
          <Text style={styles.sectionTitle} variant="heading">Recent Scans</Text>
          <Pressable onPress={() => setScreen('history')} accessibilityRole="button">
            <Text style={styles.sectionAction}>See all</Text>
          </Pressable>
        </View>
        {history.length === 0 ? (
          <View style={styles.homeEmpty}>
            <View style={[styles.recentIcon, { backgroundColor: colors.greenLight }]}>
              <AppIcon name="scan-outline" size={19} color={colors.green} />
            </View>
            <Text style={styles.homeEmptyText}>Your first scan is one tap away. Recent results will appear here.</Text>
          </View>
        ) : (
          history.slice(0, 3).map((entry) => (
            <HistoryItem key={entry.id} entry={entry} colors={colors} styles={styles} compact onPress={() => openHistoryReport(entry)} />
          ))
        )}
      </View>
    </View>
  );

  const filteredHistory = history.filter((entry) => {
    const matchesFilter = historyFilter === 'all' || entry.finalVerdict === historyFilter;
    return matchesFilter && entry.displayValue.toLowerCase().includes(historySearch.toLowerCase());
  });

  const renderHistory = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle} variant="heading">Scan history</Text>
        <Text style={styles.screenSubtitle}>Your saved scans stay on this device.</Text>
      </View>
      {history.length > 0 && (
        <>
          <View style={styles.inputWrap}>
            <AppIcon name="search-outline" size={18} color={colors.secondaryText} />
            <TextInput
              value={historySearch}
              onChangeText={setHistorySearch}
              placeholder="Search scans"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={styles.input}
              accessibilityLabel="Search scan history"
            />
            <Pressable
              onPress={() => setModal({ title: 'Clear scan history?', body: 'This permanently removes the saved scan reports from this device.', kind: 'clear-history' })}
              accessibilityRole="button"
              accessibilityLabel="Clear scan history"
              style={styles.inlineButton}
            >
              <AppIcon name="trash-outline" size={19} color={colors.secondaryText} />
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 13 }}>
            {(['all', 'safe', 'suspicious', 'malicious', 'unknown'] as const).map((filter) => {
              const selected = historyFilter === filter;
              return (
                <Pressable
                  key={filter}
                  onPress={() => setHistoryFilter(filter)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: selected ? colors.buttonPrimary : colors.surface, borderWidth: 1, borderColor: selected ? colors.buttonPrimary : colors.border }}
                >
                  <Text style={{ color: selected ? '#FFFFFF' : colors.secondaryText, fontSize: 12, fontWeight: '700' }}>
                    {filter === 'all' ? 'All' : verdictLabel(filter)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}
      {filteredHistory.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.reassuranceIcon}><AppIcon name="time-outline" size={22} color={colors.secondaryText} /></View>
          <Text style={styles.emptyTitle}>{history.length ? 'No matching scans' : 'No scans yet'}</Text>
          <Text style={styles.emptyText}>{history.length ? 'Try another search or status filter.' : 'When you scan a link, its report will be saved here on this device.'}</Text>
          {!history.length && (
            <Pressable
              onPress={() => {
                resetCodeDetection();
                setScreen('home');
              }}
              style={[styles.primaryButton, { alignSelf: 'stretch', marginTop: 17 }]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Open scanner</Text>
            </Pressable>
          )}
        </View>
      ) : filteredHistory.map((entry) => (
        <HistoryItem key={entry.id} entry={entry} colors={colors} styles={styles} onPress={() => openHistoryReport(entry)} />
      ))}
    </ScrollView>
  );

  const renderSettings = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle} variant="heading">Settings</Text>
        <Text style={styles.screenSubtitle}>Make SafeScan work the way you prefer.</Text>
      </View>

      <View style={styles.settingsCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingIcon}><AppIcon name="color-palette-outline" size={18} color={colors.navy} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingTitle}>Appearance</Text>
            <Text style={styles.settingSubtext}>Choose how SafeScan looks</Text>
          </View>
        </View>
        <View style={styles.themeChoices}>
          {(['system', 'light', 'dark'] as const).map((option) => {
            const selected = appearance === option;
            return (
              <Pressable
                key={option}
                onPress={() => void changeAppearance(option)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.themeChoice, { backgroundColor: selected ? colors.buttonPrimary : colors.background }]}
              >
                <Text style={{ color: selected ? '#FFFFFF' : colors.secondaryText, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.settingsCard}>
        <SettingRow
          icon="camera-outline"
          title="Camera access"
          subtitle={permission?.granted ? 'Allowed for scanning QR codes and barcodes' : 'Required to scan codes'}
          colors={colors}
          styles={styles}
          onPress={() => void manageCameraPermission()}
        />
        <View style={styles.separator} />
        <SettingRow
          icon="lock-closed-outline"
          title="Privacy & data"
          subtitle="How links and reports are handled"
          colors={colors}
          styles={styles}
          onPress={() => setModal({
            title: 'Your privacy',
            body: 'Links are sent to SafeScan’s backend for checking, with tracking parameters removed. The backend may query Google Safe Browsing. The app also sends a random ID created on this device; the backend stores only a scrambled (hashed) form of it, to limit abuse. Recent history is stored locally on this device and keeps the domain, verdict, scan time, and check names and statuses—not URL paths, query parameters, fragments, or evidence details. Clear history any time.',
          })}
        />
        <View style={styles.separator} />
        <SettingRow
          icon="help-circle-outline"
          title="How link checks work"
          subtitle="Understand verdicts and limitations"
          colors={colors}
          styles={styles}
          onPress={() => setModal({
            title: 'How SafeScan checks links',
            body: 'SafeScan displays the check results returned by its service. Some checks may be unavailable or still under development. “No known threats” is not a guarantee: new, targeted, or unreported threats may not be detected. HTTPS protects a connection but does not prove that a site is trustworthy.',
          })}
        />
        <View style={styles.separator} />
        <SettingRow
          icon="information-circle-outline"
          title="About SafeScan"
          subtitle="A calmer way to check before you click"
          colors={colors}
          styles={styles}
          onPress={() => setModal({
            title: 'About SafeScan',
            body: 'SafeScan helps you review a link before opening it. It does not visit the destination, and its results should be treated as guidance—not a guarantee of safety.',
          })}
        />
      </View>

      <View style={styles.settingsCard}>
        <SettingRow
          icon="trash-outline"
          title="Clear scan history"
          subtitle={`${history.length} saved ${history.length === 1 ? 'scan' : 'scans'} on this device`}
          colors={colors}
          styles={styles}
          onPress={() => setModal({ title: 'Clear scan history?', body: 'This permanently removes the saved scan reports from this device.', kind: 'clear-history' })}
        />
      </View>
      <Text style={[styles.privacyNote, { textAlign: 'center', marginTop: 7 }]}>SafeScan · Link checks are helpful, not infallible.</Text>
    </ScrollView>
  );

  const renderScanning = () => {
    const pendingDomain = parseUserUrl(url)?.hostname ?? url;
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.scannerCard}>
          <View
            style={[styles.spinnerRing, { borderColor: colors.greenLight }]}
            accessibilityRole="progressbar"
            accessibilityLabel="Waiting for link verification"
          >
            {reduceMotion
              ? <AppIcon name="shield-checkmark" size={36} color={colors.green} />
              : <ActivityIndicator size="large" color={colors.green} />}
          </View>
          <Text style={styles.scannerTitle} variant="heading">Verifying your link…</Text>
          <Text style={styles.scannerText}>Waiting for the scanner to finish its checks. Results will appear as soon as they’re available.</Text>
          <Text style={styles.scanTarget} numberOfLines={2}>{pendingDomain}</Text>
          <View style={[styles.banner, { backgroundColor: colors.paleBlue, alignSelf: 'stretch' }]}>
            <AppIcon name="information-circle-outline" color={colors.navy} size={19} />
            <Text style={[styles.bannerText, { flex: 1, marginTop: 0 }]}>Checks run on the SafeScan service. No website is opened.</Text>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderCodeResult = () => {
    if (!activeCode) return null;
    const isProductCode = shouldStoreBarcodeValue(activeCode.type);
    const returnTo = isHistoricalReport ? 'history' : 'home';
    return (
      <ScrollView contentContainerStyle={styles.codeContent} showsVerticalScrollIndicator={false}>
        <View style={styles.screenHeader}>
          <Pressable
            onPress={() => setScreen(returnTo)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 13 }}
          >
            <AppIcon name="arrow-back" size={17} color={colors.secondaryText} />
            <Text style={{ color: colors.secondaryText, fontSize: 13, fontWeight: '600' }}>
              {isHistoricalReport ? 'Back to history' : 'Back to scan'}
            </Text>
          </Pressable>
          {isHistoricalReport && <Text style={styles.eyebrow}>Historical scan</Text>}
        </View>
        <View style={[styles.verdictCard, { backgroundColor: colors.paleBlue }]}>
          <View style={[styles.verdictIcon, { backgroundColor: colors.surface }]}>
            <AppIcon name={isProductCode ? 'barcode-outline' : 'qr-code-outline'} size={36} color={colors.navy} />
          </View>
          <Text style={styles.verdictTitle} variant="heading">{isProductCode ? 'Product code scanned' : 'Code scanned'}</Text>
          <Text style={styles.verdictSummary}>
            This is decoded content, not a website security verdict. SafeScan did not open it or submit it to link analysis.
          </Text>
        </View>
        <View style={styles.codeCard}>
          <Text style={styles.settingSubtext}>{barcodeTypeLabel(activeCode.type).toUpperCase()}</Text>
          <Text selectable style={styles.codeValue}>
            {activeCode.historical && !isProductCode
              ? 'The QR/barcode contents were not saved. Rescan the code to view its contents.'
              : activeCode.value}
          </Text>
        </View>
        <View style={[styles.banner, { backgroundColor: colors.paleBlue, marginTop: 14 }]}>
          <AppIcon name="information-circle-outline" color={colors.navy} size={19} />
          <Text style={[styles.bannerText, { flex: 1, marginTop: 0 }]}>
            Only product identifiers (EAN/UPC) are retained in history. Other decoded content is discarded after this screen closes.
          </Text>
        </View>
        <Pressable
          onPress={() => {
            resetCodeDetection();
            setActiveCode(null);
            setIsHistoricalReport(false);
            setScreen('home');
          }}
          style={[styles.primaryButton, { marginTop: 18 }]}
          accessibilityRole="button"
        >
          <AppIcon name="camera-outline" color="#FFFFFF" size={19} />
          <Text style={styles.primaryButtonText}>Scan another code</Text>
        </Pressable>
      </ScrollView>
    );
  };

  const renderResult = (detailed: boolean) => {
    if (!activeScan) return null;
    const presentation = verdictDetails(activeScan.finalVerdict, colors);
    const parsedActiveUrl = parseUserUrl(activeScan.url);
    const domain = parsedActiveUrl?.hostname ?? activeScan.url;
    const expanded = detailed || screen === 'report';
    const verdictSummary = activeScan.checks.length > 0
      ? presentation.summary
      : activeScan.finalVerdict === 'safe'
        ? 'The scanner returned a no-known-threats result, but did not provide individual checks. No scan can guarantee that a link is safe.'
        : presentation.summary;

    return (
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.screenHeader}>
          <Pressable onPress={() => setScreen(isHistoricalReport ? 'history' : 'home')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 13 }}>
            <AppIcon name="arrow-back" size={17} color={colors.secondaryText} />
            <Text style={{ color: colors.secondaryText, fontSize: 13, fontWeight: '600' }}>{isHistoricalReport ? 'Back to history' : 'Back to scan'}</Text>
          </Pressable>
          {screen === 'report' && <Text style={styles.eyebrow}>{isHistoricalReport ? 'Historical report' : 'Full report'}</Text>}
        </View>

        <View style={[styles.verdictCard, { backgroundColor: presentation.tint }]}>
          <View style={[styles.verdictIcon, { backgroundColor: colors.surface }]}>
            <AppIcon name={presentation.icon} size={36} color={presentation.color} />
          </View>
          <Text style={styles.verdictTitle} variant="heading">{presentation.title}</Text>
          <Text style={styles.verdictSummary}>{verdictSummary}</Text>
        </View>

        <Pressable onPress={() => showUrlDetails(activeScan)} accessibilityRole="button" style={styles.domainCard}>
          <View style={styles.domainRow}>
            <AppIcon name="globe-outline" size={19} color={colors.secondaryText} />
            <Text style={styles.domainText} numberOfLines={1}>{domain}</Text>
            <AppIcon name="chevron-forward" size={17} color={colors.muted} />
          </View>
          <Text style={styles.domainSubtext}>
            {activeScan.cached ? 'Retrieved' : 'Checked'} {formatTimestamp(activeScan.scannedAt)}
            {activeScan.cached ? ' · Cached result' : ''}
            {' · Tap for link details'}
          </Text>
        </Pressable>

        {isHistoricalReport && (
          <View style={[styles.banner, { backgroundColor: colors.paleBlue }]}>
            <AppIcon name="time-outline" color={colors.navy} size={19} />
            <Text style={[styles.bannerText, { flex: 1, marginTop: 0 }]}>
              This is a saved result from {formatTimestamp(activeScan.scannedAt)}. History keeps only the domain, so checking again will scan the domain root—not the original path or query.
            </Text>
          </View>
        )}

        <View style={styles.quickSection}>
          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionTitle} variant="heading">Security checks</Text>
            <Pressable
              onPress={() => setModal({
                title: 'Why this result?',
                body: `This status comes from the SafeScan service. ${activeScan.checks.length > 0
                  ? `${activeScan.checks.length} individual check results are listed below; tap a check to view any evidence the service returned.`
                  : 'The service returned an overall verdict without individual check details.'} SafeScan does not display an unverified numerical safety score.`,
              })}
              accessibilityRole="button"
            >
              <Text style={styles.sectionAction}>Why this result?</Text>
            </Pressable>
          </View>
          {activeScan.checks.length > 0 ? (
            activeScan.checks.map(renderCheck)
          ) : (
            <View style={styles.banner} >
              <AppIcon name="help-circle-outline" color={colors.secondaryText} />
              <Text style={styles.bannerText}>No individual check details were returned by the scanner.</Text>
            </View>
          )}
        </View>

        <View style={[styles.banner, { backgroundColor: presentation.tint }]}>
          <AppIcon name={activeScan.finalVerdict === 'malicious' ? 'shield' : 'bulb-outline'} color={presentation.color} size={20} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>{activeScan.finalVerdict === 'malicious' ? 'Recommended action' : 'Keep this in mind'}</Text>
            <Text style={styles.bannerText}>{presentation.action}</Text>
          </View>
        </View>

        {expanded && (
          <>
            <View style={styles.quickSection}>
              <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle} variant="heading">URL and domain</Text></View>
              <View style={styles.domainCard}>
                <Text style={styles.settingSubtext}>HOSTNAME</Text>
                <Text selectable style={[styles.domainText, { marginTop: 4 }]}>{domain}</Text>
                <Text style={[styles.settingSubtext, { marginTop: 13 }]}>PROTOCOL</Text>
                <Text style={[styles.domainText, { marginTop: 4 }]}>{parsedActiveUrl?.protocol.replace(':', '') ?? 'Not available'}</Text>
                <Text style={[styles.settingSubtext, { marginTop: 13 }]}>PATH</Text>
                <Text selectable style={[styles.domainText, { marginTop: 4 }]} numberOfLines={2}>{parsedActiveUrl?.pathname ?? 'Not available'}</Text>
                <Text style={[styles.settingSubtext, { marginTop: 13 }]}>QUERY PARAMETERS</Text>
                <Text style={[styles.domainText, { marginTop: 4 }]}>
                  {parsedActiveUrl?.search ? 'Present; values hidden' : 'None'}
                </Text>
                {domain.startsWith('xn--') || domain.includes('.xn--') ? (
                  <View style={[styles.banner, { backgroundColor: colors.amberLight }]}>
                    <AppIcon name="warning" size={18} color={colors.amber} />
                    <Text style={styles.bannerText}>This hostname contains an internationalized domain label. Review the exact spelling carefully.</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={[styles.banner, { backgroundColor: colors.paleBlue }]}>
              <AppIcon name="information-circle-outline" color={colors.navy} size={20} />
              <Text style={[styles.bannerText, { flex: 1, marginTop: 0 }]}>Redirect and domain metadata are included only when the scanner returns them. SafeScan does not infer missing details.</Text>
            </View>
          </>
        )}

        {!!activeScan.serviceMessage && (
          <View style={[styles.banner, { backgroundColor: colors.paleBlue }]}>
            <AppIcon name="information-circle-outline" color={colors.navy} size={20} />
            <Text style={[styles.bannerText, { flex: 1, marginTop: 0 }]}>{activeScan.serviceMessage}</Text>
          </View>
        )}

        <View style={styles.reportActionRow}>
          {!expanded && (
            <Pressable onPress={() => setScreen('report')} style={[styles.primaryButton, styles.reportButton]} accessibilityRole="button">
              <AppIcon name="document-text-outline" color="#FFFFFF" size={17} />
              <Text style={styles.primaryButtonText}>View full report</Text>
            </Pressable>
          )}
          <Pressable onPress={() => void shareResult()} style={[styles.secondaryButton, styles.reportButton]} accessibilityRole="button">
            <AppIcon name="share-outline" color={colors.navy} size={17} />
            <Text style={styles.secondaryButtonText}>Share</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => {
            if (isHistoricalReport) {
              void startScan(activeScan.url);
            } else {
              setActiveScan(null);
              setUrl('');
              setScreen('home');
            }
          }}
          style={[styles.primaryButton, { marginTop: 10, backgroundColor: presentation.color }]}
          accessibilityRole="button"
        >
          <AppIcon name="refresh-outline" color="#FFFFFF" size={18} />
          <Text style={styles.primaryButtonText}>{isHistoricalReport ? 'Check this domain again' : 'Scan another link'}</Text>
        </Pressable>
      </ScrollView>
    );
  };

  const renderCurrentScreen = () => {
    switch (screen) {
      case 'history': return renderHistory();
      case 'settings': return renderSettings();
      case 'scanning': return renderScanning();
      case 'code': return renderCodeResult();
      case 'result': return renderResult(false);
      case 'report': return renderResult(true);
      default: return renderHome();
    }
  };

  return (
    <View style={styles.safeArea}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.page}>
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <View style={styles.brandIcon}><AppIcon name="shield-checkmark" color={colors.green} size={22} /></View>
            <Text style={styles.brandName} variant="heading">SafeScan</Text>
          </View>
          <Pressable
            onPress={() => setScreen('settings')}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            style={styles.topAction}
          >
            <AppIcon name="settings-outline" size={19} color={colors.navy} />
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>{renderCurrentScreen()}</View>

        {screen !== 'scanning' && (
          <View style={styles.bottomNav}>
            {([
              { tab: 'home' as const, icon: 'home-outline' as const, label: 'Home' },
              { tab: 'history' as const, icon: 'time-outline' as const, label: 'History' },
              { tab: 'settings' as const, icon: 'settings-outline' as const, label: 'Settings' },
            ]).map((item) => {
              const selected = currentTab === item.tab;
              return (
                <Pressable
                  key={item.tab}
                  onPress={() => {
                    if (item.tab === 'home') resetCodeDetection();
                    setScreen(item.tab);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  style={styles.navItem}
                >
                  <AppIcon name={selected && item.tab === 'home' ? 'home' : item.icon} size={20} color={selected ? colors.green : colors.muted} />
                  <Text style={[styles.navLabel, { color: selected ? colors.green : colors.secondaryText }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {!!toast && (
        <View style={{ pointerEvents: 'box-none', position: 'absolute', left: 20, right: 20, bottom: 85, maxWidth: 570, alignSelf: 'center' }}>
          <View accessibilityLiveRegion="polite" style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>
        </View>
      )}

      <Modal visible={modal !== null} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={() => setModal(null)}>
        <View style={[styles.modalBackdrop, Platform.OS === 'web' ? { justifyContent: 'center', paddingHorizontal: 20 } : null]}>
          <Pressable
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setModal(null)}
            accessibilityRole="button"
            accessibilityLabel="Close dialog"
          />
          <View
            style={[styles.modalSheet, Platform.OS === 'web' ? { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 25 } : null]}
            accessibilityViewIsModal
          >
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle} variant="heading">{modal?.title}</Text>
              <Pressable onPress={() => setModal(null)} accessibilityRole="button" accessibilityLabel="Close">
                <AppIcon name="close" color={colors.secondaryText} size={23} />
              </Pressable>
            </View>
            <Text style={styles.modalText}>{modal?.body}</Text>
            {modal?.url && (
              <>
                <Text selectable style={styles.modalUrl}>{modal.url}</Text>
                <Pressable
                  onPress={async () => {
                    try {
                      await Clipboard.setStringAsync(modal.url ?? '');
                      setToast('Link copied.');
                      setModal(null);
                    } catch {
                      setToast('Could not copy this link.');
                    }
                  }}
                  style={[styles.secondaryButton, { marginTop: 16 }]}
                  accessibilityRole="button"
                >
                  <AppIcon name="copy-outline" size={17} color={colors.navy} />
                  <Text style={styles.secondaryButtonText}>Copy link</Text>
                </Pressable>
              </>
            )}
            {modal?.kind === 'clear-history' ? (
              <View style={styles.reportActionRow}>
                <Pressable onPress={() => setModal(null)} style={[styles.secondaryButton, styles.reportButton]} accessibilityRole="button">
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={() => void clearHistory()} style={[styles.primaryButton, styles.reportButton, { backgroundColor: colors.red }]} accessibilityRole="button">
                  <Text style={styles.primaryButtonText}>Clear history</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setModal(null)} style={[styles.primaryButton, { marginTop: 18 }]} accessibilityRole="button">
                <Text style={styles.primaryButtonText}>Got it</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

    </View>
  );
}

function HistoryItem({
  entry,
  colors,
  styles,
  compact = false,
  onPress,
}: {
  entry: StoredScan;
  colors: ColorPalette;
  styles: ReturnType<typeof createStyles>;
  compact?: boolean;
  onPress: () => void;
}) {
  const color = levelColor(entry.finalVerdict, colors);
  const tint = entry.finalVerdict === 'safe' ? colors.greenLight :
    entry.finalVerdict === 'suspicious' ? colors.amberLight :
    entry.finalVerdict === 'malicious' ? colors.redLight : colors.paleBlue;
  const icon = entry.finalVerdict === 'safe' ? 'checkmark-circle' :
    entry.finalVerdict === 'suspicious' ? 'warning' :
    entry.finalVerdict === 'malicious' ? 'shield' : 'help-circle';
  if (compact) {
    const compactIcon = entry.scanType === 'barcode' ? 'qr-code-outline' : 'link-outline';
    const statusText = entry.finalVerdict === 'safe' ? 'Safe' :
      entry.finalVerdict === 'suspicious' ? 'Suspicious' :
      entry.finalVerdict === 'malicious' ? 'Dangerous' : 'Unable to verify';
    return (
      <Pressable onPress={onPress} style={styles.recentRow} accessibilityRole="button">
        <View style={[styles.recentIcon, { backgroundColor: tint }]}>
          <AppIcon name={compactIcon} size={18} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.recentDomain} numberOfLines={1}>{entry.displayValue}</Text>
          <Text style={styles.recentTime}>{formatRelativeTime(entry.scannedAt)}</Text>
        </View>
        <Text style={[styles.recentStatus, { color, backgroundColor: tint }]}>{statusText}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={styles.historyItem} accessibilityRole="button">
      <View style={[styles.historyIcon, { backgroundColor: tint }]}>
        <AppIcon name={entry.scanType === 'barcode' ? 'qr-code-outline' : icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.historyDomain} numberOfLines={1}>{entry.displayValue}</Text>
        <Text style={styles.historyTime}>{formatTimestamp(entry.scannedAt)}</Text>
        <Text style={[styles.historySummary, { color }]}>
          {entry.scanType === 'barcode' ? 'Decoded content · Not a website check' : verdictLabel(entry.finalVerdict)}
        </Text>
      </View>
      <AppIcon name="chevron-forward" size={17} color={colors.muted} />
    </Pressable>
  );
}

function SettingRow({
  icon,
  title,
  subtitle,
  colors,
  styles,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  colors: ColorPalette;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.settingRow} accessibilityRole="button">
      <View style={styles.settingIcon}><AppIcon name={icon} size={18} color={colors.navy} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingSubtext}>{subtitle}</Text>
      </View>
      <AppIcon name="chevron-forward" size={17} color={colors.muted} />
    </Pressable>
  );
}
