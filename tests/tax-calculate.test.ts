import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTax, comparePlan, netCapital, rentalDetails, solveRentalPrice } from '@/lib/tax/calculate';
import { emptyPortfolio, type TaxPortfolio } from '@/lib/tax/portfolio';
import {
  emptyPlan,
  planSchema,
  type IncomeEntry,
  type TaxPlan,
  type TaxProfile,
  type TaxScenario,
} from '@/lib/tax/schema';

// Expected values are worked by hand from the 2026 single-filer schedule:
// brackets 12,400 / 50,400 / 105,700 …, standard deduction 16,100, 0% gains up to 49,450.

let nextId = 0;
function income(kind: IncomeEntry['kind'], amount: number, extra: Partial<IncomeEntry> = {}): IncomeEntry {
  nextId += 1;
  return {
    id: `i${nextId}`,
    source: `${kind} ${nextId}`,
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

function plan(
  entries: IncomeEntry[],
  profile: Partial<TaxProfile> = {},
  scenarios: TaxScenario[] = [],
  year = 2026,
): TaxPlan {
  const base = emptyPlan(year);
  return planSchema.parse({
    ...base,
    profile: { ...base.profile, confirmed: true, ...profile },
    income: entries,
    scenarios,
  });
}

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${message ?? ''} expected ${expected}, got ${actual}`);

test('W-2 wages are taxed through the ordinary brackets after the standard deduction', () => {
  const result = calculateTax(plan([income('w2', 100_000, { withholding: 12_000 })]), emptyPortfolio());
  close(result.taxableIncome, 83_900);
  // 10% × 12,400 + 12% × 38,000 + 22% × 33,500
  close(result.ordinaryTax, 1_240 + 4_560 + 7_370);
  close(result.federalTax, 13_170);
  close(result.balance, 1_170);
  assert.equal(result.marginalRate, 0.22);
  close(result.bracketRoom!, 105_700 - 83_900);
});

test('long-term gains stack on top of ordinary income and fill the 0% band first', () => {
  const reported = { stockSource: 'reported' as const };
  const inZeroBand = calculateTax(plan([income('w2', 40_000), income('longTerm', 20_000)], reported), emptyPortfolio());
  close(inZeroBand.capitalTax, 0);
  close(inZeroBand.ordinaryTax, 1_240 + 0.12 * (23_900 - 12_400));

  const spansBands = calculateTax(plan([income('w2', 40_000), income('longTerm', 40_000)], reported), emptyPortfolio());
  // Gains occupy 23,900–63,900: 25,550 at 0%, 14,450 at 15%.
  close(spansBands.capitalTax, 0.15 * 14_450);
});

test('self-employment income pays SE tax and deducts half of it', () => {
  const result = calculateTax(plan([income('selfEmployment', 50_000)]), emptyPortfolio());
  const earnings = 50_000 * 0.9235;
  close(result.seTax, earnings * 0.153);
  close(result.adjustments, (earnings * 0.153) / 2);
  close(result.agi, 50_000 - (earnings * 0.153) / 2);
});

test('W-2 wages use up the Social Security wage base before SE tax', () => {
  const result = calculateTax(plan([income('w2', 184_500), income('selfEmployment', 20_000)]), emptyPortfolio());
  // Only the 2.9% Medicare portion remains once wages reach the 2026 base.
  close(result.seTax, 20_000 * 0.9235 * 0.029);
});

test('net capital losses offset $3,000 of ordinary income and carry the rest forward', () => {
  const joint = netCapital(-10_000, 0, false);
  assert.equal(joint.lossDeduction, 3_000);
  assert.equal(joint.ordinary, -3_000);
  assert.equal(joint.lossCarryforward, 7_000);
  assert.equal(netCapital(-10_000, 0, true).lossDeduction, 1_500);

  const mixed = netCapital(-2_000, 5_000, false);
  assert.equal(mixed.preferential, 3_000);
  assert.equal(mixed.ordinary, 0);
});

test('net investment income tax and additional Medicare tax apply above the threshold', () => {
  const result = calculateTax(
    plan([income('w2', 250_000), income('longTerm', 50_000)], { stockSource: 'reported' }),
    emptyPortfolio(),
  );
  close(result.niit, 0.038 * 50_000);
  close(result.additionalMedicare, 0.009 * 50_000);
});

test('portfolio gains feed the estimate unless reported totals are selected', () => {
  const portfolio: TaxPortfolio = { ...emptyPortfolio(), shortTerm: 2_000, longTerm: 5_000 };
  const linked = calculateTax(plan([income('w2', 60_000)]), portfolio);
  close(linked.capital.total, 7_000);
  const reported = calculateTax(plan([income('w2', 60_000)], { stockSource: 'reported' }), portfolio);
  close(reported.capital.total, 0);
});

test('projected income can be left out of the estimate', () => {
  const entries = [income('w2', 50_000), income('w2', 10_000, { month: 12, status: 'projected', source: 'Bonus' })];
  close(calculateTax(plan(entries), emptyPortfolio()).wages, 60_000);
  close(calculateTax(plan(entries), emptyPortfolio(), { includeProjected: false }).wages, 50_000);
});

test('2027 is estimated with the 2026 schedule and says so', () => {
  const result = calculateTax(plan([income('w2', 100_000)], {}, [], 2027), emptyPortfolio());
  assert.equal(result.rules.ruleYear, 2026);
  assert.ok(result.warnings.some((w) => w.startsWith('2027 projection')));
  close(result.federalTax, 13_170);
});

const rental = (participation: 'passive' | 'active' | 'professional'): TaxScenario => ({
  id: 'r1',
  type: 'rental',
  name: 'Duplex',
  enabled: true,
  notes: '',
  purchasePrice: 400_000,
  landPercent: 20,
  downPaymentPercent: 25,
  closingCosts: 8_000,
  serviceMonth: 1,
  rent: 0,
  expenses: 0,
  mortgageInterest: 0,
  participation,
  eligibilityConfirmed: participation !== 'passive',
  atRiskLimit: 1_000_000,
});

test('rental depreciation uses 27.5 years and the mid-month convention', () => {
  const details = rentalDetails(rental('passive') as Extract<TaxScenario, { type: 'rental' }>);
  close(details.depreciation, (320_000 / 27.5) * (11.5 / 12));
  close(details.cashRequired, 100_000 + 8_000);
});

test('passive rental losses are suspended; active participation earns the special allowance', () => {
  const depreciation = (320_000 / 27.5) * (11.5 / 12);
  const passive = comparePlan(plan([income('w2', 80_000)], {}, [rental('passive')]), emptyPortfolio());
  close(passive.planned.rental.suspendedLoss, depreciation);
  close(passive.savings, 0);

  const active = comparePlan(plan([income('w2', 80_000)], {}, [rental('active')]), emptyPortfolio());
  close(active.planned.agi, 80_000 - depreciation);
  assert.ok(active.savings > 0);

  // The $25,000 allowance loses 50¢ per dollar of MAGI over $100,000: $10,000 left at $130,000.
  const phased = comparePlan(plan([income('w2', 130_000)], {}, [rental('active')]), emptyPortfolio());
  close(phased.planned.rental.allowedLoss, 10_000);
  close(phased.planned.rental.suspendedLoss, depreciation - 10_000);
});

test('an IRA deduction does not enlarge the rental allowance', () => {
  const ira: TaxScenario = {
    id: 'ira',
    type: 'deduction',
    name: 'IRA',
    enabled: true,
    notes: '',
    category: 'adjustment',
    amount: 7_000,
    cashCost: 7_000,
    owner: 'taxpayer',
  };
  // MAGI stays at $130,000 (IRA added back), so the allowance is still $10,000, not $13,500.
  const result = comparePlan(plan([income('w2', 130_000)], {}, [rental('active'), ira]), emptyPortfolio());
  close(result.planned.rental.allowedLoss, 10_000);
});

test('solving for a savings target finds a price that reaches it', () => {
  const base = plan([income('w2', 90_000)]);
  const scenario = rental('active') as Extract<TaxScenario, { type: 'rental' }>;
  const price = solveRentalPrice(base, emptyPortfolio(), scenario, 1_500);
  assert.ok(price !== null && price > 0);
  const saved = comparePlan({ ...base, scenarios: [{ ...scenario, purchasePrice: price }] }, emptyPortfolio()).savings;
  assert.ok(saved >= 1_500 - 0.01, `saved ${saved}`);
  // Passive losses never offset wages, so no price reaches the target.
  assert.equal(solveRentalPrice(base, emptyPortfolio(), { ...scenario, participation: 'passive' }, 1_500), null);
});

test('deduction scenarios lower taxable income and report their savings', () => {
  const deduction: TaxScenario = {
    id: 'd1',
    type: 'deduction',
    name: 'Traditional IRA',
    enabled: true,
    notes: '',
    category: 'adjustment',
    amount: 7_000,
    cashCost: 7_000,
    owner: 'taxpayer',
  };
  const result = comparePlan(plan([income('w2', 100_000)], {}, [deduction]), emptyPortfolio());
  close(result.taxableReduction, 7_000);
  close(result.savings, 7_000 * 0.22);
  close(result.cashCost, 7_000);
});

test('business expenses lower 1099 profit and self-employment tax; meals count at 50%', () => {
  const base = plan([income('selfEmployment', 50_000)]);
  const withExpenses = {
    ...base,
    expenses: [
      {
        id: 'e1',
        description: 'Laptop',
        category: 'equipment',
        owner: 'taxpayer',
        month: 3,
        status: 'actual',
        amount: 2_000,
        notes: '',
      },
      {
        id: 'e2',
        description: 'Client lunches',
        category: 'meals',
        owner: 'taxpayer',
        month: 0,
        status: 'actual',
        amount: 1_000,
        notes: '',
      },
      {
        id: 'e3',
        description: 'New monitor',
        category: 'equipment',
        owner: 'taxpayer',
        month: 12,
        status: 'projected',
        amount: 500,
        notes: '',
      },
    ],
  } as TaxPlan;
  const result = calculateTax(withExpenses, emptyPortfolio());
  close(result.businessIncome, 50_000);
  close(result.businessExpenses, 2_000 + 500 + 500);
  close(result.businessProfit, 47_000);
  close(result.seTax, 47_000 * 0.9235 * 0.153);

  const recordedOnly = calculateTax(withExpenses, emptyPortfolio(), { includeProjected: false });
  close(recordedOnly.businessExpenses, 2_500, 'the projected monitor is left out');
});
