import { deductibleShare, type IncomeEntry, type RentalScenario, type TaxPlan, type TaxScenario } from './schema';
import { taxRules } from './rules';
import type { TaxPortfolio } from './portfolio';

const positive = (n: number) => Math.max(0, n);
export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function progressiveTax(amount: number, limits: number[], rates: number[], offset = 0) {
  let lower = 0;
  return [...limits, Infinity].map((upper, i) => {
    const income = positive(Math.min(offset + positive(amount), upper) - Math.max(offset, lower));
    const row = { lower, upper: Number.isFinite(upper) ? upper : null, rate: rates[i], income, tax: income * rates[i] };
    lower = upper;
    return row;
  });
}
export function netCapital(shortTerm: number, longTerm: number, separate: boolean) {
  const total = shortTerm + longTerm;
  const lossDeduction = Math.min(positive(-total), separate ? 1500 : 3000);
  const preferential = positive(Math.min(longTerm, total));
  return {
    shortTerm,
    longTerm,
    total,
    preferential,
    ordinary: positive(total - preferential) - lossDeduction,
    lossDeduction,
    lossCarryforward: positive(-total - lossDeduction),
  };
}
export function rentalDetails(scenario: RentalScenario) {
  const buildingBasis = scenario.purchasePrice * (1 - scenario.landPercent / 100);
  const depreciation = ((buildingBasis / 27.5) * (12 - scenario.serviceMonth + 0.5)) / 12;
  const net = scenario.rent - scenario.expenses - scenario.mortgageInterest - depreciation;
  const loss = Math.min(positive(-net), scenario.atRiskLimit);
  return {
    id: scenario.id,
    name: scenario.name,
    buildingBasis,
    depreciation,
    net,
    loss,
    atRiskDisallowed: positive(-net - loss),
    participation: scenario.participation,
    cashRequired:
      (scenario.purchasePrice * scenario.downPaymentPercent) / 100 +
      scenario.closingCosts +
      scenario.expenses +
      scenario.mortgageInterest -
      scenario.rent,
  };
}
function aggregateRentals(scenarios: TaxScenario[], magi: number, plan: TaxPlan) {
  const rows = scenarios.filter((s): s is RentalScenario => s.type === 'rental').map(rentalDetails);
  const sum = (f: (row: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  const passiveProfit = sum((r) => (r.participation !== 'professional' ? positive(r.net) : 0));
  const passiveLoss = sum((r) => (r.participation !== 'professional' ? r.loss : 0));
  const activeLoss = sum((r) => (r.participation === 'active' ? r.loss : 0));
  const regularLoss = passiveLoss - activeLoss;
  const remainingActiveLoss = positive(activeLoss - positive(passiveProfit - regularLoss));
  const separate = plan.profile.filingStatus === 'separate';
  const limit = separate ? (plan.profile.separateLivedApart ? 12500 : 0) : 25000;
  const phaseoutStart = separate ? 50000 : 100000;
  const allowance = positive(limit - positive(magi - phaseoutStart) * 0.5);
  const specialLoss = Math.min(remainingActiveLoss, allowance);
  const passiveNet = positive(passiveProfit - passiveLoss) - specialLoss;
  const professionalNet = sum((r) => (r.participation === 'professional' ? positive(r.net) - r.loss : 0));
  return {
    rows,
    taxable: passiveNet + professionalNet,
    passiveNet,
    allowedLoss:
      Math.min(passiveProfit, passiveLoss) +
      specialLoss +
      sum((r) => (r.participation === 'professional' ? r.loss : 0)),
    suspendedLoss: positive(passiveLoss - passiveProfit - specialLoss),
    atRiskDisallowed: sum((r) => r.atRiskDisallowed),
    depreciation: sum((r) => r.depreciation),
    cashRequired: sum((r) => r.cashRequired),
    allowance,
  };
}
export type CalculationOptions = {
  includeProjected?: boolean;
  includeScenarios?: boolean;
  extraShortTerm?: number;
  extraLongTerm?: number;
};
export function calculateTax(plan: TaxPlan, portfolio: TaxPortfolio, options: CalculationOptions = {}) {
  const profile = plan.profile;
  const rules = taxRules(plan.year, profile.filingStatus);
  const entries = plan.income.filter((r) => options.includeProjected !== false || r.status === 'actual');
  const expenses = plan.expenses.filter((e) => options.includeProjected !== false || e.status === 'actual');
  const scenarios = options.includeScenarios === false ? [] : plan.scenarios.filter((s) => s.enabled);
  const total = (kind: IncomeEntry['kind']) =>
    entries.filter((r) => r.kind === kind).reduce((sum, r) => sum + r.amount, 0);
  const deductionTotal = (category: string) =>
    scenarios.reduce((sum, s) => sum + (s.type === 'deduction' && s.category === category ? s.amount : 0), 0);
  const warnings: string[] = [...portfolio.warnings];
  if (!profile.confirmed) warnings.push('Confirm your filing status and taxable accounts in Plan settings.');
  if (rules.provisional)
    warnings.push(
      '2027 projection uses 2026 brackets, deductions and Social Security limits. Update the rules when 2027 parameters are published.',
    );
  if (profile.stateRate === null)
    warnings.push('State and local income taxes are not included. Set a custom state estimate in Plan settings.');
  else
    warnings.push(
      'State estimate uses your flat rate × positive federal AGI. State brackets, exemptions, credits and local tax are not modeled.',
    );
  let seTax = 0,
    seEarnings = 0,
    businessIncome = 0,
    businessExpenses = 0,
    businessProfit = 0,
    businessScenarioDeduction = 0;
  for (const owner of ['taxpayer', 'spouse'] as const) {
    const owned = entries.filter((r) => r.owner === owner);
    const wageBase = owned
      .filter((r) => r.kind === 'w2')
      .reduce((sum, r) => sum + (r.socialSecurityWages ?? r.amount), 0);
    const selfEmployment = owned.filter((r) => r.kind === 'selfEmployment');
    const receipts = selfEmployment.reduce((sum, r) => sum + r.amount, 0);
    // Costs recorded on a 1099 entry, plus the owner's own business expense list.
    const costs =
      selfEmployment.reduce((sum, r) => sum + r.expenses, 0) +
      expenses.filter((e) => e.owner === owner).reduce((sum, e) => sum + e.amount * deductibleShare(e.category), 0);
    const profit = receipts - costs;
    businessIncome += receipts;
    businessExpenses += costs;
    const requested = scenarios.reduce(
      (sum, s) => sum + (s.type === 'deduction' && s.category === 'business' && s.owner === owner ? s.amount : 0),
      0,
    );
    const allowed = Math.min(requested, positive(profit));
    businessScenarioDeduction += allowed;
    businessProfit += profit - allowed;
    const earnings = positive(profit - allowed) * 0.9235;
    if (earnings >= 400) {
      seEarnings += earnings;
      seTax += Math.min(earnings, positive(rules.socialSecurityBase - wageBase)) * 0.124 + earnings * 0.029;
    }
    if (profit < 0)
      warnings.push(
        'Business losses are included before basis, at-risk, excess business loss and NOL limits. Review eligibility.',
      );
    if (requested > allowed)
      warnings.push(
        'Scenario business deductions are capped at the owner’s available business profit. Excess losses are not modeled.',
      );
  }
  const shortTerm =
    (profile.stockSource === 'portfolio' ? portfolio.shortTerm : total('shortTerm')) -
    profile.shortLossCarryover +
    (options.extraShortTerm || 0);
  const longTerm =
    (profile.stockSource === 'portfolio' ? portfolio.longTerm : total('longTerm')) -
    profile.longLossCarryover +
    (options.extraLongTerm || 0);
  const capital = netCapital(shortTerm, longTerm, profile.filingStatus === 'separate');
  const wages = total('w2'),
    interest = total('interest'),
    ordinaryDividends = total('ordinaryDividends'),
    qualifiedDividends = total('qualifiedDividends');
  const other = total('other');
  const grossIncome =
    wages +
    businessProfit +
    interest +
    ordinaryDividends +
    qualifiedDividends +
    other +
    capital.ordinary +
    capital.preferential;
  const adjustments = profile.adjustments + deductionTotal('adjustment') + seTax / 2;
  // MAGI for the rental allowance is figured without IRA contributions and half of SE tax (Pub. 925).
  // Adjustments aren't itemised by type, so all are added back: this can only understate the allowance.
  const rental = aggregateRentals(scenarios, grossIncome, plan);
  const agi = grossIncome - adjustments + rental.taxable;
  const requestedItemized = profile.itemizedDeductions + deductionTotal('itemized');
  const itemizedReduction =
    plan.year >= 2026 ? (2 / 37) * Math.min(requestedItemized, positive(agi - rules.limits[5])) : 0;
  const itemized = positive(requestedItemized - itemizedReduction);
  const usesItemized = profile.forceItemized || itemized > rules.standardDeduction;
  const deduction = usesItemized ? itemized : rules.standardDeduction;
  const beforeQbi = positive(agi - deduction);
  const preferentialIncome = capital.preferential + qualifiedDividends;
  const qbiDeduction = Math.min(profile.qbiDeduction, positive(beforeQbi - preferentialIncome) * 0.2);
  const taxableIncome = positive(beforeQbi - qbiDeduction);
  const taxablePreferential = Math.min(taxableIncome, preferentialIncome);
  const ordinaryTaxable = positive(taxableIncome - taxablePreferential);
  const brackets = progressiveTax(ordinaryTaxable, rules.limits, rules.rates);
  const capitalBrackets = progressiveTax(taxablePreferential, rules.capitalLimits, [0, 0.15, 0.2], ordinaryTaxable);
  const ordinaryTax = brackets.reduce((sum, r) => sum + r.tax, 0);
  const capitalTax = capitalBrackets.reduce((sum, r) => sum + r.tax, 0);
  const investmentIncome = positive(
    interest + ordinaryDividends + qualifiedDividends + capital.ordinary + capital.preferential + rental.passiveNet,
  );
  const niit = 0.038 * Math.min(investmentIncome, positive(agi - rules.surtaxThreshold));
  const medicareWages = entries
    .filter((r) => r.kind === 'w2')
    .reduce((sum, r) => sum + (r.medicareWages ?? r.amount), 0);
  const additionalMedicare = 0.009 * positive(medicareWages + seEarnings - rules.surtaxThreshold);
  const creditsUsed = Math.min(profile.credits, ordinaryTax + capitalTax);
  const federalTax = positive(ordinaryTax + capitalTax - creditsUsed) + seTax + niit + additionalMedicare;
  const stateTax = profile.stateRate === null ? 0 : (positive(agi) * profile.stateRate) / 100;
  const payments =
    entries.reduce((sum, r) => sum + r.withholding, 0) + profile.estimatedPayments + profile.additionalMedicareWithheld;
  const balance = federalTax - payments;
  const marginalRate = rules.rates[rules.limits.filter((n) => ordinaryTaxable >= n).length];
  const nextBracket = rules.limits.find((n) => n > ordinaryTaxable) ?? null;
  if (entries.some((r) => r.kind === 'w2' && (r.socialSecurityWages === undefined || r.medicareWages === undefined)))
    warnings.push(
      'Missing W-2 boxes 3 or 5 default to box 1 for payroll surtax calculations. Update them if pre-tax benefits make wages differ.',
    );
  if (expenses.length)
    warnings.push(
      'Business expenses are deducted in the year paid and must be ordinary and necessary for your 1099 work. Meals count at 50%; equipment is assumed fully expensed (Section 179). Enter home office and vehicle costs after applying the IRS simplified or actual-expense method.',
    );
  if (businessProfit > 0 && !profile.qbiDeduction)
    warnings.push(
      'QBI deduction is not automatically calculated. Enter an eligible deduction in Plan settings after checking business and income limits.',
    );
  if (rental.rows.length)
    warnings.push(
      'Rental model assumes a new US residential rental placed in service this year, 27.5-year straight-line depreciation and no personal use. Land and closing costs are excluded from depreciation; bonus depreciation, recapture, existing carryovers and excess business loss limits are not modeled. The special allowance uses income before all adjustments, which may understate it.',
    );
  if (rental.rows.some((r) => r.participation === 'professional'))
    warnings.push(
      'Professional treatment assumes you qualify as a real-estate professional and materially participate. This is an eligibility assumption, not a determination.',
    );
  warnings.push(
    'Planning estimate, not a tax return: AMT, refundable credits, age/blindness additions, dependent rules, special capital-gain rates and automatic deduction eligibility are not modeled. Regular W-2 Social Security and Medicare withholding are excluded.',
  );
  return {
    year: plan.year,
    rules,
    wages,
    businessIncome,
    businessExpenses,
    businessProfit,
    interest,
    ordinaryDividends,
    qualifiedDividends,
    other,
    capital,
    grossIncome,
    adjustments,
    agi,
    deduction,
    usesItemized,
    itemizedReduction,
    qbiDeduction,
    taxableIncome,
    ordinaryTaxable,
    taxablePreferential,
    brackets,
    capitalBrackets,
    ordinaryTax,
    capitalTax,
    seTax,
    niit,
    additionalMedicare,
    creditsUsed,
    federalTax,
    stateTax,
    totalTax: federalTax + stateTax,
    payments,
    balance,
    marginalRate,
    nextBracket,
    bracketRoom: nextBracket === null ? null : nextBracket - ordinaryTaxable,
    effectiveRate: positive(agi) > 0 ? federalTax / agi : 0,
    rental,
    businessScenarioDeduction,
    actualIncome: entries.filter((r) => r.status === 'actual').reduce((sum, r) => sum + r.amount - r.expenses, 0),
    projectedIncome: entries.filter((r) => r.status === 'projected').reduce((sum, r) => sum + r.amount - r.expenses, 0),
    warnings: [...new Set(warnings)],
  };
}
export type TaxCalculation = ReturnType<typeof calculateTax>;
export function comparePlan(plan: TaxPlan, portfolio: TaxPortfolio, includeProjected = true) {
  const baseline = calculateTax(plan, portfolio, { includeProjected, includeScenarios: false });
  const planned = calculateTax(plan, portfolio, { includeProjected });
  const cashCost = plan.scenarios
    .filter((s) => s.enabled)
    .reduce((sum, s) => sum + (s.type === 'deduction' ? s.cashCost : rentalDetails(s).cashRequired), 0);
  return {
    baseline,
    planned,
    savings: baseline.federalTax - planned.federalTax,
    taxableReduction: baseline.taxableIncome - planned.taxableIncome,
    cashCost,
  };
}
/** Solve a hypothetical purchase price; returns null when passive/at-risk limits make the target unreachable. */
export function solveRentalPrice(
  plan: TaxPlan,
  portfolio: TaxPortfolio,
  scenario: RentalScenario,
  target: number,
): number | null {
  if (target <= 0) return 0;
  const otherScenarios = plan.scenarios.filter((s) => s.id !== scenario.id);
  const base = calculateTax({ ...plan, scenarios: otherScenarios }, portfolio).federalTax;
  const saving = (purchasePrice: number) =>
    base -
    calculateTax({ ...plan, scenarios: [...otherScenarios, { ...scenario, enabled: true, purchasePrice }] }, portfolio)
      .federalTax;
  let lo = 0,
    hi = 10_000_000;
  if (saving(hi) < target) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (saving(mid) >= target) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}
