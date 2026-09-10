'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StockQuote } from '@/types';
import { CacheEntry, isFresh, quoteKey, readCache, writeCache } from '@/lib/marketCache';
import { onRefresh } from '@/lib/refresh';

const quoteFailures: Record<string, { error: string; timestamp: number }> = {};
const inFlightQuotes: Partial<Record<string, Promise<QuoteFetchResult>>> = {};
const CACHE_TTL = 30000; // 30 seconds
const FAILURE_TTL = 30000;

type QuoteFetchResult = {
  quote: StockQuote | null;
  error: string | null;
  /** The quote came from cache after the network refused to produce a newer one. */
  stale: boolean;
};

/** Last known quote for a symbol, however old — used to paint something on a
 * cold start and to survive a failed request. */
export function cachedQuote(symbol: string | null): StockQuote | null {
  if (!symbol) return null;
  return readCache<StockQuote>(quoteKey(symbol.trim().toUpperCase()))?.value ?? null;
}

async function fetchQuoteForSymbol(symbol: string, force = false): Promise<QuoteFetchResult> {
  const key = symbol.trim().toUpperCase();
  const cached: CacheEntry<StockQuote> | null = readCache<StockQuote>(quoteKey(key));

  if (!force) {
    if (isFresh(cached, CACHE_TTL)) {
      return { quote: cached!.value, error: null, stale: false };
    }

    const recentFailure = quoteFailures[key];
    if (recentFailure && Date.now() - recentFailure.timestamp < FAILURE_TTL) {
      // Don't re-hammer a symbol that just failed, but a stale price still
      // beats an empty cell.
      if (cached) return { quote: cached.value, error: null, stale: true };
      return { quote: null, error: recentFailure.error, stale: false };
    }

    if (inFlightQuotes[key]) {
      return inFlightQuotes[key];
    }
  }

  const request = (async (): Promise<QuoteFetchResult> => {
    // On a manual refresh, tell the route to skip its 30s upstream revalidate.
    // A header rather than a query param, so the service worker keeps treating
    // this as the same URL and doesn't accumulate a second cache entry.
    const init: RequestInit = force ? { headers: { 'x-refresh': '1' }, cache: 'no-store' } : {};

    try {
      const res = await fetch(`/api/stock/quote?symbol=${encodeURIComponent(key)}`, init);

      if (!res.ok) {
        let error = 'Quote unavailable';
        try {
          const body = await res.json();
          if (typeof body.error === 'string') error = body.error;
        } catch {
          // Keep the generic unavailable message for non-JSON error responses.
        }

        quoteFailures[key] = { error, timestamp: Date.now() };
        if (cached) return { quote: cached.value, error: null, stale: true };
        return { quote: null, error, stale: false };
      }

      const data: StockQuote = await res.json();
      writeCache(quoteKey(key), data);
      delete quoteFailures[key];
      return { quote: data, error: null, stale: false };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      quoteFailures[key] = { error, timestamp: Date.now() };
      if (cached) return { quote: cached.value, error: null, stale: true };
      return { quote: null, error, stale: false };
    } finally {
      delete inFlightQuotes[key];
    }
  })();

  inFlightQuotes[key] = request;
  return request;
}

export function useStockQuote(symbol: string | null, autoRefresh = true) {
  const [quote, setQuote] = useState<StockQuote | null>(() => cachedQuote(symbol));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
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
        const result = await fetchQuoteForSymbol(symbol, force);
        if (requestIdRef.current !== requestId) return;

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

    if (autoRefresh && symbol) {
      intervalRef.current = setInterval(() => fetchQuote(false), 60000); // Refresh every 60s
    }

    return () => {
      requestIdRef.current += 1;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchQuote, autoRefresh, symbol]);

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
      // paint, and the network results replace it symbol by symbol below.
      const seeded: Record<string, StockQuote> = {};
      for (const symbol of uniqueSymbols) {
        const cached = cachedQuote(symbol);
        if (cached) seeded[symbol] = cached;
      }
      if (Object.keys(seeded).length > 0) setQuotes(seeded);

      setLoading(Object.keys(seeded).length === 0);

      const results: Record<string, StockQuote> = { ...seeded };

      // Fetch in parallel, with 5 concurrent max to respect rate limits
      const chunks = [];
      for (let i = 0; i < uniqueSymbols.length; i += 5) {
        chunks.push(uniqueSymbols.slice(i, i + 5));
      }

      try {
        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (symbol) => {
              const result = await fetchQuoteForSymbol(symbol, force);
              if (result.quote) {
                results[symbol] = result.quote;
              } else {
                delete results[symbol];
              }
            })
          );

          if (requestIdRef.current !== requestId) return;
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
    const interval = setInterval(() => fetchAll(false), 60000);
    return () => {
      requestIdRef.current += 1;
      clearInterval(interval);
    };
  }, [fetchAll]);

  useEffect(() => onRefresh(() => fetchAll(true)), [fetchAll]);

  const refetch = useCallback(() => fetchAll(false), [fetchAll]);

  return { quotes, loading, refetch };
}
