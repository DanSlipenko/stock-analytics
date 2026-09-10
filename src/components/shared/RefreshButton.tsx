'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useStore } from '@/context/StoreContext';
import { refreshAll } from '@/lib/refresh';

/** How often the "updated N ago" label is recomputed while the tab is open. */
const TICK = 30000;

function formatAge(since: number): string {
  const seconds = Math.round((Date.now() - since) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Manual reload for the header.
 *
 * Prices are served from a persistent cache and only auto-refresh on a timer,
 * so this is the escape hatch when the user wants the current number now: it
 * drops the cached market data, re-runs every price hook on the page, and
 * refetches the portfolio collections behind them.
 */
export default function RefreshButton() {
  const { fetchCampaigns, fetchAlerts, fetchWatchlist, fetchAssets } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);

    try {
      await Promise.allSettled([
        fetchCampaigns(),
        fetchAlerts(),
        fetchWatchlist(),
        fetchAssets(),
        // Clears the market cache and re-runs the mounted price hooks.
        refreshAll(),
      ]);
      setRefreshedAt(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, fetchCampaigns, fetchAlerts, fetchWatchlist, fetchAssets]);

  // Keep the relative label honest without re-rendering the whole header.
  useEffect(() => {
    if (refreshedAt === null) return;
    const interval = setInterval(() => tick((n) => n + 1), TICK);
    return () => clearInterval(interval);
  }, [refreshedAt]);

  const title = refreshing
    ? 'Refreshing…'
    : refreshedAt === null
      ? 'Refresh prices'
      : `Refresh prices · updated ${formatAge(refreshedAt)}`;

  return (
    <Tooltip title={title}>
      <Button
        type="text"
        className="header-icon-button"
        aria-label="Refresh prices"
        disabled={refreshing}
        onClick={handleRefresh}
        icon={<ReloadOutlined spin={refreshing} />}
      />
    </Tooltip>
  );
}
