import { useState } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/help/FaqExpandableItem.kt` (87 non-blank lines) — FULL PORT
 *   line 30     `var expanded by remember { mutableStateOf(false) }` → useState
 *   lines 31-34 `animateFloatAsState(if (expanded) 180f else 0f)` → CSS rotate
 *   lines 36-50 Card(12.dp, surfaceVariant@0.4, BorderStroke(1.dp, outlineVariant@0.5))
 *   lines 52-72 the clickable row: question (14sp Bold) + ExpandMore icon
 *   lines 73-88 AnimatedVisibility(expandVertically / shrinkVertically) answer
 *
 * Kotlin defaults preserved verbatim:
 *   question 14sp Bold onSurface, answer 13sp onSurfaceVariant lineHeight 20sp,
 *   icon tint MintPrimary, contentDescription = 收起 / 展开 (switching),
 *   testTag("faq_item_${question.hashCode()}").
 *
 * ADAPTATION — `AnimatedVisibility(expandVertically)` → a max-height transition.
 * `expandVertically` grows from 0 to the measured content height; CSS
 * `grid-template-rows: 0fr → 1fr` reproduces that with a real content height
 * (no pixel guessing), and it composites on the compositor.
 */
export function FaqExpandableItem(props: {
  question: string;
  answer: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={[
        'faq-item',
        expanded ? 'faq-item--expanded' : '',
        props.className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`faq_item_${hashCode(props.question)}`}
      style={props.style}
    >
      <button
        type="button"
        className="faq-item__header"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="faq-item__question">{props.question}</span>
        <span
          className="faq-item__arrow"
          aria-label={expanded ? '收起' : '展开'}
          style={{ transform: `rotate(${expanded ? 180 : 0}deg)` }}
        >
          <ExpandMoreIcon />
        </span>
      </button>
      <div className="faq-item__body" data-open={expanded}>
        <div className="faq-item__body-inner">
          <p className="faq-item__answer">{props.answer}</p>
        </div>
      </div>
    </div>
  );
}

/** JVM `String.hashCode()` — the Kotlin `testTag` used it directly. */
export function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

function ExpandMoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
    </svg>
  );
}