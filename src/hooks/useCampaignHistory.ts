"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onRefresh } from "@/lib/refresh";
import { toDayKey, type DailyClose, type HistoryRequest, type PerformanceWindow, type Resolution } from "@/lib/campaignPerformance";

type CacheEntry = { closes: DailyClose[]; fetchedAt: number };

export type CampaignHistory = {
  /** The window this data was fetched for — not necessarily the current one, so
   * the caller can keep showing the last complete chart while the next loads. */
  window: PerformanceWindow;
  closes: Record<string, DailyClose[]>;
  /** Requested symbols the API returned no usable history for. */
  missing: string[];
};

/**
 * Session cache. Flipping between time ranges is the common move, and the route
 * already revalidates upstream every minute, so a few minutes of reuse here
 * saves a fan-out of requests per toggle.
 */
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<DailyClose[]>>();
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CONCURRENCY = 5;

const cacheKey = (request: HistoryRequest, resolution: Resolution) => `${request.symbol}|${resolution}|${request.from}`;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchCloses(request: HistoryRequest, resolution: Resolution, force: boolean): Promise<DailyClose[]> {
  const key = cacheKey(request, resolution);
  const cached = cache.get(key);

  if (!force) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.closes;

    const pending = inFlight.get(key);
    if (pending) return pending;
  }

  const to = Math.floor(Date.now() / 1000);
  const url = `/api/stock/candles?symbol=${encodeURIComponent(request.symbol)}&resolution=${resolution}&from=${request.from}&to=${to}`;
  // On a manual refresh, tell the route to skip its upstream revalidate window.
  const init: RequestInit = force ? { headers: { "x-refresh": "1" }, cache: "no-store" } : {};

  const load = (async () => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`Candles request failed with ${res.status}`);

      const data = await res.json();
      const candles: { time?: number; close?: number | null }[] = data.candles ?? [];

      // One close per day, last one wins: an intraday final bar and that day's
      // settled bar can both arrive under the same key.
      const byDay = new Map<string, number>();
      for (const candle of candles) {
        const day = candle.time == null ? null : toDayKey(Number(candle.time) * 1000);
        if (!day || candle.close == null || !Number.isFinite(candle.close)) continue;
        byDay.set(day, candle.close);
      }

      const closes = [...byDay.entries()]
        .map(([day, close]) => ({ day, close }))
        .sort((a, b) => a.day.localeCompare(b.day));

      cache.set(key, { closes, fetchedAt: Date.now() });
      return closes;
    } catch (error) {
      // A stale copy beats flattening the position to its buy price.
      if (cached) return cached.closes;
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, load);
  return load;
}

/**
 * Daily (or weekly) closes for every symbol a performance window needs.
 *
 * While a new window loads the previous result stays in place, so the chart
 * holds its frame instead of collapsing into a skeleton on every range change.
 */
export function useCampaignHistory(performanceWindow: PerformanceWindow | null) {
  const [history, setHistory] = useState<CampaignHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const windowRef = useRef(performanceWindow);
  windowRef.current = performanceWindow;

  const load = useCallback(async (force = false) => {
    const target = windowRef.current;
    const requestId = ++requestIdRef.current;

    if (!target) {
      setHistory(null);
      setLoading(false);
      return;
    }

    if (target.requests.length === 0) {
      // Everything was sold before this window opened: realized P&L only.
      setHistory({ window: target, closes: {}, missing: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    const closes: Record<string, DailyClose[]> = {};
    const missing: string[] = [];

    try {
      for (const group of chunk(target.requests, MAX_CONCURRENCY)) {
        await Promise.all(
          group.map(async (request) => {
            try {
              const result = await fetchCloses(request, target.resolution, force);
              if (result.length > 0) closes[request.symbol] = result;
              else missing.push(request.symbol);
            } catch {
              missing.push(request.symbol);
            }
          }),
        );

        if (requestIdRef.current !== requestId) return;
      }

      setHistory({ window: target, closes, missing: missing.sort() });
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  // Keyed on the window's identity: a new range or a new symbol refetches, a
  // re-render with the same needs doesn't.
  useEffect(() => {
    load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [performanceWindow?.key, load]);

  useEffect(() => onRefresh(() => load(true)), [load]);

  return { history, loading };
}
