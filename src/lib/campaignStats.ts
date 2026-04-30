import { Campaign } from "@/types";

type QuoteMap = Record<string, { currentPrice?: number } | undefined>;

export interface CampaignStats {
  invested: number;
  currentValue: number;
  realized: number;
  pnl: number;
  pnlPercent: number;
}

export function calculateCampaignStats(campaign: Campaign, quotes: QuoteMap = {}): CampaignStats {
  let invested = 0;
  let currentValue = 0;
  let realized = 0;
  let pnl = 0;

  campaign.stocks.forEach((stock) => {
    const soldShares = stock.transactions.reduce((sum, transaction) => sum + transaction.shares, 0);
    const remainingShares = stock.shares - soldShares;
    const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;

    const unrealizedStock = remainingShares * (currentPrice - stock.buyPrice);
    const realizedStock = stock.transactions.reduce(
      (sum, transaction) => sum + transaction.shares * (transaction.price - stock.buyPrice),
      0
    );

    invested += remainingShares * stock.buyPrice;
    currentValue += remainingShares * currentPrice;
    realized += realizedStock;
    pnl += unrealizedStock + realizedStock;
  });

  const pnlBasis = invested + Math.abs(realized);
  const pnlPercent = invested > 0 ? (pnl / pnlBasis) * 100 : 0;

  return { invested, currentValue, realized, pnl, pnlPercent };
}
