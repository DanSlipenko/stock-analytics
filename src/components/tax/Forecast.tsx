'use client';

import { useState } from 'react';
import { Segmented } from 'antd';
import { businessByMonth, byMonth, type MonthTotals } from '@/lib/tax/monthly';
import type { TaxPlan } from '@/lib/tax/schema';
import { cn } from '@/lib/utils';
import { Section, months, signedUsd, usd } from './controls';

type View = 'All Income' | 'Business';
// The bars above and below the baseline, the tooltip's figures and the table row for one month.
type Column = {
  name: string;
  up: MonthTotals;
  down: MonthTotals;
  figures: [label: string, value: string][];
  cells: string[];
};

const none: MonthTotals = { actual: 0, projected: 0 };
const total = (m: MonthTotals) => m.actual + m.projected;
const add = (a: MonthTotals, b: MonthTotals) => ({ actual: a.actual + b.actual, projected: a.projected + b.projected });
const above = (m: MonthTotals) => ({ actual: Math.max(0, m.actual), projected: Math.max(0, m.projected) });
const below = (m: MonthTotals) => ({ actual: Math.max(0, -m.actual), projected: Math.max(0, -m.projected) });

/** One bar: actual next to the baseline, projected beyond it, so its length is the month's total. */
function Bar({ value, scale, className }: { value: MonthTotals; scale: number; className?: string }) {
  const sum = total(value);
  // An empty month draws nothing, not a hairline stub.
  if (!sum) return null;
  return (
    <span className={cn('tax-stack', className)} style={{ height: `${Math.max(3, (sum / scale) * 100)}%` }}>
      {value.actual > 0 && <i className="tax-bar-actual" style={{ flexGrow: value.actual }} />}
      {value.projected > 0 && <i className="tax-bar-projected" style={{ flexGrow: value.projected }} />}
    </span>
  );
}

export default function Forecast({ plan, onMonth }: { plan: TaxPlan; onMonth: (month: number) => void }) {
  const businessIncome = plan.income.filter((r) => r.kind === 'selfEmployment');
  const hasBusiness = businessIncome.length > 0 || plan.expenses.length > 0;
  const [picked, setPicked] = useState<View>('All Income');
  const business = hasBusiness && picked === 'Business';

  let columns: Column[];
  let year: Column;
  let headings: string[];
  if (business) {
    headings = ['Income', 'Expenses', 'Net'];
    const describe = (name: string, income: MonthTotals, expenses: MonthTotals): Column => {
      const net = signedUsd(total(income) - total(expenses));
      return {
        name,
        up: income,
        down: expenses,
        figures: [
          ['Income', usd(total(income))],
          ['Expenses', usd(total(expenses))],
          ['Net', net],
        ],
        cells: [usd(total(income)), usd(total(expenses)), net],
      };
    };
    const rows = businessByMonth(plan.income, plan.expenses);
    columns = rows.map((m, i) => describe(months[i + 1], m.income, m.expenses));
    year = describe(
      'Full year',
      rows.map((m) => m.income).reduce(add, none),
      rows.map((m) => m.expenses).reduce(add, none),
    );
  } else {
    headings = ['Actual', 'Projected', 'Total'];
    const describe = (name: string, m: MonthTotals): Column => {
      // Only the parts a month has, with a total when it has both.
      const figures: Column['figures'] = [];
      if (m.actual) figures.push(['Actual', usd(m.actual)]);
      if (m.projected) figures.push(['Projected', usd(m.projected)]);
      if (m.actual && m.projected) figures.push(['Total', usd(total(m))]);
      return {
        name,
        up: above(m),
        down: below(m),
        figures: figures.length ? figures : [['Income', usd(0)]],
        cells: [usd(m.actual), usd(m.projected), usd(total(m))],
      };
    };
    const rows = byMonth(plan.income, (r) => r.amount);
    columns = rows.map((m, i) => describe(months[i + 1], m));
    year = describe('Full year', rows.reduce(add, none));
  }

  // Bars above and below the baseline share one scale, so the baseline sits where the two maxima meet.
  const maxUp = Math.max(0, ...columns.map((c) => total(c.up)));
  const maxDown = Math.max(0, ...columns.map((c) => total(c.down)));
  const spread = (business ? [...businessIncome, ...plan.expenses] : plan.income).some((r) => r.month === 0);
  const downClass = business ? 'tax-bar-out' : 'tax-bar-loss';

  return (
    <Section
      id="tax-forecast-title"
      title={business ? 'Business by Month' : 'Income by Month'}
      actions={
        <>
          {hasBusiness && (
            <Segmented<View>
              size="small"
              aria-label="Chart view"
              options={['All Income', 'Business']}
              value={business ? 'Business' : 'All Income'}
              onChange={setPicked}
            />
          )}
          <div className="tax-legend" aria-hidden="true">
            {business ? (
              <>
                <span>
                  <i className="tax-bar-actual" />
                  Income
                </span>
                <span>
                  <i className="tax-bar-actual tax-bar-out" />
                  Expenses
                </span>
              </>
            ) : (
              <span>
                <i className="tax-bar-actual" />
                Actual
              </span>
            )}
            <span>
              <i className="tax-bar-projected" />
              Projected
            </span>
            {!business && maxDown > 0 && (
              <span>
                <i className="tax-bar-actual tax-bar-loss" />
                Loss
              </span>
            )}
          </div>
        </>
      }
    >
      <div className="campaigns-panel tax-panel">
        <div
          className="tax-month-chart"
          role="group"
          aria-label={`${business ? 'Monthly business income and expenses' : 'Monthly income'} for ${plan.year}`}
        >
          {columns.map((c, i) => (
            <button
              key={c.name}
              type="button"
              className="tax-month"
              onClick={() => onMonth(i + 1)}
              aria-label={`${c.name}: ${c.figures.map((f) => f.join(' ')).join(', ')}. Edit this month.`}
            >
              {/* Inside the panel, so the outer months anchor to their edge instead of overflowing. */}
              <span
                className={cn('tax-month-tip', i < 2 && 'tax-month-tip-start', i > 9 && 'tax-month-tip-end')}
                aria-hidden="true"
              >
                <strong>{c.name}</strong>
                {c.figures.map(([label, value]) => (
                  <span key={label}>
                    {label}
                    <b>{value}</b>
                  </span>
                ))}
              </span>
              <span className="tax-month-bars" aria-hidden="true">
                <span className="tax-month-up" style={{ flexGrow: maxUp || 1 }}>
                  <Bar value={c.up} scale={maxUp} />
                </span>
                {maxDown > 0 && (
                  <span className="tax-month-down" style={{ flexGrow: maxDown }}>
                    <Bar value={c.down} scale={maxDown} className={downClass} />
                  </span>
                )}
              </span>
              <span>{c.name.slice(0, 3)}</span>
            </button>
          ))}
        </div>
        <p className="tax-footnote">
          {business
            ? '1099 income above the line, business expenses below.'
            : 'Income before business expenses and deductions.'}
          {spread && ' Full-year totals are spread evenly across the twelve months.'} Choose a month to edit its income
          and expenses.
        </p>
        <details className="tax-disclosure">
          <summary>Monthly Amounts</summary>
          <table className="tax-month-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                {headings.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...columns, year].map((c) => (
                <tr key={c.name} className={c === year ? 'tax-total-row' : undefined}>
                  <th scope="row">{c.name}</th>
                  {c.cells.map((cell, i) => (
                    <td key={headings[i]}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </Section>
  );
}
