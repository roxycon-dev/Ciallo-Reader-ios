import { type CSSProperties, type ReactNode } from 'react';
import { DESIGN_TOKENS, MOTION } from '../theme/tokens';
import { withAlpha } from '../../core/glass/color';
import { GlassCard } from './GlassCard';

/**
 * Port of Android TabScreenHeader.kt (lines 116–187).
 *
 * Compose parameters mapped 1:1:
 * - GlassCard shape = RoundedCornerShape(24.dp) → `DESIGN_TOKENS.radius.xl` (= 24dp;
 *   DesignTokens.kt L45 `RadiusXl = 24.dp`)
 * - outer padding: horizontal 20.dp, vertical outerV (10 expanded / 6 collapsed)
 * - inner row padding: horizontal 20.dp, vertical innerV (12 expanded / 7 collapsed)
 * - title: fontSize 24.sp → 19.sp, FontWeight.Bold, AppFonts.Serif
 * - subtitle: 12.sp, FontWeight.Medium, titleColor.copy(alpha=0.75),
 *   letterSpacing 1.5.sp, height subH (20.dp → 0.dp), alpha subAlpha (1 → 0)
 * - animations: tween(220) for outerV/innerV/titleSize/subH, tween(180) for subAlpha
 * - leading 后紧跟 `Spacer(Modifier.width(2.dp))`（TabScreenHeader.kt L158）
 *
 * REVIEW FIXES
 * ① `radius.xxl` did not exist (the token table is `xs/sm/md/lg/xl`); it now uses
 *    `radius.xl`, which is the 24dp the Kotlin shape actually asks for.
 * ② The Kotlin `Spacer(2.dp)` between `leading` and the title column was missing.
 * ③ The local `withAlpha` copy is replaced by the shared `core/glass/color` helper.
 */
export function TabScreenHeader(props: {
  title: string;
  subtitle?: string;
  collapsed?: boolean;
  titleColor?: string;
  titleVisible?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const collapsed = props.collapsed === true;
  const titleVisible = props.titleVisible !== false;

  // animateDpAsState(if (collapsed) 6.dp else 10.dp) / (if collapsed 7.dp else 12.dp)
  const outerV = collapsed ? 6 : 10;
  const innerV = collapsed ? 7 : 12;
  const titleSize = collapsed ? 19 : 24;
  const subtitleHidden = collapsed || props.subtitle === undefined;

  const titleStyle: CSSProperties = {
    fontSize: titleSize,
    fontFamily: DESIGN_TOKENS.font.family.serif,
    fontWeight: 700,
    color: props.titleColor ?? DESIGN_TOKENS.color.darkCharcoal,
    transition: `font-size ${MOTION.headerCollapse}ms ${MOTION.easeOut}`,
  };

  // subtitle color = titleColor.copy(alpha = 0.75f)
  const subtitleColor =
    props.titleColor !== undefined
      ? withAlpha(props.titleColor, 0.75)
      : DESIGN_TOKENS.color.mediumGray;

  const subtitleStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: 1.5,
    color: subtitleColor,
    height: subtitleHidden ? 0 : 20,
    opacity: subtitleHidden ? 0 : 1,
    transition: `height ${MOTION.headerCollapse}ms ${MOTION.easeOut}, opacity 180ms ${MOTION.easeOut}`,
  };

  return (
    <GlassCard
      radius={DESIGN_TOKENS.radius.xl}
      className="tab-screen-header"
      style={{
        padding: 0,
        paddingTop: outerV,
        paddingBottom: outerV,
        paddingLeft: 20,
        paddingRight: 20,
        transition: `padding-top ${MOTION.headerCollapse}ms ${MOTION.easeOut}, padding-bottom ${MOTION.headerCollapse}ms ${MOTION.easeOut}`,
      }}
    >
      <div
        className="tab-screen-header__row"
        style={{
          paddingTop: innerV,
          paddingBottom: innerV,
          paddingLeft: 20,
          paddingRight: 20,
          transition: `padding-top ${MOTION.headerCollapse}ms ${MOTION.easeOut}, padding-bottom ${MOTION.headerCollapse}ms ${MOTION.easeOut}`,
        }}
      >
        {props.leading !== undefined ? (
          <div className="tab-screen-header__leading">{props.leading}</div>
        ) : null}
        {titleVisible ? (
          <>
            {/* TabScreenHeader.kt L158 — `if (leading != null) Spacer(Modifier.width(2.dp))` */}
            {props.leading !== undefined ? <span className="tab-screen-header__gap" /> : null}
            <div className="tab-screen-header__titles">
              <h1 className="tab-screen-header__title" style={titleStyle}>
                {props.title}
              </h1>
              {props.subtitle !== undefined ? (
                <p
                  className={
                    subtitleHidden
                      ? 'tab-screen-header__subtitle tab-screen-header__subtitle--hidden'
                      : 'tab-screen-header__subtitle'
                  }
                  style={subtitleStyle}
                >
                  {props.subtitle}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        {props.trailing !== undefined ? (
          <div className="tab-screen-header__trailing">{props.trailing}</div>
        ) : null}
      </div>
    </GlassCard>
  );
}

/** Kotlin `rememberHeaderCollapsed` (TabScreenHeader.kt L52-58) — 滚过首项 20dp 即收起。 */
export const HEADER_COLLAPSE_THRESHOLD_DP = 20;

