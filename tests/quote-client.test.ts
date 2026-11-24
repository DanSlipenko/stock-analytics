import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { fetchQuotes, MAX_BATCH } from '@/lib/quoteClient';
import { clearMarketCache } from '@/lib/marketCache';
import type { StockQuote } from '@/types';

const realFetch = globalThis.fetch;
let requests: { url: string; init?: RequestInit }[] = [];
let respond: (symbols: string[]) => Response = () => new Response('{}');

function quote(price: number): StockQuote {
  return { currentPrice: price, change: 0, percentChange: 0, high: price, low: price, open: price, previousClose: price, timestamp: 0 };
}

const symbolsOf = (url: string) => decodeURIComponent(new URL(url, 'http://x').searchParams.get('symbols') ?? '').split(',');

beforeEach(() => {
  clearMarketCache();
  requests = [];
  respond = (symbols) => Response.json({ quotes: Object.fromEntries(symbols.map((s, i) => [s, quote(100 + i)])) });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return respond(symbolsOf(url));
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

// Crypto symbols keep a plain TTL whatever the time of day, which keeps these
// tests independent of whether the US market happens to be open.
const CRYPTO = ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT'];

test('symbols needing a refresh go out in one request, keyed by normalized symbol', async () => {
  const results = await fetchQuotes(['binance:btcusdt', ...CRYPTO]);
  assert.equal(requests.length, 1);
  assert.deepEqual(symbolsOf(requests[0].url).sort(), [...CRYPTO].sort());
  for (const symbol of CRYPTO) assert.ok(results[symbol]?.quote, symbol);
});

test('fresh cached quotes are not requested again', async () => {
  await fetchQuotes(CRYPTO);
  await fetchQuotes(CRYPTO);
  assert.equal(requests.length, 1);
});

test('concurrent callers share the in-flight request', async () => {
  const [a, b] = await Promise.all([fetchQuotes(CRYPTO), fetchQuotes([CRYPTO[0]])]);
  assert.equal(requests.length, 1);
  assert.equal(a[CRYPTO[0]].quote?.currentPrice, b[CRYPTO[0]].quote?.currentPrice);
});

test('force bypasses the cache and sends the refresh header', async () => {
  await fetchQuotes(CRYPTO);
  await fetchQuotes(CRYPTO, { force: true });
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[1].init?.headers).get('x-refresh'), '1');
});

test('large symbol lists are split at the route cap', async () => {
  const many = Array.from({ length: MAX_BATCH + 5 }, (_, i) => `BINANCE:C${i}USDT`);
  await fetchQuotes(many);
  assert.equal(requests.length, 2);
  assert.equal(symbolsOf(requests[0].url).length, MAX_BATCH);
});

test('a failed request falls back to the cached quote and is not retried immediately', async () => {
  await fetchQuotes(CRYPTO, { maxAge: 0 });
  respond = () => Response.json({ error: 'Upstream down' }, { status: 503 });

  const failed = await fetchQuotes(CRYPTO, { maxAge: 0 });
  assert.equal(requests.length, 2);
  assert.equal(failed[CRYPTO[0]].stale, true);
  assert.ok(failed[CRYPTO[0]].quote);

  await fetchQuotes(CRYPTO, { maxAge: 0 });
  assert.equal(requests.length, 2, 'recent failure suppresses a retry');
});

test('a symbol the server could not price gets an error, not a quote', async () => {
  respond = () => Response.json({ quotes: {} });
  const results = await fetchQuotes(['BINANCE:NOPEUSDT']);
  assert.equal(results['BINANCE:NOPEUSDT'].quote, null);
  assert.equal(results['BINANCE:NOPEUSDT'].error, 'Quote unavailable');
});
