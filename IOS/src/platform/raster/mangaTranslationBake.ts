import { anchorRect, binarySearchHorizontalFontSize, contrastingTextColor, fitVerticalText, freeBlockGeometry, insetTextBoundsFromContour, layoutVerticalColumns, medianLineHeight, prefersVerticalText, sampleBackgroundColor, stripWhitespaceForVertical } from '@core/mangatranslate/bubblePipeline';
import type { RectF } from '@core/mangatranslate/index';
import type { PageTranslation } from '@core/mangatranslate/translationCore';

const color = (argb: number) => '#' + (argb & 0xffffff).toString(16).padStart(6, '0');
const w = (r: RectF) => r.right - r.left;
const h = (r: RectF) => r.bottom - r.top;

export async function bakeMangaTranslation(image: HTMLImageElement, translation: PageTranslation, scale: number): Promise<Blob> {
  const { pageWidth: width, pageHeight: height, regions } = translation;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法绘制漫画译文');
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const sample = (bounds: RectF) => sampleBackgroundColor((x, y) => {
      const i = (y * width + x) * 4;
      return (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!;
    }, width, height, bounds) ?? 0xffffff;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const font = (size: number) => { ctx.font = size + 'px sans-serif'; };
    function draw(text: string, r: RectF, background: number, lineHeight: number) {
      if (w(r) <= 1 || h(r) <= 1) return;
      ctx!.fillStyle = color(contrastingTextColor(background));
      if (prefersVerticalText(r)) {
        const chars = Array.from(stripWhitespaceForVertical(text));
        const fit = fitVerticalText(chars.length, w(r), h(r));
        if (!fit) return;
        font(fit.size);
        for (const glyph of layoutVerticalColumns(chars, r, fit) ?? []) ctx!.fillText(chars[glyph.charIndex]!, glyph.x, glyph.y);
        return;
      }
      const wrap = (size: number) => {
        font(size);
        const lines: string[] = [];
        for (const paragraph of text.split('\n')) {
          let line = '';
          for (const glyph of paragraph) {
            if (line && ctx!.measureText(line + glyph).width > w(r)) { lines.push(line.trimEnd()); line = glyph.trimStart(); }
            else line += glyph;
          }
          lines.push(line);
        }
        return lines;
      };
      const fit = binarySearchHorizontalFontSize(r, scale, lineHeight, (size) => {
        const s = size * scale, lines = wrap(s);
        return lines.length * s * 1.15 <= h(r) && lines.every((line) => ctx!.measureText(line).width <= w(r) + 0.5);
      });
      if (fit === null) return;
      const size = fit * scale, lines = wrap(size), step = size * 1.15;
      const top = r.top + (h(r) - lines.length * step) / 2;
      for (const [i, line] of lines.entries()) ctx!.fillText(line, (r.left + r.right) / 2, top + i * step + size);
    }
    for (const region of regions) {
      const text = region.translated.trim();
      if (!text) continue;
      const lines = region.lineRects ?? [];
      if (lines.length) {
        let background: number | undefined;
        for (const line of lines) {
          const pad = Math.min(4, Math.max(1, Math.min(w(line), h(line)) * 0.06));
          const erase = { left: Math.max(0, line.left - pad), top: Math.max(0, line.top - pad),
            right: Math.min(width, line.right + pad), bottom: Math.min(height, line.bottom + pad) };
          if (w(erase) <= 0 || h(erase) <= 0) continue;
          const local = sample(erase); background ??= local;
          ctx.fillStyle = color(local); ctx.fillRect(erase.left, erase.top, w(erase), h(erase));
        }
        const r = { left: Math.max(0, region.rect.left, Math.min(...lines.map((line) => line.left))),
          top: Math.max(0, region.rect.top, Math.min(...lines.map((line) => line.top))),
          right: Math.min(width, region.rect.right, Math.max(...lines.map((line) => line.right))),
          bottom: Math.min(height, region.rect.bottom, Math.max(...lines.map((line) => line.bottom))) };
        draw(text, r, background ?? 0xffffff, medianLineHeight(lines));
      } else if (region.contour && region.contour.length >= 6) {
        const r = insetTextBoundsFromContour(region.contour, width, height);
        const background = sample(region.rect);
        ctx.fillStyle = color(background); ctx.beginPath();
        for (let i = 0; i < region.contour.length - 1; i += 2) {
          const x = region.contour[i]! * width, y = region.contour[i + 1]! * height;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
        draw(text, anchorRect(r, lines), background, 0);
      } else {
        const g = freeBlockGeometry(region.rect);
        if (!g.ok) continue;
        const background = sample(region.rect);
        ctx.fillStyle = color(background); ctx.beginPath();
        ctx.roundRect(region.rect.left, region.rect.top, w(region.rect), h(region.rect), g.corner); ctx.fill();
        draw(text, g.inner, background, 0);
      }
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法保存漫画译文位图')), 'image/png'));
  } finally { canvas.width = 0; canvas.height = 0; }
}
