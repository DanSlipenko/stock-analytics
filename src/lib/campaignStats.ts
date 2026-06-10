import { Campaign } from "@/types";

type QuoteMap = Record<string, { currentPrice?: number } | undefined>;
type PriceMap = Record<string, number | undefined>;

export interface CampaignStats {
  invested: number;
  currentValue: number;
  realized: number;
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

const getSoldShares = (stock: Campaign["stocks"][number]) =>
  stock.transactions.reduce((sum, transaction) => sum + transaction.shares, 0);

const getRemainingShares = (stock: Campaign["stocks"][number]) => Math.max(stock.shares - getSoldShares(stock), 0);

const isInCurrentYear = (dateStr: string) => new Date(dateStr).getFullYear() === new Date().getFullYear();

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
    stock.transactions.forEach((transaction) => {
      if (isInCurrentYear(transaction.date)) {
        const gain = transaction.shares * (transaction.price - stock.buyPrice);
        pnl += gain;
        basis += Math.abs(transaction.shares * stock.buyPrice);
      }
    });

    const remainingShares = getRemainingShares(stock);
    if (remainingShares <= 0) return;

    const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;

    if (isInCurrentYear(stock.buyDate)) {
      const unrealized = remainingShares * (currentPrice - stock.buyPrice);
      pnl += unrealized;
      basis += remainingShares * stock.buyPrice;
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
