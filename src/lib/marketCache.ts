/**
 * Persistent client-side cache for market data.
 *
 * The quote hooks already dedupe in-flight requests and hold results in
 * module-level maps, but those die with the page: every cold start — and on an
 * installed PWA, every relaunch — re-fetched every symbol before it could show
 * a single number. Backing them with localStorage lets the last known prices
 * paint immediately while the network refresh happens behind them, and keeps a
 * stale copy around to fall back on when a request fails.
 *
 * Storage is best-effort. Private windows, cleared site data and browsers set
 * to block site data all make this unavailable — sometimes by throwing on the
 * accessor itself — so every path here degrades to "no cache" rather than
 * failing a render.
 */

const STORAGE_KEY = 'stockpulse:market-cache:v1';

/** Entries past this age are dropped on load; no market data stays useful. */
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** Enough for a large portfolio plus its period lookups, small enough to stay
 * well inside a ~5MB origin quota. Oldest entries are evicted first. */
const MAX_ENTRIES = 500;

const FLUSH_DELAY = 300;

type StoredEntry = { v: unknown; t: number };

export type CacheEntry<T> = {
  value: T;
  /** When this value was written, in epoch ms. */
  storedAt: number;
};

let memory: Map<string, StoredEntry> | null = null;
let flushHandle: ReturnType<typeof setTimeout> | null = null;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    // Blocked site data throws on the accessor, before any read or write.
    return null;
  }
}

function load(): Map<string, StoredEntry> {
  if (memory) return memory;

  memory = new Map();
  const store = storage();
  if (!store) return memory;

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, StoredEntry>;
      const cutoff = Date.now() - MAX_AGE;
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.t === 'number' && entry.t > cutoff) {
          memory.set(key, entry);
        }
      }
    }
  } catch {
    // Corrupt or half-written payload — start clean instead of failing.
  }

  return memory;
}

function flush() {
  flushHandle = null;

  const store = storage();
  if (!store || !memory) return;

  let entries = [...memory.entries()];
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b[1].t - a[1].t);
    entries = entries.slice(0, MAX_ENTRIES);
    memory = new Map(entries);
  }

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Over quota, most likely. Halve the cache and take one more shot; if that
    // fails too the cache is only an optimisation, so drop it and move on.
    try {
      const half = entries.sort((a, b) => b[1].t - a[1].t).slice(0, Math.floor(MAX_ENTRIES / 2));
      memory = new Map(half);
      store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(half)));
    } catch {
      try {
        store.removeItem(STORAGE_KEY);
      } catch {
        // Nothing left to try.
      }
    }
  }
}

/** Writes are batched: a portfolio refresh touches dozens of symbols at once,
 * and serialising the whole store per symbol is the expensive part. */
function scheduleFlush() {
  if (flushHandle !== null) return;
  flushHandle = setTimeout(flush, FLUSH_DELAY);
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  const entry = load().get(key);
  if (!entry) return null;
  return { value: entry.v as T, storedAt: entry.t };
}

export function writeCache<T>(key: string, value: T): void {
  load().set(key, { v: value, t: Date.now() });
  scheduleFlush();
}

/** True when the entry is inside `ttl`. A `null` entry is never fresh, and a
 * stale entry is still worth showing — read it and check this separately. */
export function isFresh(entry: CacheEntry<unknown> | null, ttl: number): boolean {
  return entry !== null && Date.now() - entry.storedAt < ttl;
}

export function clearMarketCache(): void {
  memory = new Map();
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Already unavailable; the in-memory map is cleared either way.
  }
}

export const quoteKey = (symbol: string) => `quote:${symbol}`;

export const closeKey = (symbol: string, isoDate: string) => `close:${symbol}:${isoDate}`;
