import { Campaign, CampaignStock, MoneyLocation, StockQuote } from "@/types";
import { calculateCampaignStats, calculateCampaignAnnualPnL } from "@/lib/campaignStats";

export type LastDayMovement = {
  value: number;
  percentage: number;
};

// A campaign stock enriched with where it lives (campaign + money location).
export type AssetStock = CampaignStock & {
  campaignId: string;
  campaignName: string;
};

export type AssetGroup = {
  key: string;
  slug: string;
  name: string;
  stocks: AssetStock[];
};

// The built-in institutions / assets available everywhere.
export const DEFAULT_ASSETS = [
  "Fidelity Personal Dan",
  "Fidelity Roth Dan",
  "Fidelity Roth Clara",
  "HSA",
  "Kraken",
  "Pay Pal",
];

// The asset an account represents is identified by its own name (each account
// the user created is kept distinct); we fall back to the type only when a
// location somehow has no name.
export const institutionOf = (location?: Pick<MoneyLocation, "name" | "type">) =>
  location?.name?.trim() || location?.type?.trim() || "Unassigned";

export const formatCurrency = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const slugify = (value: string) =>
  value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "unassigned";

// Normalize an asset/institution name so different spellings collapse together.
export const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

// Group all holdings by the asset (institution) they belong to.
export function buildAssetGroups(campaigns: Campaign[]): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();

  campaigns.forEach((campaign) => {
    const locationsById = new Map<string, MoneyLocation>();
    campaign.moneyLocations.forEach((location) => {
      if (location._id) locationsById.set(location._id, location);
    });

    campaign.stocks.forEach((stock) => {
      const location = stock.locationId ? locationsById.get(stock.locationId) : undefined;
      const institution = location ? institutionOf(location) : "Unassigned";
      const key = normalizeName(institution);

      if (!groups.has(key)) {
        groups.set(key, { key, slug: slugify(key), name: institution, stocks: [] });
      }

      groups.get(key)!.stocks.push({
        ...stock,
        campaignId: campaign._id || "",
        campaignName: campaign.name,
      });
    });
  });

  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// The list of assets available to pick: built-ins + registered + any already in use.
export function assetOptions(campaigns: Campaign[], registeredAssetNames: string[] = []): string[] {
  const byNorm = new Map<string, string>();
  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const norm = normalizeName(trimmed);
    if (!byNorm.has(norm)) byNorm.set(norm, trimmed);
  };

  DEFAULT_ASSETS.forEach(add);
  registeredAssetNames.forEach(add);
  campaigns.forEach((campaign) =>
    campaign.moneyLocations.forEach((location) => add(institutionOf(location))),
  );

  return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b));
}

// Generate a client-side ObjectId-compatible hex string so we can link a new
// money location to a stock within a single save.
export function newObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, "0");
  const random = "xxxxxxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  return timestamp + random;
}

// Ensure the campaign has a money location for the chosen asset; return the
// locationId to use plus the (possibly extended) money locations array.
export function resolveAssetLocation(
  campaign: Campaign,
  institution: string,
): { locationId: string; moneyLocations: MoneyLocation[] } {
  const norm = normalizeName(institution);
  const existing = campaign.moneyLocations.find(
    (location) => normalizeName(institutionOf(location)) === norm,
  );

  if (existing?._id) {
    return { locationId: existing._id, moneyLocations: campaign.moneyLocations };
  }

  const _id = newObjectId();
  const newLocation: MoneyLocation = { _id, name: institution, type: institution };
  return { locationId: _id, moneyLocations: [...campaign.moneyLocations, newLocation] };
}

export const findAssetGroup = (campaigns: Campaign[], slug: string): AssetGroup | undefined =>
  buildAssetGroups(campaigns).find((group) => group.slug === slug);

// Rename an asset/account everywhere it's used. Locations matching the source
// name are renamed to the target (name + type kept in sync). If a campaign ends
// up with duplicate target locations, they're merged and stocks repointed.
// Renaming to an existing asset name therefore also merges accounts.
export function planRenameAsset(campaigns: Campaign[], fromNormalized: string, toName: string): Campaign[] {
  const toNorm = normalizeName(toName);
  const updated: Campaign[] = [];

  campaigns.forEach((campaign) => {
    const hasMatch = campaign.moneyLocations.some((loc) => normalizeName(institutionOf(loc)) === fromNormalized);
    if (!hasMatch) return;

    let locations = campaign.moneyLocations.map((loc) =>
      normalizeName(institutionOf(loc)) === fromNormalized ? { ...loc, name: toName, type: toName } : loc,
    );

    let stocks = campaign.stocks;

    const matches = locations.filter((loc) => normalizeName(institutionOf(loc)) === toNorm);
    if (matches.length > 1) {
      const keeperId = matches[0]._id;
      const removedIds = new Set(matches.slice(1).map((loc) => loc._id).filter(Boolean) as string[]);

      stocks = campaign.stocks.map((stock) =>
        stock.locationId && removedIds.has(stock.locationId) && keeperId ? { ...stock, locationId: keeperId } : stock,
      );
      locations = locations.filter((loc) => !(loc._id && removedIds.has(loc._id)));
    }

    updated.push({ ...campaign, moneyLocations: locations, stocks });
  });

  return updated;
}

// Reuse the campaign P&L math by treating an arbitrary stock list as a pseudo campaign.
const asPseudoCampaign = (stocks: CampaignStock[]) => ({ stocks } as unknown as Campaign);

export const statsForStocks = (stocks: CampaignStock[], quotes: Record<string, StockQuote>) =>
  calculateCampaignStats(asPseudoCampaign(stocks), quotes);

export const annualForStocks = (
  stocks: CampaignStock[],
  quotes: Record<string, StockQuote>,
  yearStartPrices: Record<string, number>,
) => calculateCampaignAnnualPnL(asPseudoCampaign(stocks), quotes, yearStartPrices);

// ---- Per-stock helpers ----

export const getSoldShares = (stock: CampaignStock) =>
  stock.transactions.reduce((sum, transaction) => sum + transaction.shares, 0);

export const getRemainingShares = (stock: CampaignStock) => Math.max(stock.shares - getSoldShares(stock), 0);

export const isSoldOut = (stock: CampaignStock) => getRemainingShares(stock) <= 0;

export const getRealizedPnL = (stock: CampaignStock) =>
  stock.transactions.reduce((sum, transaction) => sum + transaction.shares * (transaction.price - stock.buyPrice), 0);

export const getRealizedPnLPercent = (stock: CampaignStock) => {
  const sold = getSoldShares(stock);
  if (sold <= 0) return 0;
  const costBasis = sold * stock.buyPrice;
  return costBasis > 0 ? (getRealizedPnL(stock) / costBasis) * 100 : 0;
};

export const getAverageSoldPrice = (stock: CampaignStock) => {
  const sold = getSoldShares(stock);
  if (sold <= 0) return null;
  const proceeds = stock.transactions.reduce((sum, transaction) => sum + transaction.shares * transaction.price, 0);
  return proceeds / sold;
};

export const sortStarredFirst = <T extends CampaignStock>(stocks: T[]) =>
  [...stocks].sort((a, b) => Number(Boolean(b.isStarred)) - Number(Boolean(a.isStarred)));

export const getQuoteLastDayMovement = (quote?: StockQuote): LastDayMovement | null => {
  if (!quote) return null;
  const change =
    isFiniteNumber(quote.change) ? quote.change
    : isFiniteNumber(quote.currentPrice) && isFiniteNumber(quote.previousClose) ? quote.currentPrice - quote.previousClose
    : null;

  if (change == null) return null;

  const percentage =
    isFiniteNumber(quote.percentChange) ? quote.percentChange
    : isFiniteNumber(quote.previousClose) && quote.previousClose !== 0 ? (change / quote.previousClose) * 100
    : 0;

  return { value: change, percentage };
};

export const getLastDayMovement = (stock: CampaignStock, quote?: StockQuote): LastDayMovement | null => {
  const remainingShares = getRemainingShares(stock);
  const movement = getQuoteLastDayMovement(quote);
  if (remainingShares <= 0 || !movement) return null;

  return { value: remainingShares * movement.value, percentage: movement.percentage };
};

export const getDisplayLastDayMovement = (stock: CampaignStock, quote?: StockQuote): LastDayMovement | null =>
  getLastDayMovement(stock, quote) ?? getQuoteLastDayMovement(quote);

export const lastDayForStocks = (
  stocks: CampaignStock[],
  quotes: Record<string, StockQuote>,
): LastDayMovement => {
  const totals = stocks.reduce(
    (acc, stock) => {
      const quote = quotes[stock.symbol];
      const movement = getLastDayMovement(stock, quote);
      if (!movement) return acc;
      const remainingShares = getRemainingShares(stock);
      const previousValue = isFiniteNumber(quote?.previousClose) ? remainingShares * quote.previousClose : 0;
      return { value: acc.value + movement.value, basis: acc.basis + previousValue };
    },
    { value: 0, basis: 0 },
  );
  return { value: totals.value, percentage: totals.basis > 0 ? (totals.value / totals.basis) * 100 : 0 };
};
