'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

type PriceMap = Record<string, number>;

const priceCache: Record<string, { data: number; timestamp: number }> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getPeriodStartDates() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return { monthStart, yearStart };
}

async function fetchCloseAtDate(symbol: string, targetDate: Date): Promise<number | null> {
  const cacheKey = `${symbol}:${targetDate.toISOString().slice(0, 10)}`;
  const cached = priceCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const lookback = new Date(targetDate);
  lookback.setDate(lookback.getDate() - 10);
  const from = Math.floor(lookback.getTime() / 1000);
  const to = Math.floor(targetDate.getTime() / 1000) + 86400;

  try {
    const res = await fetch(
      `/api/stock/candles?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&resolution=D`
    );

    if (!res.ok) return null;

    const data = await res.json();
    const candles: { time: number; close: number | null }[] = data.candles ?? [];
    const targetTs = Math.floor(targetDate.getTime() / 1000);
    const valid = candles.filter((c) => c.time <= targetTs && c.close != null);

    if (valid.length === 0) return null;

    const close = valid[valid.length - 1].close!;
    priceCache[cacheKey] = { data: close, timestamp: Date.now() };
    return close;
  } catch {
    return null;
  }
}

async function fetchPricesForDate(symbols: string[], targetDate: Date): Promise<PriceMap> {
  const prices: PriceMap = {};

  const chunks = [];
  for (let i = 0; i < symbols.length; i += 5) {
    chunks.push(symbols.slice(i, i + 5));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (symbol) => {
        const close = await fetchCloseAtDate(symbol, targetDate);
        if (close != null) {
          prices[symbol] = close;
        }
      })
    );
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

  const fetchAll = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (uniqueSymbols.length === 0) {
      setMonthStartPrices({});
      setYearStartPrices({});
      return;
    }

    setLoading(true);

    try {
      const { monthStart, yearStart } = getPeriodStartDates();
      const [monthPrices, yearPrices] = await Promise.all([
        fetchPricesForDate(uniqueSymbols, monthStart),
        fetchPricesForDate(uniqueSymbols, yearStart),
      ]);

      if (requestIdRef.current !== requestId) return;

      setMonthStartPrices(monthPrices);
      setYearStartPrices(yearPrices);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [uniqueSymbols]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { monthStartPrices, yearStartPrices, loading };
}
