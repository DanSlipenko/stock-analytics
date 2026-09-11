import { CampaignStock, Transaction } from "@/types";

/**
 * Share quantities are floats, and crypto lots carry up to 8 decimals, so the
 * sum of a lot's sells rarely lands exactly on the amount bought. Anything
 * within this fraction of the lot is floating-point noise, not a holding.
 */
const DUST_TOLERANCE = 1e-9;

/** Partial sells are recorded to satoshi precision so crypto lots round-trip. */
const SHARE_DECIMALS = 8;

type StockShares = Pick<CampaignStock, "shares" | "transactions">;

export const getSoldShares = (stock: Pick<CampaignStock, "transactions">) =>
  stock.transactions.reduce((sum, transaction) => sum + transaction.shares, 0);

/**
 * Shares left of `shares` after selling `sold`, clamped at zero and with float
 * noise snapped to zero. Takes the two numbers rather than a lot so a caller
 * replaying a lot's history day by day can ask about a partial set of sells.
 */
export const snapRemaining = (shares: number, sold: number) => {
  const remaining = shares - sold;
  return remaining <= Math.max(Math.abs(shares), 1) * DUST_TOLERANCE ? 0 : remaining;
};

/** Shares still held, clamped at zero and with float noise snapped to zero. */
export const getRemainingShares = (stock: StockShares) => snapRemaining(stock.shares, getSoldShares(stock));

export const isSoldOut = (stock: StockShares) => getRemainingShares(stock) <= 0;

/**
 * Shares to record when selling `percent` of what's left.
 *
 * A full sell returns the exact remainder, unrounded: rounding it is how a
 * "100%" sale of 0.12613208 BTC used to be stored as 0.1261, stranding a
 * sliver that kept the lot listed as open. Partial sells round to 8 decimals
 * and never exceed what's held.
 */
export function sharesForPercent(remaining: number, percent: number): number {
  if (percent >= 100) return remaining;
  const factor = 10 ** SHARE_DECIMALS;
  return Math.min(Math.round(((remaining * percent) / 100) * factor) / factor, remaining);
}

type LotCost = Pick<CampaignStock, "shares" | "buyPrice" | "buyFee">;

/**
 * Cost basis per share: the buy price plus the buy fee spread across the lot.
 * Every P&L figure uses this rather than `buyPrice`, so fees show up as cost.
 */
export const getCostPerShare = (stock: LotCost) =>
  stock.shares > 0 ? stock.buyPrice + (stock.buyFee ?? 0) / stock.shares : stock.buyPrice;

/** Realized P&L of one sale: proceeds net of the sale fee, minus the cost basis of the shares sold. */
export const getSaleRealizedPnL = (stock: LotCost, sale: Pick<Transaction, "shares" | "price" | "fee">) =>
  sale.shares * (sale.price - getCostPerShare(stock)) - (sale.fee ?? 0);

/** Display form: up to 8 decimals, so float noise never renders as 3.2e-5. */
export const formatShares = (shares: number) =>
  shares.toLocaleString(undefined, { maximumFractionDigits: SHARE_DECIMALS });
