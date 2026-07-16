import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'harness',
  description: 'Claude Code ハーネス育成アプリ',
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/projects', label: 'Projects' },
  { href: '/proposals', label: 'Proposals' },
  { href: '/drift', label: 'Drift' },
  { href: '/history', label: 'History' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="layout">
          <aside className="sidebar">
            <h1>🌱 harness</h1>
            <nav className="nav">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href}>
                  {n.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
