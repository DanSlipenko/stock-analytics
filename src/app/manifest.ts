import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'StockPulse — Portfolio Analytics',
    short_name: 'StockPulse',
    description:
      'Track your stock campaigns, monitor P&L, set price alerts, and manage your watchlist with real-time market data.',
    // Not '/': that route is now a server redirect to /campaigns, and the
    // service worker can't cache a redirect — so an offline launch from the
    // home screen would land on the offline page despite /campaigns being
    // cached. `id` stays '/' so existing installs update in place rather than
    // being treated as a different app.
    start_url: '/campaigns',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: '#0a0e1a',
    theme_color: '#0a0e1a',
    orientation: 'any',
    categories: ['finance', 'business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Campaigns',
        short_name: 'Campaigns',
        url: '/campaigns',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Watchlist',
        short_name: 'Watchlist',
        url: '/watchlist',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Alerts',
        short_name: 'Alerts',
        url: '/alerts',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
