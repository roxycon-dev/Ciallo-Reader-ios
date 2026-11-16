import { type ReactNode } from 'react';

export function SettingsRow(props: {
  label: string;
  description?: string;
  value?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  const interactive = props.onClick !== undefined;
  const classNames = [
    'settings-row',
    props.danger === true ? 'settings-row--danger' : '',
    interactive ? '' : 'settings-row--static',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      <span className="settings-row__text">
        <span className="settings-row__label">{props.label}</span>
        {props.description !== undefined ? (
          <span className="settings-row__description">{props.description}</span>
        ) : null}
        {props.value !== undefined ? (
          <span className="settings-row__value">{props.value}</span>
        ) : null}
      </span>
      {props.control !== undefined ? (
        <span className="settings-row__control">{props.control}</span>
      ) : null}
      {props.children !== undefined ? (
        <div className="settings-row__children" style={{ width: '100%' }}>
          {props.children}
        </div>
      ) : null}
    </>
  );

  if (props.children === undefined) {
    return (
      <button
        type="button"
        className={classNames}
        disabled={!interactive}
        onClick={interactive ? props.onClick : undefined}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className={classNames}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? props.onClick : undefined}
    >
      {inner}
    </div>
  );
}

export function SettingsSection(props: {
  title?: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      {props.title !== undefined ? (
        <h2 className="settings-section__title">{props.title}</h2>
      ) : null}
      {props.caption !== undefined ? (
        <p className="settings-section__caption">{props.caption}</p>
      ) : null}
      <div className="settings-section__body">{props.children}</div>
    </section>
  );
}
