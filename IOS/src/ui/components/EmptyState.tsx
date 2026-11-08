import { type ReactNode } from 'react';

export function EmptyState(props: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2 className="empty-state__title">{props.title}</h2>
      {props.subtitle !== undefined ? (
        <p className="empty-state__subtitle">{props.subtitle}</p>
      ) : null}
      {props.action !== undefined ? (
        <div className="empty-state__action">{props.action}</div>
      ) : null}
    </div>
  );
}
