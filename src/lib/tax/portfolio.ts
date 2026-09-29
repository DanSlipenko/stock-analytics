import type { Campaign } from '@/types';
import { getCostPerShare, getRemainingShares, getSaleRealizedPnL } from '@/lib/shares';

export type TaxSale = {
  id: string;
  campaignId: string;
  holdingId: string;
  symbol: string;
  account: string;
  date: string;
  bought: string;
  shares: number;
  proceeds: number;
  basis: number;
  gain: number;
  term: 'short' | 'long';
  excluded: boolean;
};
export type TaxHolding = {
  id: string;
  campaignId: string;
  symbol: string;
  account: string;
  bought: string;
  shares: number;
  costPerShare: number;
  /** First day a sale of this lot counts as long-term (YYYY-MM-DD). */
  longTermFrom: string;
  excluded: boolean;
};
export type TaxPortfolio = {
  shortTerm: number;
  longTerm: number;
  sales: TaxSale[];
  holdings: TaxHolding[];
  locations: { id: string; name: string }[];
  warnings: string[];
};
/** The day after the one-year anniversary (YYYY-MM-DD): a lot must be held more than a year to be long-term. */
export function longTermFrom(bought: string) {
  // Calendar dates, not 365 elapsed days: leap years and the anniversary matter.
  const acquisition = new Date(bought);
  const year = acquisition.getUTCFullYear() + 1;
  const month = acquisition.getUTCMonth();
  const day = Math.min(acquisition.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day + 1)).toISOString().slice(0, 10);
}
export function isLongTerm(bought: string, sold: string) {
  return new Date(sold).toISOString().slice(0, 10) >= longTermFrom(bought);
}
export function portfolioForTax(campaigns: Campaign[], year: number, excludedLocationIds: string[] = []): TaxPortfolio {
  const result: TaxPortfolio = { shortTerm: 0, longTerm: 0, sales: [], holdings: [], locations: [], warnings: [] };
  for (const campaign of campaigns) {
    for (const location of campaign.moneyLocations) {
      if (location._id) result.locations.push({ id: location._id, name: `${location.name} · ${campaign.name}` });
    }
    for (const stock of campaign.stocks) {
      const excluded = excludedLocationIds.includes(stock.locationId);
      const account = campaign.moneyLocations.find((l) => l._id === stock.locationId)?.name || 'Unassigned';
      if (!Number.isFinite(new Date(stock.buyDate).getTime()) || stock.shares <= 0) {
        result.warnings.push(`${stock.symbol}: missing purchase date or share count; excluded from tax calculations.`);
        continue;
      }
      const remaining = getRemainingShares(stock);
      if (remaining > 0)
        result.holdings.push({
          id: stock._id!,
          campaignId: campaign._id!,
          symbol: stock.symbol,
          account,
          bought: stock.buyDate,
          shares: remaining,
          costPerShare: getCostPerShare(stock),
          longTermFrom: longTermFrom(stock.buyDate),
          excluded,
        });
      if (stock.transactions.reduce((sum, t) => sum + t.shares, 0) > stock.shares + 1e-8)
        result.warnings.push(
          `${stock.symbol}: recorded sales exceed purchased shares; reconcile this lot before relying on gains.`,
        );
      for (const sale of stock.transactions) {
        const date = new Date(sale.date);
        if (!Number.isFinite(date.getTime()) || date < new Date(stock.buyDate)) {
          result.warnings.push(`${stock.symbol}: invalid sale date; sale omitted.`);
          continue;
        }
        if (date.getUTCFullYear() !== year) continue;
        const gain = getSaleRealizedPnL(stock, sale);
        const term = isLongTerm(stock.buyDate, sale.date) ? 'long' : 'short';
        result.sales.push({
          id: sale._id!,
          campaignId: campaign._id!,
          holdingId: stock._id!,
          symbol: stock.symbol,
          account,
          date: sale.date,
          bought: stock.buyDate,
          shares: sale.shares,
          proceeds: sale.shares * sale.price - (sale.fee || 0),
          basis: sale.shares * getCostPerShare(stock),
          gain,
          term,
          excluded,
        });
        if (!excluded) result[term === 'long' ? 'longTerm' : 'shortTerm'] += gain;
      }
    }
  }
  // Sums of float products drift (2340.100000000001); totals are dollars and cents.
  result.shortTerm = Math.round(result.shortTerm * 100) / 100;
  result.longTerm = Math.round(result.longTerm * 100) / 100;
  return result;
}
export const emptyPortfolio = (): TaxPortfolio => ({
  shortTerm: 0,
  longTerm: 0,
  sales: [],
  holdings: [],
  locations: [],
  warnings: [],
});
