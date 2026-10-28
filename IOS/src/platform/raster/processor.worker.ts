import { process } from '@core/comic/comicImagePipeline';
import { readFlat } from '@core/comic/anime4KCnn';
import type { Geometry, Toning } from '@core/comic/comicImagePipeline';
import type { PixImage } from '@core/comic/comicPixOps';
import { referencePixOps } from './pixCodec';
import restore from '../../../public/comic/anime4k_restore_s.json';
import upscale from '../../../public/comic/anime4k_upscale_s.json';

const ops = { ...referencePixOps(), cnn: { restore: readFlat(new Float32Array(restore)), upscale: readFlat(new Float32Array(upscale)) } };
self.onmessage = (event: MessageEvent<{ id: number; image: PixImage; geometry: Geometry; tone: Toning }>): void => {
  const { id, image, geometry, tone } = event.data;
  try {
    const result = process(image, geometry, tone, ops);
    self.postMessage({ id, result }, { transfer: [result.data.buffer] });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : '图像处理失败' }); }
};
