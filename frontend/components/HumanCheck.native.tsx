import React from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { ColorPalette } from '../constants/colors';
import { CAPTCHA_PAGE_URL } from '../hooks/communityApi';

/**
 * Loads the community site's Turnstile bridge page. It posts { token } once the check passes
 * and { expired: true } when the token runs out. Change resetKey after every submit: each token works once.
 */
export default function HumanCheck({
  resetKey,
  onToken,
  onError,
}: {
  colors: ColorPalette;
  resetKey: number;
  onToken: (token: string | null) => void;
  onError: (message: string) => void;
}) {
  const onMessage = (event: WebViewMessageEvent) => {
    let message: unknown;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const { token, expired, error } = message as Record<string, unknown>;
    if (typeof token === 'string' && token) onToken(token);
    else if (expired || error) onToken(null);
    if (error) onError('The human check couldn’t load. Please try again.');
  };

  return (
    <View style={{ height: 80, borderRadius: 12, overflow: 'hidden' }}>
      <WebView
        key={resetKey}
        source={{ uri: CAPTCHA_PAGE_URL }}
        onMessage={onMessage}
        onError={() => {
          onToken(null);
          onError('The human check couldn’t load. Check your connection and try again.');
        }}
        originWhitelist={['https://*']}
        scrollEnabled={false}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
