import { NextRequest, NextResponse } from "next/server";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

const CURATED_CRYPTO = [
  { description: "Bitcoin USD", displaySymbol: "BTC-USD", symbol: "BINANCE:BTCUSDT", type: "Cryptocurrency" },
  { description: "Ethereum USD", displaySymbol: "ETH-USD", symbol: "BINANCE:ETHUSDT", type: "Cryptocurrency" },
  { description: "Solana USD", displaySymbol: "SOL-USD", symbol: "BINANCE:SOLUSDT", type: "Cryptocurrency" },
  { description: "Cardano USD", displaySymbol: "ADA-USD", symbol: "BINANCE:ADAUSDT", type: "Cryptocurrency" },
  { description: "Dogecoin USD", displaySymbol: "DOGE-USD", symbol: "BINANCE:DOGEUSDT", type: "Cryptocurrency" },
  { description: "Zcash USD", displaySymbol: "ZEC-USD", symbol: "BINANCE:ZECUSDT", type: "Cryptocurrency" },
];

const MOCK_STOCKS = [
  { description: "Apple Inc", displaySymbol: "AAPL", symbol: "AAPL", type: "Common Stock" },
  { description: "Microsoft Corporation", displaySymbol: "MSFT", symbol: "MSFT", type: "Common Stock" },
  { description: "Amazon.com Inc", displaySymbol: "AMZN", symbol: "AMZN", type: "Common Stock" },
  { description: "Alphabet Inc Class A", displaySymbol: "GOOGL", symbol: "GOOGL", type: "Common Stock" },
  { description: "Tesla Inc", displaySymbol: "TSLA", symbol: "TSLA", type: "Common Stock" },
  { description: "NVIDIA Corporation", displaySymbol: "NVDA", symbol: "NVDA", type: "Common Stock" },
  { description: "Meta Platforms Inc", displaySymbol: "META", symbol: "META", type: "Common Stock" },
  { description: "Netflix Inc", displaySymbol: "NFLX", symbol: "NFLX", type: "Common Stock" },
  { description: "AMD Advanced Micro Devices", displaySymbol: "AMD", symbol: "AMD", type: "Common Stock" },
  { description: "Disney Walt Co", displaySymbol: "DIS", symbol: "DIS", type: "Common Stock" },
  { description: "PayPal Holdings Inc", displaySymbol: "PYPL", symbol: "PYPL", type: "Common Stock" },
  { description: "Shopify Inc", displaySymbol: "SHOP", symbol: "SHOP", type: "Common Stock" },
  { description: "Spotify Technology SA", displaySymbol: "SPOT", symbol: "SPOT", type: "Common Stock" },
  { description: "Uber Technologies Inc", displaySymbol: "UBER", symbol: "UBER", type: "Common Stock" },
  { description: "Palantir Technologies Inc", displaySymbol: "PLTR", symbol: "PLTR", type: "Common Stock" },
  ...CURATED_CRYPTO,
  { description: "Fidelity ZERO Total Market Index Fund", displaySymbol: "FZROX", symbol: "FZROX", type: "Mutual Fund" },
];

function matchesCuratedCrypto(entry: (typeof CURATED_CRYPTO)[number], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const bareSymbol = entry.displaySymbol.replace(/-USD$/i, "").toLowerCase();
  return (
    bareSymbol === needle ||
    entry.description.toLowerCase().includes(needle) ||
    entry.displaySymbol.toLowerCase().includes(needle) ||
    entry.symbol.toLowerCase().includes(needle)
  );
}

const NORMALIZED_ALLOWED_TYPES = new Set([
  "common stock",
  "cryptocurrency",
  "adr",
  "etf",
  "etp",
  "reit",
  "mutual fund",
  "fund",
]);

function isLikelyTicker(query: string) {
  return /^[A-Z0-9][A-Z0-9.:-]{0,14}$/i.test(query.trim());
}

type AssetType = "stock" | "crypto" | "any";

function isCryptoResult(type?: string) {
  return (type || "").toLowerCase() === "cryptocurrency";
}

function manualResultAllowed(query: string, assetType: AssetType) {
  const isBinance = query.trim().toUpperCase().startsWith("BINANCE:");
  if (assetType === "crypto") return isBinance;
  if (assetType === "stock") return !isBinance;
  return true;
}

function createManualResult(query: string) {
  const symbol = query.trim().toUpperCase();
  return {
    description: `Use ${symbol}`,
    displaySymbol: symbol,
    symbol,
    type: "Symbol",
  };
}

async function canUseManualResult(query: string) {
  const symbol = query.trim().toUpperCase();
  if (!isLikelyTicker(symbol)) return false;
  if (symbol.startsWith("BINANCE:")) return true;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 300 },
      }
    );

    if (!res.ok) return false;

    const data = await res.json();
    return Boolean(data.chart?.result?.[0]?.meta?.symbol) && !data.chart?.error;
  } catch (error) {
    console.error("Manual symbol validation error:", error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const typeParam = (searchParams.get("type") || "").toLowerCase();
  const assetType: AssetType = typeParam === "crypto" ? "crypto" : typeParam === "stock" ? "stock" : "any";

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  if (!FINNHUB_KEY || FINNHUB_KEY === "your_finnhub_key_here") {
    const pool =
      assetType === "crypto" ? MOCK_STOCKS.filter((s) => isCryptoResult(s.type))
      : assetType === "stock" ? MOCK_STOCKS.filter((s) => !isCryptoResult(s.type))
      : MOCK_STOCKS;
    const filtered = pool.filter(
      (s) => s.symbol.toLowerCase().includes(q.toLowerCase()) || s.description.toLowerCase().includes(q.toLowerCase()),
    ).slice(0, 10);
    const hasExactMatch = filtered.some((s) => s.symbol.toLowerCase() === q.toLowerCase());
    const shouldAddManualResult = manualResultAllowed(q, assetType) && !hasExactMatch && await canUseManualResult(q);
    const results = shouldAddManualResult ? [createManualResult(q), ...filtered].slice(0, 10) : filtered;
    return NextResponse.json({ results });
  }

  try {
    const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`, {
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      throw new Error(`Finnhub API error: ${res.status}`);
    }

    const data = await res.json();

    // Limit results and allow common stocks, funds, ADRs, ETFs, and crypto
    let results = (data.result || [])
      .filter((r: { type: string }) =>
        !r.type || NORMALIZED_ALLOWED_TYPES.has(r.type.toLowerCase())
      )
      .map((r: { description: string; displaySymbol: string; symbol: string; type: string }) => ({
        description: r.description,
        displaySymbol: r.displaySymbol,
        symbol: r.symbol,
        type: r.type,
      }));

    if (assetType === "crypto") {
      results = results.filter((r: { type?: string }) => isCryptoResult(r.type));
    } else if (assetType === "stock") {
      results = results.filter((r: { type?: string }) => !isCryptoResult(r.type));
    }

    const curatedCryptoMatches =
      assetType === "stock"
        ? []
        : CURATED_CRYPTO.filter(
            (c) =>
              matchesCuratedCrypto(c, q) &&
              !results.some(
                (r: { symbol: string; displaySymbol: string }) =>
                  r.symbol.toLowerCase() === c.symbol.toLowerCase() ||
                  r.displaySymbol.toLowerCase() === c.displaySymbol.toLowerCase(),
              ),
          );
    results = [...curatedCryptoMatches, ...results];

    const hasExactMatch = results.some((r: { symbol: string; displaySymbol: string }) =>
      r.symbol.toLowerCase() === q.toLowerCase() ||
      r.displaySymbol.toLowerCase() === q.toLowerCase() ||
      r.displaySymbol.replace(/-USD$/i, "").toLowerCase() === q.toLowerCase()
    );
    if (manualResultAllowed(q, assetType) && !hasExactMatch && await canUseManualResult(q)) {
      results.unshift(createManualResult(q));
    }

    // Prioritize US stocks (which typically don't have a dot in the symbol, except for class shares like BRK.B)
    results.sort((a: any, b: any) => {
      const aHasDot = a.symbol.includes('.');
      const bHasDot = b.symbol.includes('.');
      if (aHasDot && !bHasDot) return 1;
      if (!aHasDot && bHasDot) return -1;
      return 0;
    });

    results = results.slice(0, 10);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Failed to search" }, { status: 500 });
  }
}
