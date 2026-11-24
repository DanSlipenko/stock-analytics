import { NextRequest, NextResponse } from 'next/server';
import { getQuote } from '@/lib/quotes';

// Upstream calls time out after 5s. This caps the whole request, including Next's
// background cache revalidation, which runs without that timeout.
export const maxDuration = 15;

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
