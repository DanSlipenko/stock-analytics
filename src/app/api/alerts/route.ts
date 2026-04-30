import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import PriceAlert from '@/models/PriceAlert';

export async function GET() {
  try {
    await dbConnect();
    const alerts = await PriceAlert.find({}).sort({ createdAt: -1 });
    return NextResponse.json(alerts);
  } catch (error) {
    console.error('GET /api/alerts error:', error);
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    const body = await request.json();
    const alert = await PriceAlert.create({
      symbol: body.symbol,
      type: body.type,
      targetPrice: body.targetPrice,
      targetPercent: body.targetPercent,
      referencePrice: body.referencePrice,
      triggered: false,
    });
    return NextResponse.json(alert, { status: 201 });
  } catch (error) {
    console.error('POST /api/alerts error:', error);
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}
