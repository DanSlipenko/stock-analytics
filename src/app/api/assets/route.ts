import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Asset from '@/models/Asset';

export async function GET() {
  try {
    await dbConnect();
    const assets = await Asset.find({}).sort({ name: 1 });
    return NextResponse.json(assets);
  } catch (error) {
    console.error('GET /api/assets error:', error);
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    const body = await request.json();
    const name = (body.name || '').trim();

    if (!name) {
      return NextResponse.json({ error: 'Asset name is required' }, { status: 400 });
    }

    // Avoid creating duplicates that only differ by casing/whitespace.
    const existing = await Asset.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (existing) {
      return NextResponse.json({ error: 'An asset with that name already exists' }, { status: 409 });
    }

    const asset = await Asset.create({ name });
    return NextResponse.json(asset, { status: 201 });
  } catch (error) {
    console.error('POST /api/assets error:', error);
    return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 });
  }
}
