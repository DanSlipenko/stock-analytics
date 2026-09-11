import { PriceAlert } from "@/types";
import { formatUsd } from "@/lib/campaignFormat";

/* "$150.00" for a price target, "5%" for a percentage one. */
export const formatAlertTarget = (alert: Pick<PriceAlert, "targetPrice" | "targetPercent">) =>
  alert.targetPrice != null ? formatUsd(alert.targetPrice) : `${alert.targetPercent}%`;

export const formatAlertDirection = (type: PriceAlert["type"]) => (type === "above" ? "Goes above" : "Drops below");
