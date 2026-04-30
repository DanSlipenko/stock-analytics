import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const resolution = searchParams.get('resolution') || 'D';
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const fromTs = from || String(now - 365 * 24 * 60 * 60); // default 1 year
  const toTs = to || String(now);

  // Handle cryptocurrency via Binance Public API
  if (symbol.startsWith('BINANCE:')) {
    const cryptoSymbol = symbol.replace('BINANCE:', '');
    
    // Map Finnhub resolutions to Binance intervals
    let interval = '1d';
    if (resolution === '1') interval = '1m';
    if (resolution === '5') interval = '5m';
    if (resolution === '15') interval = '15m';
    if (resolution === '60') interval = '1h';
    if (resolution === 'W') interval = '1w';
    if (resolution === 'M') interval = '1M';

    try {
      const res = await fetch(
        `https://api.binance.us/api/v3/klines?symbol=${cryptoSymbol}&interval=${interval}&startTime=${Number(fromTs) * 1000}&endTime=${Number(toTs) * 1000}&limit=1000`,
        { next: { revalidate: 60 } }
      );
      if (res.ok) {
        const data = await res.json();
        const candles = data.map((k: any[]) => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
        return NextResponse.json({ candles, status: 'ok' });
      }
    } catch (e) {
      console.error('Binance klines fetch error:', e);
    }
  }

  if (!FINNHUB_KEY || FINNHUB_KEY === 'your_finnhub_key_here') {
    // Generate mock candle data
    const candles = [];
    const days = Math.min(Math.floor((Number(toTs) - Number(fromTs)) / 86400), 365);
    let price = 100 + Math.random() * 100;
    for (let i = 0; i < days; i++) {
      const open = price;
      const change = (Math.random() - 0.48) * 5;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * 3;
      const low = Math.min(open, close) - Math.random() * 3;
      candles.push({
        time: Number(fromTs) + i * 86400,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.floor(Math.random() * 50000000) + 1000000,
      });
      price = close;
    }
    return NextResponse.json({ candles, status: 'mock' });
  }

  try {
    // Map Finnhub resolution to Yahoo interval
    let yhInterval = '1d';
    if (resolution === '1') yhInterval = '1m';
    if (resolution === '5') yhInterval = '5m';
    if (resolution === '15') yhInterval = '15m';
    if (resolution === '60') yhInterval = '60m';
    if (resolution === 'W') yhInterval = '1wk';
    if (resolution === 'M') yhInterval = '1mo';

    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${fromTs}&period2=${toTs}&interval=${yhInterval}`,
      { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 60 } 
      }
    );

    if (!res.ok) {
      throw new Error(`Yahoo Finance API error: ${res.status}`);
    }

    const data = await res.json();
    const result = data.chart?.result?.[0];

    if (!result || !result.timestamp) {
      return NextResponse.json({ candles: [], status: 'no_data' });
    }

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];

    const candles = timestamps
      .map((time: number, i: number) => ({
        time,
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume[i],
      }))
      .filter((c: any) => c.open !== null && c.close !== null); // Filter out missing data points

    return NextResponse.json({ candles, status: 'ok' });
  } catch (error) {
    console.error('Candles fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch candles' }, { status: 500 });
  }
}
