/**
 * Image byte helpers shared by FB2 / DOCX parser ports.
 *
 * Replaces Android `android.util.Base64` + `BitmapFactory.Options(inJustDecodeBounds)`
 * with pure header probes (no DOM canvas in core).
 */

/** android.util.Base64.DEFAULT decode after stripping whitespace (FB2 binary text). */
export function decodeBase64ToBytes(base64: string): Uint8Array | null {
  const cleaned = base64.replace(/\s/g, '');
  if (cleaned.length === 0) return null;
  try {
    const bin = atob(cleaned);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

/** Port of `Fb2Parser.detectImageExt` (PNG / GIF / JPEG magic). */
export function detectImageExt(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'gif';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'jpg';
  }
  return null;
}

function probePng(bytes: Uint8Array): { width: number; height: number } | null {
  // signature(8) + IHDR length(4) + "IHDR"(4) + width(4) + height(4)
  if (bytes.length < 24) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const width =
    ((bytes[16] as number) << 24) | ((bytes[17] as number) << 16) | ((bytes[18] as number) << 8) | (bytes[19] as number);
  const height =
    ((bytes[20] as number) << 24) | ((bytes[21] as number) << 16) | ((bytes[22] as number) << 8) | (bytes[23] as number);
  if (width <= 0 || height <= 0) return null;
  return { width: width >>> 0, height: height >>> 0 };
}

function probeGif(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const width = (bytes[6] as number) | ((bytes[7] as number) << 8);
  const height = (bytes[8] as number) | ((bytes[9] as number) << 8);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function probeJpeg(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 3 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = bytes[pos + 1] as number;
    // standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const len = ((bytes[pos + 2] as number) << 8) | (bytes[pos + 3] as number);
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (pos + 8 >= bytes.length) return null;
      const height = ((bytes[pos + 5] as number) << 8) | (bytes[pos + 6] as number);
      const width = ((bytes[pos + 7] as number) << 8) | (bytes[pos + 8] as number);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    if (len < 2) return null;
    pos += 2 + len;
  }
  return null;
}

function probeBmp(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 26) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const width = bytes[18]! | (bytes[19]! << 8) | (bytes[20]! << 16) | (bytes[21]! << 24);
  const height = bytes[22]! | (bytes[23]! << 8) | (bytes[24]! << 16) | (bytes[25]! << 24);
  const w = Math.abs(width);
  const h = Math.abs(height);
  if (w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

/**
 * WebP (RIFF/WEBP) bounds. Android's `BitmapFactory` decodes WebP, so a WebP
 * illustration must probe successfully — otherwise the caller falls back to
 * "undecodable" and drops the element.
 *   VP8  (lossy)  : width/height at offset 26/28, 14 bits each
 *   VP8L (lossless): 14-bit width-1 / height-1 packed from offset 21
 *   VP8X (extended): 24-bit canvas width-1/height-1 at offset 24/27
 */
function probeWebp(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  if (
    bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50
  ) {
    return null;
  }
  const fourcc = String.fromCharCode(
    bytes[12] as number, bytes[13] as number, bytes[14] as number, bytes[15] as number,
  );
  const size = (w: number, h: number): { width: number; height: number } | null =>
    w > 0 && h > 0 ? { width: w, height: h } : null;
  if (fourcc === 'VP8 ') {
    const w = ((bytes[26] as number) | ((bytes[27] as number) << 8)) & 0x3fff;
    const h = ((bytes[28] as number) | ((bytes[29] as number) << 8)) & 0x3fff;
    return size(w, h);
  }
  if (fourcc === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits =
      ((bytes[21] as number) |
        ((bytes[22] as number) << 8) |
        ((bytes[23] as number) << 16) |
        ((bytes[24] as number) << 24)) >>> 0;
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >>> 14) & 0x3fff) + 1;
    return size(w, h);
  }
  if (fourcc === 'VP8X') {
    const w =
      ((bytes[24] as number) | ((bytes[25] as number) << 8) | ((bytes[26] as number) << 16)) + 1;
    const h =
      ((bytes[27] as number) | ((bytes[28] as number) << 8) | ((bytes[29] as number) << 16)) + 1;
    return size(w, h);
  }
  return null;
}

/**
 * BitmapFactory bounds probe (inJustDecodeBounds).
 * Returns null when the bytes are not a decodable image (Android: outWidth<=0).
 */
export function probeImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const ext = detectImageExt(bytes);
  if (ext === 'png') return probePng(bytes);
  if (ext === 'gif') return probeGif(bytes);
  if (ext === 'jpg') return probeJpeg(bytes);
  const webp = probeWebp(bytes);
  if (webp) return webp;
  return probeBmp(bytes);
}

/** True when bytes look like a decodable bitmap (cover validation parity). */
export function isDecodableImage(bytes: Uint8Array): boolean {
  return probeImageSize(bytes) !== null;
}

/**
 * `BitmapFactory.Options.outMimeType` for the same bytes `probeImageSize` accepts.
 * Android sets it from the decoded `ImageFormat`, so a PNG yields "image/png" and a
 * format outside the png/gif/jpeg probe list falls through to "jpg" — which is
 * exactly the `else` branch of Kotlin EpubParser.kt L809-812.
 */
export function probeImageMime(bytes: Uint8Array): string {
  const ext = detectImageExt(bytes);
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'jpg') return 'image/jpeg';
  if (probeWebp(bytes) !== null) return 'image/webp';
  return 'image/jpeg';
}
