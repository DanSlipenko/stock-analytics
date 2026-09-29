'use client';
import { useState } from 'react';
import { Button, Modal } from 'antd';
import { errorMessage, profileSchema, type TaxPlan, type TaxProfile } from '@/lib/tax/schema';
import type { TaxPortfolio } from '@/lib/tax/portfolio';
import { filingLabels } from '@/lib/tax/rules';
import { ErrorNotice, Field, MoneyField } from './controls';

export default function ProfileEditor({
  plan,
  portfolio,
  onClose,
  onSave,
}: {
  plan: TaxPlan;
  portfolio: TaxPortfolio;
  onClose: () => void;
  onSave: (profile: TaxProfile) => Promise<void>;
}) {
  const [profile, setProfile] = useState(plan.profile);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<TaxProfile>) => setProfile((p) => ({ ...p, ...patch }));
  const money = (key: keyof TaxProfile, label: string, hint?: string) => (
    <MoneyField label={label} hint={hint} value={profile[key] as number} onChange={(n) => update({ [key]: n ?? 0 })} />
  );
  return (
    <Modal open title={`Settings · ${plan.year}`} onCancel={onClose} footer={null} width={730} className="tax-dialog">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setSaving(true);
          try {
            await onSave(profileSchema.parse({ ...profile, confirmed: true }));
            onClose();
          } catch (e) {
            setError(errorMessage(e, 'Could not save settings.'));
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="tax-form-grid">
          <Field label="Filing Status">
            <select
              value={profile.filingStatus}
              onChange={(e) => update({ filingStatus: e.target.value as TaxProfile['filingStatus'] })}
            >
              {Object.entries(filingLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Stock Gains Source"
            hint="One source for the entire year, so 1099-B and tracked sales never overlap."
          >
            <select
              value={profile.stockSource}
              onChange={(e) => update({ stockSource: e.target.value as TaxProfile['stockSource'] })}
            >
              <option value="portfolio">Linked portfolio sales</option>
              <option value="reported">1099-B / reported totals</option>
            </select>
          </Field>
          <Field label="State / Locality" hint="Optional label for your custom estimate.">
            <input
              maxLength={60}
              placeholder="e.g. Illinois"
              value={profile.stateName}
              onChange={(e) => update({ stateName: e.target.value })}
            />
          </Field>
          <Field
            label="Custom State Rate (%)"
            hint="Blank excludes state tax. Estimate = rate × positive federal AGI; this is not a state return."
          >
            <input
              type="number"
              min={0}
              max={15}
              step="0.01"
              value={profile.stateRate ?? ''}
              onChange={(e) => update({ stateRate: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>
        </div>
        {profile.filingStatus === 'separate' && (
          <label className="tax-check">
            <input
              type="checkbox"
              checked={profile.separateLivedApart}
              onChange={(e) => update({ separateLivedApart: e.target.checked })}
            />
            Lived apart from spouse for the entire year (rental allowance)
          </label>
        )}
        <details className="tax-disclosure" open>
          <summary>Taxable Accounts</summary>
          <p className="tax-description">
            Exclude retirement, tax-deferred and other accounts whose sales are not currently taxable. Unassigned
            holdings are included; assign them to an account in your campaign if needed.
          </p>
          {portfolio.locations.length ? (
            portfolio.locations.map((l) => (
              <label key={l.id} className="tax-check">
                <input
                  type="checkbox"
                  checked={!profile.excludedLocationIds.includes(l.id)}
                  onChange={(e) =>
                    update({
                      excludedLocationIds: e.target.checked
                        ? profile.excludedLocationIds.filter((id) => id !== l.id)
                        : [...profile.excludedLocationIds, l.id],
                    })
                  }
                />
                {l.name}
              </label>
            ))
          ) : (
            <p className="tax-description">Accounts appear here when you add portfolio holdings.</p>
          )}
        </details>
        <details className="tax-disclosure">
          <summary>Deductions & Credits</summary>
          <p className="tax-description">
            Enter eligible amounts after their own caps and phaseouts. Do not re-enter deductions already removed from
            W-2 box 1. The planner chooses the larger of standard and itemized deductions, unless forced.
          </p>
          <div className="tax-form-grid">
            {money(
              'adjustments',
              'Eligible Adjustments to Income',
              'e.g. deductible IRA or HSA contributions not already excluded from wages.',
            )}
            {money(
              'itemizedDeductions',
              'Eligible Itemized Deductions',
              'After SALT, mortgage interest and charitable limits. Top-bracket reduction is calculated.',
            )}
            {money(
              'qbiDeduction',
              'Eligible QBI Deduction',
              'Enter the reviewed amount; the taxable-income ceiling is applied.',
            )}
            {money(
              'credits',
              'Nonrefundable Federal Credits',
              'After eligibility and phaseout limits; capped at income tax.',
            )}
          </div>
          <label className="tax-check">
            <input
              type="checkbox"
              checked={profile.forceItemized}
              onChange={(e) => update({ forceItemized: e.target.checked })}
            />
            Force itemized deductions (for example, spouse itemizes on a separate return)
          </label>
        </details>
        <details className="tax-disclosure">
          <summary>Payments & Prior Capital Losses</summary>
          <div className="tax-form-grid">
            {money(
              'estimatedPayments',
              'Federal Estimated Payments',
              'Payments already made, in addition to entry-level withholding.',
            )}
            {money(
              'additionalMedicareWithheld',
              'Additional Medicare Tax Withheld',
              'Additional 0.9% tax only; exclude regular Medicare withholding.',
            )}
            {money('shortLossCarryover', 'Short-Term Loss Carryover', 'Prior-year unused loss, as a positive amount.')}
            {money('longLossCarryover', 'Long-Term Loss Carryover', 'Prior-year unused loss, as a positive amount.')}
          </div>
        </details>
        <ErrorNotice error={error} />
        <div className="tax-modal-footer">
          <Button shape="round" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="primary" shape="round" htmlType="submit" loading={saving}>
            Save Settings
          </Button>
        </div>
      </form>
    </Modal>
  );
}
