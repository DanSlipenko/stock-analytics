import type { ThemeConfig } from 'antd';

const theme: ThemeConfig = {
  token: {
    // Colors
    colorPrimary: '#00d4aa',
    colorBgBase: '#0a0e1a',
    colorBgContainer: '#111827',
    colorBgElevated: '#1a2332',
    colorBgLayout: '#0a0e1a',
    colorBorder: '#1e2a3a',
    colorBorderSecondary: '#162030',
    colorText: '#e2e8f0',
    colorTextSecondary: '#94a3b8',
    colorTextTertiary: '#64748b',
    colorTextQuaternary: '#475569',

    // Success / Error (green for gains, red for losses)
    colorSuccess: '#22c55e',
    colorError: '#ef4444',
    colorWarning: '#f59e0b',
    colorInfo: '#3b82f6',

    // Typography
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 14,
    fontSizeHeading1: 30,
    fontSizeHeading2: 24,
    fontSizeHeading3: 20,

    // Borders & Radius
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,

    // Shadows
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.2)',
    boxShadowSecondary: '0 10px 15px -3px rgba(0,0,0,0.4), 0 4px 6px -4px rgba(0,0,0,0.3)',

    // Motion
    motionDurationFast: '0.15s',
    motionDurationMid: '0.25s',
    motionDurationSlow: '0.35s',
  },
  components: {
    Layout: {
      siderBg: '#0f1629',
      headerBg: '#0f1629',
      bodyBg: '#0a0e1a',
      triggerBg: '#1a2332',
    },
    Menu: {
      darkItemBg: '#0f1629',
      darkItemSelectedBg: 'rgba(0,212,170,0.12)',
      darkItemHoverBg: 'rgba(0,212,170,0.06)',
      darkItemSelectedColor: '#00d4aa',
      darkItemColor: '#94a3b8',
      itemBorderRadius: 8,
    },
    Card: {
      colorBgContainer: '#111827',
      colorBorder: '#1e2a3a',
    },
    Table: {
      colorBgContainer: '#111827',
      headerBg: '#0f1629',
      headerColor: '#94a3b8',
      rowHoverBg: 'rgba(0,212,170,0.04)',
      borderColor: '#1e2a3a',
    },
    Button: {
      primaryShadow: '0 2px 8px rgba(0,212,170,0.3)',
    },
    Modal: {
      contentBg: '#111827',
      headerBg: '#111827',
    },
    Drawer: {
      colorBgElevated: '#111827',
    },
    Statistic: {
      contentFontSize: 28,
    },
    Input: {
      colorBgContainer: '#0f1629',
      colorBorder: '#1e2a3a',
      activeBorderColor: '#00d4aa',
      hoverBorderColor: '#00d4aa80',
    },
    Select: {
      colorBgContainer: '#0f1629',
      colorBorder: '#1e2a3a',
      optionSelectedBg: 'rgba(0,212,170,0.12)',
    },
    InputNumber: {
      colorBgContainer: '#0f1629',
      colorBorder: '#1e2a3a',
    },
    DatePicker: {
      colorBgContainer: '#0f1629',
      colorBorder: '#1e2a3a',
    },
    Notification: {
      colorBgElevated: '#1a2332',
    },
    Tag: {
      borderRadiusSM: 4,
    },
  },
  algorithm: undefined, // We manually set dark colors
};

export default theme;
