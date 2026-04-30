import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';

export async function GET() {
  try {
    await dbConnect();
    const campaigns = await Campaign.find({}).sort({ createdAt: -1 });
    return NextResponse.json(campaigns);
  } catch (error) {
    console.error('GET /api/campaigns error:', error);
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    const body = await request.json();
    const campaign = await Campaign.create({
      name: body.name,
      startDate: body.startDate || new Date(),
      moneyLocations: body.moneyLocations || [],
      stocks: [],
    });
    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error('POST /api/campaigns error:', error);
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}
