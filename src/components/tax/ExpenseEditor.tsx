'use client';

import { useState } from 'react';
import { Button, Modal } from 'antd';
import { calculateTax } from '@/lib/tax/calculate';
import type { TaxPortfolio } from '@/lib/tax/portfolio';
import {
  deductibleShare,
  errorMessage,
  expenseCategories,
  expenseLabels,
  expenseSchema,
  type ExpenseEntry,
  type TaxPlan,
} from '@/lib/tax/schema';
import { Capsule, ErrorNotice, Field, MoneyField, months, usd } from './controls';

function blankExpense(): ExpenseEntry {
  return {
    id: crypto.randomUUID(),
    description: '',
    category: 'software',
    owner: 'taxpayer',
    month: 0,
    status: 'actual',
    amount: 0,
    notes: '',
  };
}

export default function ExpenseEditor({
  plan,
  portfolio,
  entry,
  onClose,
  onSave,
}: {
  plan: TaxPlan;
  portfolio: TaxPortfolio;
  entry?: ExpenseEntry;
  onClose: () => void;
  onSave: (entries: ExpenseEntry[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ExpenseEntry>(() => entry ?? blankExpense());
  const [endMonth, setEndMonth] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (patch: Partial<ExpenseEntry>) => setDraft((d) => ({ ...d, ...patch }));

  // A new monthly expense can repeat, e.g. a subscription billed every month.
  const repeatCount = !entry && draft.month > 0 && endMonth > draft.month ? endMonth - draft.month + 1 : 1;
  const expand = (first: ExpenseEntry, id: (i: number) => string) =>
    Array.from({ length: repeatCount }, (_, i) => ({ ...first, id: id(i), month: first.month + i }));

  // Live effect on the full-year federal estimate, with every repeated month included.
  const others = plan.expenses.filter((e) => e.id !== draft.id);
  const before = calculateTax({ ...plan, expenses: others }, portfolio);
  const after = calculateTax(
    { ...plan, expenses: [...others, ...expand({ ...draft, amount: draft.amount || 0 }, (i) => `${draft.id}-${i}`)] },
    portfolio,
  );
  const saved = Math.max(0, before.federalTax - after.federalTax);
  const seSaved = Math.max(0, before.seTax - after.seTax);
  const deductible = (draft.amount || 0) * deductibleShare(draft.category) * repeatCount;
  const ownerHasBusiness = plan.income.some((r) => r.kind === 'selfEmployment' && r.owner === draft.owner);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const first = expenseSchema.parse(draft);
      await onSave(expand(first, (i) => (i ? crypto.randomUUID() : first.id)));
      onClose();
    } catch (e) {
      setError(errorMessage(e, 'Could not save the expense.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={entry ? 'Edit Business Expense' : 'Add Business Expense'}
      onCancel={onClose}
      footer={null}
      width={720}
      className="tax-dialog"
      mask={{ closable: !saving }}
    >
      <form onSubmit={save}>
        <p className="tax-description">
          {plan.year} · A cost of your 1099 work. Record what you’ve paid, or forecast what you expect to spend.
        </p>
        <div className="tax-form-grid">
          <Field label="What You Paid For">
            <input
              required
              maxLength={120}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="e.g. Adobe Creative Cloud"
            />
          </Field>
          <Field
            label="Category"
            hint={draft.category === 'meals' ? 'Only half of a business meal is deductible.' : undefined}
          >
            <select
              value={draft.category}
              onChange={(e) => update({ category: e.target.value as ExpenseEntry['category'] })}
            >
              {expenseCategories.map((c) => (
                <option key={c} value={c}>
                  {expenseLabels[c]}
                </option>
              ))}
            </select>
          </Field>
          <MoneyField
            label={repeatCount > 1 ? 'Amount per Month' : 'Amount'}
            value={draft.amount}
            onChange={(n) => update({ amount: n ?? 0 })}
            hint={
              repeatCount > 1 ? `${usd((draft.amount || 0) * repeatCount)} across ${repeatCount} months` : undefined
            }
          />
          <Field label="Status">
            <select value={draft.status} onChange={(e) => update({ status: e.target.value as ExpenseEntry['status'] })}>
              <option value="actual">Actual · already paid</option>
              <option value="projected">Projected · expected</option>
            </select>
          </Field>
          <Field label="Period">
            <select
              value={draft.month}
              onChange={(e) => {
                update({ month: Number(e.target.value) });
                setEndMonth(0);
              }}
            >
              {months.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          {!entry && draft.month > 0 && (
            <Field label="Repeat Monthly Through" hint="For subscriptions and other recurring costs.">
              <select value={endMonth || draft.month} onChange={(e) => setEndMonth(Number(e.target.value))}>
                {months.map(
                  (m, i) =>
                    i >= draft.month && (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ),
                )}
              </select>
            </Field>
          )}
          {plan.profile.filingStatus === 'joint' && (
            <Field label="Whose Business">
              <select value={draft.owner} onChange={(e) => update({ owner: e.target.value as ExpenseEntry['owner'] })}>
                <option value="taxpayer">Yours</option>
                <option value="spouse">Spouse’s</option>
              </select>
            </Field>
          )}
        </div>

        {!ownerHasBusiness && (
          <p className="tax-notice">
            There’s no 1099 income for this business in {plan.year} yet. Expenses without business income create a loss,
            and loss limits aren’t modeled here.
          </p>
        )}

        <section className="tax-result-panel" aria-label="Live estimate">
          <div className="tax-result-heading">
            <h3>Effect on Your {plan.year} Tax</h3>
            <Capsule>Live estimate</Capsule>
          </div>
          <dl className="tax-rows">
            <div className="tax-total-row">
              <dt>Federal tax saved</dt>
              <dd className={saved > 0.5 ? 'tax-gain' : undefined}>{usd(saved)}</dd>
            </div>
            {seSaved > 0.5 && (
              <div>
                <dt>Of which self-employment tax</dt>
                <dd>{usd(seSaved)}</dd>
              </div>
            )}
            <div>
              <dt>Deductible amount</dt>
              <dd>{usd(deductible)}</dd>
            </div>
          </dl>
        </section>

        <Field label="Notes">
          <textarea rows={2} maxLength={1000} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
        </Field>
        <ErrorNotice error={error} />
        <div className="tax-modal-footer">
          <Button shape="round" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="primary" shape="round" htmlType="submit" loading={saving}>
            {repeatCount > 1 ? `Save ${repeatCount} Months` : 'Save Expense'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
