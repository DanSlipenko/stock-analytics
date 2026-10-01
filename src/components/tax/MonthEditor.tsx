'use client';

import { useState } from 'react';
import { Button, Modal } from 'antd';
import { expenseKey, fromGrid, incomeKey, toGrid, type MonthGrid, type Status } from '@/lib/tax/monthly';
import {
  errorMessage,
  expenseLabels,
  incomeLabels,
  type ExpenseEntry,
  type IncomeEntry,
  type TaxPlan,
} from '@/lib/tax/schema';
import { ErrorNotice, StatusPicker, months, usd } from './controls';

type Entry = IncomeEntry | ExpenseEntry;

/** One payer or cost across the year: each month's amount, marked projected or actual. */
function MonthEditor<T extends Entry>({
  title,
  description,
  year,
  entries,
  withheld,
  signed,
  blank,
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  year: number;
  entries: T[];
  /** Show the federal tax withheld from each month's payment. */
  withheld: boolean;
  /** Allow negative amounts, e.g. a month's capital loss. */
  signed: boolean;
  blank: (month: number, status: Status) => T;
  onClose: () => void;
  onSave: (entries: T[], remove: string[]) => Promise<void>;
}) {
  const [grid, setGrid] = useState<MonthGrid>(() => toGrid(entries, year));
  const [changed, setChanged] = useState(false);
  const [every, setEvery] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = <K extends keyof MonthGrid>(column: K, m: number, value: MonthGrid[K][number]) => {
    setGrid((g) => ({ ...g, [column]: g[column].map((v, i) => (i === m ? value : v)) }));
    setChanged(true);
  };
  const filled = grid.amount.flatMap((a, m) => (a === undefined ? [] : [{ amount: a, status: grid.status[m] }]));
  const sum = (status: Status) => filled.reduce((n, f) => n + (f.status === status ? f.amount : 0), 0);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!changed) return onClose();
    if (!filled.length) {
      setError('Enter at least one month, or delete this entry from the list instead.');
      return;
    }
    setSaving(true);
    try {
      const result = fromGrid(entries, grid, blank, () => crypto.randomUUID());
      await onSave(result.entries, result.remove);
      onClose();
    } catch (e) {
      setError(errorMessage(e, 'Could not save the months.'));
    } finally {
      setSaving(false);
    }
  }

  const money = (
    label: string,
    value: number | undefined,
    onChange: (n: number | undefined) => void,
    disabled = false,
  ) => (
    <span className="tax-money-input">
      <span aria-hidden="true">$</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min={signed ? undefined : 0}
        max={1_000_000_000}
        aria-label={label}
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </span>
  );

  return (
    <Modal
      open
      title={title}
      onCancel={onClose}
      footer={null}
      width={720}
      className="tax-dialog"
      mask={{ closable: !saving && !changed }}
    >
      <form onSubmit={save}>
        <p className="tax-description">{description}</p>
        <table className="tax-grid tax-inputs">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Amount</th>
              <th scope="col">Status</th>
              {withheld && <th scope="col">Withheld</th>}
            </tr>
          </thead>
          <tbody>
            {months.slice(1).map((name, m) => {
              const empty = grid.amount[m] === undefined;
              return (
                <tr key={name}>
                  <th scope="row">
                    <abbr title={name}>{name.slice(0, 3)}</abbr>
                  </th>
                  <td>{money(`${name} amount`, grid.amount[m], (n) => update('amount', m, n))}</td>
                  <td>
                    <StatusPicker
                      label={`${name} status`}
                      value={grid.status[m]}
                      disabled={empty}
                      onChange={(status) => update('status', m, status)}
                    />
                  </td>
                  {withheld && (
                    <td>
                      {money(
                        `${name} federal tax withheld`,
                        empty ? undefined : grid.withheld[m] || undefined,
                        (n) => update('withheld', m, n ?? 0),
                        empty,
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="tax-grid-fill tax-inputs">
          {money('Amount for every month', every, setEvery)}
          <Button
            shape="round"
            disabled={every === undefined}
            onClick={() => {
              setGrid((g) => ({ ...g, amount: g.amount.map(() => every) }));
              setChanged(true);
            }}
          >
            Use for Every Month
          </Button>
        </div>

        <dl className="tax-rows">
          <div>
            <dt>Actual</dt>
            <dd>{usd(sum('actual'), 2)}</dd>
          </div>
          <div>
            <dt>Projected</dt>
            <dd>{usd(sum('projected'), 2)}</dd>
          </div>
          <div className="tax-total-row">
            <dt>Total for {year}</dt>
            <dd>{usd(sum('actual') + sum('projected'), 2)}</dd>
          </div>
        </dl>

        <ErrorNotice error={error} />
        <div className="tax-modal-footer">
          <Button shape="round" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="primary" shape="round" htmlType="submit" loading={saving}>
            Save Months
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const EXPLAIN =
  'Mark each month Projected if you’re expecting it, or Actual once it’s real. Leave a month blank for no entry; $0 means nothing.';

export function IncomeMonths({
  plan,
  groupKey,
  onClose,
  onSave,
}: {
  plan: TaxPlan;
  groupKey: string;
  onClose: () => void;
  onSave: (entries: IncomeEntry[], remove: string[]) => Promise<void>;
}) {
  const entries = plan.income.filter((r) => incomeKey(r) === groupKey);
  const first = entries[0];
  if (!first) return null;
  return (
    <MonthEditor<IncomeEntry>
      title={first.source}
      description={`${incomeLabels[first.kind]}${first.owner === 'spouse' ? ' · Spouse' : ''} · ${plan.year}. ${EXPLAIN}`}
      year={plan.year}
      entries={entries}
      withheld={!['shortTerm', 'longTerm'].includes(first.kind)}
      signed={['shortTerm', 'longTerm', 'other'].includes(first.kind)}
      blank={(month, status) => ({
        id: '',
        source: first.source,
        kind: first.kind,
        owner: first.owner,
        month,
        status,
        amount: 0,
        expenses: 0,
        withholding: 0,
        notes: '',
      })}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

export function ExpenseMonths({
  plan,
  groupKey,
  onClose,
  onSave,
}: {
  plan: TaxPlan;
  groupKey: string;
  onClose: () => void;
  onSave: (entries: ExpenseEntry[], remove: string[]) => Promise<void>;
}) {
  const entries = plan.expenses.filter((e) => expenseKey(e) === groupKey);
  const first = entries[0];
  if (!first) return null;
  return (
    <MonthEditor<ExpenseEntry>
      title={first.description}
      description={`${expenseLabels[first.category]}${first.owner === 'spouse' ? ' · Spouse’s business' : ''} · ${plan.year}. ${EXPLAIN}`}
      year={plan.year}
      entries={entries}
      withheld={false}
      signed={false}
      blank={(month, status) => ({
        id: '',
        description: first.description,
        category: first.category,
        owner: first.owner,
        month,
        status,
        amount: 0,
        notes: '',
      })}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
