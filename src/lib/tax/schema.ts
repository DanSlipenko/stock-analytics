import { z } from 'zod';
import { incomeKey } from './monthly';

export const taxYearSchema = z.number().int().min(2025).max(2027);
export const filingStatusSchema = z.enum(['single', 'joint', 'separate', 'head']);
const dollars = z.number().finite().min(0).max(1_000_000_000);
const signedDollars = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const incomeKinds = [
  'w2',
  'selfEmployment',
  'interest',
  'ordinaryDividends',
  'qualifiedDividends',
  'shortTerm',
  'longTerm',
  'other',
] as const;
export const incomeLabels: Record<(typeof incomeKinds)[number], string> = {
  w2: 'W-2 wages',
  selfEmployment: '1099 / self-employment',
  interest: '1099-INT interest',
  ordinaryDividends: 'Nonqualified dividends',
  qualifiedDividends: 'Qualified dividends',
  shortTerm: 'Short-term gain / loss',
  longTerm: 'Long-term gain / loss',
  other: 'Other ordinary income',
};
export const incomeSchema = z
  .object({
    id: id.describe('Stable entry ID. Reuse an existing ID to edit that entry; use a new one to add.'),
    source: z.string().trim().min(1).max(120).describe('Employer, client or payer name.'),
    kind: z.enum(incomeKinds),
    owner: z.enum(['taxpayer', 'spouse']).default('taxpayer'),
    month: z.number().int().min(0).max(12).default(0).describe('0 = full-year total; 1–12 = that calendar month.'),
    status: z
      .enum(['actual', 'projected'])
      .default('actual')
      .describe('actual = already earned; projected = expected future income.'),
    amount: signedDollars.describe('USD. W-2 box 1, 1099 gross receipts, or net gain/loss for capital kinds.'),
    expenses: dollars.default(0).describe('Deductible business expenses; selfEmployment only.'),
    withholding: dollars.default(0).describe('Federal income tax withheld (W-2 box 2 / 1099 box 4).'),
    socialSecurityWages: dollars.optional(),
    medicareWages: dollars.optional(),
    documentName: z.string().max(200).optional(),
    documentHash: z.string().max(64).optional(),
    notes: z.string().max(1000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.amount < 0 && !['shortTerm', 'longTerm', 'other'].includes(v.kind))
      ctx.addIssue({
        code: 'custom',
        message: 'Only capital gains/losses and other income can be negative.',
        path: ['amount'],
      });
    if (v.kind !== 'selfEmployment' && v.expenses !== 0)
      ctx.addIssue({
        code: 'custom',
        message: 'Business expenses belong to self-employment income.',
        path: ['expenses'],
      });
    if (v.kind !== 'w2' && (v.socialSecurityWages !== undefined || v.medicareWages !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Payroll wage boxes belong to W-2 income.' });
  });
export const expenseCategories = [
  'software',
  'equipment',
  'homeOffice',
  'vehicle',
  'travel',
  'meals',
  'phoneInternet',
  'supplies',
  'professional',
  'advertising',
  'education',
  'insurance',
  'contractors',
  'other',
] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];
export const expenseLabels: Record<ExpenseCategory, string> = {
  software: 'Software & subscriptions',
  equipment: 'Equipment & computers',
  homeOffice: 'Home office',
  vehicle: 'Car & mileage',
  travel: 'Travel',
  meals: 'Business meals',
  phoneInternet: 'Phone & internet',
  supplies: 'Office supplies',
  professional: 'Legal & professional fees',
  advertising: 'Advertising & marketing',
  education: 'Training & education',
  insurance: 'Business insurance',
  contractors: 'Contract labor',
  other: 'Other business expense',
};
/** Business meals are 50% deductible; every other category counts in full. */
export const deductibleShare = (category: ExpenseCategory) => (category === 'meals' ? 0.5 : 1);
export const expenseSchema = z
  .object({
    id: id.describe('Stable expense ID. Reuse an existing ID to edit that expense; use a new one to add.'),
    description: z.string().trim().min(1).max(120).describe('What was bought, e.g. "Adobe Creative Cloud".'),
    category: z.enum(expenseCategories),
    owner: z
      .enum(['taxpayer', 'spouse'])
      .default('taxpayer')
      .describe('Whose 1099 / self-employment business the expense belongs to.'),
    month: z.number().int().min(0).max(12).default(0).describe('0 = full-year total; 1–12 = that calendar month.'),
    status: z
      .enum(['actual', 'projected'])
      .default('actual')
      .describe('actual = already paid; projected = expected future spending.'),
    amount: dollars.describe('USD actually spent. Enter meals in full; only half is deducted.'),
    notes: z.string().max(1000).default(''),
  })
  .strict();
// No defaults on the fields themselves: a partial profile update must leave
// omitted fields alone, and Zod's .partial() still fills in field defaults.
export const profileSchema = z
  .object({
    filingStatus: filingStatusSchema,
    confirmed: z.boolean().describe('The user has reviewed filing status and taxable accounts.'),
    stateName: z.string().max(60),
    stateRate: z.number().min(0).max(15).nullable().describe('Flat state rate in percent; null excludes state tax.'),
    stockSource: z
      .enum(['portfolio', 'reported'])
      .describe('portfolio = gains from recorded stock sales; reported = shortTerm/longTerm income entries.'),
    excludedLocationIds: z.array(z.string().max(100)).max(500).describe('Non-taxable accounts, e.g. an IRA.'),
    shortLossCarryover: dollars,
    longLossCarryover: dollars,
    adjustments: dollars.describe('Eligible adjustments to income, e.g. deductible IRA or HSA contributions.'),
    itemizedDeductions: dollars,
    forceItemized: z.boolean(),
    qbiDeduction: dollars,
    credits: dollars.describe('Nonrefundable federal credits.'),
    estimatedPayments: dollars.describe('Federal estimated tax payments already made.'),
    additionalMedicareWithheld: dollars,
    separateLivedApart: z.boolean(),
  })
  .strict();
export const profileDefaults: z.infer<typeof profileSchema> = {
  filingStatus: 'single',
  confirmed: false,
  stateName: '',
  stateRate: null,
  stockSource: 'portfolio',
  excludedLocationIds: [],
  shortLossCarryover: 0,
  longLossCarryover: 0,
  adjustments: 0,
  itemizedDeductions: 0,
  forceItemized: false,
  qbiDeduction: 0,
  credits: 0,
  estimatedPayments: 0,
  additionalMedicareWithheld: 0,
  separateLivedApart: false,
};
export const profilePatchSchema = profileSchema.partial();
const scenarioBase = {
  id,
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  notes: z.string().max(1000).default(''),
};
export const rentalSchema = z
  .object({
    ...scenarioBase,
    type: z.literal('rental'),
    purchasePrice: dollars,
    landPercent: z.number().min(0).max(100).default(20),
    downPaymentPercent: z.number().min(0).max(100).default(25),
    closingCosts: dollars.default(0),
    serviceMonth: z.number().int().min(1).max(12).default(10),
    rent: dollars.default(0),
    expenses: dollars.default(0),
    mortgageInterest: dollars.default(0),
    participation: z.enum(['passive', 'active', 'professional']).default('passive'),
    eligibilityConfirmed: z.boolean().default(false),
    atRiskLimit: dollars.default(0),
  })
  .strict();
export const deductionSchema = z
  .object({
    ...scenarioBase,
    type: z.literal('deduction'),
    category: z.enum(['adjustment', 'itemized', 'business']),
    amount: dollars,
    cashCost: dollars,
    owner: z.enum(['taxpayer', 'spouse']).default('taxpayer'),
  })
  .strict();
export const scenarioSchema = z.discriminatedUnion('type', [rentalSchema, deductionSchema]);
export const planSchema = z
  .object({
    year: taxYearSchema,
    revision: z.number().int().nonnegative().default(0),
    // Plans saved before a profile field existed pick up its default.
    profile: z.preprocess(
      (value) => ({ ...profileDefaults, ...(typeof value === 'object' && value !== null ? value : {}) }),
      profileSchema,
    ),
    income: z.array(incomeSchema).max(2000).default([]),
    expenses: z.array(expenseSchema).max(2000).default([]),
    scenarios: z.array(scenarioSchema).max(50).default([]),
    updatedAt: z.string().optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    for (const key of ['income', 'expenses', 'scenarios'] as const) {
      if (new Set(plan[key].map((r) => r.id)).size !== plan[key].length)
        ctx.addIssue({ code: 'custom', message: `Duplicate ${key} IDs.` });
    }
    // Each month holds one amount per payer, projected or actual; a full-year total covers every month.
    const groups = new Map<string, number[]>();
    for (const entry of plan.income) {
      const key = incomeKey(entry);
      const months = groups.get(key) || [];
      if (months.includes(entry.month) || (months.length && (entry.month === 0 || months.includes(0)))) {
        ctx.addIssue({
          code: 'custom',
          message: `“${entry.source}” has overlapping ${incomeLabels[entry.kind]} entries. Edit its existing total or use distinct, non-overlapping months.`,
        });
      }
      months.push(entry.month);
      groups.set(key, months);
      if (entry.owner === 'spouse' && plan.profile.filingStatus !== 'joint')
        ctx.addIssue({ code: 'custom', message: 'Spouse income requires married filing jointly.' });
      if (['shortTerm', 'longTerm'].includes(entry.kind) && plan.profile.stockSource === 'portfolio')
        ctx.addIssue({
          code: 'custom',
          message:
            'Switch stock gains to reported totals before entering 1099-B gains. Portfolio and reported gains are never added together.',
        });
    }
    if (plan.expenses.some((e) => e.owner === 'spouse') && plan.profile.filingStatus !== 'joint')
      ctx.addIssue({ code: 'custom', message: 'Spouse business expenses require married filing jointly.' });
    for (const scenario of plan.scenarios) {
      if (scenario.type === 'deduction' && scenario.owner === 'spouse' && plan.profile.filingStatus !== 'joint')
        ctx.addIssue({ code: 'custom', message: 'Spouse deductions require married filing jointly.' });
      if (scenario.type === 'rental' && scenario.participation !== 'passive' && !scenario.eligibilityConfirmed)
        ctx.addIssue({
          code: 'custom',
          message: 'Confirm rental participation eligibility before applying a special loss allowance.',
        });
    }
  });
const removeIds = z
  .array(id)
  .max(500)
  .optional()
  .describe('IDs to delete in the same save, e.g. a full-year total being replaced by monthly entries.');
export const mutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('profile'),
    profile: profilePatchSchema.describe('Only the settings to change; omitted settings keep their saved values.'),
  }),
  z.object({
    action: z.literal('income'),
    entries: z
      .array(incomeSchema)
      .max(500)
      .describe('Entries to add, or to replace in full when the ID already exists.'),
    remove: removeIds,
  }),
  z.object({ action: z.literal('deleteIncome'), id }),
  z.object({
    action: z.literal('expenses'),
    entries: z
      .array(expenseSchema)
      .max(500)
      .describe('Business expenses to add, or to replace in full when the ID already exists.'),
    remove: removeIds,
  }),
  z.object({ action: z.literal('deleteExpense'), id }),
  z
    .object({
      action: z.literal('entries'),
      income: z.array(incomeSchema).max(500).optional().describe('Income entries to add or replace by ID.'),
      removeIncome: removeIds,
      expenses: z.array(expenseSchema).max(500).optional().describe('Business expenses to add or replace by ID.'),
      removeExpenses: removeIds,
    })
    .describe('Income and business expense changes saved together, e.g. one month’s figures.'),
  z.object({
    action: z.literal('scenario'),
    scenario: scenarioSchema.describe('A complete scenario; an existing ID is replaced in full.'),
  }),
  z.object({ action: z.literal('deleteScenario'), id }),
]);
export const writeSchema = z.object({ revision: z.number().int().nonnegative(), mutation: mutationSchema }).strict();
export type TaxPlan = z.infer<typeof planSchema>;
export type TaxProfile = z.infer<typeof profileSchema>;
export type IncomeEntry = z.infer<typeof incomeSchema>;
export type ExpenseEntry = z.infer<typeof expenseSchema>;
export type TaxScenario = z.infer<typeof scenarioSchema>;
export type RentalScenario = z.infer<typeof rentalSchema>;
export type PlanMutation = z.infer<typeof mutationSchema>;
export type FilingStatus = z.infer<typeof filingStatusSchema>;
/** A readable message for anything thrown; Zod errors become their issue messages instead of raw JSON. */
export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) =>
        issue.code === 'custom' || !issue.path.length ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
      )
      .join(' ');
  }
  return error instanceof Error ? error.message : fallback;
}
export function emptyPlan(year: number): TaxPlan {
  return planSchema.parse({ year });
}

/** Removes the named IDs, then adds each entry or replaces the one with its ID. */
function upsert<T extends { id: string }>(current: T[], entries: T[] = [], remove: string[] = []) {
  const removed = new Set(remove);
  const byId = new Map(current.filter((r) => !removed.has(r.id)).map((r) => [r.id, r]));
  entries.forEach((r) => byId.set(r.id, r));
  return [...byId.values()];
}

export function applyMutation(plan: TaxPlan, mutation: PlanMutation): TaxPlan {
  const next = structuredClone(plan);
  if (mutation.action === 'profile') next.profile = { ...next.profile, ...mutation.profile };
  if (mutation.action === 'income') next.income = upsert(next.income, mutation.entries, mutation.remove);
  if (mutation.action === 'entries') {
    next.income = upsert(next.income, mutation.income, mutation.removeIncome);
    next.expenses = upsert(next.expenses, mutation.expenses, mutation.removeExpenses);
  }
  if (mutation.action === 'deleteIncome') next.income = next.income.filter((r) => r.id !== mutation.id);
  if (mutation.action === 'expenses') next.expenses = upsert(next.expenses, mutation.entries, mutation.remove);
  if (mutation.action === 'deleteExpense') next.expenses = next.expenses.filter((r) => r.id !== mutation.id);
  if (mutation.action === 'scenario')
    next.scenarios = [...next.scenarios.filter((r) => r.id !== mutation.scenario.id), mutation.scenario];
  if (mutation.action === 'deleteScenario') next.scenarios = next.scenarios.filter((r) => r.id !== mutation.id);
  return planSchema.parse(next);
}
