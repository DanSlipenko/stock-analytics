import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { applyMutation, emptyPlan, errorMessage, mutationSchema, planSchema, type IncomeEntry } from '@/lib/tax/schema';
import { isLongTerm, longTermFrom, portfolioForTax } from '@/lib/tax/portfolio';
import { csvRows, parseIncomeCsv, parseMoney, suggestDocumentIncome } from '@/lib/tax/import';
import type { Campaign } from '@/types';

const entry = (id: string, month: number, extra: Partial<IncomeEntry> = {}): IncomeEntry => ({
  id,
  source: 'Acme',
  kind: 'w2',
  owner: 'taxpayer',
  month,
  status: 'actual',
  amount: 5_000,
  expenses: 0,
  withholding: 0,
  notes: '',
  ...extra,
});

test('a profile update merges instead of resetting omitted settings', () => {
  let plan = applyMutation(emptyPlan(2026), {
    action: 'profile',
    profile: { confirmed: true, excludedLocationIds: ['roth'], estimatedPayments: 4_000 },
  });
  // What an MCP client sends when asked to change only the filing status.
  const mutation = mutationSchema.parse({ action: 'profile', profile: { filingStatus: 'joint' } });
  plan = applyMutation(plan, mutation);
  assert.equal(plan.profile.filingStatus, 'joint');
  assert.equal(plan.profile.confirmed, true);
  assert.deepEqual(plan.profile.excludedLocationIds, ['roth']);
  assert.equal(plan.profile.estimatedPayments, 4_000);
});

test('unknown profile settings are rejected', () => {
  assert.throws(() => mutationSchema.parse({ action: 'profile', profile: { filingstatus: 'joint' } }));
});

test('plans saved before a profile field existed still load', () => {
  const plan = planSchema.parse({ year: 2026, profile: { filingStatus: 'head' } });
  assert.equal(plan.profile.filingStatus, 'head');
  assert.equal(plan.profile.stockSource, 'portfolio');
});

test('income upserts by ID and deletes only the named entry', () => {
  let plan = applyMutation(emptyPlan(2026), { action: 'income', entries: [entry('jan', 1), entry('feb', 2)] });
  plan = applyMutation(plan, { action: 'income', entries: [entry('jan', 1, { amount: 6_000 })] });
  assert.equal(plan.income.length, 2);
  assert.equal(plan.income.find((r) => r.id === 'jan')?.amount, 6_000);
  plan = applyMutation(plan, { action: 'deleteIncome', id: 'feb' });
  assert.deepEqual(
    plan.income.map((r) => r.id),
    ['jan'],
  );
});

test('an annual total cannot overlap monthly entries from the same payer', () => {
  const plan = applyMutation(emptyPlan(2026), { action: 'income', entries: [entry('jan', 1)] });
  assert.throws(() => applyMutation(plan, { action: 'income', entries: [entry('year', 0)] }), /overlapping/);
  // A different payer is fine.
  applyMutation(plan, { action: 'income', entries: [entry('other', 0, { source: 'Globex' })] });
});

test('reported 1099-B gains require switching off portfolio gains first', () => {
  const gain = entry('gain', 0, { kind: 'longTerm', source: 'Broker' });
  assert.throws(() => applyMutation(emptyPlan(2026), { action: 'income', entries: [gain] }), /reported totals/);
  const reported = applyMutation(emptyPlan(2026), { action: 'profile', profile: { stockSource: 'reported' } });
  assert.equal(applyMutation(reported, { action: 'income', entries: [gain] }).income.length, 1);
});

test('spouse income requires a joint return', () => {
  assert.throws(
    () => applyMutation(emptyPlan(2026), { action: 'income', entries: [entry('s', 0, { owner: 'spouse' })] }),
    /jointly/,
  );
});

test('validation errors read as sentences, not JSON', () => {
  const result = z.object({ amount: z.number().min(0) }).safeParse({ amount: -1 });
  assert.ok(!result.success);
  assert.match(errorMessage(result.error, 'x'), /^amount: /);
  assert.equal(errorMessage(new Error('Plain'), 'x'), 'Plain');
  assert.equal(errorMessage('nope', 'Fallback'), 'Fallback');
});

test('a lot turns long-term the day after its one-year anniversary', () => {
  assert.equal(longTermFrom('2025-12-01T00:00:00.000Z'), '2026-12-02');
  assert.equal(isLongTerm('2025-03-15', '2026-03-15'), false);
  assert.equal(isLongTerm('2025-03-15', '2026-03-16'), true);
  // Bought on a leap day: the anniversary falls on February 28.
  assert.equal(longTermFrom('2024-02-29'), '2025-03-01');
});

test('portfolio sales in the tax year split into short- and long-term, skipping excluded accounts', () => {
  const campaigns = [
    {
      _id: 'c1',
      name: 'Core',
      startDate: '2024-01-01',
      moneyLocations: [
        { _id: 'brokerage', name: 'Brokerage', type: 'Brokerage' },
        { _id: 'roth', name: 'Roth IRA', type: 'Roth IRA' },
      ],
      stocks: [
        {
          _id: 's1',
          symbol: 'NVDA',
          shares: 40,
          buyPrice: 85,
          buyDate: '2024-03-12',
          locationId: 'brokerage',
          transactions: [{ _id: 't1', type: 'sell', shares: 15, price: 180, date: '2026-02-20', percentSold: 37.5 }],
        },
        {
          _id: 's2',
          symbol: 'AMD',
          shares: 50,
          buyPrice: 160,
          buyFee: 5,
          buyDate: '2025-10-01',
          locationId: 'brokerage',
          transactions: [
            { _id: 't2', type: 'sell', shares: 50, price: 210, fee: 5, date: '2026-05-14', percentSold: 100 },
          ],
        },
        {
          _id: 's3',
          symbol: 'MSFT',
          shares: 10,
          buyPrice: 300,
          buyDate: '2023-05-01',
          locationId: 'roth',
          transactions: [{ _id: 't3', type: 'sell', shares: 5, price: 420, date: '2026-04-01', percentSold: 50 }],
        },
        {
          _id: 's4',
          symbol: 'VOO',
          shares: 15,
          buyPrice: 350,
          buyDate: '2022-06-01',
          locationId: 'brokerage',
          transactions: [{ _id: 't4', type: 'sell', shares: 5, price: 500, date: '2025-06-01', percentSold: 33 }],
        },
      ],
    },
  ] as Campaign[];

  const result = portfolioForTax(campaigns, 2026, ['roth']);
  assert.equal(result.longTerm, 15 * (180 - 85));
  // Both fees count: the buy fee raises basis, the sale fee cuts proceeds.
  assert.ok(Math.abs(result.shortTerm - (50 * (210 - 160) - 5 - 5)) < 0.01);
  assert.equal(result.sales.length, 3, 'the 2025 VOO sale belongs to another year');
  assert.equal(result.sales.find((s) => s.symbol === 'MSFT')?.excluded, true);
  assert.deepEqual(
    result.holdings.map((h) => [h.symbol, h.shares, h.longTermFrom]),
    [
      ['NVDA', 25, '2025-03-13'],
      ['MSFT', 5, '2024-05-02'],
      ['VOO', 10, '2023-06-02'],
    ],
  );
});

test('money parsing accepts common formats and rejects ambiguous ones', () => {
  assert.equal(parseMoney('$1,234.56'), 1234.56);
  assert.equal(parseMoney('(500)'), -500);
  assert.throws(() => parseMoney('12.345'));
  assert.throws(() => parseMoney('ten'));
});

test('CSV parsing handles quotes, embedded commas and CRLF', () => {
  assert.deepEqual(csvRows('a,b\r\n"x, y","say ""hi"""\r\n'), [
    ['a', 'b'],
    ['x, y', 'say "hi"'],
  ]);
  assert.throws(() => csvRows('a\n"open'), /unclosed/);
});

test('income CSV rows become validated entries for the selected year only', () => {
  let n = 0;
  const csv = 'year,source,kind,amount,month,status,withholding\n2026,"Acme, Inc.",w2,"10,000.00",1,actual,1500\n';
  const [row] = parseIncomeCsv(csv, 2026, () => `id${++n}`);
  assert.equal(row.source, 'Acme, Inc.');
  assert.equal(row.amount, 10_000);
  assert.equal(row.withholding, 1_500);
  assert.throws(() => parseIncomeCsv(csv, 2025, () => 'x'), /belongs to 2026/);
});

test('document text suggests W-2 amounts only when each label is unambiguous', () => {
  const w2 =
    'Form W-2 Wage and Tax Statement 2026\nWages, tips, other compensation $85,000.00\nFederal income tax withheld $9,100.00';
  assert.deepEqual(suggestDocumentIncome(w2), { kind: 'w2', amount: 85_000, withholding: 9_100, year: 2026 });
  const nec = '1099-NEC 2026 Nonemployee compensation $12,500.00';
  assert.equal(suggestDocumentIncome(nec).kind, 'selfEmployment');
  assert.equal(suggestDocumentIncome(nec).amount, 12_500);
  // 1099-DIV totals include qualified dividends, so the amount is left for the user to split.
  assert.equal(suggestDocumentIncome('1099-DIV Total ordinary dividends $900.00').amount, undefined);
});

test('business expenses upsert by ID, delete by ID, and need a joint return for a spouse', () => {
  const expense = { id: 'e1', description: 'Figma', category: 'software', amount: 180 };
  let plan = applyMutation(emptyPlan(2026), mutationSchema.parse({ action: 'expenses', entries: [expense] }));
  assert.equal(plan.expenses[0].status, 'actual');
  assert.equal(plan.expenses[0].month, 0);
  plan = applyMutation(plan, mutationSchema.parse({ action: 'expenses', entries: [{ ...expense, amount: 240 }] }));
  assert.equal(plan.expenses.length, 1);
  assert.equal(plan.expenses[0].amount, 240);
  assert.throws(
    () =>
      applyMutation(
        plan,
        mutationSchema.parse({ action: 'expenses', entries: [{ ...expense, id: 'e2', owner: 'spouse' }] }),
      ),
    /jointly/,
  );
  plan = applyMutation(plan, { action: 'deleteExpense', id: 'e1' });
  assert.equal(plan.expenses.length, 0);
});

test('plans saved before expenses existed load with an empty list', () => {
  assert.deepEqual(planSchema.parse({ year: 2026 }).expenses, []);
});
