import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { getTaxContext, listTaxPlans, saveTaxMutation } from '@/lib/tax/service';
import { applyMutation, errorMessage, mutationSchema, taxYearSchema } from '@/lib/tax/schema';
import { comparePlan, monthlySummary, roundMoney } from '@/lib/tax/calculate';
import { TAX_SOURCES } from '@/lib/tax/rules';

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

async function result(work: () => Promise<unknown>) {
  try {
    return json(await work());
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: errorMessage(error, 'Tax planning request failed.') }],
      isError: true,
    };
  }
}

/** The headline numbers of an estimate, so a write can report its effect without the full bracket tables. */
function summarize({ baseline, planned, savings, cashCost }: ReturnType<typeof comparePlan>) {
  return {
    federalTax: roundMoney(planned.federalTax),
    stateTax: roundMoney(planned.stateTax),
    totalTax: roundMoney(planned.totalTax),
    agi: roundMoney(planned.agi),
    businessIncome: roundMoney(planned.businessIncome),
    businessExpenses: roundMoney(planned.businessExpenses),
    taxableIncome: roundMoney(planned.taxableIncome),
    marginalRate: planned.marginalRate,
    effectiveRate: Math.round(planned.effectiveRate * 10000) / 10000,
    averageTaxRate: Math.round((planned.agi > 0 ? planned.totalTax / planned.agi : 0) * 10000) / 10000,
    payments: roundMoney(planned.payments),
    balanceDue: roundMoney(planned.balance),
    federalTaxWithoutScenarios: roundMoney(baseline.federalTax),
    scenarioSavings: roundMoney(savings),
    scenarioCashCost: roundMoney(cashCost),
    warnings: planned.warnings,
  };
}

export function registerTaxTools(server: McpServer) {
  server.registerTool(
    'list_tax_plans',
    {
      title: 'List tax plans',
      description: 'List saved household tax planning years and revisions.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => result(listTaxPlans),
  );

  server.registerTool(
    'get_tax_plan',
    {
      title: 'Get tax plan and estimate',
      description:
        'Read income, business expenses, scenarios, settings, linked stock sales, open holdings and baseline/planned tax estimates. Call before writes to obtain the current revision and entry IDs. ' +
        "monthly lists each calendar month as the app's month view shows it: income (actual and projected), 1099 business income, business expenses (actual and projected), net, " +
        "estimated tax at the year's average federal + state rate (total tax ÷ AGI) on income less deductible expenses, and after-tax. Full-year (month 0) entries count as an even twelfth of each month. " +
        'Years 2025–2027; 2027 uses provisional 2026 rules. Amounts are USD. No mutation.',
      inputSchema: z.object({ year: taxYearSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ year }) =>
      result(async () => {
        const context = await getTaxContext(year);
        return { ...context, monthly: monthlySummary(context.plan, context.estimate.planned), sources: TAX_SOURCES };
      }),
  );

  server.registerTool(
    'update_tax_plan',
    {
      title: 'Update tax income, settings or scenario',
      description:
        'Save one tax-plan mutation using the revision from get_tax_plan; a stale revision fails instead of overwriting, so re-read and retry. ' +
        'income upserts entries by stable ID (reuse an ID to edit; each entry is replaced in full); remove lists IDs to delete in the same save. Month 0 is a full-year total, 1–12 are individual months. ' +
        'Monthly and annual entries for the same payer, owner and income kind cannot overlap: each month holds one amount, either "projected" (expected) or "actual" (received). ' +
        'To change one month of a full-year total, replace it in a single save: send all twelve monthly entries (an even split, with the changed month edited) and remove the full-year ID. ' +
        "The entries action saves income and expense changes together, e.g. one month's figures: income/removeIncome and expenses/removeExpenses. " +
        'profile merges: send only the settings to change. W-2 amount is box 1; withholding is box 2 only. Self-employment (1099-NEC) amount is gross receipts. ' +
        'Record business costs with the expenses action (upsert by ID, same month/status fields; amount is what was spent, meals are deducted at 50%) ' +
        'rather than the income entry expenses field, and never both. Nonqualified dividends exclude qualified dividends. Reported short/long gains replace portfolio totals ' +
        '(set profile.stockSource="reported" first); never record both. Rental purchases are scenarios, not full purchase-price deductions. ' +
        'Delete actions remove only the specified entry. Does not execute stock trades. Use only for changes the user asked for. ' +
        'Returns the saved plan, the updated estimate and the monthly breakdown.',
      inputSchema: z.object({
        year: taxYearSchema,
        revision: z.number().int().nonnegative().describe('The plan revision returned by get_tax_plan.'),
        mutation: mutationSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ year, revision, mutation }) =>
      result(async () => {
        await saveTaxMutation(year, revision, mutation);
        const context = await getTaxContext(year);
        return {
          plan: context.plan,
          estimate: summarize(context.estimate),
          monthly: monthlySummary(context.plan, context.estimate.planned),
        };
      }),
  );

  server.registerTool(
    'preview_tax_plan',
    {
      title: 'Preview tax changes without saving',
      description:
        'Apply a sequence of hypothetical income, expense, combined entries, setting or scenario mutations in memory and return baseline/planned estimates and the monthly breakdown. No writes. ' +
        'Useful for income forecasts, monthly what-ifs, deductions and rental comparisons. Preserve saved entry IDs when replacing income. Consult returned assumptions and warnings.',
      inputSchema: z.object({
        year: taxYearSchema,
        mutations: z.array(mutationSchema).max(50),
        includeProjected: z.boolean().default(true),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ year, mutations, includeProjected }) =>
      result(async () => {
        const context = await getTaxContext(year);
        const plan = mutations.reduce(applyMutation, context.plan);
        // Account exclusions change which portfolio sales count, and that needs a fresh portfolio read.
        const excluded = plan.profile.excludedLocationIds;
        if (JSON.stringify(excluded) !== JSON.stringify(context.plan.profile.excludedLocationIds))
          throw new Error(
            'Preview account exclusions by saving settings first; this preview cannot change account scope.',
          );
        const estimate = comparePlan(plan, context.portfolio, includeProjected);
        return {
          plan,
          summary: summarize(estimate),
          monthly: monthlySummary(plan, estimate.planned),
          estimate,
          sources: TAX_SOURCES,
        };
      }),
  );
}
