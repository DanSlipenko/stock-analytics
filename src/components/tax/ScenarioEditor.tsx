'use client';
import { useMemo, useState } from 'react';
import { Button, Modal } from 'antd';
import {
  deductionSchema,
  errorMessage,
  rentalSchema,
  scenarioSchema,
  type TaxPlan,
  type TaxScenario,
} from '@/lib/tax/schema';
import { calculateTax, rentalDetails, solveRentalPrice } from '@/lib/tax/calculate';
import type { TaxPortfolio } from '@/lib/tax/portfolio';
import { Capsule, ErrorNotice, Field, MoneyField, months, signedUsd, usd } from './controls';

export default function ScenarioEditor({
  plan,
  portfolio,
  scenario,
  kind,
  onClose,
  onSave,
}: {
  plan: TaxPlan;
  portfolio: TaxPortfolio;
  scenario?: TaxScenario;
  kind: 'rental' | 'deduction';
  onClose: () => void;
  onSave: (scenario: TaxScenario) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TaxScenario>(
    () =>
      scenario ||
      (kind === 'rental'
        ? rentalSchema.parse({ id: crypto.randomUUID(), type: 'rental', name: 'Residential rental', purchasePrice: 0 })
        : deductionSchema.parse({
            id: crypto.randomUUID(),
            type: 'deduction',
            name: 'Eligible deduction',
            category: 'adjustment',
            amount: 0,
            cashCost: 0,
          })),
  );
  const [target, setTarget] = useState(5000);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch }) as TaxScenario);
  const without = useMemo(
    () => ({ ...plan, scenarios: plan.scenarios.filter((s) => s.id !== draft.id) }),
    [plan, draft.id],
  );
  const before = calculateTax(without, portfolio);
  const after = calculateTax({ ...without, scenarios: [...without.scenarios, { ...draft, enabled: true }] }, portfolio);
  const savingAmount = before.federalTax - after.federalTax;
  const rental = draft.type === 'rental' ? rentalDetails(draft) : null;
  const solved = useMemo(
    () => (draft.type === 'rental' ? solveRentalPrice(plan, portfolio, draft, target) : null),
    [plan, portfolio, draft, target],
  );
  const money = (key: string, label: string, hint?: string) => (
    <MoneyField
      label={label}
      hint={hint}
      value={(draft as unknown as Record<string, number>)[key]}
      onChange={(n) => update({ [key]: n ?? 0 })}
    />
  );
  return (
    <Modal
      open
      title={draft.type === 'rental' ? 'Real Estate Scenario' : 'Deduction Scenario'}
      onCancel={onClose}
      footer={null}
      width={800}
      className="tax-dialog"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setSaving(true);
          try {
            await onSave(scenarioSchema.parse(draft));
            onClose();
          } catch (e) {
            setError(errorMessage(e, 'Could not save scenario.'));
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="tax-description">
          Explore the effect on your {plan.year} forecast. These scenarios change the estimate; they do not record a
          purchase or payment.
        </p>
        <Field label="Scenario Name">
          <input required maxLength={120} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        {draft.type === 'rental' ? (
          <>
            <div className="tax-form-grid">
              {money('purchasePrice', 'Property Purchase Price')}
              <Field label="Land Allocation (%)" hint="Land is not depreciable.">
                <input
                  required
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={draft.landPercent}
                  onChange={(e) => update({ landPercent: Number(e.target.value) })}
                />
              </Field>
              <Field label="Down Payment (%)">
                <input
                  required
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={draft.downPaymentPercent}
                  onChange={(e) => update({ downPaymentPercent: Number(e.target.value) })}
                />
              </Field>
              {money(
                'closingCosts',
                'Cash Closing Costs',
                'Counted toward cash required; not deducted or added to depreciation basis in this model.',
              )}
              <Field label="Placed in Service" hint="First month available for rent in this tax year.">
                <select value={draft.serviceMonth} onChange={(e) => update({ serviceMonth: Number(e.target.value) })}>
                  {months.slice(1).map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m} {plan.year}
                    </option>
                  ))}
                </select>
              </Field>
              {money('rent', `Rental Income During ${plan.year}`, 'Total for this year, not a monthly rent amount.')}
              {money(
                'expenses',
                'Operating Expenses This Year',
                'Eligible repairs, taxes, insurance, management. Exclude principal, improvements and interest entered separately.',
              )}
              {money('mortgageInterest', 'Mortgage Interest This Year')}
              {money(
                'atRiskLimit',
                'Available Basis / At-Risk Loss Limit',
                'Enter the smaller eligible loss limit after reviewing basis and at-risk rules. Defaults to $0 until supplied.',
              )}
              <Field label="Rental Participation">
                <select
                  value={draft.participation}
                  onChange={(e) => update({ participation: e.target.value, eligibilityConfirmed: false })}
                >
                  <option value="passive">Passive rental</option>
                  <option value="active">Active participation · special allowance</option>
                  <option value="professional">Real estate professional + material participation</option>
                </select>
              </Field>
            </div>
            {draft.participation !== 'passive' && (
              <label className="tax-check">
                <input
                  type="checkbox"
                  required
                  checked={draft.eligibilityConfirmed}
                  onChange={(e) => update({ eligibilityConfirmed: e.target.checked })}
                />
                {draft.participation === 'active'
                  ? 'I meet the active-participation and ownership requirements for the rental loss allowance.'
                  : 'I meet both real-estate professional and material-participation requirements for this activity.'}
              </label>
            )}
            <p className="tax-notice">
              A property purchase is not a dollar-for-dollar deduction. The estimate depreciates the building over 27.5
              years using the first-year mid-month convention. Passive losses may be suspended; the active-participation
              allowance phases out with income.
            </p>
          </>
        ) : (
          <>
            <div className="tax-form-grid">
              <Field label="Tax Treatment">
                <select value={draft.category} onChange={(e) => update({ category: e.target.value })}>
                  <option value="adjustment">Adjustment to income · eligible amount</option>
                  <option value="itemized">Itemized deduction · eligible amount</option>
                  <option value="business">Business expense · offsets 1099 profit</option>
                </select>
              </Field>
              {money(
                'amount',
                'Eligible Deduction Amount',
                'Amount after contribution limits, income phaseouts and other eligibility rules.',
              )}
              {money('cashCost', 'Cash Required', 'The amount you will actually spend or contribute.')}
              {draft.category === 'business' && plan.profile.filingStatus === 'joint' && (
                <Field label="Business Owner">
                  <select value={draft.owner} onChange={(e) => update({ owner: e.target.value })}>
                    <option value="taxpayer">You</option>
                    <option value="spouse">Spouse</option>
                  </select>
                </Field>
              )}
            </div>
            <p className="tax-notice">
              Enter an eligible deduction, such as a deductible retirement contribution or business expense. Eligibility
              is not determined automatically. Do not deduct amounts already excluded from your income. Itemized
              deductions only help once they exceed your standard deduction.
            </p>
          </>
        )}
        <section className="tax-result-panel" aria-label="Live estimate">
          <div className="tax-result-heading">
            <h3>Effect on Your {plan.year} Tax</h3>
            <Capsule>Live estimate</Capsule>
          </div>
          <dl className="tax-rows">
            <div className="tax-total-row">
              <dt>{savingAmount >= 0 ? 'Federal tax saved' : 'Added federal tax'}</dt>
              <dd className={savingAmount > 0.5 ? 'tax-gain' : undefined}>{usd(Math.abs(savingAmount))}</dd>
            </div>
            <div>
              <dt>Taxable income</dt>
              <dd>{signedUsd(after.taxableIncome - before.taxableIncome)}</dd>
            </div>
            <div>
              <dt>Cash required</dt>
              <dd>{usd(rental?.cashRequired ?? (draft.type === 'deduction' ? draft.cashCost : 0))}</dd>
            </div>
            {rental && (
              <>
                <div>
                  <dt>First-year depreciation</dt>
                  <dd>{usd(rental.depreciation)}</dd>
                </div>
                <div>
                  <dt>Property income / loss</dt>
                  <dd>{signedUsd(rental.net)}</dd>
                </div>
                {after.rental.suspendedLoss > 0 && (
                  <div>
                    <dt>Suspended passive losses, all properties</dt>
                    <dd>{usd(after.rental.suspendedLoss)}</dd>
                  </div>
                )}
                {after.rental.atRiskDisallowed > 0 && (
                  <div>
                    <dt>Over your basis / at-risk limit</dt>
                    <dd>{usd(after.rental.atRiskDisallowed)}</dd>
                  </div>
                )}
              </>
            )}
          </dl>
        </section>
        {draft.type === 'rental' && (
          <details className="tax-disclosure" open={!scenario}>
            <summary>How Much Would I Need to Spend?</summary>
            <MoneyField label="Federal Tax I Want to Save" value={target} onChange={(n) => setTarget(n ?? 0)} />
            <p className="tax-notice">
              {solved === null
                ? 'No property price up to $10 million reaches this target with your income, participation and loss limit. Passive losses can’t offset wages, so spending more wouldn’t help this year.'
                : `About ${usd(solved)} of property, needing ${usd(rentalDetails({ ...draft, purchasePrice: solved }).cashRequired)} in cash this year. Rent, expenses, service month, land share and your loss limit are held as entered. A what-if, not investment advice.`}
            </p>
          </details>
        )}
        <Field label="Notes">
          <textarea rows={2} maxLength={1000} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
        </Field>
        <ErrorNotice error={error} />
        <div className="tax-modal-footer">
          <Button shape="round" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="primary" shape="round" htmlType="submit" loading={saving}>
            Save Scenario
          </Button>
        </div>
      </form>
    </Modal>
  );
}
