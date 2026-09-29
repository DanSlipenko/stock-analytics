'use client';

import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { FileText } from 'lucide-react';
import type { TaxCalculation } from '@/lib/tax/calculate';
import type { TaxPlan } from '@/lib/tax/schema';
import Forecast from './Forecast';
import { Capsule, Empty, Section, minusUsd, percent, usd } from './controls';

function Brackets({ estimate }: { estimate: TaxCalculation }) {
  const current = estimate.marginalRate;
  return (
    <Section
      id="tax-brackets-title"
      title="Tax Brackets"
      actions={<Capsule>{estimate.rules.ruleYear} federal rates</Capsule>}
    >
      <div className="campaigns-panel tax-panel">
        <ol className="tax-bracket-list">
          {estimate.brackets.map((b) => {
            const span = b.upper === null ? Math.max(b.income, 1) : b.upper - b.lower;
            return (
              <li key={b.rate} className={b.rate === current ? 'tax-bracket tax-bracket-current' : 'tax-bracket'}>
                <span className="tax-bracket-rate">{percent(b.rate)}</span>
                <span className="tax-bracket-track" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (b.income / span) * 100)}%` }} />
                </span>
                <span className="tax-bracket-range">
                  {usd(b.lower)}
                  {b.upper === null ? '+' : ` – ${usd(b.upper)}`}
                </span>
                <strong>{usd(b.tax)}</strong>
              </li>
            );
          })}
        </ol>
        <p className="tax-footnote">
          Each rate applies only to the income inside its band.{' '}
          {estimate.bracketRoom !== null
            ? `${usd(estimate.bracketRoom)} more ordinary income stays in the ${percent(current)} bracket.`
            : 'Ordinary income reaches the top bracket.'}{' '}
          Long-term gains and qualified dividends stack on top and use the rates below.
        </p>
        <details className="tax-disclosure">
          <summary>Capital Gains Rates</summary>
          <dl className="tax-rows">
            {estimate.capitalBrackets.map((b) => (
              <div key={b.rate}>
                <dt>
                  {percent(b.rate)} · {usd(b.lower)}
                  {b.upper === null ? '+' : ` – ${usd(b.upper)}`}
                </dt>
                <dd>
                  {usd(b.tax)}
                  <small> on {usd(b.income)}</small>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </Section>
  );
}

function Breakdown({
  plan,
  estimate,
  includeProjected,
}: {
  plan: TaxPlan;
  estimate: TaxCalculation;
  includeProjected: boolean;
}) {
  const row = (label: string, value: string, total = false) => (
    <div key={label} className={total ? 'tax-total-row' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  const otherIncome = estimate.interest + estimate.ordinaryDividends + estimate.qualifiedDividends + estimate.other;
  return (
    <Section
      id="tax-breakdown-title"
      title="How It Adds Up"
      actions={<Capsule>{includeProjected ? 'Full-year forecast' : 'Recorded income only'}</Capsule>}
    >
      <div className="campaigns-panel tax-panel">
        <dl className="tax-rows">
          {row('W-2 wages', usd(estimate.wages))}
          {row('1099 income', usd(estimate.businessIncome))}
          {estimate.businessExpenses > 0 && row('Business expenses', minusUsd(estimate.businessExpenses))}
          {estimate.businessScenarioDeduction > 0 &&
            row('Planned business purchases', minusUsd(estimate.businessScenarioDeduction))}
          {otherIncome !== 0 && row('Interest, dividends & other', usd(otherIncome))}
          {row('Stock gains / losses', usd(estimate.capital.ordinary + estimate.capital.preferential))}
          {estimate.rental.rows.length > 0 && row('Rental income / allowed loss', usd(estimate.rental.taxable))}
          {row('Adjustments', minusUsd(estimate.adjustments))}
          {row('Adjusted gross income', usd(estimate.agi), true)}
          {row(`${estimate.usesItemized ? 'Itemized' : 'Standard'} deduction`, minusUsd(estimate.deduction))}
          {estimate.qbiDeduction > 0 && row('QBI deduction', minusUsd(estimate.qbiDeduction))}
          {row('Taxable income', usd(estimate.taxableIncome), true)}
          {row('Income tax', usd(estimate.ordinaryTax))}
          {row('Capital gains tax', usd(estimate.capitalTax))}
          {estimate.seTax > 0 && row('Self-employment tax', usd(estimate.seTax))}
          {estimate.niit > 0 && row('Net investment income tax', usd(estimate.niit))}
          {estimate.additionalMedicare > 0 && row('Additional Medicare tax', usd(estimate.additionalMedicare))}
          {estimate.creditsUsed > 0 && row('Credits', minusUsd(estimate.creditsUsed))}
          {row('Federal tax', usd(estimate.federalTax), true)}
          {plan.profile.stateRate !== null && (
            <>
              {row(
                `${plan.profile.stateName || 'State'} estimate · ${plan.profile.stateRate}%`,
                usd(estimate.stateTax),
              )}
              {row('Federal + state', usd(estimate.totalTax), true)}
            </>
          )}
        </dl>
        {estimate.capital.lossCarryforward > 0 && (
          <p className="tax-notice">
            {usd(estimate.capital.lossCarryforward)} of capital loss is left over. Enter it as a carryover in next
            year’s settings; it isn’t copied automatically.
          </p>
        )}
      </div>
    </Section>
  );
}

export default function Overview({
  plan,
  estimate,
  includeProjected,
  onAddIncome,
  onMonth,
}: {
  plan: TaxPlan;
  estimate: TaxCalculation;
  includeProjected: boolean;
  onAddIncome: () => void;
  onMonth: (month: number) => void;
}) {
  return (
    <>
      {plan.income.length ? (
        <Forecast plan={plan} onMonth={onMonth} />
      ) : (
        <section className="campaigns-section" aria-label="Add income">
          <div className="campaigns-panel">
            <Empty
              icon={<FileText size={28} strokeWidth={1.6} />}
              title="Add Your W-2 and 1099 Income"
              action={
                <Button type="primary" shape="round" size="large" icon={<PlusOutlined />} onClick={onAddIncome}>
                  Add Income
                </Button>
              }
            >
              Import a W-2 or 1099, or type in what you’ve earned and expect to earn. Your stock sales are already
              counted.
            </Empty>
          </div>
        </section>
      )}
      <div className="tax-two-column">
        <Brackets estimate={estimate} />
        <Breakdown plan={plan} estimate={estimate} includeProjected={includeProjected} />
      </div>
    </>
  );
}
