import { Campaign } from "@/types";
import { getCostPerShare, getRemainingShares, getSaleRealizedPnL } from "@/lib/shares";

type QuoteMap = Record<string, { currentPrice?: number } | undefined>;
type PriceMap = Record<string, number | undefined>;

export interface CampaignStats {
  invested: number;
  currentValue: number;
  realized: number;
  /** Total capital deployed, including shares that have since been sold. */
  costBasis: number;
  pnl: number;
  pnlPercent: number;
}

export type PeriodChangeStats = {
  value: number;
  percentage: number;
  basis: number;
};

export type AnnualPnLStats = {
  pnl: number;
  pnlPercent: number;
  basis: number;
};

const isInCurrentYear = (dateStr: string) => new Date(dateStr).getFullYear() === new Date().getFullYear();

export function calculateCampaignStats(campaign: Campaign, quotes: QuoteMap = {}): CampaignStats {
  let invested = 0;
  let currentValue = 0;
  let realized = 0;
  let costBasis = 0;
  let pnl = 0;

  campaign.stocks.forEach((stock) => {
    const remainingShares = getRemainingShares(stock);
    const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;
    const costPerShare = getCostPerShare(stock);

    const unrealizedStock = remainingShares * (currentPrice - costPerShare);
    const realizedStock = stock.transactions.reduce((sum, transaction) => sum + getSaleRealizedPnL(stock, transaction), 0);

    invested += remainingShares * costPerShare;
    currentValue += remainingShares * currentPrice;
    realized += realizedStock;
    // Cost of every share bought, so selling doesn't shrink the denominator.
    costBasis += stock.shares * costPerShare;
    pnl += unrealizedStock + realizedStock;
  });

  const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

  return { invested, currentValue, realized, costBasis, pnl, pnlPercent };
}

export function calculateCampaignMonthlyChange(
  campaign: Campaign,
  quotes: QuoteMap = {},
  monthStartPrices: PriceMap = {},
): PeriodChangeStats {
  const totals = campaign.stocks.reduce(
    (sum, stock) => {
      const remainingShares = getRemainingShares(stock);
      const monthStartPrice = monthStartPrices[stock.symbol];
      const currentPrice = quotes[stock.symbol]?.currentPrice;

      if (remainingShares <= 0 || monthStartPrice == null || currentPrice == null) return sum;

      return {
        value: sum.value + remainingShares * (currentPrice - monthStartPrice),
        basis: sum.basis + remainingShares * monthStartPrice,
      };
    },
    { value: 0, basis: 0 },
  );

  return {
    value: totals.value,
    basis: totals.basis,
    percentage: totals.basis > 0 ? (totals.value / totals.basis) * 100 : 0,
  };
}

export function calculateCampaignAnnualPnL(
  campaign: Campaign,
  quotes: QuoteMap = {},
  yearStartPrices: PriceMap = {},
): AnnualPnLStats {
  let pnl = 0;
  let basis = 0;

  campaign.stocks.forEach((stock) => {
    const costPerShare = getCostPerShare(stock);

    stock.transactions.forEach((transaction) => {
      if (isInCurrentYear(transaction.date)) {
        pnl += getSaleRealizedPnL(stock, transaction);
        basis += Math.abs(transaction.shares * costPerShare);
      }
    });

    const remainingShares = getRemainingShares(stock);
    if (remainingShares <= 0) return;

    const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;

    if (isInCurrentYear(stock.buyDate)) {
      const unrealized = remainingShares * (currentPrice - costPerShare);
      pnl += unrealized;
      basis += remainingShares * costPerShare;
      return;
    }

    const yearStartPrice = yearStartPrices[stock.symbol];
    if (yearStartPrice == null) return;

    const unrealized = remainingShares * (currentPrice - yearStartPrice);
    pnl += unrealized;
    basis += remainingShares * yearStartPrice;
  });

  return {
    pnl,
    basis,
    pnlPercent: basis > 0 ? (pnl / basis) * 100 : 0,
  };
}
