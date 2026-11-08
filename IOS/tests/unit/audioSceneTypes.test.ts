import { describe, expect, it } from 'vitest';
import { COMIC_SCENE_LABELS, sceneAssetUrl, type ComicScene } from '../../src/core/audio/sceneTypes';

describe('sceneTypes', () => {
  it('has 8 scenes matching Android ComicScene enum', () => {
    expect(COMIC_SCENE_LABELS).toHaveLength(8);
    const scenes = COMIC_SCENE_LABELS.map((e) => e.scene);
    expect(scenes).toEqual(['NONE', 'RAIN', 'SNOW', 'SAKURA', 'FIREFLY', 'OCEAN', 'CAMPFIRE', 'NIGHT']);
  });

  it('labels match Android ComicReaderSheets.kt', () => {
    const byScene = Object.fromEntries(COMIC_SCENE_LABELS.map((e) => [e.scene, e.label]));
    expect(byScene.NONE).toBe('关闭');
    expect(byScene.RAIN).toBe('雨夜');
    expect(byScene.SNOW).toBe('落雪');
    expect(byScene.SAKURA).toBe('樱花');
    expect(byScene.FIREFLY).toBe('萤火');
    expect(byScene.OCEAN).toBe('海边');
    expect(byScene.CAMPFIRE).toBe('篝火');
    expect(byScene.NIGHT).toBe('夏夜');
  });

  it('sceneAssetUrl maps to m4a files for non-NONE scenes', () => {
    const all: Exclude<ComicScene, 'NONE'>[] = ['RAIN', 'SNOW', 'SAKURA', 'FIREFLY', 'OCEAN', 'CAMPFIRE', 'NIGHT'];
    for (const s of all) {
      const url = sceneAssetUrl(s);
      expect(url).toBeTruthy();
      expect(url).toMatch(/\.m4a$/);
    }
  });

  it('sceneAssetUrl returns null for NONE', () => {
    expect(sceneAssetUrl('NONE')).toBeNull();
  });
});
