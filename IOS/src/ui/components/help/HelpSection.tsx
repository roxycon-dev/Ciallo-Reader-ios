/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/help/HelpSection.kt` (110 non-blank lines) — FULL PORT
 *   lines 18-40  `HelpSectionHeader(title, modifier)`   → HelpSectionHeader
 *   lines 43-92  `FlowStepItem(stepNumber, title, desc, modifier)` → FlowStepItem
 *   lines 95-114 `TextDetailCard(text, modifier)`        → TextDetailCard
 *
 * Kotlin defaults preserved verbatim:
 *   HelpSectionHeader: 4×16dp mint bar, 8dp gap, 16sp Bold onBackground
 *   FlowStepItem:      12dp radius, surfaceVariant@0.25, 36dp circle
 *                      MintPrimary@0.15, 16sp Bold mint step number,
 *                      14sp Bold title, 4dp gap, 12sp desc lineHeight 16
 *   TextDetailCard:    12dp radius, surfaceVariant@0.2, 13sp lineHeight 18
 *
 * ADAPTATION — `Card`/`Text`/`Spacer` → semantic divs; `lineHeight` in `sp` maps to
 * unitless CSS `line-height` (sp == dp == px at the default font scale).
 */

export const HELP_PRIMARY = '#059669';

export function HelpSectionHeader(props: {
  title: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={['help-section-header', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
    >
      <span className="help-section-header__bar" style={{ background: HELP_PRIMARY }} />
      <span style={{ width: 8 }} />
      <h2 className="help-section-header__title">{props.title}</h2>
    </div>
  );
}

export function FlowStepItem(props: {
  stepNumber: string;
  title: string;
  desc: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={['help-step-card', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
    >
      <div className="help-step-card__row">
        <span className="help-step-card__badge" style={{ background: 'rgba(5, 150, 105, 0.15)' }}>
          {props.stepNumber}
        </span>
        <span style={{ width: 16 }} />
        <div className="help-step-card__texts">
          <p className="help-step-card__title">{props.title}</p>
          <div style={{ height: 4 }} />
          <p className="help-step-card__desc">{props.desc}</p>
        </div>
      </div>
    </div>
  );
}

export function TextDetailCard(props: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={['help-detail-card', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
    >
      <p className="help-detail-card__text">{props.text}</p>
    </div>
  );
}
