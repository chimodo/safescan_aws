# SafeScan

SafeScan is an Expo app that checks links and scans QR codes/barcodes.

## Run the native sticker check

QR sticker analysis uses `react-native-fast-opencv`, a native JSI module. It does not run in Expo Go. Use a development build on an Android device/emulator or iOS device/simulator:

```bash
npm install
npx expo run:android
```

For iOS, run `npx expo run:ios` on macOS. These commands generate the native project when needed, compile the native OpenCV module, install the app, and start Metro.

To create an Android APK in the EAS cloud for direct installation on a phone, log in with `npx eas-cli login`, then run `npx eas-cli build --platform android --profile preview`. The `preview` profile in [`eas.json`](./eas.json) is configured for an internally distributed APK. The first build may ask to create/link an EAS project and configure Android application signing; follow the prompts. Once complete, open the APK installation link on the phone. This route requires internet access and an Expo account but no USB connection.

For an Android development-client build (for development with Metro), use `npx eas-cli build --platform android --profile development`; the profile also creates an installable APK. For a cloud iOS build, create an iOS development profile and use `eas build --profile development --platform ios`.

After the development build is installed, start Metro for that client with:

```bash
npx expo start --dev-client
```

You can still use `npx expo start --web` for the rest of the interface; the sticker check will report that a native development build is required.

The on-device check takes one still capture and detects the QR corners directly in that captured image, rather than mapping preview coordinates onto the photo. It rectifies the QR and nearby area to a 960×960 image with a 640-pixel QR, then uses Sobel gradients to evaluate the QR boundary. It applies 2nd-to-98th percentile intensity normalization; textured surroundings use the inside-QR versus outer-annulus low-gradient pattern, while white or low-texture surroundings use a normalized boundary-profile check. It does not compare captures or use gloss/highlight values. The experimental thresholds are not a calibrated probability or a validated guarantee that a sticker is present. Users should verify that any sticker is intended to be there. Sticker measurements, timing, and optional correctness feedback are stored locally for the developer diagnostics page; captured images are not saved.

## General Expo development

Install dependencies with `npm install`, then run `npx expo start` for the standard Expo development server. Expo Go can be used for features that do not require the OpenCV native module, but it cannot run QR sticker analysis.

Learn more about [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/) and [`react-native-fast-opencv`](https://lukaszkurantdev.github.io/react-native-fast-opencv/installation).
