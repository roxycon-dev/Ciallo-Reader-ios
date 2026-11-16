function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function PageTurnSelectorRow(props: {
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        props.selected
          ? 'page-turn-row page-turn-row--selected'
          : 'page-turn-row'
      }
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span className="page-turn-row__text">
        <span className="page-turn-row__label">{props.label}</span>
        {props.description !== undefined ? (
          <span className="page-turn-row__description">
            {props.description}
          </span>
        ) : null}
      </span>
      {props.selected ? (
        <span className="check-badge" aria-hidden="true">
          <CheckIcon />
        </span>
      ) : null}
    </button>
  );
}
