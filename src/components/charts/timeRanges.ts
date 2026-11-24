export type TimeRange = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const TIME_RANGES: { key: TimeRange; label: string; seconds: number }[] = [
  { key: '1W', label: '1W', seconds: 7 * 86400 },
  { key: '1M', label: '1M', seconds: 30 * 86400 },
  { key: '3M', label: '3M', seconds: 90 * 86400 },
  { key: '6M', label: '6M', seconds: 180 * 86400 },
  { key: '1Y', label: '1Y', seconds: 365 * 86400 },
  { key: 'ALL', label: 'ALL', seconds: 5 * 365 * 86400 },
];

const DAY_SECONDS = 86400;

/**
 * End of a daily-candle request, in epoch seconds: the next UTC midnight.
 *
 * Requests used to end at "now", which made every candle URL unique to the
 * second, so neither the server's fetch cache nor the service worker ever got a
 * hit. A day-aligned end is the same all day; the upstreams return bars up to
 * the present either way, and the server cache still refreshes every minute.
 */
export function candleRangeEnd(nowMs = Date.now()) {
  return (Math.floor(nowMs / 1000 / DAY_SECONDS) + 1) * DAY_SECONDS;
}

/** Start of the UTC day containing `seconds`, for day-aligned range starts. */
export function startOfUtcDay(seconds: number) {
  return Math.floor(seconds / DAY_SECONDS) * DAY_SECONDS;
}
