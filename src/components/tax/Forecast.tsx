'use client';

import type { TaxPlan } from '@/lib/tax/schema';
import { Section, months, usd } from './controls';

export default function Forecast({ plan, onMonth }: { plan: TaxPlan; onMonth: (month: number) => void }) {
  const monthly = months.slice(1).map((name, i) => {
    const entries = plan.income.filter((r) => r.month === i + 1);
    const sum = (status: 'actual' | 'projected') =>
      entries.filter((r) => r.status === status).reduce((n, r) => n + r.amount, 0);
    return { name, actual: sum('actual'), projected: sum('projected') };
  });
  const max = Math.max(1, ...monthly.flatMap((m) => [Math.abs(m.actual), Math.abs(m.projected)]));
  const annual = plan.income.filter((r) => !r.month).reduce((n, r) => n + r.amount, 0);
  // An empty month draws nothing, not a hairline stub.
  const bar = (value: number) =>
    value ? { height: `${Math.max(3, (Math.abs(value) / max) * 100)}%` } : { height: 0, visibility: 'hidden' as const };

  return (
    <Section
      id="tax-forecast-title"
      title="Income by Month"
      actions={
        <div className="tax-legend" aria-hidden="true">
          <span>
            <i className="tax-bar-actual" />
            Actual
          </span>
          <span>
            <i className="tax-bar-projected" />
            Projected
          </span>
        </div>
      }
    >
      <div className="campaigns-panel tax-panel">
        <div className="tax-month-chart" role="group" aria-label={`Monthly income for ${plan.year}`}>
          {monthly.map((m, i) => (
            <button
              key={m.name}
              type="button"
              className="tax-month"
              onClick={() => onMonth(i + 1)}
              aria-label={`${m.name}: actual ${usd(m.actual)}, projected ${usd(m.projected)}. Show entries.`}
              title={`${m.name}\nActual ${usd(m.actual)}\nProjected ${usd(m.projected)}`}
            >
              <span className="tax-month-bars" aria-hidden="true">
                <i className={`tax-bar-actual ${m.actual < 0 ? 'tax-bar-negative' : ''}`} style={bar(m.actual)} />
                <i
                  className={`tax-bar-projected ${m.projected < 0 ? 'tax-bar-negative' : ''}`}
                  style={bar(m.projected)}
                />
              </span>
              <span>{m.name.slice(0, 3)}</span>
            </button>
          ))}
        </div>
        <p className="tax-footnote">
          Income before business expenses and deductions. Choose a month to see its entries.
          {annual !== 0 && ` Full-year totals (${usd(annual)}) aren’t split across months.`} Stock sales are on the
          Stocks tab.
        </p>
        <details className="tax-disclosure">
          <summary>Monthly Amounts</summary>
          <dl className="tax-rows">
            {monthly.map((m) => (
              <div key={m.name}>
                <dt>{m.name}</dt>
                <dd>
                  {usd(m.actual)}
                  {m.projected !== 0 && <small> + {usd(m.projected)} projected</small>}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </Section>
  );
}
