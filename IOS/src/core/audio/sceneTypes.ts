export type ComicScene =
  | 'NONE'
  | 'RAIN'
  | 'SNOW'
  | 'SAKURA'
  | 'FIREFLY'
  | 'OCEAN'
  | 'CAMPFIRE'
  | 'NIGHT'

export const COMIC_SCENE_LABELS: ReadonlyArray<{ scene: ComicScene; label: string }> = [
  { scene: 'NONE', label: '关闭' },
  { scene: 'RAIN', label: '雨夜' },
  { scene: 'SNOW', label: '落雪' },
  { scene: 'SAKURA', label: '樱花' },
  { scene: 'FIREFLY', label: '萤火' },
  { scene: 'OCEAN', label: '海边' },
  { scene: 'CAMPFIRE', label: '篝火' },
  { scene: 'NIGHT', label: '夏夜' },
]

const SCENE_ASSET: Readonly<Record<Exclude<ComicScene, 'NONE'>, string>> = {
  RAIN: '/audio/scene_rain.m4a',
  SNOW: '/audio/scene_snow.m4a',
  SAKURA: '/audio/scene_sakura.m4a',
  FIREFLY: '/audio/scene_firefly.m4a',
  OCEAN: '/audio/scene_ocean.m4a',
  CAMPFIRE: '/audio/scene_campfire.m4a',
  NIGHT: '/audio/scene_night.m4a',
}

export function sceneAssetUrl(scene: ComicScene): string | null {
  if (scene === 'NONE') return null
  return SCENE_ASSET[scene]
}
