import type { ExpenseEntry, IncomeEntry } from './schema';

export type Status = 'actual' | 'projected';
type Dated = { month: number; status: Status };

/** One payer's income of one kind, as the Income list groups it. */
export const incomeKey = (r: Pick<IncomeEntry, 'owner' | 'kind' | 'source'>) =>
  `${r.owner}|${r.kind}|${r.source.trim().toLowerCase()}`;
/** One recurring cost, e.g. the same subscription paid each month. */
export const expenseKey = (e: Pick<ExpenseEntry, 'owner' | 'category' | 'description'>) =>
  `${e.owner}|${e.category}|${e.description.trim().toLowerCase()}`;

export type MonthTotals = { actual: number; projected: number };

/** Twelve calendar months of totals. A full-year entry (month 0) is spread evenly across all twelve. */
export function byMonth<T extends Dated>(entries: T[], amount: (entry: T) => number): MonthTotals[] {
  const totals = Array.from({ length: 12 }, () => ({ actual: 0, projected: 0 }));
  for (const entry of entries) {
    const value = amount(entry);
    if (!value) continue;
    if (entry.month) totals[entry.month - 1][entry.status] += value;
    else totals.forEach((t) => (t[entry.status] += value / 12));
  }
  return totals;
}

/** 1099 income in, business costs out: the expense list plus costs saved on older 1099 entries. */
export function businessByMonth(income: IncomeEntry[], expenses: ExpenseEntry[]) {
  const business = income.filter((r) => r.kind === 'selfEmployment');
  const listed = byMonth(expenses, (e) => e.amount);
  const attached = byMonth(business, (r) => r.expenses);
  return byMonth(business, (r) => r.amount).map((m, i) => ({
    income: m,
    expenses: {
      actual: listed[i].actual + attached[i].actual,
      projected: listed[i].projected + attached[i].projected,
    },
  }));
}

/** The year's QBI deduction split across months by business profit; months at a loss take none. */
export function qbiByMonth(
  income: IncomeEntry[],
  expenses: ExpenseEntry[],
  deduction: number,
  includeProjected = true,
) {
  const profit = businessByMonth(income, expenses).map((m) =>
    Math.max(
      0,
      m.income.actual - m.expenses.actual + (includeProjected ? m.income.projected - m.expenses.projected : 0),
    ),
  );
  const total = profit.reduce((sum, p) => sum + p, 0);
  return profit.map((p) => (total ? (deduction * p) / total : 0));
}

/** The year's average federal + state rate: total tax ÷ AGI. */
export const averageRate = (estimate: { agi: number; totalTax: number }) =>
  estimate.agi > 0 ? estimate.totalTax / estimate.agi : 0;

/** One month's bottom line, with tax at the year's average rate on income less deductible costs. */
export function monthResult(income: number, businessExpenses: number, deductible: number, rate: number) {
  const estimatedTax = Math.max(0, income - deductible) * rate;
  const net = income - businessExpenses;
  return { income, businessExpenses, net, estimatedTax, afterTax: net - estimatedTax };
}

/** Twelve cent-rounded parts of a total; December takes the rounding remainder so they add back up. */
export function splitEvenly(total: number) {
  const part = Math.round((total / 12) * 100) / 100;
  return Array.from({ length: 12 }, (_, i) => (i < 11 ? part : Math.round((total - part * 11) * 100) / 100));
}

/** A new amount defaults to actual for months already over and projected for the rest. */
export function defaultStatus(year: number, month: number, today = new Date()): Status {
  const current = today.getFullYear() * 12 + today.getMonth();
  return year * 12 + month - 1 < current ? 'actual' : 'projected';
}

/**
 * Twelve months of one payer or cost; index 0 is January. Each month holds one amount, either projected
 * or actual. A blank (undefined) amount means no entry, which is different from $0.
 */
export type MonthGrid = { amount: (number | undefined)[]; status: Status[]; withheld: number[] };

type GridEntry = Dated & { id: string; amount: number; withholding?: number; expenses?: number };

/** Lays entries out as twelve months; a full-year total is split evenly and keeps its status. */
export function toGrid(entries: GridEntry[], year: number): MonthGrid {
  const grid: MonthGrid = {
    amount: Array(12).fill(undefined),
    status: Array.from({ length: 12 }, (_, m) => defaultStatus(year, m + 1)),
    withheld: Array(12).fill(0),
  };
  for (const e of entries) {
    const amounts = e.month ? null : splitEvenly(e.amount);
    const withholding = e.month ? null : splitEvenly(e.withholding ?? 0);
    for (let m = 0; m < 12; m++) {
      if (e.month && e.month !== m + 1) continue;
      grid.amount[m] = (grid.amount[m] ?? 0) + (amounts ? amounts[m] : e.amount);
      grid.status[m] = e.status;
      grid.withheld[m] += withholding ? withholding[m] : (e.withholding ?? 0);
    }
  }
  return grid;
}

/**
 * Turns an edited grid back into entry changes: one entry per filled month, reusing that month's ID.
 * A cleared month, a duplicate in the same month, or a full-year total being split is removed.
 */
export function fromGrid<T extends GridEntry>(
  entries: T[],
  grid: MonthGrid,
  blank: (month: number, status: Status) => T,
  newId: () => string,
): { entries: T[]; remove: string[] } {
  const saved: T[] = [];
  const remove = entries.filter((e) => !e.month).map((e) => e.id);
  const full = entries.find((e) => !e.month);
  const fullExpenses = splitEvenly(full?.expenses ?? 0);
  for (let m = 1; m <= 12; m++) {
    const [prior, ...duplicates] = entries.filter((e) => e.month === m);
    remove.push(...duplicates.map((e) => e.id));
    const amount = grid.amount[m - 1];
    if (amount === undefined) {
      if (prior) remove.push(prior.id);
      continue;
    }
    const status = grid.status[m - 1];
    const entry: T = { ...(prior ?? full ?? blank(m, status)), id: prior?.id ?? newId(), month: m, status, amount };
    if ('withholding' in entry) entry.withholding = grid.withheld[m - 1];
    if ('expenses' in entry) entry.expenses = prior ? (prior.expenses ?? 0) : fullExpenses[m - 1];
    // Payroll wage boxes describe the old amount; without them they default to the new one.
    if (!prior || prior.amount !== amount) {
      const fields = entry as Record<string, unknown>;
      delete fields.socialSecurityWages;
      delete fields.medicareWages;
    }
    saved.push(entry);
  }
  return { entries: saved, remove };
}
