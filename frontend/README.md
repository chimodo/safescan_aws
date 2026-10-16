# SafeScan

SafeScan is an Expo app for checking links before opening them. Home shows a live camera preview when access is available. The preview detects QR codes and supported barcodes; tapping **Scan QR Code** confirms the detected content, and only decoded HTTP(S) QR links are sent to SafeScan for verification. Other decoded content is shown without treating it as a website. The app also includes scan results, an expandable report, on-device history, and settings.

## Run the app

Install dependencies and start the web version:

```bash
npm ci
npm run web
```

To use a native device or emulator, run `npx expo start` and follow the Expo CLI instructions.

## Camera and image scanning

Camera permission is requested from the Home permission panel when needed. The live preview pauses when the app backgrounds or the user navigates away from Home, and resumes when they return if permission remains available. Native builds scan QR codes and standard barcode formats supported by Expo Camera. Web live scanning is limited to QR codes by Expo Camera; image scanning in a browser requires its `BarcodeDetector` API. On native devices, image scanning uses Expo Camera's image barcode scanner. The app does not open decoded links.

The interface loads Orbitron for prominent headings and Montserrat for general text using Expo Google Fonts packages. System fonts are used as a fallback while the custom fonts load.

## Link checks and privacy

The app submits decoded HTTP(S) QR destinations to the SafeScan scanner service configured in `hooks/useURLScanner.ts`. The service may check links against Google Safe Browsing. A scan is not a guarantee that a link is safe, and SafeScan does not open the destination.

Scan history is stored locally with the hostname, verdict, check names, and check statuses. URL paths, query parameters, fragments, and evidence details are not saved in history. Product barcode identifiers (EAN/UPC) are stored; other decoded QR/barcode content is not. Opening a historical report shows that it is old; rescanning a link from history checks the saved domain root.

The app supports both the current aggregated scanner response and the service's legacy verdict response. When the service returns only a verdict, the app does not invent individual checks or show its numerical score. Missing checks are shown as unavailable.

## Quality checks

```bash
npx tsc --noEmit
npm run lint
```
