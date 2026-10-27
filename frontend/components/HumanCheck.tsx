import React from 'react';
import { View } from 'react-native';
import Text from './AppText';
import type { ColorPalette } from '../constants/colors';
import { COMMUNITY_SITE_URL } from '../hooks/communityApi';

/** react-native-webview has no web support, so the browser build points to the community website instead */
export default function HumanCheck({ colors }: {
  colors: ColorPalette;
  resetKey: number;
  onToken: (token: string | null) => void;
  onError: (message: string) => void;
}) {
  return (
    <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 12, lineHeight: 18, color: colors.secondaryText }}>
        The human check runs in the iOS and Android apps. In a browser, share links at {COMMUNITY_SITE_URL}.
      </Text>
    </View>
  );
}
