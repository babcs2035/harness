'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/projects', label: 'Projects' },
  { href: '/machines', label: 'Machines' },
  { href: '/proposals', label: 'Proposals' },
  { href: '/drift', label: 'Drift' },
  { href: '/history', label: 'History' },
];

/** 現在地をハイライトするナビゲーションバー。 */
export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {NAV.map((n) => {
        const isActive = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            style={
              isActive
                ? { color: '#e6edf3', background: 'rgba(68,147,248,0.15)', fontWeight: 600 }
                : undefined
            }
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
