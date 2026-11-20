/**
 * 设置页「神回」分组 — 逐行移植 Android `god/GodSettingsSection.kt`（269 行）。
 *
 * Android 结构：
 *   Column(fillMaxWidth) {
 *     Text("神回") 13sp SemiBold ls0.1, onSurface 0.62
 *     Spacer(8)
 *     GlassCard(r16) {
 *       Column(padding 16, spacedBy 14) {
 *         Text("神回排行榜展示风格") 14sp Medium
 *         Row(spacedBy 10) { GodRankingStyle.entries.forEach { GodStyleCard(weight 1) } }
 *         if (hasGyro) GodSettingSwitchRow("排行榜陀螺仪视差", …)
 *         if (onOpenRanking != null) Box(r12, secondary 0.10, padding v11) {
 *           Text("查看神回排行榜 ✦") 13.5sp SemiBold gold
 *         }
 *       }
 *     }
 *   }
 *
 * GodStyleCard：上半部分是风格小型示意（Compose Canvas 现画 → 这里用 SVG 等价绘制），
 * 选中弹簧缩放 1.04 + 金渐变描边 1.6dp，未选 1dp onSurface 0.12 描边。
 *
 * 几何与文案全部来自 `@core/god/godSettingsSection`（比例式），此处只负责画 ——
 * 示意图的 11 个元素不再手算成小数散在 JSX 里。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AppSwitch } from '@ui/components/AppSwitch';
import { GlassCard } from '@ui/components/GlassCard';
import { useAppStore } from '@ui/state/appStore';
import {
  GOD_RANKING_STYLES,
  getGodGyroParallaxEnabled,
  getGodRankingStyle,
  setGodGyroParallaxEnabled,
  setGodRankingStyle,
  takeGodStyleSettingsJumpPending,
  type GodRankingStyleCode,
} from '@core/god/godRankingSettings';
import {
  GOD_SETTINGS_CTA,
  GOD_SETTINGS_STRINGS,
  GOD_STYLE_CARD,
  godSettingsCtaColor,
  godStyleCardLabelWeight,
  godStyleCardScale,
  godStylePreview,
  type GodStylePreviewOp,
} from '@core/god/godSettingsSection';
import { tr } from '@core/i18n';
import { godGoldGradient, godIsDark, hasGodRotationSensor } from './GodRankingShared';
import { scrollElementIntoView } from '@ui/lib/scroll';
import '../../../styles/god.css';

/** GodSettingSwitchRow（GodSettingsSection.kt L147-165）。 */
function GodSettingSwitchRow(props: {
  title: string;
  desc: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="god-switch-row">
      <div className="god-switch-row__text">
        <span className="god-switch-row__title">{props.title}</span>
        {props.desc !== '' ? (
          <>
            <div className="god-switch-row__gap2" />
            <span className="god-switch-row__desc">{props.desc}</span>
          </>
        ) : null}
      </div>
      <div className="god-switch-row__gap10" />
      {/* Kotlin L164 直接调共享的 `AppSwitch`（不是这里的私有实现）。 */}
      <AppSwitch
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
        aria-label={props.title}
      />
    </div>
  );
}

/** 把一个示意图元素画成 SVG 节点（坐标来自 `godStylePreview` 的比例换算）。 */
function previewNode(op: GodStylePreviewOp, index: number) {
  if (op.kind === 'circle') {
    return <circle key={index} cx={op.x} cy={op.y} r={op.radius} fill={op.fill} />;
  }
  if (op.kind === 'path' && op.path !== undefined) {
    const { controlX, controlY, endX, endY, strokeWidth } = op.path;
    return (
      <path
        key={index}
        d={`M${op.x} ${op.y} Q${controlX} ${controlY} ${endX} ${endY}`}
        fill="none"
        stroke={op.fill}
        strokeWidth={strokeWidth}
      />
    );
  }
  return (
    <rect
      key={index}
      x={op.x}
      y={op.y}
      width={op.width}
      height={op.height}
      rx={op.kind === 'roundRect' ? op.radius : 0}
      fill={op.fill}
    />
  );
}

/** 风格小型示意（GodSettingsSection.kt L212-249 的 Canvas → SVG 等价）。 */
function GodStyleMiniArt(props: { style: GodRankingStyleCode; gold: readonly [string, string, string] }) {
  const ops = godStylePreview(props.style, props.gold);
  return (
    <svg
      className="god-style-card__art"
      width={String(GOD_STYLE_CARD.artWidthDp)}
      height={String(GOD_STYLE_CARD.artHeightDp)}
      viewBox={`0 0 ${String(GOD_STYLE_CARD.artWidthDp)} ${String(GOD_STYLE_CARD.artHeightDp)}`}
      aria-hidden="true"
    >
      {ops.map((op, index) => previewNode(op, index))}
    </svg>
  );
}

/** 风格单选卡片（GodSettingsSection.kt L172-257）。 */
function GodStyleCard(props: {
  styleCode: GodRankingStyleCode;
  label: string;
  selected: boolean;
  gold: [string, string, string];
  onClick: () => void;
}) {
  const { selected } = props;
  // E55 深色补漏：未选中标签 = Kotlin L255 的 `onSurfaceVariant`（随主题翻转，
  // Theme.kt 未覆写该 M3 角色 → 基线 浅 #49454F 系文字灰 / 深 #CAC4D0）；
  // 此前写死浅色 #61666D，深色卡上对比度不足。CSS 够不着内联 style，
  // 按任务书「一行级补丁」在此修。
  const dark = godIsDark();
  // animateFloatAsState(springMain) → CSS 过渡等效
  const cardStyle: CSSProperties = selected
    ? ({
        transform: `scale(${String(godStyleCardScale(true))})`,
        '--god-gold-gradient': `linear-gradient(90deg, ${props.gold[0]}, ${props.gold[1]}, ${props.gold[2]})`,
      } as CSSProperties)
    : { transform: `scale(${String(godStyleCardScale(false))})` };
  return (
    <button
      type="button"
      className={selected ? 'god-style-card god-style-card--selected' : 'god-style-card'}
      style={cardStyle}
      aria-pressed={selected}
      onClick={props.onClick}
    >
      <GodStyleMiniArt style={props.styleCode} gold={props.gold} />
      <div className="god-style-card__gap6" />
      <span
        className="god-style-card__label"
        style={{
          color: selected ? props.gold[0] : dark ? '#CAC4D0' : '#61666D',
          // Kotlin L254 `if (selected) FontWeight.Bold else FontWeight.Medium` ——
          // 此前只写了 500，选中态标签没有加粗。
          fontWeight: godStyleCardLabelWeight(selected),
        }}
      >
        {props.label}
      </span>
    </button>
  );
}

export function GodSettingsSection(props: {
  /**
   * Kotlin L59 `onOpenRanking: (() -> Unit)? = null` —— 传 `null` 时整块入口不渲染
   * （Kotlin L117 `if (onOpenRanking != null)`）。设置页的默认行为是切到排行榜 route。
   */
  onOpenRanking?: (() => void) | null;
} = {}) {
  // 设置页已在 MainShell 的 settings tab 内 → 只需切到排行榜 route
  const setRoute = useAppStore((s) => s.setRoute);
  const onOpenRanking =
    props.onOpenRanking === undefined ? (): void => setRoute('godRanking') : props.onOpenRanking;
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const dark = godIsDark();
  const gold = godGoldGradient(dark);
  const hasGyro = hasGodRotationSensor();
  const [style, setStyle] = useState<GodRankingStyleCode>(getGodRankingStyle);
  const [gyro, setGyro] = useStateSafe(getGodGyroParallaxEnabled);

  // GodStyleSettingsJump 信标：从排行榜「陈列方式」跳入 → 动画滚动到本分区
  useEffect(() => {
    if (takeGodStyleSettingsJumpPending()) {
      scrollElementIntoView(sectionRef.current, { behavior: 'smooth', block: 'center' });
    }
  }, []);

  return (
    <div ref={sectionRef} className="god-settings" id="god_settings">
      <span className="god-settings__title">{tr(GOD_SETTINGS_STRINGS.sectionTitle)}</span>
      <div className="god-settings__gap8" />
      <GlassCard radius={16} padding={16}>
        <div className="god-settings__card">
          <span className="god-settings__card-title">{tr(GOD_SETTINGS_STRINGS.styleTitle)}</span>
          <div className="god-settings__styles">
            {GOD_RANKING_STYLES.map((entry) => (
              <GodStyleCard
                key={entry.code}
                styleCode={entry.code}
                label={entry.label}
                selected={style === entry.code}
                gold={gold}
                onClick={() => {
                  setStyle(entry.code);
                  setGodRankingStyle(entry.code);
                }}
              />
            ))}
          </div>

          {hasGyro ? (
            <GodSettingSwitchRow
              title={tr(GOD_SETTINGS_STRINGS.gyroTitle)}
              desc={tr(GOD_SETTINGS_STRINGS.gyroDesc)}
              checked={gyro}
              onCheckedChange={(next) => {
                setGyro(next);
                setGodGyroParallaxEnabled(next);
              }}
            />
          ) : null}

          {onOpenRanking !== null ? (
            <button
              type="button"
              className="god-settings__open-ranking"
              style={{ background: `rgba(16, 185, 129, ${String(GOD_SETTINGS_CTA.backgroundAlpha)})` }}
              onClick={() => onOpenRanking()}
            >
              <span style={{ color: godSettingsCtaColor(dark) }}>
                {tr(GOD_SETTINGS_STRINGS.openRanking)}
              </span>
            </button>
          ) : null}
        </div>
      </GlassCard>
    </div>
  );
}

/** 读设置 + 本地 state 同步（设置项只存 localStorage，无需持久化层）。 */
function useStateSafe(loader: () => boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(loader);
  return [value, setValue];
}
