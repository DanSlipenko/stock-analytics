import dbConnect from '@/lib/mongodb';
import TaxPlanModel from '@/models/TaxPlan';
import CampaignModel from '@/models/Campaign';
import type { Campaign } from '@/types';
import { applyMutation, emptyPlan, planSchema, taxYearSchema, type PlanMutation, type TaxPlan } from './schema';
import { portfolioForTax } from './portfolio';
import { comparePlan } from './calculate';

export class TaxPlanConflict extends Error {
  constructor() {
    super('This plan changed in another window or through MCP. Refresh the plan before saving your changes.');
  }
}
export async function getTaxPlan(year: number): Promise<TaxPlan> {
  taxYearSchema.parse(year);
  await dbConnect();
  const document = await TaxPlanModel.findById(`tax-${year}`).lean();
  if (!document) return emptyPlan(year);
  const { _id, ...plan } = JSON.parse(JSON.stringify(document));
  void _id;
  return planSchema.parse(plan);
}
export async function getTaxContext(year: number) {
  const plan = await getTaxPlan(year);
  const campaigns: Campaign[] = JSON.parse(JSON.stringify(await CampaignModel.find({}).lean()));
  const portfolio = portfolioForTax(campaigns, year, plan.profile.excludedLocationIds);
  return { plan, portfolio, estimate: comparePlan(plan, portfolio) };
}
export async function saveTaxMutation(year: number, revision: number, mutation: PlanMutation) {
  const existing = await getTaxPlan(year);
  if (existing.revision !== revision) throw new TaxPlanConflict();
  const next = applyMutation(existing, mutation);
  next.revision = revision + 1;
  next.updatedAt = new Date().toISOString();
  try {
    const saved = await TaxPlanModel.findOneAndUpdate(
      { _id: `tax-${year}`, revision },
      { $set: next },
      { upsert: revision === 0, new: true, runValidators: true },
    );
    if (!saved) throw new TaxPlanConflict();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
      throw new TaxPlanConflict();
    throw error;
  }
  return next;
}
export async function listTaxPlans() {
  await dbConnect();
  return TaxPlanModel.find({}, { _id: 0, year: 1, revision: 1, updatedAt: 1 }).sort({ year: -1 }).lean();
}
