'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { StockQuote } from '@/types';

// Simple in-memory cache to reduce API calls
const quoteCache: Record<string, { data: StockQuote; timestamp: number }> = {};
const CACHE_TTL = 30000; // 30 seconds

export function useStockQuote(symbol: string | null, autoRefresh = true) {
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchQuote = useCallback(async () => {
    if (!symbol) return;

    // Check cache
    const cached = quoteCache[symbol];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setQuote(cached.data);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/stock/quote?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error('Failed to fetch quote');
      const data: StockQuote = await res.json();
      quoteCache[symbol] = { data, timestamp: Date.now() };
      setQuote(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchQuote();

    if (autoRefresh && symbol) {
      intervalRef.current = setInterval(fetchQuote, 60000); // Refresh every 60s
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchQuote, autoRefresh, symbol]);

  return { quote, loading, error, refetch: fetchQuote };
}

// Batch quote fetcher for multiple symbols
export function useStockQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (symbols.length === 0) return;
    setLoading(true);

    const results: Record<string, StockQuote> = {};

    // Fetch in parallel, with 5 concurrent max to respect rate limits
    const chunks = [];
    for (let i = 0; i < symbols.length; i += 5) {
      chunks.push(symbols.slice(i, i + 5));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(async (symbol) => {
        const cached = quoteCache[symbol];
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          results[symbol] = cached.data;
          return;
        }

        try {
          const res = await fetch(`/api/stock/quote?symbol=${encodeURIComponent(symbol)}`);
          if (res.ok) {
            const data: StockQuote = await res.json();
            quoteCache[symbol] = { data, timestamp: Date.now() };
            results[symbol] = data;
          }
        } catch (e) {
          console.error(`Failed to fetch quote for ${symbol}:`, e);
        }
      });

      await Promise.all(promises);
    }

    setQuotes(results);
    setLoading(false);
  }, [symbols]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')]);

  return { quotes, loading, refetch: fetchAll };
}
