'use client';

import { useMemo } from 'react';
import { Button, Popconfirm } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Building2 } from 'lucide-react';
import MetaLine from '@/components/shared/MetaLine';
import { calculateTax, rentalDetails, type comparePlan } from '@/lib/tax/calculate';
import type { TaxPortfolio } from '@/lib/tax/portfolio';
import type { TaxPlan, TaxScenario } from '@/lib/tax/schema';
import { Capsule, Empty, Section, Summary, Toggle, months, usd } from './controls';

const categoryLabels = {
  adjustment: 'Adjustment to income',
  itemized: 'Itemized deduction',
  business: 'Business expense',
};
const participationLabels = {
  passive: 'Passive',
  active: 'Active participation',
  professional: 'Real estate professional',
};

export default function Scenarios({
  plan,
  portfolio,
  comparison,
  saving,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  plan: TaxPlan;
  portfolio: TaxPortfolio;
  comparison: ReturnType<typeof comparePlan>;
  saving: boolean;
  onAdd: (kind: 'rental' | 'deduction') => void;
  onEdit: (scenario: TaxScenario) => void;
  onToggle: (scenario: TaxScenario, enabled: boolean) => void;
  onDelete: (scenario: TaxScenario) => void;
}) {
  const { baseline, planned, savings, taxableReduction, cashCost } = comparison;

  // What each scenario is worth on its own terms: an active one against the plan without it,
  // an inactive one against the plan with it switched on.
  const worth = useMemo(() => {
    const taxWith = (scenarios: TaxScenario[]) => calculateTax({ ...plan, scenarios }, portfolio).federalTax;
    const current = taxWith(plan.scenarios);
    return new Map(
      plan.scenarios.map((s) => {
        const toggled = plan.scenarios.map((other) => (other.id === s.id ? { ...other, enabled: !s.enabled } : other));
        return [s.id, s.enabled ? taxWith(toggled) - current : current - taxWith(toggled)];
      }),
    );
  }, [plan, portfolio]);

  const active = plan.scenarios.filter((s) => s.enabled).length;

  return (
    <>
      {plan.scenarios.length > 0 && (
        <Summary
          className="tax-summary-4"
          hero={{
            label: 'Estimated Tax Savings',
            value: usd(savings),
            tone: savings > 0.5 ? 'gain' : undefined,
            detail: `${usd(taxableReduction)} less taxable income · ${active} of ${plan.scenarios.length} scenarios on`,
          }}
          cells={[
            { label: 'Federal Tax Without', value: usd(baseline.federalTax) },
            { label: 'Federal Tax With Plan', value: usd(planned.federalTax) },
            {
              label: 'Cash Required',
              value: usd(cashCost),
              detail: cashCost > 0 ? `${usd(Math.max(0, cashCost - savings))} after tax savings` : undefined,
            },
          ]}
        />
      )}

      <Section
        id="tax-scenarios-title"
        title="Scenarios"
        count={plan.scenarios.length}
        footnote="Model a purchase or contribution before you spend. A deduction lowers tax by a fraction of what you spend; it never makes the spending free."
        actions={
          <>
            <Button shape="round" icon={<PlusOutlined />} onClick={() => onAdd('deduction')}>
              Deduction
            </Button>
            <Button shape="round" icon={<Building2 size={15} />} onClick={() => onAdd('rental')}>
              Real Estate
            </Button>
          </>
        }
      >
        {plan.scenarios.length ? (
          <div className="campaigns-grid">
            {plan.scenarios.map((s) => {
              const value = worth.get(s.id) ?? 0;
              const cash = s.type === 'rental' ? rentalDetails(s).cashRequired : s.cashCost;
              return (
                <article key={s.id} className={s.enabled ? 'tax-card' : 'tax-card tax-card-off'}>
                  <header className="tax-card-header">
                    <div className="tax-card-heading">
                      <h3>{s.name}</h3>
                      <MetaLine
                        className="campaign-list-card-subtitle"
                        parts={
                          s.type === 'rental'
                            ? [
                                `${usd(s.purchasePrice)} property`,
                                `in service ${months[s.serviceMonth].slice(0, 3)}`,
                                participationLabels[s.participation],
                              ]
                            : [categoryLabels[s.category], ...(s.owner === 'spouse' ? ['Spouse'] : [])]
                        }
                      />
                    </div>
                    <Toggle
                      checked={s.enabled}
                      disabled={saving}
                      label={`Include ${s.name} in the plan`}
                      onChange={(checked) => onToggle(s, checked)}
                    />
                  </header>
                  <dl className="tax-rows">
                    <div>
                      <dt>{s.enabled ? 'Tax saved' : 'Would save'}</dt>
                      <dd className={value > 0.5 ? 'tax-gain' : undefined}>{usd(value)}</dd>
                    </div>
                    {s.type === 'deduction' && (
                      <div>
                        <dt>Deduction</dt>
                        <dd>{usd(s.amount)}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Cash required</dt>
                      <dd>{usd(cash)}</dd>
                    </div>
                  </dl>
                  <footer className="tax-card-actions">
                    <Button type="text" onClick={() => onEdit(s)}>
                      Edit
                    </Button>
                    <Popconfirm
                      title="Delete this scenario?"
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      cancelText="Keep"
                      onConfirm={() => onDelete(s)}
                    >
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={saving}
                        aria-label={`Delete ${s.name}`}
                      />
                    </Popconfirm>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="campaigns-panel">
            <Empty
              icon={<Building2 size={28} strokeWidth={1.6} />}
              title="What Would Lower Your Tax?"
              action={
                <Button
                  type="primary"
                  shape="round"
                  size="large"
                  icon={<Building2 size={16} />}
                  onClick={() => onAdd('rental')}
                >
                  Model a Property
                </Button>
              }
            >
              Try a rental purchase, an IRA contribution, an itemized deduction or a business expense, then switch
              scenarios on and off to compare.
            </Empty>
          </div>
        )}
      </Section>

      {planned.rental.rows.length > 0 && (
        <Section
          id="tax-rental-title"
          title="Rental Losses"
          footnote="The special rental allowance is shared across properties. Suspended losses carry forward; they don’t reduce this year’s wages."
        >
          <div className="campaigns-panel tax-panel">
            <dl className="tax-rows">
              <div>
                <dt>First-year depreciation</dt>
                <dd>{usd(planned.rental.depreciation)}</dd>
              </div>
              <div>
                <dt>Losses used this year</dt>
                <dd>{usd(planned.rental.allowedLoss)}</dd>
              </div>
              <div>
                <dt>Suspended passive losses</dt>
                <dd>{usd(planned.rental.suspendedLoss)}</dd>
              </div>
              {planned.rental.atRiskDisallowed > 0 && (
                <div>
                  <dt>Over your basis / at-risk limit</dt>
                  <dd>{usd(planned.rental.atRiskDisallowed)}</dd>
                </div>
              )}
            </dl>
          </div>
        </Section>
      )}
    </>
  );
}
