import { BarcodeScanningResult, scanFromURLAsync } from 'expo-camera';
import type { BarcodeType } from 'expo-camera';
import { Platform } from 'react-native';

interface BrowserBarcodeDetectorResult {
  rawValue: string;
  format: string;
}

interface BrowserBarcodeDetectorInstance {
  detect(source: ImageBitmap): Promise<BrowserBarcodeDetectorResult[]>;
}

interface BrowserBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BrowserBarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

const browserFormats: Record<string, string> = {
  qr_code: 'qr',
  aztec: 'aztec',
  code_128: 'code128',
  code_39: 'code39',
  code_93: 'code93',
  codabar: 'codabar',
  data_matrix: 'datamatrix',
  ean_13: 'ean13',
  ean_8: 'ean8',
  itf: 'itf14',
  pdf417: 'pdf417',
  upc_a: 'upc_a',
  upc_e: 'upc_e',
};

export const supportedBarcodeTypes: BarcodeType[] = [
  'qr',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'codabar',
  'itf14',
  'aztec',
  'pdf417',
  'datamatrix',
];

async function scanBrowserImage(uri: string): Promise<BarcodeScanningResult[]> {
  const detectorConstructor = (globalThis as typeof globalThis & {
    BarcodeDetector?: BrowserBarcodeDetectorConstructor;
  }).BarcodeDetector;
  if (!detectorConstructor || typeof createImageBitmap !== 'function') {
    throw new Error('Image code scanning is not supported by this browser. Try scanning with your camera instead.');
  }

  const supportedFormats = await detectorConstructor.getSupportedFormats();
  const formats = supportedFormats.filter((format) => Object.prototype.hasOwnProperty.call(browserFormats, format));
  if (formats.length === 0) {
    throw new Error('This browser does not support barcode detection in images. Try scanning with your camera instead.');
  }

  const response = await fetch(uri);
  if (!response.ok) throw new Error('The selected image could not be opened. Please choose another image.');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const detector = new detectorConstructor({ formats });
    const results = await detector.detect(bitmap);
    return results.map((result) => ({
      type: browserFormats[result.format] ?? result.format,
      data: result.rawValue,
      cornerPoints: [],
      bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
    }));
  } finally {
    bitmap.close();
  }
}

export async function scanCodeImage(uri: string): Promise<BarcodeScanningResult[]> {
  if (Platform.OS === 'web') return scanBrowserImage(uri);
  return scanFromURLAsync(uri, supportedBarcodeTypes);
}
