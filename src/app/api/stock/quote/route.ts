import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

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
      throw new Error(`Finnhub API error: ${res.status}`);
    }

    const data = await res.json();

    if (!Number.isFinite(data.c) || data.c <= 0 || !data.t) {
      return NextResponse.json({ error: 'No quote data' }, { status: 404 });
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
    return NextResponse.json({ error: 'Failed to fetch quote' }, { status: 500 });
  }
}
