'use client';

import { useId, type ReactNode } from 'react';
import { Button, Popconfirm } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { ChevronRight, Pencil } from 'lucide-react';
import MetaLine from '@/components/shared/MetaLine';
import { cn } from '@/lib/utils';

export const usd = (value: number, decimals = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(Object.is(Math.round(value * 10 ** decimals), -0) ? 0 : value);

/** Gains and losses, signed the way the campaign pages show P&L. */
export const signedUsd = (value: number, decimals = 0) =>
  `${value > 0.004 ? '+' : value < -0.004 ? '-' : ''}${usd(Math.abs(value), decimals)}`;

/** An amount subtracted on the way to taxable income: "-$1,200", or "$0" when there is nothing to subtract. */
export const minusUsd = (value: number) => (Math.round(value) === 0 ? usd(0) : `-${usd(value)}`);

export const percent = (value: number) => `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

export const months = [
  'Annual total',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Dec 2, 2026" from a YYYY-MM-DD or ISO date, read in UTC so the day never shifts. */
export const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const tone = (value: number) => (value > 0.004 ? 'gain' : value < -0.004 ? 'loss' : undefined);

/** A titled block in the campaign pages' layout: heading row with optional actions, then its content. */
export function Section({
  id,
  title,
  count,
  actions,
  footnote,
  className,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  actions?: ReactNode;
  footnote?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('campaigns-section', className)} aria-labelledby={id}>
      <div className="campaigns-section-header">
        <h2 id={id} className="campaigns-section-title">
          {title}
          {count !== undefined && <span className="campaigns-section-count">{count}</span>}
        </h2>
        {actions && <div className="tax-section-actions">{actions}</div>}
      </div>
      {footnote && <p className="campaigns-section-footnote">{footnote}</p>}
      {children}
    </section>
  );
}

export type SummaryCell = {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: 'gain' | 'loss';
  capsule?: ReactNode;
};

/** The grouped headline panel from the campaign pages: one hero figure, then supporting figures. */
export function Summary({ hero, cells, className }: { hero: SummaryCell; cells: SummaryCell[]; className?: string }) {
  return (
    <dl className={cn('campaigns-summary animate-in', className)}>
      <div className="campaigns-summary-cell campaigns-summary-hero">
        <dt>{hero.label}</dt>
        <dd>
          <span className={cn('campaigns-summary-balance', hero.tone && `tax-${hero.tone}`)}>{hero.value}</span>
          {hero.detail && <span className="campaigns-summary-detail">{hero.detail}</span>}
        </dd>
      </div>
      {cells.map((cell) => (
        <div key={cell.label} className="campaigns-summary-cell">
          <dt>{cell.label}</dt>
          <dd>
            <span className={cn('campaigns-summary-value', cell.tone && `tax-${cell.tone}`)}>{cell.value}</span>
            {cell.capsule}
            {cell.detail && <span className="campaigns-summary-detail">{cell.detail}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Capsule({ children, tone: capsuleTone }: { children: ReactNode; tone?: 'gain' | 'loss' | 'dashed' }) {
  return (
    <span
      className={cn(
        'campaign-status',
        capsuleTone === 'dashed' ? 'tax-capsule-dashed' : capsuleTone && `tax-capsule-${capsuleTone}`,
      )}
    >
      {children}
    </span>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="tax-empty">
      <span className="tax-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

/** One editable entry in an inset list: title and details, an amount, then edit and delete. */
export function ListRow({
  title,
  projected,
  meta,
  value,
  name,
  saving,
  onEdit,
  onDelete,
}: {
  title: string;
  projected: boolean;
  meta: string[];
  value: string;
  /** Names the entry in button labels and the delete confirmation, e.g. "Figma, March". */
  name: string;
  saving: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="tax-list-row">
      <div className="tax-list-main">
        <div className="tax-list-title">
          <strong>{title}</strong>
          {projected && <Capsule tone="dashed">Projected</Capsule>}
        </div>
        {meta.length > 0 && <MetaLine className="tax-list-meta" parts={meta} />}
      </div>
      <span className="tax-list-value">{value}</span>
      <div className="tax-row-actions">
        <Button type="text" icon={<Pencil size={15} />} aria-label={`Edit ${name}`} onClick={onEdit} />
        <Popconfirm
          title="Delete this entry?"
          description={name}
          okText="Delete"
          okButtonProps={{ danger: true }}
          cancelText="Keep"
          onConfirm={onDelete}
        >
          <Button type="text" danger icon={<DeleteOutlined />} disabled={saving} aria-label={`Delete ${name}`} />
        </Popconfirm>
      </div>
    </li>
  );
}

/** Several entries under one heading with their total, collapsed until opened. */
export function ListGroup({
  title,
  projected,
  meta,
  value,
  children,
}: {
  title: string;
  projected: number;
  meta: string[];
  value: string;
  children: ReactNode;
}) {
  return (
    <li className="tax-group">
      <details>
        <summary className="tax-list-row tax-group-summary">
          <div className="tax-list-main">
            <div className="tax-list-title">
              <strong>{title}</strong>
              {projected > 0 && <Capsule tone="dashed">{projected} projected</Capsule>}
            </div>
            <MetaLine className="tax-list-meta" parts={meta} />
          </div>
          <span className="tax-list-value">{value}</span>
          <ChevronRight className="tax-group-chevron" size={18} aria-hidden="true" />
        </summary>
        <ul className="tax-group-rows">{children}</ul>
      </details>
    </li>
  );
}

/**
 * An iOS switch. Given children it renders as a one-row inset list cell — label leading, switch
 * trailing — because the HIG reserves switches for list rows, not bare toolbars.
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when there are no children to act as the visible label. */
  label?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={children ? undefined : label}
      disabled={disabled}
      className={children ? 'tax-toggle-row' : 'tax-toggle-bare'}
      onClick={() => onChange(!checked)}
    >
      {children && <span className="tax-toggle-label">{children}</span>}
      <span className="tax-toggle" data-checked={checked} aria-hidden="true">
        <span className="tax-toggle-knob" />
      </span>
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="tax-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function MoneyField({
  label,
  value,
  onChange,
  hint,
  signed = false,
  optional = false,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  hint?: string;
  signed?: boolean;
  optional?: boolean;
}) {
  const id = useId();
  return (
    <label className="tax-field">
      <span>{label}</span>
      <div className="tax-money-input">
        <span aria-hidden="true">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min={signed ? undefined : 0}
          max={1_000_000_000}
          value={value ?? ''}
          required={!optional}
          aria-describedby={hint ? id : undefined}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      </div>
      {hint && <small id={id}>{hint}</small>}
    </label>
  );
}

export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <div className="tax-error" role="alert">
      {error}
    </div>
  ) : null;
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
