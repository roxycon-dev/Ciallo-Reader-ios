import { type ReactElement } from 'react';
import { MOTION } from '../theme/tokens';

type OptionLike<T extends string | number> = T | { value: T; label: string };

function normalizeOption<T extends string | number>(
  opt: OptionLike<T>,
): { value: T; label: string } {
  if (typeof opt === 'object' && opt !== null && 'label' in opt) {
    return { value: opt.value, label: opt.label };
  }
  return { value: opt, label: String(opt) };
}

function isValueMode<T extends string | number>(
  options: ReadonlyArray<OptionLike<T>>,
): boolean {
  return options.some((opt) => typeof opt === 'object' && opt !== null && 'label' in opt);
}

export function SegmentedPillSelector<T extends string | number>(props: {
  options: ReadonlyArray<OptionLike<T>>;
  value: T;
  onChange: (value: T) => void;
}): ReactElement {
  const { options, value, onChange } = props;
  const items = options.map(normalizeOption);
  const valueMode = isValueMode(options);
  const count = items.length;

  let index = 0;
  if (count > 0) {
    if (valueMode) {
      const found = items.findIndex((item) => item.value === value);
      index = found < 0 ? 0 : found;
    } else {
      const idx = typeof value === 'number' ? value : 0;
      index = Math.max(0, Math.min(count - 1, idx));
    }
  }

  if (count === 0) {
    return <div className="segmented-pill" style={{ height: 48 }} />;
  }

  return (
    <div className="segmented-pill" style={{ height: 48 }}>
      <div
        className="segmented-pill__indicator"
        style={{
          width: `calc(100% / ${count})`,
          transform: `translateX(${index * 100}%)`,
          transition: `transform ${MOTION.transition}ms ${MOTION.easeOutQuart}`,
        }}
      />
      {items.map((item, i) => {
        const active = valueMode ? item.value === value : i === index;
        return (
          <button
            key={`${String(item.value)}-${item.label}`}
            type="button"
            className={
              active
                ? 'segmented-pill__option segmented-pill__option--active'
                : 'segmented-pill__option'
            }
            onClick={() => {
              if (valueMode) onChange(item.value);
              else onChange(i as unknown as T);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
