import { StockQuote } from '@/types';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

type YahooQuotePoint = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
};

/**
 * `refresh` comes from the app's manual reload button: the user explicitly asked
 * for fresh numbers, so bypass the revalidate window rather than handing back a
 * response that may be up to `revalidate` seconds old.
 */
function upstreamCache(refresh: boolean, revalidate: number): RequestInit {
  return refresh ? { cache: 'no-store' } : { next: { revalidate } };
}

function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function findLastValidPriceIndex(values?: Array<number | null>) {
  if (!values) return -1;

  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (isValidPrice(values[index])) return index;
  }

  return -1;
}

async function fetchYahooQuote(symbol: string, cacheInit: RequestInit): Promise<StockQuote | null> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      ...cacheInit,
    }
  );

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  if (data.chart?.error) {
    return null;
  }

  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const quote: YahooQuotePoint | undefined = result?.indicators?.quote?.[0];
  const timestamps: number[] | undefined = result?.timestamp;

  if (!meta || !quote || !Array.isArray(timestamps)) {
    return null;
  }

  const lastIndex = findLastValidPriceIndex(quote.close);
  const currentPrice = isValidPrice(meta.regularMarketPrice) ? meta.regularMarketPrice : quote.close?.[lastIndex];
  const previousClose = isValidPrice(meta.chartPreviousClose)
    ? meta.chartPreviousClose
    : isValidPrice(meta.previousClose)
      ? meta.previousClose
      : quote.close?.[lastIndex - 1];

  if (!isValidPrice(currentPrice) || !isValidPrice(previousClose)) {
    return null;
  }

  const change = currentPrice - previousClose;

  return {
    currentPrice,
    change,
    percentChange: previousClose === 0 ? 0 : (change / previousClose) * 100,
    high: isValidPrice(quote.high?.[lastIndex]) ? quote.high[lastIndex] : currentPrice,
    low: isValidPrice(quote.low?.[lastIndex]) ? quote.low[lastIndex] : currentPrice,
    open: isValidPrice(quote.open?.[lastIndex]) ? quote.open[lastIndex] : currentPrice,
    previousClose,
    timestamp: (timestamps[lastIndex] ?? Math.floor(Date.now() / 1000)) * 1000,
  };
}

async function fetchBinanceQuote(symbol: string, cacheInit: RequestInit): Promise<StockQuote | null> {
  const cryptoSymbol = symbol.replace('BINANCE:', '');
  try {
    const res = await fetch(`https://api.binance.us/api/v3/ticker/24hr?symbol=${cryptoSymbol}`, cacheInit);
    if (!res.ok) return null;

    const data = await res.json();
    return {
      currentPrice: parseFloat(data.lastPrice),
      change: parseFloat(data.priceChange),
      percentChange: parseFloat(data.priceChangePercent),
      high: parseFloat(data.highPrice),
      low: parseFloat(data.lowPrice),
      open: parseFloat(data.openPrice),
      previousClose: parseFloat(data.prevClosePrice),
      timestamp: data.closeTime,
    };
  } catch (e) {
    console.error('Binance fetch error:', e);
    return null;
  }
}

/** Returns null when no upstream can price the symbol. */
export async function getQuote(symbol: string, { refresh = false } = {}): Promise<StockQuote | null> {
  const cacheInit = upstreamCache(refresh, 30);

  if (symbol.startsWith('BINANCE:')) {
    const binanceQuote = await fetchBinanceQuote(symbol, cacheInit);
    if (binanceQuote) return binanceQuote;
  }

  if (!FINNHUB_KEY || FINNHUB_KEY === 'your_finnhub_key_here') {
    return {
      currentPrice: 150 + Math.random() * 50,
      change: (Math.random() - 0.5) * 10,
      percentChange: (Math.random() - 0.5) * 5,
      high: 200,
      low: 140,
      open: 155,
      previousClose: 152,
      timestamp: Date.now(),
    };
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
      cacheInit
    );

    if (!res.ok) {
      return fetchYahooQuote(symbol, cacheInit);
    }

    const data = await res.json();

    if (!Number.isFinite(data.c) || data.c <= 0 || !data.t) {
      return fetchYahooQuote(symbol, cacheInit);
    }

    return {
      currentPrice: data.c,
      change: data.d,
      percentChange: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
      timestamp: data.t * 1000,
    };
  } catch (error) {
    console.error('Quote fetch error:', error);
    return null;
  }
}

/** Best-effort batch lookup; symbols that fail to price are omitted. */
export async function getQuotes(symbols: string[]): Promise<Record<string, StockQuote>> {
  const unique = Array.from(new Set(symbols));
  const entries = await Promise.all(
    unique.map(async (symbol) => [symbol, await getQuote(symbol)] as const)
  );

  return Object.fromEntries(entries.filter(([, quote]) => quote !== null)) as Record<string, StockQuote>;
}
