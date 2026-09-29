'use client';

import { Button, Select } from 'antd';
import { PlusOutlined, RightOutlined } from '@ant-design/icons';
import { FileUp } from 'lucide-react';
import { incomeLabels, type IncomeEntry, type TaxPlan } from '@/lib/tax/schema';
import { Empty, ListGroup, ListRow, Section, months, usd } from './controls';

type Group = {
  key: string;
  source: string;
  kind: IncomeEntry['kind'];
  owner: IncomeEntry['owner'];
  entries: IncomeEntry[];
};

const gross = (entries: IncomeEntry[]) => entries.reduce((sum, r) => sum + r.amount, 0);
const sum = (entries: IncomeEntry[], key: 'withholding' | 'expenses') => entries.reduce((n, r) => n + r[key], 0);

export default function IncomeList({
  plan,
  month,
  saving,
  onMonth,
  onAdd,
  onForecast,
  onEdit,
  onDelete,
}: {
  plan: TaxPlan;
  month: number;
  saving: boolean;
  onMonth: (month: number) => void;
  onAdd: () => void;
  onForecast: () => void;
  onEdit: (entry: IncomeEntry) => void;
  onDelete: (entry: IncomeEntry) => void;
}) {
  // One group per payer and income type, so twelve monthly paychecks read as one employer.
  const groups = [
    ...plan.income
      .filter((r) => month < 0 || r.month === month)
      .reduce((map, r) => {
        const key = `${r.owner}|${r.kind}|${r.source.trim().toLowerCase()}`;
        const group = map.get(key) ?? { key, source: r.source, kind: r.kind, owner: r.owner, entries: [] };
        group.entries.push(r);
        return map.set(key, group);
      }, new Map<string, Group>())
      .values(),
  ]
    .map((g) => ({ ...g, entries: g.entries.sort((a, b) => a.month - b.month) }))
    .sort((a, b) => gross(b.entries) - gross(a.entries));

  const row = (r: IncomeEntry, grouped: boolean) => (
    <ListRow
      key={r.id}
      title={grouped ? months[r.month] : r.source}
      projected={r.status === 'projected'}
      meta={[
        ...(grouped ? [] : [incomeLabels[r.kind], months[r.month]]),
        ...(!grouped && r.owner === 'spouse' ? ['Spouse'] : []),
        ...(r.withholding ? [`${usd(r.withholding)} withheld`] : []),
        ...(r.expenses ? [`${usd(r.expenses)} expenses`] : []),
        ...(r.documentName ? [r.documentName] : []),
      ]}
      value={usd(r.amount, 2)}
      name={`${r.source}, ${months[r.month]}`}
      saving={saving}
      onEdit={() => onEdit(r)}
      onDelete={() => onDelete(r)}
    />
  );

  return (
    <Section
      id="tax-income-title"
      title="Income"
      count={plan.income.length}
      actions={
        <>
          <Select
            aria-label="Show period"
            className="tax-period-select"
            value={month}
            onChange={onMonth}
            options={[{ value: -1, label: 'All periods' }, ...months.map((m, i) => ({ value: i, label: m }))]}
          />
          <Button shape="round" icon={<PlusOutlined />} onClick={onForecast}>
            Add Forecast
          </Button>
        </>
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
                  title={g.source}
                  projected={g.entries.filter((r) => r.status === 'projected').length}
                  meta={[
                    incomeLabels[g.kind],
                    `${g.entries.length} entries`,
                    ...(g.owner === 'spouse' ? ['Spouse'] : []),
                    ...(sum(g.entries, 'withholding') ? [`${usd(sum(g.entries, 'withholding'))} withheld`] : []),
                    ...(sum(g.entries, 'expenses') ? [`${usd(sum(g.entries, 'expenses'))} expenses`] : []),
                  ]}
                  value={usd(gross(g.entries), 2)}
                >
                  {g.entries.map((r) => row(r, true))}
                </ListGroup>
              ),
            )}
          </ul>
        ) : (
          <Empty
            icon={<FileUp size={28} strokeWidth={1.6} />}
            title={month < 0 ? 'No Income Yet' : `Nothing in ${months[month]}`}
            action={
              <Button type="primary" shape="round" size="large" icon={<PlusOutlined />} onClick={onAdd}>
                Add Income
              </Button>
            }
          >
            Import a W-2 or 1099, use the CSV template, or type the amounts in yourself.
          </Empty>
        )}
      </div>
    </Section>
  );
}

export function PlanAhead({ year, onNextYear }: { year: number; onNextYear?: () => void }) {
  return (
    <Section
      id="tax-next-year-title"
      title={onNextYear ? `Planning ${year + 1}` : 'Planning Ahead'}
      footnote="Add a forecast for each month you expect to be paid; Repeat Monthly Through fills several months at once. A payer’s full-year total and its monthly entries can’t overlap."
    >
      {onNextYear && (
        <Button shape="round" onClick={onNextYear}>
          Open {year + 1}
          <RightOutlined />
        </Button>
      )}
    </Section>
  );
}
