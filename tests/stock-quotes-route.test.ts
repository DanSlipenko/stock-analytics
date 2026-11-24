import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/stock/quotes/route';

// The test runner doesn't load .env, so FINNHUB_API_KEY is unset and the quote
// library answers with mock prices: this exercises the route's parsing and
// validation without touching the network.
const live = Boolean(process.env.FINNHUB_API_KEY);

const call = (query: string) => GET(new NextRequest(`http://localhost/api/stock/quotes${query}`));

test('returns one quote per requested symbol, upper-cased and de-duplicated', { skip: live && 'FINNHUB_API_KEY is set' }, async () => {
  const res = await call('?symbols=aapl,MSFT,AAPL');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body.quotes).sort(), ['AAPL', 'MSFT']);
  assert.equal(typeof body.quotes.AAPL.currentPrice, 'number');
});

test('rejects a missing, oversized or entirely malformed symbol list', async () => {
  assert.equal((await call('')).status, 400);
  assert.equal((await call('?symbols=')).status, 400);
  const tooMany = Array.from({ length: 51 }, (_, i) => `S${i}`).join(',');
  assert.equal((await call(`?symbols=${tooMany}`)).status, 400);
  assert.equal((await call(`?symbols=${encodeURIComponent('<script>')}`)).status, 400);
});

test('a malformed symbol is dropped without failing the rest', { skip: live && 'FINNHUB_API_KEY is set' }, async () => {
  const res = await call(`?symbols=${encodeURIComponent('AAPL,<script>')}`);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys((await res.json()).quotes), ['AAPL']);
});
