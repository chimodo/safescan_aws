// Checks that an uploaded file really is a JPEG or PNG and removes its metadata
// (EXIF, including GPS location and device details; XMP; IPTC; comments; text chunks).
// It never re-encodes the picture, so it needs no image library and keeps the Lambda small.
//
// One side effect: phone photos rely on EXIF orientation, so a sideways photo may show sideways.
// Screenshots are unaffected. The app can re-encode photos upright before upload to avoid it.

export type CleanResult =
  | { ok: true; type: 'image/jpeg' | 'image/png'; ext: 'jpg' | 'png'; bytes: Buffer; width: number; height: number }
  | { ok: false; reason: string };

/** Larger images are refused, so a tiny file can't expand into a huge picture in the browser */
export const MAX_DIMENSION = 8000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function cleanImage(input: Buffer): CleanResult {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return cleanJpeg(input);
  if (input.length >= 8 && input.subarray(0, 8).equals(PNG_SIGNATURE)) return cleanPng(input);
  return { ok: false, reason: 'not a JPEG or PNG' };
}

// ---- JPEG ----

/** Segments that are kept: JFIF header, ICC colour profile, and Adobe colour info needed to decode some files */
function keepJpegSegment(marker: number, data: Buffer): boolean {
  if (marker === 0xe0) return true; // APP0 JFIF
  if (marker === 0xe2) return data.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0'; // APP2 colour profile only
  if (marker === 0xee) return true; // APP14 Adobe colour transform
  if (marker >= 0xe1 && marker <= 0xef) return false; // APP1 EXIF/XMP, APP13 IPTC, and every other APPn
  if (marker === 0xfe) return false; // COM comment
  return true; // tables, frame headers and everything needed to decode
}

// Start-of-frame markers carry the picture's dimensions
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function cleanJpeg(input: Buffer): CleanResult {
  const out: Buffer[] = [input.subarray(0, 2)]; // SOI
  let pos = 2;
  let width = 0;
  let height = 0;

  while (pos < input.length) {
    if (input[pos] !== 0xff) return { ok: false, reason: 'malformed JPEG' };
    while (input[pos] === 0xff && pos < input.length) pos++; // fill bytes
    const marker = input[pos++];
    if (marker === undefined) return { ok: false, reason: 'truncated JPEG' };

    if (marker === 0xd9) { // EOI before any image data
      return { ok: false, reason: 'JPEG has no image data' };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { // standalone markers
      out.push(Buffer.from([0xff, marker]));
      continue;
    }

    if (pos + 2 > input.length) return { ok: false, reason: 'truncated JPEG' };
    const length = input.readUInt16BE(pos);
    if (length < 2 || pos + length > input.length) return { ok: false, reason: 'malformed JPEG segment' };
    const segment = input.subarray(pos - 2, pos + length); // marker + length + data
    const data = input.subarray(pos + 2, pos + length);

    if (SOF_MARKERS.has(marker) && data.length >= 5) {
      height = data.readUInt16BE(1);
      width = data.readUInt16BE(3);
    }

    if (marker === 0xda) { // start of scan: the compressed image data follows until the end
      if (!width || !height) return { ok: false, reason: 'JPEG has no frame header' };
      out.push(input.subarray(pos - 2));
      break;
    }

    if (keepJpegSegment(marker, data)) out.push(segment);
    pos += length;
  }

  if (!width || !height) return { ok: false, reason: 'JPEG has no image data' };
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return { ok: false, reason: `image larger than ${MAX_DIMENSION}px` };
  return { ok: true, type: 'image/jpeg', ext: 'jpg', bytes: Buffer.concat(out), width, height };
}

// ---- PNG ----

/** Text, EXIF and timestamp chunks are removed; image, palette and colour chunks are kept */
const DROP_PNG_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function cleanPng(input: Buffer): CleanResult {
  const out: Buffer[] = [PNG_SIGNATURE];
  let pos = 8;
  let width = 0;
  let height = 0;
  let first = true;
  let sawImageData = false;

  while (pos + 12 <= input.length) {
    const length = input.readUInt32BE(pos);
    const type = input.subarray(pos + 4, pos + 8).toString('latin1');
    const end = pos + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > input.length) return { ok: false, reason: 'malformed PNG chunk' };

    if (first) {
      if (type !== 'IHDR' || length < 8) return { ok: false, reason: 'PNG does not start with a header' };
      width = input.readUInt32BE(pos + 8);
      height = input.readUInt32BE(pos + 12);
      first = false;
    }
    if (type === 'IDAT') sawImageData = true;

    if (!DROP_PNG_CHUNKS.has(type)) out.push(input.subarray(pos, end));
    pos = end;
    if (type === 'IEND') break;
  }

  if (!sawImageData || !width || !height) return { ok: false, reason: 'PNG has no image data' };
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return { ok: false, reason: `image larger than ${MAX_DIMENSION}px` };
  return { ok: true, type: 'image/png', ext: 'png', bytes: Buffer.concat(out), width, height };
}
