'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StockQuote } from '@/types';

// Simple in-memory cache to reduce API calls
const quoteCache: Record<string, { data: StockQuote; timestamp: number }> = {};
const quoteFailures: Record<string, { error: string; timestamp: number }> = {};
const inFlightQuotes: Partial<Record<string, Promise<QuoteFetchResult>>> = {};
const CACHE_TTL = 30000; // 30 seconds
const FAILURE_TTL = 30000;

type QuoteFetchResult = {
  quote: StockQuote | null;
  error: string | null;
};

async function fetchQuoteForSymbol(symbol: string): Promise<QuoteFetchResult> {
  const cacheKey = symbol.trim().toUpperCase();
  const cached = quoteCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { quote: cached.data, error: null };
  }

  const recentFailure = quoteFailures[cacheKey];
  if (recentFailure && Date.now() - recentFailure.timestamp < FAILURE_TTL) {
    return { quote: null, error: recentFailure.error };
  }

  if (inFlightQuotes[cacheKey]) {
    return inFlightQuotes[cacheKey];
  }

  inFlightQuotes[cacheKey] = (async () => {
    try {
      const res = await fetch(`/api/stock/quote?symbol=${encodeURIComponent(cacheKey)}`);

      if (!res.ok) {
        let error = 'Quote unavailable';
        try {
          const body = await res.json();
          if (typeof body.error === 'string') error = body.error;
        } catch {
          // Keep the generic unavailable message for non-JSON error responses.
        }

        quoteFailures[cacheKey] = { error, timestamp: Date.now() };
        return { quote: null, error };
      }

      const data: StockQuote = await res.json();
      quoteCache[cacheKey] = { data, timestamp: Date.now() };
      delete quoteFailures[cacheKey];
      return { quote: data, error: null };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      quoteFailures[cacheKey] = { error, timestamp: Date.now() };
      return { quote: null, error };
    } finally {
      delete inFlightQuotes[cacheKey];
    }
  })();

  return inFlightQuotes[cacheKey];
}

export function useStockQuote(symbol: string | null, autoRefresh = true) {
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const requestIdRef = useRef(0);

  const fetchQuote = useCallback(async () => {
    if (!symbol) return;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchQuoteForSymbol(symbol);
      if (requestIdRef.current !== requestId) return;

      setQuote(result.quote);
      setError(result.error);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [symbol]);

  useEffect(() => {
    fetchQuote();

    if (autoRefresh && symbol) {
      intervalRef.current = setInterval(fetchQuote, 60000); // Refresh every 60s
    }

    return () => {
      requestIdRef.current += 1;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchQuote, autoRefresh, symbol]);

  return { quote, loading, error, refetch: fetchQuote };
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

  const fetchAll = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (uniqueSymbols.length === 0) {
      setQuotes({});
      return;
    }

    setLoading(true);

    const results: Record<string, StockQuote> = {};

    // Fetch in parallel, with 5 concurrent max to respect rate limits
    const chunks = [];
    for (let i = 0; i < uniqueSymbols.length; i += 5) {
      chunks.push(uniqueSymbols.slice(i, i + 5));
    }

    try {
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (symbol) => {
            const result = await fetchQuoteForSymbol(symbol);
            if (result.quote) {
              results[symbol] = result.quote;
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
  }, [uniqueSymbols]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000);
    return () => {
      requestIdRef.current += 1;
      clearInterval(interval);
    };
  }, [fetchAll]);

  return { quotes, loading, refetch: fetchAll };
}
