import mongoose, { Schema } from 'mongoose';

// One plan per year in this single-household app. Shared Zod validation runs on every write.
const TaxPlanSchema = new Schema(
  {
    _id: { type: String, required: true },
    year: { type: Number, required: true },
    revision: { type: Number, required: true },
    profile: { type: Schema.Types.Mixed, required: true },
    income: { type: [Schema.Types.Mixed], default: [] },
  expenses: { type: [Schema.Types.Mixed], default: [] },
    scenarios: { type: [Schema.Types.Mixed], default: [] },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false },
);

export default mongoose.models.TaxPlan || mongoose.model('TaxPlan', TaxPlanSchema);
