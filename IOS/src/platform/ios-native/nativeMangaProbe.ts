import type { PlatformBundle } from '@platform/index';
import { NativeMangaModels } from './nativeMangaModels';
import { NativeMangaOcr } from './nativeMangaOcr';
import { bakeMangaTranslation } from '@platform/raster/mangaTranslationBake';

export async function probeNativeManga(platform: PlatformBundle): Promise<void> {
  const models = new NativeMangaModels(platform.fs, platform.http);
  if (!await models.refresh()) throw new Error('Original Android ONNX fixtures are missing or failed their SHA-256 check');
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 460;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Missing simulator Canvas 2D');
  try {
    ctx.fillStyle = '#b9b9b9'; ctx.fillRect(0, 0, 640, 460);
    ctx.beginPath(); ctx.ellipse(320, 224, 250, 146, 0, 0, Math.PI * 2);
    ctx.lineWidth = 6; ctx.strokeStyle = '#151515'; ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#171717'; ctx.font = 'bold 51px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('HELLO WORLD', 320, 238);
    const image = new Image(); image.src = canvas.toDataURL('image/png'); await image.decode();
    const regions = await new NativeMangaOcr(models).recognize({ image, width: 640, height: 460 }, 'en');
    const match = regions.find((region) => /HELLO/i.test(region.original));
    if (!match) throw new Error('Original PP-OCR did not recognize the known text: ' + regions.map((r) => r.original).join('|'));
    const rendered = await bakeMangaTranslation(image, { pageWidth: 640, pageHeight: 460, regions: [{ ...match, translated: '你好，世界' }] }, 1);
    if (rendered.type !== 'image/png' || rendered.size < 1000) throw new Error('Manga compositing did not produce a valid bitmap');
  } finally {
    canvas.width = 0; canvas.height = 0;
    await models.closeSessions();
  }
}
