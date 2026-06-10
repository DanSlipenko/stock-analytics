import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, App } from 'antd';
import theme from '@/theme/themeConfig';
import { StoreProvider } from '@/context/StoreContext';
import AppShell from '@/components/AppShell';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'StockPulse — Portfolio Analytics',
  description: 'Track your stock campaigns, monitor P&L, set price alerts, and manage your watchlist with real-time market data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
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
