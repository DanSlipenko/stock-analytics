import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, App } from 'antd';
import theme from '@/theme/themeConfig';
import { StoreProvider } from '@/context/StoreContext';
import AppShell from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'StockPulse — Portfolio Analytics',
  description: 'Track your stock campaigns, monitor P&L, set price alerts, and manage your watchlist with real-time market data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <ConfigProvider theme={theme}>
            <App>
              <StoreProvider>
                <AppShell>{children}</AppShell>
              </StoreProvider>
            </App>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
