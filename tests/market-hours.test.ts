import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsMarketOpen, isUsSessionSymbol, lastUsMarketClose, quoteIsCurrent } from '@/lib/marketHours';

const at = (iso: string) => Date.parse(iso);
const MINUTE = 60_000;

test('market is open 9:30–16:15 ET on weekdays, in both standard and daylight time', () => {
  // Tue 2026-11-24 is EST (UTC-5): 9:30 ET = 14:30Z, 16:15 ET = 21:15Z.
  assert.equal(isUsMarketOpen(at('2026-11-24T14:29:00Z')), false);
  assert.equal(isUsMarketOpen(at('2026-11-24T14:30:00Z')), true);
  assert.equal(isUsMarketOpen(at('2026-11-24T21:14:00Z')), true);
  assert.equal(isUsMarketOpen(at('2026-11-24T21:15:00Z')), false);
  // Wed 2026-07-15 is EDT (UTC-4): 9:30 ET = 13:30Z.
  assert.equal(isUsMarketOpen(at('2026-07-15T13:29:00Z')), false);
  assert.equal(isUsMarketOpen(at('2026-07-15T13:30:00Z')), true);
  assert.equal(isUsMarketOpen(at('2026-07-15T20:14:00Z')), true);
  assert.equal(isUsMarketOpen(at('2026-07-15T20:15:00Z')), false);
  // Saturday midday.
  assert.equal(isUsMarketOpen(at('2026-11-21T17:00:00Z')), false);
});

test('last close is the most recent weekday 16:15 ET', () => {
  // During Tuesday's session the last close is Monday's.
  assert.equal(lastUsMarketClose(at('2026-11-24T18:00:00Z')), at('2026-11-23T21:15:00Z'));
  // Tuesday evening: today's close.
  assert.equal(lastUsMarketClose(at('2026-11-25T01:00:00Z')), at('2026-11-24T21:15:00Z'));
  // Over the weekend and before Monday's open: Friday's close.
  assert.equal(lastUsMarketClose(at('2026-11-22T12:00:00Z')), at('2026-11-20T21:15:00Z'));
  assert.equal(lastUsMarketClose(at('2026-11-23T13:00:00Z')), at('2026-11-20T21:15:00Z'));
  // Daylight time.
  assert.equal(lastUsMarketClose(at('2026-07-15T23:00:00Z')), at('2026-07-15T20:15:00Z'));
});

test('only plain US tickers follow the US session', () => {
  for (const symbol of ['AAPL', 'brk.b', 'BF-B', 'FZROX']) assert.equal(isUsSessionSymbol(symbol), true, symbol);
  for (const symbol of ['BINANCE:BTCUSDT', 'BTC-USD', 'SHOP.TO', 'EURUSD=X', 'GC=F', '^GSPC']) {
    assert.equal(isUsSessionSymbol(symbol), false, symbol);
  }
});

test('after the close, a post-close stock quote is reused for up to an hour', () => {
  const saturday = at('2026-11-21T17:00:00Z');
  const saturdayEarlier = saturday - 50 * MINUTE;
  const saturdayLonger = saturday - 61 * MINUTE;
  const fridayBeforeClose = at('2026-11-20T20:00:00Z');

  assert.equal(quoteIsCurrent('AAPL', saturdayEarlier, 30_000, saturday), true);
  // Fund NAVs post hours after the bell, so a quote from right after the close
  // must not be pinned for the whole weekend.
  assert.equal(quoteIsCurrent('FZROX', at('2026-11-20T21:16:00Z'), 30_000, saturday), false);
  assert.equal(quoteIsCurrent('AAPL', saturdayLonger, 30_000, saturday), false);
  assert.equal(quoteIsCurrent('AAPL', fridayBeforeClose, 30_000, at('2026-11-20T21:30:00Z')), false);
  // Crypto trades all weekend, so it only gets maxAge.
  assert.equal(quoteIsCurrent('BINANCE:BTCUSDT', saturdayEarlier, 30_000, saturday), false);
  // Monday's open makes the weekend quote stale again.
  assert.equal(quoteIsCurrent('AAPL', at('2026-11-23T14:00:00Z'), 30_000, at('2026-11-23T14:31:00Z')), false);
  // While open, maxAge rules.
  const open = at('2026-11-24T16:00:00Z');
  assert.equal(quoteIsCurrent('AAPL', open - 20_000, 30_000, open), true);
  assert.equal(quoteIsCurrent('AAPL', open - 2 * MINUTE, 30_000, open), false);
});
