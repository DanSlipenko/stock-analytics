'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StockQuote } from '@/types';
import { cachedQuote, fetchQuotes, normalizeSymbol } from '@/lib/quoteClient';
import { onRefresh } from '@/lib/refresh';
import { useVisibleInterval } from './useVisibleInterval';

export { cachedQuote } from '@/lib/quoteClient';

/**
 * How often an on-screen page re-polls. Ticks are cheap when nothing is due:
 * fetchQuotes answers from cache for quotes still current — and after the US
 * close, stock quotes stay current for an hour at a time.
 */
const POLL_INTERVAL = 60_000;

export function useStockQuote(symbol: string | null, autoRefresh = true) {
  const [quote, setQuote] = useState<StockQuote | null>(() => cachedQuote(symbol));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const requestIdRef = useRef(0);

  const fetchQuote = useCallback(
    async (force = false) => {
      if (!symbol) return;
      const requestId = ++requestIdRef.current;

      // Show the cached price straight away and treat the request as a
      // background refresh, so a reload doesn't blank out the numbers.
      const cached = cachedQuote(symbol);
      if (cached) setQuote(cached);

      setLoading(!cached);
      setError(null);

      try {
        const result = (await fetchQuotes([symbol], { force }))[normalizeSymbol(symbol)];
        if (requestIdRef.current !== requestId || !result) return;

        setQuote(result.quote);
        setError(result.error);
        setStale(result.stale);
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [symbol]
  );

  useEffect(() => {
    fetchQuote();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchQuote]);

  useVisibleInterval(() => void fetchQuote(false), POLL_INTERVAL, autoRefresh && !!symbol);

  useEffect(() => onRefresh(() => fetchQuote(true)), [fetchQuote]);

  // Argument-less on purpose: wiring this straight to an onClick would
  // otherwise hand `force` a click event.
  const refetch = useCallback(() => fetchQuote(false), [fetchQuote]);

  return { quote, loading, error, stale, refetch };
}

// Batch quote fetcher for multiple symbols
export function useStockQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
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
        setQuotes({});
        return;
      }

      // Seed from cache first: on a cold start this fills the table in one
      // paint, and the network results replace it below.
      const seeded: Record<string, StockQuote> = {};
      for (const symbol of uniqueSymbols) {
        const cached = cachedQuote(symbol);
        if (cached) seeded[symbol] = cached;
      }
      if (Object.keys(seeded).length > 0) setQuotes(seeded);

      setLoading(Object.keys(seeded).length === 0);

      try {
        // Every symbol that needs refreshing goes out in a single request.
        const bySymbol = await fetchQuotes(uniqueSymbols, { force });
        if (requestIdRef.current !== requestId) return;

        // Keyed by the caller's spelling, which pages use to look quotes up.
        const results: Record<string, StockQuote> = {};
        for (const symbol of uniqueSymbols) {
          const quote = bySymbol[normalizeSymbol(symbol)]?.quote;
          if (quote) results[symbol] = quote;
        }
        setQuotes(results);
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
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchAll]);

  useVisibleInterval(() => void fetchAll(false), POLL_INTERVAL, uniqueSymbols.length > 0);

  useEffect(() => onRefresh(() => fetchAll(true)), [fetchAll]);

  const refetch = useCallback(() => fetchAll(false), [fetchAll]);

  return { quotes, loading, refetch };
}
