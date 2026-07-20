import 'antd/dist/antd.css';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';
import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { ThemeProvider } from '@/components/ThemeProvider';
import { darkTheme } from '@/styles/theme';

export const metadata: Metadata = {
  title: 'harness',
  description: 'Claude Code ハーネス育成アプリ',
};

/** globals.css のコンテンツを HTML に直接インライン化。
 * import だと Next.js が CSS バンドルとして非同期ロードするため FOUC が発生する。
 * <style> タグとして直接埋め込むことで同期的に適用される。 */
const GLOBAL_CSS = `
/* harness — Ant Design 用の最小レイアウトスタイル */
* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: #0e1116;
  color: #e6edf3;
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP",
    sans-serif;
  font-size: 14px;
}

a {
  color: inherit;
  text-decoration: none;
}

.layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px 24px;
  border-bottom: 1px solid #30363d;
  background: #161b22;
  position: sticky;
  top: 0;
  z-index: 10;
}

.header .logo {
  font-size: 15px;
  margin: 0;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.nav {
  display: flex;
  gap: 2px;
  flex: 1;
}

.nav a {
  display: block;
  padding: 8px 12px;
  border-radius: 6px;
  color: #8b949e;
}

.nav a:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e6edf3;
}

.content {
  flex: 1;
  padding: 28px 32px;
  overflow-x: auto;
}

/* Ant Design Table の分岐行ハイライト */
.diverged {
  background: rgba(210, 153, 34, 0.08);
}

/* Ant Design のダークテーマ用上書き（ConfigProvider で十分だが、一部は CSS で補完） */
.ant-card {
  background: #161b22;
  border-color: #30363d;
}

.ant-table {
  color: #e6edf3;
}

.ant-table-thead > tr > th {
  background: transparent;
  color: #8b949e;
  border-bottom: 1px solid #30363d;
}

.ant-table-tbody > tr > td {
  border-bottom: 1px solid #30363d;
  background: #161b22;
}

.ant-table-tbody > tr:hover > td {
  background: #1c2128;
}

.ant-input,
.ant-select-selector,
.ant-picker-input input {
  background: #0e1116;
  border-color: #30363d;
  color: #e6edf3;
}

.ant-input::placeholder,
.ant-picker-input input::placeholder {
  color: #8b949e;
}

.ant-modal-content {
  background: #161b22;
  color: #e6edf3;
}

.ant-modal-header {
  background: #161b22;
}

.ant-modal-close {
  color: #8b949e;
}

.ant-modal-close:hover {
  color: #e6edf3;
}

.ant-select-dropdown {
  background: #161b22;
}

.ant-select-item {
  color: #e6edf3;
}

.ant-select-item-option-selected {
  background: rgba(68, 147, 248, 0.15);
}

.ant-badge-count {
  box-shadow: 0 0 0 1px #161b22;
}

.ant-spin-container {
  color: #e6edf3;
}

.ant-tabs-tab {
  color: #8b949e;
}

.ant-tabs-tab-active {
  color: #e6edf3;
}

.ant-tabs-ink-bar {
  background: #4493f8;
}

.ant-tabs-content {
  color: #e6edf3;
}

.ant-tabs-tabpane {
  color: #e6edf3;
}

/* Form styles for machines page */
form.stack label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: #8b949e;
}

form.stack input {
  background: #0e1116;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #e6edf3;
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
}

/* Table number alignment */
.num {
  text-align: right;
}

/* Button hover states */
.ant-btn:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  color: #e6edf3 !important;
}
.ant-btn-primary:hover {
  background: #388bfd !important;
  color: #fff !important;
}

/* Remove Ant Design default 2px bottom shadow on primary buttons */
.ant-btn-primary::after {
  box-shadow: none !important;
}

/* Segmented dark theme */
.ant-segmented {
  background: #0e1116 !important;
  border-color: #30363d !important;
}
.ant-segmented-item-selected {
  background: #30363d !important;
  color: #e6edf3 !important;
}
.ant-segmented-item {
  color: #8b949e !important;
}
.ant-segmented-item:hover:not(.ant-segmented-item-selected):not(.ant-segmented-item-disabled) {
  color: #e6edf3 !important;
  background: rgba(255, 255, 255, 0.04) !important;
}

/* RangePicker dark theme */
.ant-picker {
  background: #0e1116 !important;
  border-color: #30363d !important;
  color: #e6edf3 !important;
}
.ant-picker:hover {
  border-color: #4493f8 !important;
}
.ant-picker-input > span {
  color: #e6edf3 !important;
}
.ant-picker-suffix {
  color: #8b949e !important;
}
.ant-picker-clear {
  background: #0e1116 !important;
}

/* Focus indicators for keyboard navigation */
a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid #4493f8;
  outline-offset: 2px;
}

details summary:focus-visible {
  outline: 2px solid #4493f8;
  outline-offset: 2px;
  border-radius: 4px;
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: ダークテーマCSSをインライン注入 */}
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} suppressHydrationWarning />
      </head>
      <body>
        <AntdRegistry>
          <ConfigProvider theme={{ ...darkTheme, zeroRuntime: true }}>
            <ThemeProvider>
              <div className="layout">
                <header className="header">
                  <h1 className="logo">🌱 harness</h1>
                  <Nav />
                </header>
                <main className="content">{children}</main>
              </div>
            </ThemeProvider>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
