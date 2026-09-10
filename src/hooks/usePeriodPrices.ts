'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { closeKey, isFresh, readCache, writeCache } from '@/lib/marketCache';
import { onRefresh } from '@/lib/refresh';

type PriceMap = Record<string, number>;

/* A period-start close only moves while that session is still open, so this can
 * be generous — it exists to catch the current day's revisions, not to re-fetch
 * settled history. */
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getPeriodStartDates() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return { monthStart, yearStart };
}

async function fetchCloseAtDate(symbol: string, targetDate: Date, force = false): Promise<number | null> {
  const key = closeKey(symbol, targetDate.toISOString().slice(0, 10));
  const cached = readCache<number>(key);
  if (!force && isFresh(cached, CACHE_TTL)) {
    return cached!.value;
  }

  const lookback = new Date(targetDate);
  lookback.setDate(lookback.getDate() - 10);
  const from = Math.floor(lookback.getTime() / 1000);
  const to = Math.floor(targetDate.getTime() / 1000) + 86400;

  try {
    const res = await fetch(
      `/api/stock/candles?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&resolution=D`,
      force ? { headers: { 'x-refresh': '1' }, cache: 'no-store' } : undefined
    );

    if (!res.ok) return cached?.value ?? null;

    const data = await res.json();
    const candles: { time: number; close: number | null }[] = data.candles ?? [];
    const targetTs = Math.floor(targetDate.getTime() / 1000);
    const valid = candles.filter((c) => c.time <= targetTs && c.close != null);

    if (valid.length === 0) return cached?.value ?? null;

    const close = valid[valid.length - 1].close!;
    writeCache(key, close);
    return close;
  } catch {
    // Offline or a dead route — the last known close is better than a gap.
    return cached?.value ?? null;
  }
}

async function fetchPricesForDate(symbols: string[], targetDate: Date, force: boolean): Promise<PriceMap> {
  const prices: PriceMap = {};

  const chunks = [];
  for (let i = 0; i < symbols.length; i += 5) {
    chunks.push(symbols.slice(i, i + 5));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (symbol) => {
        const close = await fetchCloseAtDate(symbol, targetDate, force);
        if (close != null) {
          prices[symbol] = close;
        }
      })
    );
  }

  return prices;
}

/** Cached closes for the given symbols, however old — used to paint before the
 * network answers. */
function seedFromCache(symbols: string[], targetDate: Date): PriceMap {
  const isoDate = targetDate.toISOString().slice(0, 10);
  const prices: PriceMap = {};
  for (const symbol of symbols) {
    const cached = readCache<number>(closeKey(symbol, isoDate));
    if (cached) prices[symbol] = cached.value;
  }
  return prices;
}

export function usePeriodPrices(symbols: string[]) {
  const [monthStartPrices, setMonthStartPrices] = useState<PriceMap>({});
  const [yearStartPrices, setYearStartPrices] = useState<PriceMap>({});
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const symbolsKey = symbols.join('\0');
  const uniqueSymbols = useMemo(
    () => Array.from(new Set(symbolsKey ? symbolsKey.split('\0').filter(Boolean) : [])),
    [symbolsKey]
  );

  const fetchAll = useCallback(
    async (force = false) => {
      const requestId = ++requestIdRef.current;

      if (uniqueSymbols.length === 0) {
        setMonthStartPrices({});
        setYearStartPrices({});
        return;
      }

      const { monthStart, yearStart } = getPeriodStartDates();

      const seededMonth = seedFromCache(uniqueSymbols, monthStart);
      const seededYear = seedFromCache(uniqueSymbols, yearStart);
      const hasSeed = Object.keys(seededMonth).length > 0 || Object.keys(seededYear).length > 0;
      if (hasSeed) {
        setMonthStartPrices(seededMonth);
        setYearStartPrices(seededYear);
      }

      setLoading(!hasSeed);

      try {
        const [monthPrices, yearPrices] = await Promise.all([
          fetchPricesForDate(uniqueSymbols, monthStart, force),
          fetchPricesForDate(uniqueSymbols, yearStart, force),
        ]);

        if (requestIdRef.current !== requestId) return;

        setMonthStartPrices(monthPrices);
        setYearStartPrices(yearPrices);
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [uniqueSymbols]
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => onRefresh(() => fetchAll(true)), [fetchAll]);

  return { monthStartPrices, yearStartPrices, loading };
}
