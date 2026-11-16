import { DET_INPUT, DETECTION_MAX_EDGE, REC_IMG_H, REC_IMG_W, buildRecognizerCharset, computePreResult, extractLineRects, recognizerTargetWidth, sortBoxesReadingOrder } from '@core/mangatranslate/mangaOcr';
import { BUBBLE_DET_ROWS, BUBBLE_DET_STRIDE, BUBBLE_INPUT_SIZE, RawDet, computeLetterbox, computeMaskContour, deduplicateBubbleDetections, filterRawDetRows, parsePrototypesShape, type BubbleDetection } from '@core/mangatranslate/bubbleDetector';
import { PageRegionDetector, type TileDetectionInput } from '@core/mangatranslate/pageRegionDetector';
import { lineBelongsToRegion, shouldFilterTextRectByBubble } from '@core/mangatranslate/pageRegionTiling';
import { ScriptDetector } from '@core/mangatranslate/scriptDetector';
import { TextLineOrientation } from '@core/mangatranslate/textBlockMerger';
import type { TranslatedRegion } from '@core/mangatranslate/translationCore';
import type { RectF } from '@core/mangatranslate/index';
import keys from '@core/mangatranslate/ppocr_keys_v6_small.txt?raw';
import type { NativeMangaModels, RecognitionSteps } from './nativeMangaModels';

type PageImage = { image: CanvasImageSource; width: number; height: number };
const charset = buildRecognizerCharset(keys.split(/\r?\n/));
const width = (r: RectF) => r.right - r.left;
const height = (r: RectF) => r.bottom - r.top;
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('已取消漫画翻译', 'AbortError');
};

function surface(w: number, h: number) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('无法建立漫画翻译画布');
  return { canvas, ctx };
}

function crop(page: PageImage, rect: RectF, w: number, h: number) {
  const { canvas, ctx } = surface(w, h);
  ctx.drawImage(page.image, rect.left, rect.top, width(rect), height(rect), 0, 0, w, h);
  return { canvas, image: canvas, width: w, height: h };
}

function imageBytes(canvas: HTMLCanvasElement): string {
  try { return canvas.toDataURL('image/png').split(',')[1] ?? ''; }
  finally { canvas.width = 0; canvas.height = 0; }
}

export function decodeRecognition(result: RecognitionSteps): { text: string; score: number } {
  let text = '', last = -1, score = 0, count = 0;
  for (const [i, token] of result.tokens.entries()) {
    if (token !== last && token > 0 && token < charset.length) {
      text += charset[token]; score += result.confidence[i] ?? 0; count++;
    }
    last = token;
  }
  return { text, score: count ? score / count : 0 };
}

export class NativeMangaOcr {
  constructor(private readonly models: NativeMangaModels) {}

  private async lines(page: PageImage, signal?: AbortSignal): Promise<RectF[]> {
    const shrink = Math.min(1, DETECTION_MAX_EDGE / Math.max(page.width, page.height));
    const w = Math.max(1, Math.floor(page.width * shrink)), h = Math.max(1, Math.floor(page.height * shrink));
    const pre = computePreResult(w, h);
    const { canvas, ctx } = surface(DET_INPUT, DET_INPUT);
    ctx.drawImage(page.image, pre.padW, pre.padH, Math.round(w * pre.ratioW), Math.round(h * pre.ratioH));
    const tensors = await this.models.run('det', imageBytes(canvas), signal);
    const map = tensors.find(({ shape, data }) => data.length >= DET_INPUT * DET_INPUT && shape.at(-1) === DET_INPUT && shape.at(-2) === DET_INPUT);
    if (!map) throw new Error('文字检测模型输出无效');
    const sx = page.width / w, sy = page.height / h;
    return sortBoxesReadingOrder(extractLineRects(map.data, pre)).map((r) => ({
      left: r.left * sx, right: r.right * sx, top: r.top * sy, bottom: r.bottom * sy,
    }));
  }

  private async bubbles(page: PageImage, signal?: AbortSignal): Promise<BubbleDetection[]> {
    const { width: w, height: h } = page, size = BUBBLE_INPUT_SIZE;
    const pre = computeLetterbox(w, h, size, size);
    const { canvas, ctx } = surface(size, size);
    ctx.fillStyle = '#727272'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(page.image, pre.padX, pre.padY, size - pre.padX * 2, size - pre.padY * 2);
    const output = await this.models.run('bubble', imageBytes(canvas), signal);
    const rows = output.find(({ shape }) => shape.length === 3 && shape[1] === BUBBLE_DET_ROWS && shape[2] === BUBBLE_DET_STRIDE);
    if (!rows) throw new Error('气泡分割模型输出无效');
    const masks = output.find(({ shape }) => parsePrototypesShape(shape) !== null);
    const dims = masks && parsePrototypesShape(masks.shape);
    const protos = dims && masks ? { data: masks.data, height: dims.h, width: dims.w } : null;
    const candidates = Array.from({ length: BUBBLE_DET_ROWS }, (_, i) => Array.from(rows.data.subarray(i * BUBBLE_DET_STRIDE, (i + 1) * BUBBLE_DET_STRIDE)));
    return deduplicateBubbleDetections(filterRawDetRows(candidates).flatMap((row) => {
      check(signal);
      const det = new RawDet(row), rect = det.toRect(pre, w, h);
      if (width(rect) <= 1 || height(rect) <= 1) return [];
      return [{ rect, confidence: row[4]!, maskContour: protos && computeMaskContour(det, protos, pre, w, h) }];
    }));
  }

  async recognize(page: PageImage, forcedLang?: string | null, signal?: AbortSignal): Promise<TranslatedRegion[]> {
    check(signal);
    if (!this.models.ready) throw new Error('请先下载漫画翻译模型');
    const runTile = async <T>(input: TileDetectionInput, run: (tile: PageImage) => Promise<T>) => {
      check(signal);
      const { width: w, height: h } = input.detectionSize;
      const tile = crop(page, input.tile, w, h);
      try { return await run(tile); }
      finally { tile.canvas.width = 0; tile.canvas.height = 0; }
    };
    // The page detector can treat individual tiles as unavailable. If all OCR
    // calls failed, report an engine error instead of caching an empty page.
    let lineRuns = 0, bubbleRuns = 0, lastError: unknown;
    const lines = async (image: PageImage) => {
      try { const result = await this.lines(image, signal); lineRuns++; return result; }
      catch (error) { lastError = error; throw error; }
    };
    const bubbles = async (image: PageImage) => {
      try { const result = await this.bubbles(image, signal); bubbleRuns++; return result; }
      catch (error) { lastError = error; throw error; }
    };
    const detector = new PageRegionDetector({ detectBubbles: () => bubbles(page), detectTextLines: () => lines(page) }, {
      detectBubblesInTile: (input) => runTile(input, bubbles),
      detectTextLinesInTile: (input) => runTile(input, lines),
    });
    const result = await detector.detect(page);
    check(signal);
    if (!result?.complete || !lineRuns || !bubbleRuns) throw lastError ?? new Error('漫画页面文字检测失败');
    const regions = result.bubbles.map((bubble) => {
      const own = result.textLines.filter((line) => lineBelongsToRegion(line, bubble.rect));
      return { rect: bubble.rect, contour: bubble.maskContour, lines: own,
        vertical: own.filter((line) => height(line) > width(line) * 1.5).length > own.length / 2 };
    });
    for (const block of result.textBlocks) {
      if (block.lines.length) regions.push({ rect: block.rect, contour: null, lines: [...block.lines], vertical: block.orientation === TextLineOrientation.VERTICAL });
    }
    if (!regions.some((region) => !region.contour && region.lines.length)) {
      for (const line of result.textLines.filter((line) => !result.bubbles.some((bubble) => shouldFilterTextRectByBubble(line, bubble.rect, 0.2)))) {
        regions.push({ rect: line, contour: null, lines: [line], vertical: false });
      }
    }
    const translated: TranslatedRegion[] = [];
    for (const region of regions) {
      const ordered = [...region.lines].sort(region.vertical
        ? (a, b) => b.left + b.right - a.left - a.right || a.top - b.top
        : (a, b) => a.top - b.top || a.left - b.left);
      const pieces: string[] = [];
      for (const line of ordered) {
        check(signal);
        const x = Math.min(page.width - 1, Math.max(0, Math.trunc(line.left))), y = Math.min(page.height - 1, Math.max(0, Math.trunc(line.top)));
        const w = Math.min(page.width - x, Math.trunc(line.right) - x), h = Math.min(page.height - y, Math.trunc(line.bottom) - y);
        if (w < 4 || h < 4) continue;
        const validWidth = recognizerTargetWidth(region.vertical ? h : w, region.vertical ? w : h);
        const { canvas, ctx } = surface(REC_IMG_W, REC_IMG_H);
        if (region.vertical) {
          ctx.translate(0, REC_IMG_H); ctx.rotate(-Math.PI / 2);
          ctx.drawImage(page.image, x, y, w, h, 0, 0, REC_IMG_H, validWidth);
        } else ctx.drawImage(page.image, x, y, w, h, 0, 0, validWidth, REC_IMG_H);
        const rec = decodeRecognition(await this.models.run('rec', imageBytes(canvas), signal, validWidth));
        if (rec.score >= 0.45 && rec.text.trim()) pieces.push(rec.text.trim());
      }
      const original = pieces.join(region.vertical ? '' : ' ').trim();
      if (original.length >= 2) translated.push({
        rect: region.rect, contour: region.contour, vertical: region.vertical, lineRects: region.lines,
        original, translated: '', lang: forcedLang ?? ScriptDetector.detect(original) ?? '',
      });
    }
    return translated;
  }
}
