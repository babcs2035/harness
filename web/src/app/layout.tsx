import './globals.css';
import { ConfigProvider } from 'antd';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/ThemeProvider';
import { darkTheme } from '@/styles/theme';

export const metadata: Metadata = {
  title: 'harness',
  description: 'Claude Code ハーネス育成アプリ',
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/projects', label: 'Projects' },
  { href: '/machines', label: 'Machines' },
  { href: '/proposals', label: 'Proposals' },
  { href: '/drift', label: 'Drift' },
  { href: '/history', label: 'History' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <ConfigProvider theme={darkTheme}>
          <ThemeProvider>
            <div className="layout">
              <header className="header">
                <h1 className="logo">🌱 harness</h1>
                <nav className="nav">
                  {NAV.map((n) => (
                    <a key={n.href} href={n.href}>
                      {n.label}
                    </a>
                  ))}
                </nav>
              </header>
              <main className="content">{children}</main>
            </div>
          </ThemeProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
