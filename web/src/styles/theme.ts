/** Ant Design ダークテーマ設定。既存の暗背景デザインと色を合わせる。 */
import type { ThemeConfig } from 'antd';

export const darkTheme: ThemeConfig = {
  token: {
    colorBgBase: '#0e1116',
    colorBgContainer: '#161b22',
    colorBgElevated: '#161b22',
    colorBorder: '#30363d',
    colorBorderSecondary: '#30363d',
    colorPrimary: '#4493f8',
    colorText: '#e6edf3',
    colorTextSecondary: '#8b949e',
    colorTextTertiary: '#8b949e',
    colorSuccess: '#3fb950',
    colorWarning: '#d29922',
    colorError: '#f85149',
    colorInfo: '#4493f8',
    borderRadius: 6,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: '#161b22',
      siderBg: '#161b22',
      bodyBg: '#0e1116',
    },
    Menu: {
      itemBg: 'transparent',
      itemColor: '#8b949e',
      itemHoverColor: '#e6edf3',
      itemSelectedColor: '#e6edf3',
    },
    Button: {
      colorPrimary: '#4493f8',
      defaultBg: 'transparent',
      defaultColor: '#e6edf3',
    },
    Table: {
      headerBg: 'transparent',
      borderColor: '#30363d',
      rowHoverBg: 'transparent',
    },
    Card: {
      colorBgContainer: '#161b22',
      borderRadius: 10,
    },
    Input: {
      colorBgContainer: '#0e1116',
      colorTextPlaceholder: '#8b949e',
    },
    Select: {
      colorBgContainer: '#0e1116',
    },
    Badge: {
      colorSuccess: '#3fb950',
      colorWarning: '#d29922',
      colorError: '#f85149',
    },
    Statistic: {
      colorText: '#e6edf3',
    },
  },
};
