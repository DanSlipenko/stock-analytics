import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

type YahooQuotePoint = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
};

function unavailableQuote(status = 404) {
  return NextResponse.json({ error: 'Quote unavailable' }, { status });
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

async function fetchYahooQuote(symbol: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 30 },
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }

  // Handle cryptocurrency via Binance Public API
  if (symbol.startsWith('BINANCE:')) {
    const cryptoSymbol = symbol.replace('BINANCE:', '');
    try {
      const res = await fetch(`https://api.binance.us/api/v3/ticker/24hr?symbol=${cryptoSymbol}`, { next: { revalidate: 30 } });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({
          currentPrice: parseFloat(data.lastPrice),
          change: parseFloat(data.priceChange),
          percentChange: parseFloat(data.priceChangePercent),
          high: parseFloat(data.highPrice),
          low: parseFloat(data.lowPrice),
          open: parseFloat(data.openPrice),
          previousClose: parseFloat(data.prevClosePrice),
          timestamp: data.closeTime,
        });
      }
    } catch (e) {
      console.error('Binance fetch error:', e);
    }
  }

  if (!FINNHUB_KEY || FINNHUB_KEY === 'your_finnhub_key_here') {
    // Return mock data if no API key
    return NextResponse.json({
      currentPrice: 150 + Math.random() * 50,
      change: (Math.random() - 0.5) * 10,
      percentChange: (Math.random() - 0.5) * 5,
      high: 200,
      low: 140,
      open: 155,
      previousClose: 152,
      timestamp: Date.now(),
    });
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 30 } }
    );

    if (!res.ok) {
      const yahooQuote = await fetchYahooQuote(symbol);
      if (yahooQuote) {
        return NextResponse.json(yahooQuote);
      }

      return unavailableQuote(res.status === 429 ? 429 : 502);
    }

    const data = await res.json();

    if (!Number.isFinite(data.c) || data.c <= 0 || !data.t) {
      const yahooQuote = await fetchYahooQuote(symbol);
      if (yahooQuote) {
        return NextResponse.json(yahooQuote);
      }

      return unavailableQuote();
    }

    return NextResponse.json({
      currentPrice: data.c,
      change: data.d,
      percentChange: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
      timestamp: data.t * 1000,
    });
  } catch (error) {
    console.error('Quote fetch error:', error);
    return unavailableQuote(502);
  }
}
