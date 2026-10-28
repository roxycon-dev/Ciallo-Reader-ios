import { decode, encode } from 'fast-png';
import type { Bitmap } from '@core/source/js/jsPlatform';
import type { JsImageBackend } from '@core/source/js/jsMessageHandler';
import type { WorkerBitmap } from './protocol';

class Pixels implements Bitmap {
  public data: Uint8Array;
  constructor(readonly width: number, readonly height: number, data?: Uint8Array) {
    if (width <= 0 || height <= 0 || width * height * 4 > 64 * 1024 * 1024) throw new Error('脚本图像内存预算不足');
    this.data = data ?? new Uint8Array(width * height * 4);
  }
  get allocationByteCount(): number { return this.data.byteLength; }
  getPixels(x: number, y: number, width: number, height: number): Uint8Array {
    const result = new Pixels(width, height);
    result.drawBitmapRect(result, this, x, y, width, height, 0, 0);
    return result.data;
  }
  createBitmap(width: number, height: number): Bitmap { return new Pixels(width, height); }
  createBitmapFrom(src: Bitmap, x: number, y: number, width: number, height: number): Bitmap {
    const result = new Pixels(width, height);
    result.drawBitmapRect(result, src, x, y, width, height, 0, 0);
    return result;
  }
  createRotated90(src: Bitmap): Bitmap {
    const result = new Pixels(src.height, src.width);
    const pixels = (src as Pixels).data;
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      const from = (y * src.width + x) * 4;
      const to = (x * result.width + src.height - y - 1) * 4;
      result.data.set(pixels.subarray(from, from + 4), to);
    }
    return result;
  }
  drawBitmap(dst: Bitmap, src: Bitmap, x: number, y: number): void {
    this.drawBitmapRect(dst, src, 0, 0, src.width, src.height, x, y);
  }
  drawBitmapRect(dst: Bitmap, src: Bitmap, srcX: number, srcY: number, width: number, height: number, x: number, y: number): void {
    const target = dst as Pixels;
    const pixels = (src as Pixels).data;
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      const sx = srcX + column; const sy = srcY + row; const dx = x + column; const dy = y + row;
      if (sx < 0 || sy < 0 || dx < 0 || dy < 0 || sx >= src.width || sy >= src.height || dx >= dst.width || dy >= dst.height) continue;
      const from = (sy * src.width + sx) * 4; const to = (dy * dst.width + dx) * 4;
      target.data.set(pixels.subarray(from, from + 4), to);
    }
  }
  decodeBytes(bytes: Uint8Array): Bitmap | null {
    try {
      const image = decode(bytes);
      const output = new Pixels(image.width, image.height);
      for (let i = 0; i < image.width * image.height; i++) {
        const scale = image.depth === 16 ? 256 : 1;
        const from = i * image.channels;
        const gray = Math.floor(Number(image.data[from] ?? 0) / scale);
        output.data[i * 4] = gray;
        output.data[i * 4 + 1] = image.channels < 3 ? gray : Math.floor(Number(image.data[from + 1] ?? 0) / scale);
        output.data[i * 4 + 2] = image.channels < 3 ? gray : Math.floor(Number(image.data[from + 2] ?? 0) / scale);
        output.data[i * 4 + 3] = image.channels === 2 || image.channels === 4 ? Math.floor(Number(image.data[from + image.channels - 1]) / scale) : 255;
      }
      return output;
    } catch { return null; }
  }
  compressPng(): Uint8Array { return encode({ width: this.width, height: this.height, data: this.data, channels: 4, depth: 8 }); }
  recycle(): void { this.data = new Uint8Array(); }
}

export function createWorkerImageBackend(): JsImageBackend & { prepare(bytes: Uint8Array, image: WorkerBitmap): void } {
  const prepared = new WeakMap<Uint8Array, Pixels>();
  const factory = new Pixels(1, 1);
  return {
    maxMemory: 384 * 1024 * 1024,
    prepare(bytes, image) { prepared.set(bytes, new Pixels(image.width, image.height, image.data)); },
    probeBounds(bytes) { const image = prepared.get(bytes) ?? factory.decodeBytes(bytes); return image ? { width: image.width, height: image.height } : null; },
    decode: (bytes) => prepared.get(bytes) ?? factory.decodeBytes(bytes),
    create: (width, height) => new Pixels(width, height),
    crop: (src, x, y, width, height) => factory.createBitmapFrom(src, x, y, width, height),
    rotate90: (src) => factory.createRotated90(src),
    draw: (dst, src, x, y) => factory.drawBitmap(dst, src, x, y),
    drawRect: (dst, src, sx, sy, width, height, x, y) => factory.drawBitmapRect(dst, src, sx, sy, width, height, x, y),
  };
}
