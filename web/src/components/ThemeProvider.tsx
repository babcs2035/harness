'use client';

/**
 * Ant Design ダークテーマ用のラッパー。
 * ConfigProvider は server component から渡せないため、
 * client component としてテーマを適用する。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
