/**
 * Campaign performance over time.
 *
 * The summary panel answers "where does this campaign stand right now"; this
 * answers "how did it get here". Everything below is pure: the caller supplies
 * daily closes (see `useCampaignHistory`) and live quotes, and gets back one
 * point per day with the campaign's P&L, market value and cost at that date.
 *
 * Two rules shape the maths:
 *
 * 1. Days are bucketed by their UTC date key, candles and trades alike. Yahoo
 *    stamps a daily bar at the exchange's open and Binance at 00:00 UTC, so a
 *    UTC key lands both on the trading day they belong to.
 * 2. A missing close is forward-filled from the last one known. Stocks have no
 *    weekend bars, crypto does, and a campaign holding both needs one shared
 *    axis.
 */

import { Campaign, CampaignStock } from "@/types";
import { snapRemaining } from "@/lib/shares";
import { TIME_RANGES, type TimeRange } from "@/components/charts/timeRanges";

const DAY_MS = 86_400_000;

/** Enough to find a prior close across a holiday week, or a prior weekly bar. */
const LOOKBACK_DAYS = 21;

/**
 * Above this span the history is pulled weekly. Binance caps a request at 1000
 * candles, so a multi-year daily pull would silently lose its recent end —
 * exactly the part that matters — and 1000 weekly bars cover 19 years.
 */
const WEEKLY_ABOVE_DAYS = 730;

export type Resolution = "D" | "W";

export type DailyClose = { day: string; close: number };

/** One `/api/stock/candles` call: a symbol and how far back it needs to go. */
export type HistoryRequest = { symbol: string; from: number };

export type PerformanceWindow = {
  /** The range this window was built for, so a readout can name the period it
   * is actually showing rather than the one just clicked. */
  range: TimeRange;
  /** First day the chart shows. */
  fromDay: string;
  /** Last day the chart shows, always today. */
  today: string;
  resolution: Resolution;
  /** The range reaches further back than the first buy, so the period is named
   * by that date rather than by the range. */
  clipped: boolean;
  requests: HistoryRequest[];
  /** Identity of the data this window needs; the fetch hook keys off it. */
  key: string;
};

export type PerformancePoint = {
  day: string;
  /** UTC midnight in seconds — what the chart's time axis takes. */
  time: number;
  /** Realized plus unrealized, each lot measured against its buy price. */
  pnl: number;
  /** Market value of the shares still held. */
  value: number;
  /** What those held shares cost. */
  invested: number;
  /** Cost of every share bought up to this day, sold ones included. */
  costBasis: number;
};

export type PerformanceSeries = {
  /**
   * The day before the window opens. Every period figure is measured from here,
   * the way a stock chart measures from the previous close. On a window clipped
   * to the first buy it is a campaign that doesn't exist yet: all zeroes.
   */
  baseline: PerformancePoint;
  /** The baseline first, then one point per day that has a close, then today. */
  points: PerformancePoint[];
};

export type PerformanceMode = "pnl" | "value";

export type PerformanceExtreme = { day: string; value: number };

export type PerformanceSummary = {
  high: PerformanceExtreme;
  low: PerformanceExtreme;
  /** Biggest one-step gain and loss in P&L — the market's work. Deposits move
   * value and cost together, so they never show up here. */
  best: PerformanceExtreme;
  worst: PerformanceExtreme;
};

type Lot = {
  stock: CampaignStock;
  buyDay: string;
  sells: { day: string; shares: number; price: number }[];
  /** Day the lot's last share was sold; null while any share is held. */
  soldOutDay: string | null;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** `YYYY-MM-DD` in UTC, or null when the input isn't a usable date. */
export function toDayKey(value: string | number | Date): string | null {
  const ms =
    value instanceof Date ? value.getTime()
    : typeof value === "number" ? value
    : Date.parse(value);

  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

const dayKeyToMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

const previousDayKey = (day: string) => toDayKey(dayKeyToMs(day) - DAY_MS)!;

function toLots(campaign: Campaign): Lot[] {
  return campaign.stocks.flatMap((stock) => {
    const buyDay = toDayKey(stock.buyDate);
    if (!buyDay) return [];

    const sells = stock.transactions
      .flatMap((transaction) => {
        const day = toDayKey(transaction.date);
        return day ? [{ day, shares: transaction.shares, price: transaction.price }] : [];
      })
      .sort((a, b) => a.day.localeCompare(b.day));

    let sold = 0;
    let soldOutDay: string | null = null;
    for (const sell of sells) {
      sold += sell.shares;
      if (snapRemaining(stock.shares, sold) <= 0) {
        soldOutDay = sell.day;
        break;
      }
    }

    return [{ stock, buyDay, sells, soldOutDay }];
  });
}

/**
 * What the chart covers and which history it needs, or null for a campaign with
 * nothing bought yet.
 */
export function getPerformanceWindow(campaign: Campaign, range: TimeRange, nowMs: number = Date.now()): PerformanceWindow | null {
  const today = toDayKey(nowMs)!;
  const lots = toLots(campaign).filter((lot) => lot.buyDay <= today);
  if (lots.length === 0) return null;

  const firstBuyMs = Math.min(...lots.map((lot) => dayKeyToMs(lot.buyDay)));
  const rangeSeconds = TIME_RANGES.find((entry) => entry.key === range)?.seconds ?? 0;
  const rangeStartMs = range === "ALL" ? firstBuyMs : nowMs - rangeSeconds * 1000;
  const fromDay = toDayKey(Math.min(Math.max(rangeStartMs, firstBuyMs), nowMs))!;
  const clipped = firstBuyMs >= rangeStartMs;

  const resolution: Resolution = dayKeyToMs(today) - dayKeyToMs(fromDay) > WEEKLY_ABOVE_DAYS * DAY_MS ? "W" : "D";

  // One request per symbol, from the earliest day one of its lots is still held
  // inside the window. A lot sold out before the window opened contributes only
  // realized P&L, which needs no price at all.
  const starts = new Map<string, string>();
  for (const lot of lots) {
    const from = lot.buyDay > fromDay ? lot.buyDay : fromDay;
    if (lot.soldOutDay !== null && lot.soldOutDay <= from) continue;

    const current = starts.get(lot.stock.symbol);
    if (current === undefined || from < current) starts.set(lot.stock.symbol, from);
  }

  const requests = [...starts.entries()]
    .map(([symbol, from]) => ({
      symbol,
      // The lookback gives the first day a close to be measured against.
      from: Math.floor((dayKeyToMs(from) - LOOKBACK_DAYS * DAY_MS) / 1000),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    range,
    fromDay,
    today,
    resolution,
    clipped,
    requests,
    key: `${resolution}|${requests.map((request) => `${request.symbol}@${request.from}`).join(",")}`,
  };
}

/**
 * The campaign valued once per day across the window.
 *
 * Today's point prefers the live quote, so the chart's last value agrees with
 * the summary panel above it. A symbol whose history failed to load falls back
 * to its buy price, which shows as no unrealized gain rather than a false one.
 */
export function buildPerformanceSeries(
  campaign: Campaign,
  history: Record<string, DailyClose[]>,
  quotes: Record<string, { currentPrice?: number } | undefined>,
  bounds: Pick<PerformanceWindow, "fromDay" | "today">,
): PerformanceSeries | null {
  const lots = toLots(campaign).filter((lot) => lot.buyDay <= bounds.today);
  if (lots.length === 0) return null;

  const days = new Set<string>([previousDayKey(bounds.fromDay), bounds.today]);
  for (const closes of Object.values(history)) {
    for (const close of closes) {
      if (close.day >= bounds.fromDay && close.day <= bounds.today) days.add(close.day);
    }
  }
  const axis = [...days].sort();

  const symbols = Object.keys(history);
  const cursors = new Map(symbols.map((symbol) => [symbol, 0]));
  const lastClose = new Map<string, number>();

  const points = axis.map<PerformancePoint>((day) => {
    // Forward-fill: take every close up to and including this day, keep the last.
    for (const symbol of symbols) {
      const closes = history[symbol];
      let cursor = cursors.get(symbol)!;
      while (cursor < closes.length && closes[cursor].day <= day) {
        lastClose.set(symbol, closes[cursor].close);
        cursor += 1;
      }
      cursors.set(symbol, cursor);
    }

    const live = day === bounds.today;
    let pnl = 0;
    let value = 0;
    let invested = 0;
    let costBasis = 0;

    for (const lot of lots) {
      if (lot.buyDay > day) continue;

      const { stock } = lot;
      let sold = 0;
      let realized = 0;
      for (const sell of lot.sells) {
        if (sell.day > day) break;
        sold += sell.shares;
        realized += sell.shares * (sell.price - stock.buyPrice);
      }

      const held = snapRemaining(stock.shares, sold);
      const quoted = live ? quotes[stock.symbol]?.currentPrice : undefined;
      const price = isFiniteNumber(quoted) ? quoted : (lastClose.get(stock.symbol) ?? stock.buyPrice);

      pnl += realized + held * (price - stock.buyPrice);
      value += held * price;
      invested += held * stock.buyPrice;
      // Every share bought, so a sale doesn't shrink the denominator.
      costBasis += stock.shares * stock.buyPrice;
    }

    return { day, time: Math.floor(dayKeyToMs(day) / 1000), pnl, value, invested, costBasis };
  });

  return { baseline: points[0], points };
}

/** What the chart plots: P&L since the window opened, or money in stocks. */
export const metricAt = (point: PerformancePoint, mode: PerformanceMode, baseline: PerformancePoint) =>
  mode === "pnl" ? point.pnl - baseline.pnl : point.value;

/**
 * The window's gain against the capital it was earned on: what was already in
 * stocks when the window opened, plus what was bought inside it.
 */
export function periodReturnPercent(point: PerformancePoint, baseline: PerformancePoint) {
  const deployed = baseline.value + (point.costBasis - baseline.costBasis);
  return deployed > 0 ? ((point.pnl - baseline.pnl) / deployed) * 100 : 0;
}

/** How far the held shares sit above or below what they cost. */
export const unrealizedPercent = (point: PerformancePoint) =>
  point.invested > 0 ? ((point.value - point.invested) / point.invested) * 100 : 0;

/** Extremes inside the window. The baseline day sits outside it, so it's skipped. */
export function summarizePerformance(series: PerformanceSeries, mode: PerformanceMode): PerformanceSummary | null {
  const { points, baseline } = series;
  if (points.length < 2) return null;

  const metric = (point: PerformancePoint) => metricAt(point, mode, baseline);
  const step = (index: number) => points[index].pnl - points[index - 1].pnl;

  let high = 1;
  let low = 1;
  let best = 1;
  let worst = 1;

  for (let index = 2; index < points.length; index += 1) {
    if (metric(points[index]) > metric(points[high])) high = index;
    if (metric(points[index]) < metric(points[low])) low = index;
    if (step(index) > step(best)) best = index;
    if (step(index) < step(worst)) worst = index;
  }

  return {
    high: { day: points[high].day, value: metric(points[high]) },
    low: { day: points[low].day, value: metric(points[low]) },
    best: { day: points[best].day, value: step(best) },
    worst: { day: points[worst].day, value: step(worst) },
  };
}
