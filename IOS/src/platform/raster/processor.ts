import type { Geometry, Toning } from '@core/comic/comicImagePipeline';
import type { PixImage } from '@core/comic/comicPixOps';
import ProcessingWorker from './processor.worker.ts?worker&inline';

/** CPU enhancement never occupies the UI thread. One page at a time bounds memory. */
export class RasterProcessor {
  private worker: Worker | null = null;
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private cancel: ((reason: Error) => void) | null = null;
  private closed = false;
  process(image: PixImage, geometry: Geometry, tone: Toning): Promise<PixImage> {
    const run = this.queue.catch(() => {}).then(() => new Promise<PixImage>((resolve, reject) => {
      if (this.closed) { reject(new Error('图像处理已关闭')); return; }
      const worker = this.worker ??= new ProcessingWorker();
      const id = ++this.sequence;
      const finish = (): void => { clearTimeout(timeout); this.cancel = null; };
      const timeout = setTimeout(() => { this.release(); reject(new Error('图像处理超时，请降低增强档位')); }, 60_000);
      this.cancel = (error) => { finish(); reject(error); };
      worker.onerror = (event) => { finish(); this.release(); reject(new Error(event.message)); };
      worker.onmessage = (event: MessageEvent<{ id: number; result?: PixImage; error?: string }>) => {
        if (event.data.id !== id) return;
        finish();
        if (event.data.result) resolve(event.data.result);
        else reject(new Error(event.data.error ?? '图像处理失败'));
      };
      worker.postMessage({ id, image, geometry, tone });
    }));
    this.queue = run;
    return run;
  }
  release(): void { this.worker?.terminate(); this.worker = null; this.cancel?.(new Error('图像处理已取消')); this.cancel = null; }
  close(): void { this.closed = true; this.release(); }
}
