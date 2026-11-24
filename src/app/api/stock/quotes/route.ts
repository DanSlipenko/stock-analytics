import { NextRequest, NextResponse } from 'next/server';
import { getQuotes } from '@/lib/quotes';

// Upstream calls time out after 5s each. This caps the whole request, including
// Next's background cache revalidation, which runs without that timeout.
export const maxDuration = 15;

const MAX_SYMBOLS = 50;
const SYMBOL_PATTERN = /^[A-Z0-9.:^=_&/-]{1,32}$/;

/**
 * Quotes for several symbols in one invocation: `?symbols=AAPL,MSFT,BINANCE:BTCUSDT`.
 * Symbols that can't be priced — including malformed ones — are left out of
 * `quotes`, so one bad entry doesn't blank the rest of the page.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('symbols') ?? '';
  const requested = [...new Set(raw.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];

  if (requested.length > MAX_SYMBOLS) {
    return NextResponse.json({ error: `At most ${MAX_SYMBOLS} symbols per request` }, { status: 400 });
  }

  const symbols = requested.filter((symbol) => SYMBOL_PATTERN.test(symbol));
  if (symbols.length === 0) {
    return NextResponse.json({ error: 'At least one valid symbol is required' }, { status: 400 });
  }

  const quotes = await getQuotes(symbols, { refresh: request.headers.get('x-refresh') === '1' });
  return NextResponse.json({ quotes });
}
