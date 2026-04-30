import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import WatchlistItem from '@/models/WatchlistItem';

export async function GET() {
  try {
    await dbConnect();
    const items = await WatchlistItem.find({}).sort({ createdAt: -1 });
    return NextResponse.json(items);
  } catch (error) {
    console.error('GET /api/watchlist error:', error);
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    const body = await request.json();
    const item = await WatchlistItem.create({
      symbol: body.symbol,
      targetBuyPrice: body.targetBuyPrice,
      notes: body.notes || '',
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error('POST /api/watchlist error:', error);
    return NextResponse.json({ error: 'Failed to add to watchlist' }, { status: 500 });
  }
}
