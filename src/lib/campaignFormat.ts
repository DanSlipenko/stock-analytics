import { Campaign } from "@/types";

export const formatUsd = (value: number, digits = 2) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const formatSignedUsd = (value: number) => `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatUsd(Math.abs(value))}`;

export const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/* "May 20" this year, "Dec 1, 2025" otherwise. */
export const formatStartDate = (value: string) => {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};

export const formatStockSummary = (activeStockCount: number, stockCount: number) =>
  activeStockCount > 0 ? `${activeStockCount} of ${stockCount} active` : pluralize(stockCount, "stock");

/* The line under a campaign's name: "12 of 15 active · 4 locations · Started May 20". */
export const getCampaignMetaParts = (campaign: Campaign, activeStockCount: number) => [
  formatStockSummary(activeStockCount, campaign.stocks.length),
  pluralize(campaign.moneyLocations.length, "location"),
  ...(campaign.startDate ? [`Started ${formatStartDate(campaign.startDate)}`] : []),
];
