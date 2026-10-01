import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTax, monthlySummary } from '@/lib/tax/calculate';
import { businessByMonth, byMonth, defaultStatus, fromGrid, monthResult, splitEvenly, toGrid } from '@/lib/tax/monthly';
import { emptyPortfolio } from '@/lib/tax/portfolio';
import { applyMutation, emptyPlan, type ExpenseEntry, type IncomeEntry } from '@/lib/tax/schema';

let nextId = 0;
function income(kind: IncomeEntry['kind'], amount: number, extra: Partial<IncomeEntry> = {}): IncomeEntry {
  nextId += 1;
  return {
    id: `i${nextId}`,
    source: 'Acme',
    kind,
    owner: 'taxpayer',
    month: 0,
    status: 'actual',
    amount,
    expenses: 0,
    withholding: 0,
    notes: '',
    ...extra,
  };
}

function expense(amount: number, extra: Partial<ExpenseEntry> = {}): ExpenseEntry {
  nextId += 1;
  return {
    id: `e${nextId}`,
    description: 'Hosting',
    category: 'software',
    owner: 'taxpayer',
    month: 0,
    status: 'actual',
    amount,
    notes: '',
    ...extra,
  };
}

const blank = (month: number, status: IncomeEntry['status']) => income('w2', 0, { month, status });

test('full-year income is spread evenly across the twelve months', () => {
  const months = byMonth([income('w2', 60_000, { status: 'projected' })], (r) => r.amount);
  for (const m of months) assert.deepEqual(m, { actual: 0, projected: 5_000 });
});

test('monthly income lands in its own month, alongside a spread full-year total', () => {
  const months = byMonth(
    [income('w2', 12_000), income('selfEmployment', 3_000, { source: 'Gig', month: 3, status: 'projected' })],
    (r) => r.amount,
  );
  assert.deepEqual(months[0], { actual: 1_000, projected: 0 });
  assert.deepEqual(months[2], { actual: 1_000, projected: 3_000 });
});

test('business months pair 1099 income with listed and attached expenses, leaving W-2 wages out', () => {
  const months = businessByMonth(
    [income('w2', 120_000), income('selfEmployment', 2_400, { month: 2, expenses: 200 })],
    [expense(1_200), expense(50, { description: 'Domains', month: 2, status: 'projected' })],
  );
  assert.deepEqual(months[0], { income: { actual: 0, projected: 0 }, expenses: { actual: 100, projected: 0 } });
  assert.deepEqual(months[1], {
    income: { actual: 2_400, projected: 0 },
    expenses: { actual: 300, projected: 50 },
  });
});

test('an even split adds back up to the total', () => {
  const parts = splitEvenly(44_598.38);
  assert.equal(parts[0], 3_716.53);
  assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100, 44_598.38);
});

test('new amounts default to actual for past months and projected for the rest', () => {
  const today = new Date(2026, 9, 1);
  assert.equal(defaultStatus(2026, 9, today), 'actual');
  assert.equal(defaultStatus(2026, 10, today), 'projected');
  assert.equal(defaultStatus(2025, 12, today), 'actual');
  assert.equal(defaultStatus(2027, 1, today), 'projected');
});

test('editing a full-year total splits it into months, each projected or actual', () => {
  const full = income('w2', 60_000, { status: 'projected', withholding: 1_200 });
  const grid = toGrid([full], 2026);
  assert.equal(grid.amount[0], 5_000);
  assert.equal(grid.status[0], 'projected');
  assert.equal(grid.withheld[0], 100);
  grid.amount[0] = 5_100;
  grid.status[0] = 'actual';
  let ids = 0;
  const { entries, remove } = fromGrid([full], grid, blank, () => `n${++ids}`);
  assert.deepEqual(remove, [full.id]);
  assert.equal(entries.length, 12);
  assert.deepEqual(
    { month: entries[0].month, status: entries[0].status, amount: entries[0].amount },
    { month: 1, status: 'actual', amount: 5_100 },
  );
  assert.deepEqual(
    {
      month: entries[1].month,
      status: entries[1].status,
      amount: entries[1].amount,
      withholding: entries[1].withholding,
    },
    { month: 2, status: 'projected', amount: 5_000, withholding: 100 },
  );
});

test('a month keeps its ID when edited and is removed when cleared', () => {
  const jan = income('w2', 5_000, { month: 1, status: 'projected' });
  const feb = income('w2', 5_000, { month: 2, status: 'projected' });
  const grid = toGrid([jan, feb], 2026);
  grid.status[0] = 'actual';
  grid.amount[1] = undefined;
  const { entries, remove } = fromGrid([jan, feb], grid, blank, () => 'new');
  assert.deepEqual(remove, [feb.id]);
  assert.deepEqual(
    entries.map((r) => [r.id, r.status]),
    [[jan.id, 'actual']],
  );
});

test('a month holds one amount per payer, never a projected and an actual one', () => {
  const saved = applyMutation(emptyPlan(2026), {
    action: 'income',
    entries: [income('w2', 5_000, { id: 'p', month: 1, status: 'projected' })],
  });
  assert.throws(
    () => applyMutation(saved, { action: 'income', entries: [income('w2', 5_100, { id: 'a', month: 1 })] }),
    /overlapping/,
  );
});

test('a save can replace a full-year total with months in one step', () => {
  const saved = applyMutation(emptyPlan(2026), {
    action: 'income',
    entries: [income('w2', 60_000, { id: 'year', status: 'projected' })],
  });
  const months = Array.from({ length: 12 }, (_, i) =>
    income('w2', 5_000, { id: `m${i + 1}`, month: i + 1, status: i < 9 ? 'actual' : 'projected' }),
  );
  const next = applyMutation(saved, { action: 'income', entries: months, remove: ['year'] });
  assert.equal(next.income.length, 12);
  assert.ok(!next.income.some((r) => r.id === 'year'));
});

test('income and expenses can be saved together', () => {
  const next = applyMutation(emptyPlan(2026), {
    action: 'entries',
    income: [income('selfEmployment', 3_000, { id: 'gig', month: 3 })],
    expenses: [expense(120, { id: 'host', month: 3 })],
  });
  assert.equal(next.income.length, 1);
  assert.equal(next.expenses.length, 1);
});

test('the monthly summary MCP reads matches the month view result', () => {
  const plan = {
    ...emptyPlan(2026),
    income: [
      income('w2', 60_000, { status: 'projected' }),
      income('selfEmployment', 2_000, { source: 'Gig', month: 3 }),
    ],
    expenses: [expense(400, { description: 'Lunch', category: 'meals', month: 3 })],
  };
  const estimate = calculateTax(plan, emptyPortfolio());
  const { averageTaxRate, months } = monthlySummary(plan, estimate);
  const march = months[2];
  assert.deepEqual([march.incomeActual, march.incomeProjected, march.businessIncome], [2_000, 5_000, 2_000]);
  // Meals are spent in full but deducted at half.
  const expected = monthResult(7_000, 400, 200, estimate.totalTax / estimate.agi);
  assert.equal(march.net, expected.net);
  assert.equal(march.estimatedTax, Math.round(expected.estimatedTax * 100) / 100);
  assert.ok(averageTaxRate > 0);
});
