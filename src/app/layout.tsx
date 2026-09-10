import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, App } from 'antd';
import theme from '@/theme/themeConfig';
import { StoreProvider } from '@/context/StoreContext';
import AppShell from '@/components/AppShell';
import ServiceWorkerRegistrar from '@/components/pwa/ServiceWorkerRegistrar';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
});

export const metadata: Metadata = {
  applicationName: 'StockPulse',
  title: 'StockPulse — Portfolio Analytics',
  description: 'Track your stock campaigns, monitor P&L, set price alerts, and manage your watchlist with real-time market data.',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'StockPulse',
    statusBarStyle: 'black-translucent',
  },
  // Phone numbers aren't meaningful here, and Safari's autolinking mangles
  // ticker prices and quantities.
  formatDetection: { telephone: false },
  other: {
    // Next emits the standardised `mobile-web-app-capable`; iOS below 15.4
    // only understands the apple-prefixed name.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0e1a',
  width: 'device-width',
  initialScale: 1,
  // Lets the layout extend into the display cutout / home-indicator area,
  // which the safe-area padding in globals.css then accounts for.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `dark` activates the shadcn dark: variants (@custom-variant dark (&:is(.dark *)));
  // this app is dark-only, so it is always on.
  return (
    <html lang="en" className="dark">
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
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
