import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import WatchlistItem from '@/models/WatchlistItem';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await dbConnect();
    const { id } = await context.params;
    const item = await WatchlistItem.findByIdAndDelete(id);
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Item removed from watchlist' });
  } catch (error) {
    console.error('DELETE /api/watchlist/[id] error:', error);
    return NextResponse.json({ error: 'Failed to remove item' }, { status: 500 });
  }
}
