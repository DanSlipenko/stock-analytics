/**
 * Browser-side quote fetching shared by every price hook and the alert checker.
 *
 * Symbols that need a network refresh go to the server together, in one
 * `/api/stock/quotes` request, instead of one request per symbol: each request
 * is a billed function invocation, and a page of 30 holdings used to be 30 of
 * them a minute. Fresh cached quotes, recent failures and symbols already in
 * flight are answered without asking the server again.
 */

import type { StockQuote } from '@/types';
import { quoteKey, readCache, writeCache } from './marketCache';
import { quoteIsCurrent } from './marketHours';

/** How long a quote is reused while the market is open. */
export const QUOTE_TTL = 30_000;

const FAILURE_TTL = 30_000;

/** Symbols per request — the route's cap. */
export const MAX_BATCH = 50;

export type QuoteResult = {
  quote: StockQuote | null;
  error: string | null;
  /** The quote came from cache after the network failed to produce a newer one. */
  stale: boolean;
};

export type FetchQuotesOptions = {
  /** Skip every cache and in-flight request: the user asked for fresh numbers. */
  force?: boolean;
  /** Reuse a cached quote younger than this, in ms. */
  maxAge?: number;
};

const failures = new Map<string, { error: string; at: number }>();
const inFlight = new Map<string, Promise<QuoteResult>>();

export const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

/** Last known quote for a symbol, however old — used to paint something on a
 * cold start and to survive a failed request. */
export function cachedQuote(symbol: string | null): StockQuote | null {
  if (!symbol) return null;
  return readCache<StockQuote>(quoteKey(normalizeSymbol(symbol)))?.value ?? null;
}

function failed(symbol: string, error: string): QuoteResult {
  const cached = cachedQuote(symbol);
  // A stale price still beats an empty cell.
  return cached ? { quote: cached, error: null, stale: true } : { quote: null, error, stale: false };
}

/** One request for up to MAX_BATCH symbols. Never rejects: every symbol gets a
 * result, falling back to its cached quote when the request fails. */
async function requestBatch(symbols: string[], force: boolean): Promise<Record<string, QuoteResult>> {
  // On a manual refresh, tell the route to skip its upstream revalidate window.
  // A header rather than a query param, so the service worker keeps treating
  // this as the same URL and doesn't accumulate a second cache entry.
  const init: RequestInit = force ? { headers: { 'x-refresh': '1' }, cache: 'no-store' } : {};
  // Sorted so the same set of symbols always produces the same URL.
  const query = [...symbols].sort().map(encodeURIComponent).join(',');

  let quotes: Record<string, StockQuote> = {};
  let error: string | null = null;

  try {
    const res = await fetch(`/api/stock/quotes?symbols=${query}`, init);
    const body = await res.json().catch(() => null);
    if (res.ok) {
      quotes = body?.quotes ?? {};
    } else {
      error = typeof body?.error === 'string' ? body.error : 'Quote unavailable';
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error';
  }

  const results: Record<string, QuoteResult> = {};
  const now = Date.now();

  for (const symbol of symbols) {
    const quote = quotes[symbol];
    if (quote) {
      writeCache(quoteKey(symbol), quote);
      failures.delete(symbol);
      results[symbol] = { quote, error: null, stale: false };
    } else {
      const message = error ?? 'Quote unavailable';
      failures.set(symbol, { error: message, at: now });
      results[symbol] = failed(symbol, message);
    }
  }

  return results;
}

/**
 * Quotes for `symbols`, keyed by normalized (trimmed, upper-case) symbol.
 *
 * Outside US market hours a stock quote fetched after the close is reused for
 * up to an hour, so a page left open overnight or over the weekend asks about
 * stocks hourly instead of every minute; crypto and other symbols with their own
 * hours keep `maxAge`.
 */
export async function fetchQuotes(
  symbols: string[],
  { force = false, maxAge = QUOTE_TTL }: FetchQuotesOptions = {},
): Promise<Record<string, QuoteResult>> {
  const unique = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  const results: Record<string, QuoteResult> = {};
  const pending: Promise<void>[] = [];
  const needed: string[] = [];
  const now = Date.now();

  for (const symbol of unique) {
    if (!force) {
      const cached = readCache<StockQuote>(quoteKey(symbol));
      if (cached && quoteIsCurrent(symbol, cached.storedAt, maxAge, now)) {
        results[symbol] = { quote: cached.value, error: null, stale: false };
        continue;
      }

      // Don't re-ask for a symbol that just failed.
      const failure = failures.get(symbol);
      if (failure && now - failure.at < FAILURE_TTL) {
        results[symbol] = failed(symbol, failure.error);
        continue;
      }

      const existing = inFlight.get(symbol);
      if (existing) {
        pending.push(existing.then((result) => void (results[symbol] = result)));
        continue;
      }
    }

    needed.push(symbol);
  }

  for (let index = 0; index < needed.length; index += MAX_BATCH) {
    const batch = needed.slice(index, index + MAX_BATCH);
    const request = requestBatch(batch, force);

    for (const symbol of batch) {
      const result = request.then((bySymbol) => bySymbol[symbol]);
      inFlight.set(symbol, result);
      pending.push(
        result.then((value) => {
          results[symbol] = value;
          // A forced refresh may have replaced this entry; leave the newer one.
          if (inFlight.get(symbol) === result) inFlight.delete(symbol);
        }),
      );
    }
  }

  await Promise.all(pending);
  return results;
}
