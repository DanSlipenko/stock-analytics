'use client';

import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Receipt } from 'lucide-react';
import { expenseKey } from '@/lib/tax/monthly';
import { deductibleShare, expenseLabels, type ExpenseEntry, type TaxPlan } from '@/lib/tax/schema';
import { Empty, ListGroup, ListRow, Section, months, usd } from './controls';

const spent = (entries: ExpenseEntry[]) => entries.reduce((sum, e) => sum + e.amount, 0);
const halfDeductible = (e: Pick<ExpenseEntry, 'category'>) =>
  deductibleShare(e.category) < 1 ? ['50% deductible'] : [];

export default function ExpenseList({
  plan,
  month,
  saving,
  onAdd,
  onEdit,
  onDelete,
  onMonths,
}: {
  plan: TaxPlan;
  month: number;
  saving: boolean;
  onAdd: () => void;
  onEdit: (entry: ExpenseEntry) => void;
  onDelete: (entry: ExpenseEntry) => void;
  onMonths: (key: string) => void;
}) {
  const shown = plan.expenses.filter((e) => month < 0 || e.month === month || (month > 0 && e.month === 0));
  // One group per cost, so a subscription paid every month reads as one line.
  const groups = [
    ...shown
      .reduce(
        (map, e) => map.set(expenseKey(e), [...(map.get(expenseKey(e)) ?? []), e]),
        new Map<string, ExpenseEntry[]>(),
      )
      .entries(),
  ]
    .map(([key, entries]) => ({ key, entries: entries.sort((a, b) => a.month - b.month) }))
    .sort((a, b) => spent(b.entries) - spent(a.entries));
  const deductible = plan.expenses.reduce((sum, e) => sum + e.amount * deductibleShare(e.category), 0);
  const hasBusiness = plan.income.some((r) => r.kind === 'selfEmployment');

  const row = (e: ExpenseEntry, grouped: boolean) => (
    <ListRow
      key={e.id}
      title={grouped ? months[e.month] : e.description}
      projected={e.status === 'projected'}
      meta={
        grouped
          ? []
          : [
              expenseLabels[e.category],
              months[e.month],
              ...(e.owner === 'spouse' ? ['Spouse'] : []),
              ...halfDeductible(e),
            ]
      }
      value={usd(e.amount, 2)}
      name={`${e.description}, ${months[e.month]}`}
      saving={saving}
      onEdit={() => onEdit(e)}
      onDelete={() => onDelete(e)}
      onMonths={grouped ? undefined : () => onMonths(expenseKey(e))}
    />
  );

  return (
    <Section
      id="tax-expenses-title"
      title="Business Expenses"
      count={plan.expenses.length}
      footnote={
        plan.expenses.length
          ? `${usd(deductible)} deductible in ${plan.year}. Expenses lower both income tax and self-employment tax on your 1099 work.`
          : 'Software, equipment, a home office, travel: the costs of your 1099 work lower both income tax and self-employment tax.'
      }
      actions={
        <Button shape="round" icon={<PlusOutlined />} onClick={onAdd}>
          Add Expense
        </Button>
      }
    >
      <div className="campaigns-panel">
        {groups.length ? (
          <ul className="tax-list">
            {groups.map((g) =>
              g.entries.length === 1 ? (
                row(g.entries[0], false)
              ) : (
                <ListGroup
                  key={g.key}
                  title={g.entries[0].description}
                  projected={g.entries.filter((e) => e.status === 'projected').length}
                  meta={[
                    expenseLabels[g.entries[0].category],
                    `${g.entries.length} entries`,
                    ...(g.entries[0].owner === 'spouse' ? ['Spouse'] : []),
                    ...halfDeductible(g.entries[0]),
                  ]}
                  value={usd(spent(g.entries), 2)}
                  onMonths={() => onMonths(g.key)}
                >
                  {g.entries.map((e) => row(e, true))}
                </ListGroup>
              ),
            )}
          </ul>
        ) : (
          <Empty
            icon={<Receipt size={28} strokeWidth={1.6} />}
            title={plan.expenses.length ? `Nothing in ${months[month]}` : 'No Business Expenses Yet'}
            action={
              <Button
                type={hasBusiness ? 'primary' : 'default'}
                shape="round"
                size="large"
                icon={<PlusOutlined />}
                onClick={onAdd}
              >
                Add Expense
              </Button>
            }
          >
            {hasBusiness
              ? 'Record what you’ve paid, and forecast what you’ll spend, to see how much less tax your 1099 income owes.'
              : 'Business expenses offset 1099 income. Add your 1099 work under Income first, then record its costs here.'}
          </Empty>
        )}
      </div>
    </Section>
  );
}
