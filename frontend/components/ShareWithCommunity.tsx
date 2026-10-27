import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import AppIcon from './AppIcon';
import Text from './AppText';
import TextInput from './AppTextInput';
import HumanCheck from './HumanCheck';
import type createStyles from '../app/styles';
import type { ColorPalette } from '../constants/colors';
import { ApiError, COMMUNITY_SITE_URL, submitReport, uploadScreenshot } from '../hooks/communityApi';
import {
  DETAILS_MAX_LENGTH,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_MAX_COUNT,
  THREAT_TYPES,
  type ScreenshotType,
  type ThreatType,
} from '../../shared/community';

type Shot = { uri: string; type: ScreenshotType };
type Sent = { linkPath: string; screenshots: number; failedUploads: number };

const MAX_MB = SCREENSHOT_MAX_BYTES / (1024 * 1024);

async function fileSize(uri: string): Promise<number | null> {
  try {
    const blob = await (await fetch(uri)).blob();
    return blob.size;
  } catch {
    return null;
  }
}

/**
 * Re-encodes every picked image: PNG stays PNG, anything else (often HEIC on iPhones) becomes JPEG.
 * Re-encoding also turns sideways photos upright, since the server strips the orientation tag.
 */
async function prepareScreenshot(asset: ImagePicker.ImagePickerAsset): Promise<Shot> {
  const png = asset.mimeType === 'image/png' || /\.png$/i.test(asset.fileName ?? asset.uri);
  const rendered = await ImageManipulator.manipulate(asset.uri).renderAsync();
  const saved = await rendered.saveAsync({ format: png ? SaveFormat.PNG : SaveFormat.JPEG, compress: 0.85 });
  const size = await fileSize(saved.uri);
  if (size !== null && size > SCREENSHOT_MAX_BYTES) {
    throw new Error(`That image is over ${MAX_MB} MB. Choose a smaller screenshot.`);
  }
  return { uri: saved.uri, type: png ? 'image/png' : 'image/jpeg' };
}

export default function ShareWithCommunity({
  url,
  colors,
  styles,
  onBack,
}: {
  url: string;
  colors: ColorPalette;
  styles: ReturnType<typeof createStyles>;
  onBack: () => void;
}) {
  const [threatType, setThreatType] = useState<ThreatType | null>(null);
  const [details, setDetails] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [picking, setPicking] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);

  const pickScreenshots = async () => {
    setPicking(true);
    setError('');
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: SCREENSHOT_MAX_COUNT - shots.length,
        quality: 1,
      });
      if (selection.canceled) return;
      const picked = selection.assets.slice(0, SCREENSHOT_MAX_COUNT - shots.length);
      const prepared: Shot[] = [];
      for (const asset of picked) prepared.push(await prepareScreenshot(asset));
      setShots((previous) => [...previous, ...prepared].slice(0, SCREENSHOT_MAX_COUNT));
      if (selection.assets.length > picked.length) setError(`Only ${SCREENSHOT_MAX_COUNT} screenshots can be added.`);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'That image couldn’t be added. Try another one.');
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    if (!threatType) {
      setError('Choose what kind of threat this is.');
      return;
    }
    if (!token) {
      setError('Complete the human check first.');
      return;
    }
    // Each token works once, so load a fresh widget for any retry
    const captchaToken = token;
    setToken(null);
    setCaptchaKey((key) => key + 1);
    setSubmitting(true);
    setError('');
    try {
      const report = await submitReport({
        url,
        threatType,
        details: details.trim(),
        screenshotTypes: shots.map((shot) => shot.type),
        captchaToken,
      });
      let failedUploads = 0;
      for (const slot of report.uploads) {
        const shot = shots[slot.slot];
        if (!shot || !(await uploadScreenshot(slot, shot.uri))) failedUploads += 1;
      }
      setSent({ linkPath: report.linkPath, screenshots: shots.length, failedUploads });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Your report couldn’t be sent. Please try again.';
      setError(submitError instanceof ApiError && submitError.status === 403
        ? `${message} Complete the human check again, then resend.`
        : message);
    } finally {
      setSubmitting(false);
    }
  };

  const backLink = (
    <Pressable onPress={onBack} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 13 }}>
      <AppIcon name="arrow-back" size={17} color={colors.secondaryText} />
      <Text style={{ color: colors.secondaryText, fontSize: 13, fontWeight: '600' }}>Back to result</Text>
    </Pressable>
  );

  if (sent) {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.screenHeader}>{backLink}</View>
        <View style={[styles.verdictCard, { backgroundColor: colors.greenLight }]}>
          <View style={[styles.verdictIcon, { backgroundColor: colors.surface }]}>
            <AppIcon name="people" size={34} color={colors.green} />
          </View>
          <Text style={styles.verdictTitle} variant="heading">Thanks for sharing</Text>
          <Text style={styles.verdictSummary}>
            Your report is on the community page now, where others can mark it helpful.
            {sent.screenshots > 0 ? ' Screenshots appear after a maintainer approves them.' : ''}
          </Text>
        </View>
        {sent.failedUploads > 0 && (
          <View style={[styles.banner, { backgroundColor: colors.amberLight }]}>
            <AppIcon name="warning" size={18} color={colors.amber} />
            <Text style={[styles.bannerText, { flex: 1, marginTop: 0 }]}>
              {sent.failedUploads === 1 ? '1 screenshot' : `${sent.failedUploads} screenshots`} couldn’t be uploaded. Your report was still shared.
            </Text>
          </View>
        )}
        <Pressable
          onPress={() => void WebBrowser.openBrowserAsync(COMMUNITY_SITE_URL + sent.linkPath)}
          style={[styles.primaryButton, { marginTop: 18 }]}
          accessibilityRole="button"
        >
          <AppIcon name="chatbubbles-outline" color="#FFFFFF" size={18} />
          <Text style={styles.primaryButtonText}>See what others said</Text>
        </Pressable>
        <Pressable onPress={onBack} style={[styles.secondaryButton, { marginTop: 10 }]} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Back to result</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.screenHeader}>
        {backLink}
        <Text style={styles.screenTitle} variant="heading">Share with community</Text>
        <Text style={styles.screenSubtitle}>Your report shows publicly on SafeScan’s community page and helps others decide.</Text>
      </View>

      <View style={styles.domainCard}>
        <Text style={styles.settingSubtext}>LINK</Text>
        <Text selectable style={[styles.domainText, { marginTop: 4 }]} numberOfLines={3}>{url}</Text>
      </View>

      <View style={styles.quickSection}>
        <Text style={styles.inputLabel}>What kind of threat is it?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(Object.entries(THREAT_TYPES) as [ThreatType, string][]).map(([type, label]) => {
            const selected = threatType === type;
            return (
              <Pressable
                key={type}
                onPress={() => setThreatType(type)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: selected ? colors.buttonPrimary : colors.surface, borderWidth: 1, borderColor: selected ? colors.buttonPrimary : colors.border }}
              >
                <Text style={{ color: selected ? '#FFFFFF' : colors.secondaryText, fontSize: 12, fontWeight: '700' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.quickSection}>
        <Text style={styles.inputLabel}>Details (optional)</Text>
        <TextInput
          value={details}
          onChangeText={setDetails}
          maxLength={DETAILS_MAX_LENGTH}
          multiline
          placeholder="Where did you find it? What did it ask for?"
          placeholderTextColor={colors.muted}
          style={{ minHeight: 96, color: colors.navy, fontSize: 15, textAlignVertical: 'top', padding: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.background }}
          accessibilityLabel="Details"
        />
        <Text style={[styles.privacyNote, { textAlign: 'right', marginTop: 6 }]}>{details.length}/{DETAILS_MAX_LENGTH}</Text>
      </View>

      <View style={styles.quickSection}>
        <Text style={styles.inputLabel}>Screenshots (optional, up to {SCREENSHOT_MAX_COUNT})</Text>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {shots.map((shot, index) => (
            <View key={shot.uri} style={{ width: 84, height: 84, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface2 }}>
              <Image source={{ uri: shot.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityIgnoresInvertColors />
              <Pressable
                onPress={() => setShots((previous) => previous.filter((_, i) => i !== index))}
                accessibilityRole="button"
                accessibilityLabel={`Remove screenshot ${index + 1}`}
                style={{ position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(16, 44, 70, 0.76)' }}
              >
                <AppIcon name="close" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
          {shots.length < SCREENSHOT_MAX_COUNT && (
            <Pressable
              onPress={() => void pickScreenshots()}
              disabled={picking || submitting}
              accessibilityRole="button"
              accessibilityLabel="Add screenshots"
              style={{ width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}
            >
              {picking ? <ActivityIndicator color={colors.green} /> : <AppIcon name="image-outline" size={24} color={colors.secondaryText} />}
            </Pressable>
          )}
        </View>
        <Text style={styles.privacyNote}>JPEG or PNG, {MAX_MB} MB each. Location and device details are removed before anyone sees them.</Text>
      </View>

      <View style={styles.quickSection}>
        <Text style={styles.inputLabel}>Human check</Text>
        <HumanCheck colors={colors} resetKey={captchaKey} onToken={setToken} onError={setError} />
      </View>

      {!!error && <Text style={styles.errorText} accessibilityLiveRegion="polite">{error}</Text>}

      <Pressable
        onPress={() => void submit()}
        disabled={submitting || !threatType || !token}
        accessibilityRole="button"
        accessibilityState={{ disabled: submitting || !threatType || !token }}
        style={[styles.primaryButton, { marginTop: 18 }, submitting || !threatType || !token ? { opacity: 0.55 } : null]}
      >
        {submitting
          ? <ActivityIndicator color="#FFFFFF" />
          : <>
              <AppIcon name="paper-plane-outline" color="#FFFFFF" size={18} />
              <Text style={styles.primaryButtonText}>Share report</Text>
            </>}
      </Pressable>
    </ScrollView>
  );
}
