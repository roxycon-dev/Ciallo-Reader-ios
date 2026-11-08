/**
 * 设置页「神回」分组 — 逐行移植 Android `god/GodSettingsSection.kt`（265 行）。
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
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
import { godGoldGradient, godIsDark, hasGodRotationSensor } from './GodRankingShared';
import { scrollElementIntoView } from '@ui/lib/scroll';
import '../../../styles/god.css';

/** AppSwitch（与 SettingsPage 内嵌版一致：60×32 / circle 24 / pad 4 / MintPrimary）。 */
function AppSwitch(props: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={props.checked ? 'app-switch app-switch--on' : 'app-switch'}
      onClick={() => props.onCheckedChange(!props.checked)}
      aria-pressed={props.checked}
      aria-label={props.ariaLabel ?? 'switch'}
    >
      <span className="app-switch__thumb" />
    </button>
  );
}

/** GodSettingSwitchRow（GodSettingsSection.kt L136-162）。 */
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
      <AppSwitch checked={props.checked} onCheckedChange={props.onCheckedChange} ariaLabel={props.title} />
    </div>
  );
}

/** 风格小型示意（GodSettingsSection.kt L208-245 的 Canvas → SVG 等价）。 */
function GodStyleMiniArt(props: { style: GodRankingStyleCode }) {
  const gold = godGoldGradient(godIsDark());
  // Canvas 62×46，坐标按 GodSettingsSection.kt L210-243 换算
  return (
    <svg
      className="god-style-card__art"
      width="62"
      height="46"
      viewBox="0 0 62 46"
      aria-hidden="true"
    >
      {props.style === 'podium' ? (
        <>
          {/* 三个台阶 + 中间最高 */}
          <rect x="7.4" y="28.5" width="13.6" height="17.5" rx="4" fill={gold[1]} />
          <rect x="24.2" y="19.3" width="13.6" height="26.7" rx="4" fill={gold[0]} />
          <rect x="40.9" y="32.2" width="13.6" height="13.8" rx="4" fill={gold[2]} />
        </>
      ) : null}
      {props.style === 'vinyl' ? (
        <>
          {/* 三张唱片套 + 一张抽出的黑胶 */}
          <rect x="3.7" y="11" width="9.9" height="28.5" rx="4" fill="#5A5F6B" />
          <rect x="18.6" y="8.3" width="11.2" height="31.3" rx="4" fill={gold[0]} />
          <rect x="36" y="11" width="9.9" height="28.5" rx="4" fill="#5A5F6B" />
          <circle cx="52.1" cy="23.9" r="11" fill="#121316" />
          <circle cx="52.1" cy="23.9" r="3.7" fill={gold[0]} />
          {/* 搁板 */}
          <rect x="0" y="40.5" width="62" height="3.7" fill="#33666666" />
        </>
      ) : null}
      {props.style === 'polaroid' ? (
        <>
          {/* 麻绳 */}
          <path
            d="M0 7.4 Q31 15.6 62 7.4"
            fill="none"
            stroke="#B79B72"
            strokeWidth="2"
          />
          {/* 两张拍立得 */}
          <rect x="6.2" y="13.8" width="19.8" height="23.9" rx="4" fill="#FFFFFF" />
          <rect x="32.2" y="15.6" width="19.8" height="23.9" rx="4" fill="#FFFFFF" />
        </>
      ) : null}
    </svg>
  );
}

/** 风格单选卡片（GodSettingsSection.kt L168-254）。 */
function GodStyleCard(props: {
  styleCode: GodRankingStyleCode;
  label: string;
  selected: boolean;
  gold: [string, string, string];
  onClick: () => void;
}) {
  const { selected } = props;
  // E55 深色补漏：未选中标签 = Kotlin L249 的 `onSurfaceVariant`（随主题翻转，
  // Theme.kt 未覆写该 M3 角色 → 基线 浅 #49454F 系文字灰 / 深 #CAC4D0）；
  // 此前写死浅色 #61666D，深色卡上对比度不足。CSS 够不着内联 style，
  // 按任务书「一行级补丁」在此修。
  const dark = godIsDark();
  // animateFloatAsState(springMain) → CSS 过渡等效
  const cardStyle: CSSProperties = selected
    ? ({
        transform: 'scale(1.04)',
        '--god-gold-gradient': `linear-gradient(90deg, ${props.gold[0]}, ${props.gold[1]}, ${props.gold[2]})`,
      } as CSSProperties)
    : { transform: 'scale(1)' };
  return (
    <button
      type="button"
      className={selected ? 'god-style-card god-style-card--selected' : 'god-style-card'}
      style={cardStyle}
      aria-pressed={selected}
      onClick={props.onClick}
    >
      <GodStyleMiniArt style={props.styleCode} />
      <div className="god-style-card__gap6" />
      <span
        className="god-style-card__label"
        style={{ color: selected ? props.gold[0] : dark ? '#CAC4D0' : '#61666D' }}
      >
        {props.label}
      </span>
    </button>
  );
}

export function GodSettingsSection() {
  // 设置页已在 MainShell 的 settings tab 内 → 只需切到排行榜 route
  const setRoute = useAppStore((s) => s.setRoute);
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
      <span className="god-settings__title">神回</span>
      <div className="god-settings__gap8" />
      <GlassCard radius={16} padding={16}>
        <div className="god-settings__card">
          <span className="god-settings__card-title">神回排行榜展示风格</span>
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
              title="排行榜陀螺仪视差"
              desc="倾斜手机时封面与光环反向位移，形成景深"
              checked={gyro}
              onCheckedChange={(next) => {
                setGyro(next);
                setGodGyroParallaxEnabled(next);
              }}
            />
          ) : null}

          <button
            type="button"
            className="god-settings__open-ranking"
            style={{ background: 'rgba(16, 185, 129, 0.10)' }}
            onClick={() => setRoute('godRanking')}
          >
            <span style={{ color: dark ? '#C79A3E' : '#D98E1F' }}>查看神回排行榜 ✦</span>
          </button>
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
