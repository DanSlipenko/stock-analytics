import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

const MOCK_PROFILES: Record<string, object> = {
  AAPL: { name: 'Apple Inc', ticker: 'AAPL', logo: '', industry: 'Technology', marketCapitalization: 3000000, weburl: 'https://apple.com', country: 'US', exchange: 'NASDAQ', finnhubIndustry: 'Technology' },
  MSFT: { name: 'Microsoft Corporation', ticker: 'MSFT', logo: '', industry: 'Technology', marketCapitalization: 2800000, weburl: 'https://microsoft.com', country: 'US', exchange: 'NASDAQ', finnhubIndustry: 'Technology' },
  GOOGL: { name: 'Alphabet Inc', ticker: 'GOOGL', logo: '', industry: 'Technology', marketCapitalization: 2000000, weburl: 'https://abc.xyz', country: 'US', exchange: 'NASDAQ', finnhubIndustry: 'Technology' },
  TSLA: { name: 'Tesla Inc', ticker: 'TSLA', logo: '', industry: 'Automobiles', marketCapitalization: 800000, weburl: 'https://tesla.com', country: 'US', exchange: 'NASDAQ', finnhubIndustry: 'Automobiles' },
  NVDA: { name: 'NVIDIA Corporation', ticker: 'NVDA', logo: '', industry: 'Technology', marketCapitalization: 2500000, weburl: 'https://nvidia.com', country: 'US', exchange: 'NASDAQ', finnhubIndustry: 'Technology' },
  META: { name: 'Meta Platforms Inc', ticker: 'META', logo: '', industry: 'Technology', marketCapitalization: 1200000, weburl: 'https://meta.com', country: 'US', exchange: 'NASDAQ', finnhubIndustry: 'Technology' },
  AMZN: { name: 'Amazon.com Inc', ticker: 'AMZN', logo: '', industry: 'Retail', marketCapitalization: 1900000, weburl: 'https://amazon.com', country: 'US', exchange: 'NASDAQ', finnhubIndustry: 'Retail' },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }

  if (!FINNHUB_KEY || FINNHUB_KEY === 'your_finnhub_key_here') {
    const mock = MOCK_PROFILES[symbol.toUpperCase()] || {
      name: symbol.toUpperCase(),
      ticker: symbol.toUpperCase(),
      logo: '',
      industry: 'Unknown',
      marketCapitalization: 0,
      weburl: '',
      country: 'US',
      exchange: 'UNKNOWN',
      finnhubIndustry: 'Unknown',
    };
    return NextResponse.json(mock);
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 3600 } }
    );

    if (!res.ok) {
      throw new Error(`Finnhub API error: ${res.status}`);
    }

    const data = await res.json();

    return NextResponse.json({
      name: data.name || symbol,
      ticker: data.ticker || symbol,
      logo: data.logo || '',
      industry: data.finnhubIndustry || '',
      marketCapitalization: data.marketCapitalization || 0,
      weburl: data.weburl || '',
      country: data.country || '',
      exchange: data.exchange || '',
      finnhubIndustry: data.finnhubIndustry || '',
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}
