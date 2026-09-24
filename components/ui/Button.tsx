import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'sm';

interface Style {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: IconName;
}

export function buttonClass({ variant = 'primary', size = 'md', block }: Style = {}): string {
  return ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block'].filter(Boolean).join(' ');
}

/** Tombol aksi. Aksi tulis on-chain memakai <TxButton> (Fase 5), bukan ini. */
export function Button({ variant, size, block, icon, children, className, ...rest }: Style & ComponentProps<'button'>) {
  return (
    <button type="button" className={[buttonClass({ variant, size, block }), className].filter(Boolean).join(' ')} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/** Tautan yang berpenampilan tombol — navigasi internal lewat next/link. */
export function ButtonLink({ variant, size, block, icon, children, href }: Style & { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass({ variant, size, block })}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}
