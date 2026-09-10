import { NextRequest, NextResponse } from 'next/server';
import { getQuote } from '@/lib/quotes';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }

  const quote = await getQuote(symbol, { refresh: request.headers.get('x-refresh') === '1' });

  if (!quote) {
    return NextResponse.json({ error: 'Quote unavailable' }, { status: 404 });
  }

  return NextResponse.json(quote);
}
