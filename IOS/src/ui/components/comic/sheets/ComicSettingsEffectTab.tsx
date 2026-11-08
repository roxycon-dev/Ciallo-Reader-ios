/**
 * ComicSettingsEffectTab.tsx — 设置面板 Tab 4「主题（背景/场景/沉浸式）」。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt`）：
 *   - 978–1037 BgSwatchRow（背景类型可视化色卡）
 *   - 1039–1092 SceneOptionFlow（场景图标卡，4 列）
 *   - 1186–1222 EffectTab
 *   - 1188–1197  「阅读背景」（PAPER 时追加纸纹强度）
 *   - 1199–1212  「场景」（非 NONE 时才显示声音/音量/特效）
 *   - 1214–1221  「显示」（进度缩略图 / 沉浸式）
 *
 * 适配与跳过：
 *   - L981–983 `Row(horizontalArrangement = Arrangement.SpaceEvenly)` →
 *     CSS `display:flex; justify-content: space-evenly`。
 *   - L985–991 三元组列表（type/label/fill）→ `BG_SWATCHES`（@core/comic，色值原样）。
 *   - L999–1004 `size(40.dp).clip(CircleShape).background(fill).border(…)` →
 *     圆形 swatch + 选中时 2px 薄荷描边。
 *   - L1008–1025 选中打勾 / DYNAMIC 渐变示意 → 内联 SVG 图标。
 *   - L1053–1058 `FlowRow(maxItemsInEachRow = 4)` → CSS grid 4 列。
 *   - L1065–1070 `panelSelectedBg()/panelSelectedStroke()` → CSS 变量。
 *   - L1077 `Icon(icon, contentDescription = label)` → `<ComicIcon>` + `aria-label`。
 */
import {
  BG_SWATCHES,
  SCENE_OPTIONS,
  bgCheckTint,
  type ComicBgType,
  type ComicScene,
  type ComicSheetsConfig,
} from '@core/comic/comicReaderSheets';
import { PanelSectionCard, SliderRow, SwitchRow } from './comicSheetParts';
import { ComicIcon } from './ComicIcon';

export interface EffectTabProps {
  config: ComicSheetsConfig;
  update: (mutate: (current: ComicSheetsConfig) => ComicSheetsConfig) => void;
}

/* ── BgSwatchRow（Kotlin 979–1037） ── */

function BgSwatchItem(props: {
  type: ComicBgType;
  label: string;
  fill: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={props.active ? 'cmcs-bgswatch cmcs-bgswatch--active' : 'cmcs-bgswatch'}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      <span className="cmcs-bgswatch__dot" style={{ background: props.fill }}>
        {props.active ? (
          <span className="cmcs-bgswatch__check" style={{ color: bgCheckTint(props.type) }}>
            <ComicIcon name="Check" size={16} />
          </span>
        ) : props.type === 'DYNAMIC' ? (
          // 沉浸式：小渐变示意（背景取自当前页主色调）
          <span className="cmcs-bgswatch__dynamic" aria-hidden="true">
            <ComicIcon name="AutoAwesome" size={14} />
          </span>
        ) : null}
      </span>
      <div className="cmcs-bgswatch__gap4" />
      <span className={props.active ? 'cmcs-bgswatch__label cmcs-bgswatch__label--active' : 'cmcs-bgswatch__label'}>
        {props.label}
      </span>
    </button>
  );
}

/* ── SceneOptionFlow（Kotlin 1039–1092） ── */

function SceneCard(props: {
  scene: ComicScene;
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={props.active ? 'cmcs-scene cmcs-scene--active' : 'cmcs-scene'}
      aria-pressed={props.active}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <span
        className={props.active ? 'cmcs-scene__icon cmcs-scene__icon--active' : 'cmcs-scene__icon'}
        aria-hidden="true"
      >
        <ComicIcon name={props.icon} size={17} />
      </span>
      <div className="cmcs-scene__gap4" />
      <span className={props.active ? 'cmcs-scene__label cmcs-scene__label--active' : 'cmcs-scene__label'}>
        {props.label}
      </span>
    </button>
  );
}

export function EffectTab(props: EffectTabProps) {
  const { config, update } = props;

  return (
    <>
      {/* L1188–1197 阅读背景 */}
      <PanelSectionCard title="阅读背景" icon="Palette">
        <div className="cmcs-bgrow">
          {BG_SWATCHES.map((sw) => (
            <BgSwatchItem
              key={sw.type}
              type={sw.type}
              label={sw.label}
              fill={sw.fill}
              active={sw.type === config.bgType}
              onClick={() => update((c) => ({ ...c, bgType: sw.type }))}
            />
          ))}
        </div>
        {config.bgType === 'PAPER' ? (
          <>
            <div className="cmcs-card__gap8" />
            <SliderRow
              title="纸纹强度"
              value={config.paperIntensity}
              range={[0, 100]}
              format={(v) => `${Math.trunc(v)}`}
              onChange={(v) => update((c) => ({ ...c, paperIntensity: Math.trunc(v) }))}
            />
          </>
        ) : null}
      </PanelSectionCard>

      {/* L1199–1212 场景 */}
      <PanelSectionCard title="场景" icon="MusicNote">
        <div className="cmcs-grid cmcs-grid--4">
          {SCENE_OPTIONS.map((opt) => (
            <SceneCard
              key={opt.scene}
              scene={opt.scene}
              label={opt.label}
              icon={opt.icon}
              active={opt.scene === config.scene}
              onClick={() => update((c) => ({ ...c, scene: opt.scene }))}
            />
          ))}
        </div>
        {config.scene !== 'NONE' ? (
          <>
            <div className="cmcs-card__gap6" />
            <SwitchRow
              title="环境声音"
              checked={config.sceneSound}
              onChange={(v) => update((c) => ({ ...c, sceneSound: v }))}
            />
            {config.sceneSound ? (
              <SliderRow
                title="音量"
                value={config.sceneVolume}
                range={[0, 100]}
                format={(v) => `${Math.trunc(v)}`}
                onChange={(v) => update((c) => ({ ...c, sceneVolume: Math.trunc(v) }))}
              />
            ) : null}
            <SwitchRow
              title="阅读特效"
              checked={config.sceneEffect}
              onChange={(v) => update((c) => ({ ...c, sceneEffect: v }))}
            />
          </>
        ) : null}
      </PanelSectionCard>

      {/* L1214–1221 显示 */}
      <PanelSectionCard title="显示" icon="Visibility">
        <SwitchRow
          title="进度缩略图"
          subtitle="拖动进度条时显示页面预览"
          checked={config.showThumbPreview}
          onChange={(v) => update((c) => ({ ...c, showThumbPreview: v }))}
        />
        <SwitchRow
          title="沉浸式"
          subtitle="隐藏系统状态栏 / 导航栏"
          checked={config.hideSystemBars}
          onChange={(v) => update((c) => ({ ...c, hideSystemBars: v }))}
        />
      </PanelSectionCard>
    </>
  );
}
