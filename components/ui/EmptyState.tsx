import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({ icon, title, children, action, note }: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-ic"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
      {note && <div className="empty-note">{note}</div>}
    </div>
  );
}
