import {
  useMemo,
  useId,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  crystalPrismColors,
  strokeTintOf,
  themedTint,
} from '../../core/glass/color';
import {
  bevelCss,
  buildIndentUnitPath,
  cameraDistancePx,
  glassShadowCss,
  glassSurfaceCss,
  IDLE_PRESS,
  indentCss,
  lightPathCss,
  outerTransformCss,
  pressHandlers,
  pressLiftPx,
  pressScale,
  prismBorderCss,
  topRimCss,
  tiltLightCss,
  type PressState,
} from './GlassCardLayers';
import { glassThicknessGains, rescaleCornerRadius } from '../../core/glass/cardTweaks';
import { prefersReducedTransparency, supportsRealtimeBlur } from '../../core/glass/liquidGlass';
import { systemReduceMotion } from '../../core/glass/motion';
import { COLORS } from '../theme/tokens';
import { useAppStore } from '../state/appStore';
import { useCardTweaks } from './CardTweaks';
import { RenderQuality, useRenderQuality } from './GlassQuality';

/**
 * Interactive GlassCard port, backed by `GlassCardLayers.tsx` and Android
 * `ui/components/GlassCard.kt`. `GlassKitCard` is a separate Haze-backed
 * surface and is intentionally not used here.
 *
 * The optical layers are static CSS gradients. MAX-tier press feedback is
 * updated only by pointer events and CSS transitions; this host does not start
 * an idle animation frame loop per card.
 */
export function GlassCard(props: {
  children: ReactNode;
  className?: string;
  radius?: number;
  padding?: number;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const tweaks = useCardTweaks();
  const quality = useRenderQuality();
  const qualityId = RenderQuality[quality].id;
  const primaryIndex = useAppStore((s) => s.primaryIndex);
  const secondaryIndex = useAppStore((s) => s.secondaryIndex);
  const primary = COLORS.primaryPalette[primaryIndex] ?? COLORS.primaryPalette[2] ?? '#059669';
  const secondary = COLORS.secondaryPalette[secondaryIndex] ?? COLORS.secondaryPalette[2] ?? '#10B981';
  const reduceMotion = systemReduceMotion();
  const reducedTransparency = prefersReducedTransparency();

  // Android's card shape defaults to the live CardTweaks radius and scales an
  // explicitly supplied shape from that same 16dp reference point.
  const radius = rescaleCornerRadius(props.radius ?? null, tweaks.cornerRadiusDp);
  const styleRadius = props.style?.borderRadius;
  const effectRadius =
    typeof styleRadius === 'number'
      ? styleRadius
      : typeof styleRadius === 'string' && /^\d+(?:\.\d+)?px$/.test(styleRadius)
        ? Number.parseFloat(styleRadius)
        : radius;
  const padding = props.padding ?? 16;
  const interactive = props.onClick !== undefined;
  const isMax = qualityId === RenderQuality.MAX.id && !reduceMotion;
  const indentClipId = `glass-card-indent-${useId().replace(/:/g, '')}`;
  const [press, setPress] = useState<PressState>(IDLE_PRESS);
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });

  // Keep the observation-only pointer path. It never prevents default or
  // captures the pointer, so touch scrolling and nested buttons keep ownership.
  const handlers = useMemo(() => pressHandlers({ onChange: setPress }), [setPress]);
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isMax || !event.isPrimary) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCardSize({ width: rect.width, height: rect.height });
    handlers.onPointerDown(event);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (isMax && event.isPrimary) handlers.onPointerMove(event);
  };
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (isMax && event.isPrimary) handlers.onPointerUp();
  };
  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>): void => {
    if (isMax && event.isPrimary) handlers.onPointerCancel();
  };
  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>): void => {
    if (isMax && event.isPrimary) handlers.onPointerLeave();
  };

  const visualPress: PressState = isMax
    ? {
        ...press,
        tiltX: press.handDown ? -press.pressNorm.y * tweaks.tiltMaxDeg : 0,
        tiltY: press.handDown ? press.pressNorm.x * tweaks.tiltMaxDeg : 0,
      }
    : IDLE_PRESS;
  const indentPath = useMemo(
    () => buildIndentUnitPath(visualPress.indentSeed),
    [visualPress.indentSeed],
  );
  const tiltMag = Math.abs(visualPress.tiltX) + Math.abs(visualPress.tiltY);
  const blurRadius = Math.max(0, tweaks.blurRadiusDp);
  const hasBackdrop =
    qualityId >= RenderQuality.HIGH.id &&
    supportsRealtimeBlur() &&
    !reducedTransparency;
  const tintBase =
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
      ? '#222428'
      : '#FFFFFF';
  const tint = themedTint(tintBase, primary, tweaks.tintMix);
  const strokeTint = strokeTintOf(primary);
  const surface = glassSurfaceCss({
    qualityId,
    themedTint: tint,
    blurRadiusDp: blurRadius,
    hasBackdrop,
  });
  const [thick, beamGain, bevelGain] = glassThicknessGains(blurRadius);
  void thick;

  const cardTransform = isMax
    ? cssTextToStyle(
        outerTransformCss({
          press: visualPress,
          scrollTiltDeg: 0,
          tiltMaxDeg: tweaks.tiltMaxDeg,
          scrollTiltMaxDeg: 0,
          pressScale: pressScale(visualPress.handDown, true),
          entrance: 1,
          cameraDistance: cameraDistancePx(
            Math.max(1, Math.min(cardSize.width || 1, cardSize.height || 1)),
            tweaks.cameraDistMult,
          ),
          isMax: true,
        }),
      ).transform
    : undefined;

  const baseStyle: CSSProperties = {
    borderRadius: radius,
    padding: padding > 0 ? padding : undefined,
    backgroundColor: surface.background,
    backdropFilter: hasBackdrop ? surface.backdropFilter : 'none',
    WebkitBackdropFilter: hasBackdrop ? surface.WebkitBackdropFilter : 'none',
    boxShadow: glassShadowCss({
      qualityId,
      isMax,
      elevationPx: pressLiftPx(isMax, visualPress.handDown, tiltMag),
      primary,
      tiltMag,
    }),
    opacity: tweaks.cardAlpha,
    transform: cardTransform,
    transitionDuration: reduceMotion ? '0ms' : undefined,
    ...props.style,
  };

  const className = [
    'glass-card',
    interactive ? 'glass-card--interactive' : '',
    isMax ? 'glass-card--max' : '',
    props.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const lightPath = useMemo(
    () =>
      qualityId > RenderQuality.LOW.id
        ? cssTextToStyle(
            lightPathCss({
              height: cardSize.height,
              isPressed: visualPress.handDown,
              qualityId,
              strokeTint,
              primary,
              secondary,
              beamGain,
              bevelGain,
            }),
          )
        : null,
    [
      qualityId,
      cardSize.height,
      visualPress.handDown,
      strokeTint,
      primary,
      secondary,
      beamGain,
      bevelGain,
    ],
  );
  const tiltLight = isMax
    ? tiltLightCss({
        width: cardSize.width,
        height: cardSize.height,
        tiltX: visualPress.tiltX,
        tiltY: visualPress.tiltY,
        isMax,
      })
    : null;
  const indentPress = {
    ...visualPress,
    // Keep the measured radial shape mounted while released so its opacity can
    // settle back to zero without an extra animation loop.
    indentIntensity: Math.max(visualPress.indentIntensity, 0.005),
  };
  const indent = isMax
    ? indentCss({
        width: cardSize.width,
        height: cardSize.height,
        press: indentPress,
        themedTint: tint,
        pressStrength: tweaks.pressStrength,
        pressRadius: tweaks.pressRadius,
        tiltMaxDeg: tweaks.tiltMaxDeg,
      })
    : null;
  const rimPress = {
    ...indentPress,
    indentIntensity: Math.max(indentPress.indentIntensity, 0.03),
  };
  const rim = isMax
    ? topRimCss({ width: cardSize.width, press: rimPress, isMax })
    : null;

  const prismColors = useMemo(
    () => crystalPrismColors(primary, secondary),
    [primary, secondary],
  );
  const prism = cssTextToStyle(
    prismBorderCss({
      radius: effectRadius,
      isPressed: visualPress.handDown,
      qualityId,
      strokeTint,
      prismColors,
    }),
  );
  const bevel =
    qualityId > RenderQuality.LOW.id
      ? cssTextToStyle(bevelCss({ radius: effectRadius, strokeTint }))
      : null;

  return (
    <div
      className={className}
      onClick={props.onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                props.onClick?.();
              }
            }
          : undefined
      }
      onPointerDown={isMax ? handlePointerDown : undefined}
      onPointerMove={isMax ? handlePointerMove : undefined}
      onPointerUp={isMax ? handlePointerUp : undefined}
      onPointerCancel={isMax ? handlePointerCancel : undefined}
      onPointerLeave={isMax ? handlePointerLeave : undefined}
      style={baseStyle}
    >
      {lightPath ? (
        <span aria-hidden="true" className="glass-card__layer glass-card__light-path" style={lightPath} />
      ) : null}
      {tiltLight ? (
        <span
          aria-hidden="true"
          className="glass-card__layer glass-card__tilt-light"
          style={cssTextToStyle(tiltLight)}
        />
      ) : null}
      {indent ? (
        <span
          aria-hidden="true"
          className="glass-card__layer glass-card__indent"
          style={{
            ...cssTextToStyle(indent),
            clipPath: `url(#${indentClipId})`,
            opacity: visualPress.handDown ? visualPress.indentIntensity : 0,
          }}
        >
          <svg aria-hidden="true" width="0" height="0" focusable="false">
            <defs>
              <clipPath id={indentClipId} clipPathUnits="objectBoundingBox">
                <path d={indentPath} transform="scale(0.5) translate(1 1)" />
              </clipPath>
            </defs>
          </svg>
        </span>
      ) : null}
      {rim ? (
        <span
          aria-hidden="true"
          className="glass-card__layer glass-card__rim"
          style={{
            ...cssTextToStyle(rim),
            opacity: visualPress.handDown ? visualPress.indentIntensity : 0,
          }}
        />
      ) : null}
      {bevel ? (
        <span
          aria-hidden="true"
          className="glass-card__layer glass-card__edge glass-card__bevel"
          style={bevel}
        />
      ) : null}
      <span
        aria-hidden="true"
        className="glass-card__layer glass-card__edge glass-card__prism"
        style={prism}
      />
      {props.children}
    </div>
  );
}

/** The geometry helpers return CSS declarations to mirror their Kotlin port. */
function cssTextToStyle(cssText: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const declaration of cssText.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator <= 0) continue;
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (!value) continue;
    const camelProperty = property.startsWith('-webkit-')
      ? `Webkit${property.slice(8).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`
      : property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    style[camelProperty] = value;
  }
  return style as CSSProperties;
}
