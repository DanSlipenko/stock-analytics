// ============================================
// Stock Analytics — TypeScript Interfaces
// ============================================

export interface MoneyLocation {
  _id?: string;
  name: string;
  type: 'PayPal' | 'Kraken' | 'Fidelity Roth Clara' | 'Fidelity Roth Dan' | 'Fidelity Dan' | 'Charles Schwab';
  allocatedAmount: number;
}

export interface Transaction {
  _id?: string;
  type: 'sell';
  shares: number;
  price: number;
  date: string;
  percentSold: number;
}

export interface CampaignStock {
  _id?: string;
  symbol: string;
  shares: number;
  buyPrice: number;
  buyDate: string;
  locationId: string;
  transactions: Transaction[];
}

export interface Campaign {
  _id?: string;
  name: string;
  startDate: string;
  moneyLocations: MoneyLocation[];
  stocks: CampaignStock[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PriceAlert {
  _id?: string;
  symbol: string;
  type: 'above' | 'below';
  targetPrice?: number;
  targetPercent?: number;
  referencePrice: number;
  triggered: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WatchlistItem {
  _id?: string;
  symbol: string;
  targetBuyPrice: number;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

// Finnhub API response types
export interface StockQuote {
  currentPrice: number;
  change: number;
  percentChange: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  timestamp: number;
}

export interface StockCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockSearchResult {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
}

export interface CompanyProfile {
  name: string;
  ticker: string;
  logo: string;
  industry: string;
  marketCapitalization: number;
  weburl: string;
  country: string;
  exchange: string;
  finnhubIndustry: string;
}
