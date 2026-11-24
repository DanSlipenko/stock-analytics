/**
 * US equity session timing, so price polling can sit out the hours when a stock
 * quote cannot change.
 *
 * Exchange holidays aren't modelled: on one, the app polls through an idle
 * session, which costs a few requests and changes nothing.
 */

const ET = 'America/New_York';

/** Regular session 9:30–16:00 ET, plus a margin after the bell for the closing
 * auction print to reach the quote feeds. In minutes after ET midnight. */
const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60 + 15;

const HOUR = 60 * 60 * 1000;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

type EtParts = { year: number; month: number; day: number; minutes: number };

function etParts(ms: number): EtParts {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(ms)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, minutes: parts.hour * 60 + parts.minute };
}

/** Day of week for an ET calendar date, 0 = Sunday. */
function weekdayOf(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Epoch ms of a wall-clock time in New York. ET is UTC-5 or UTC-4; try the
 * standard offset and step back an hour if that lands on daylight time. DST
 * switches at 2am, so the afternoon times used here are never ambiguous. */
function etWallTimeToEpoch(year: number, month: number, day: number, minutes: number) {
  const standard = Date.UTC(year, month - 1, day, 5, minutes);
  return etParts(standard).minutes === minutes ? standard : standard - HOUR;
}

/**
 * True for symbols that only trade in the US regular session: plain tickers
 * with an optional one-letter share class (AAPL, BRK.B, BF-B). Everything else —
 * crypto, forex, futures, indices, foreign listings — keeps its own hours, so
 * it is never treated as closed.
 */
export function isUsSessionSymbol(symbol: string) {
  return /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(symbol.trim().toUpperCase());
}

export function isUsMarketOpen(now = Date.now()) {
  const { year, month, day, minutes } = etParts(now);
  const weekday = weekdayOf(year, month, day);
  return weekday >= 1 && weekday <= 5 && minutes >= OPEN_MINUTE && minutes < CLOSE_MINUTE;
}

/** The most recent weekday close (16:15 ET) at or before `now`. */
export function lastUsMarketClose(now = Date.now()) {
  const today = etParts(now);
  for (let back = 0; back < 7; back += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (back === 0 && today.minutes < CLOSE_MINUTE) continue;
    return etWallTimeToEpoch(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), CLOSE_MINUTE);
  }
  // Unreachable: any seven consecutive days include a weekday.
  return now;
}

/** After the close, how long a post-close quote is reused. Stock closes settle
 * within minutes, but mutual fund NAVs post hours later, so an after-close quote
 * can't be trusted until the next open. */
export const AFTER_CLOSE_MAX_AGE = 60 * 60 * 1000;

/**
 * Whether a quote stored at `storedAt` still shows the current price.
 *
 * While the market is open that means younger than `maxAge`. Once it closes, a
 * quote fetched after the close is reused for up to an hour, so a page left open
 * overnight or over the weekend asks about stocks once an hour instead of every
 * minute, without any timer having to know about market hours.
 */
export function quoteIsCurrent(symbol: string, storedAt: number, maxAge: number, now = Date.now()) {
  const age = now - storedAt;
  if (age < maxAge) return true;
  if (!isUsSessionSymbol(symbol) || isUsMarketOpen(now)) return false;
  return storedAt >= lastUsMarketClose(now) && age < AFTER_CLOSE_MAX_AGE;
}
