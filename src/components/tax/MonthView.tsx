"use client";

import { useState } from "react";
import { Button, Modal } from "antd";
import { DeleteOutlined, LeftOutlined, PlusOutlined, RightOutlined } from "@ant-design/icons";
import type { TaxCalculation } from "@/lib/tax/calculate";
import { averageRate, expenseKey, fromGrid, incomeKey, monthResult, toGrid, type MonthGrid, type Status } from "@/lib/tax/monthly";
import {
  deductibleShare,
  errorMessage,
  expenseCategories,
  expenseLabels,
  incomeKinds,
  incomeLabels,
  type ExpenseEntry,
  type IncomeEntry,
  type PlanMutation,
  type TaxPlan,
} from "@/lib/tax/schema";
import { ErrorNotice, StatusPicker, minusUsd, months, percent, signedUsd, usd } from "./controls";

type Owner = IncomeEntry["owner"];
// One payer or cost across the year. A line added here has no saved entries yet and names itself.
type Line = { id: string; key?: string; name: string; type: string; owner: Owner; grid: MonthGrid; changed: boolean };
type SetLines = React.Dispatch<React.SetStateAction<Line[]>>;

function linesFor<T extends IncomeEntry | ExpenseEntry>(
  entries: T[],
  year: number,
  key: (entry: T) => string,
  describe: (entry: T) => { name: string; type: string },
): Line[] {
  const groups = new Map<string, T[]>();
  for (const e of entries) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  return [...groups.entries()]
    .map(([k, group]) => ({
      id: k,
      key: k,
      ...describe(group[0]),
      owner: group[0].owner,
      grid: toGrid(group, year),
      changed: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every payer and business cost for one month: its amount, projected or actual, and the month's result. */
export default function MonthView({
  plan,
  estimate,
  month: initialMonth,
  onClose,
  onSave,
}: {
  plan: TaxPlan;
  estimate: TaxCalculation;
  month: number;
  onClose: () => void;
  onSave: (mutation: PlanMutation) => Promise<void>;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [income, setIncome] = useState(() => linesFor(plan.income, plan.year, incomeKey, (r) => ({ name: r.source, type: r.kind })));
  const [expenses, setExpenses] = useState(() =>
    linesFor(plan.expenses, plan.year, expenseKey, (e) => ({ name: e.description, type: e.category })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const joint = plan.profile.filingStatus === "joint";
  const m = month - 1;
  const dirty = [...income, ...expenses].some((l) => l.changed);

  // Lines keep all twelve months, so moving between months loses nothing and one save covers them all.
  const patch = (setLines: SetLines, id: string, update: (line: Line) => Partial<Line>) =>
    setLines((lines) => lines.map((l) => (l.id === id ? { ...l, ...update(l) } : l)));
  const setMonthCell = <K extends keyof MonthGrid>(setLines: SetLines, id: string, column: K, value: MonthGrid[K][number]) =>
    patch(setLines, id, (l) => ({
      grid: { ...l.grid, [column]: l.grid[column].map((v, i) => (i === m ? value : v)) },
      changed: true,
    }));

  const amount = (l: Line) => l.grid.amount[m] ?? 0;
  // The same result MCP reports for each month, from the lines as currently edited.
  const rate = averageRate(estimate);
  const result = monthResult(
    income.reduce((n, l) => n + amount(l), 0),
    expenses.reduce((n, l) => n + amount(l), 0),
    expenses.reduce((n, l) => n + amount(l) * deductibleShare(l.type as ExpenseEntry["category"]), 0),
    rate,
  );
  const hasProjected = [...income, ...expenses].some((l) => l.grid.amount[m] !== undefined && l.grid.status[m] === "projected");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!dirty) return onClose();
    const newId = () => crypto.randomUUID();
    const mutation = {
      action: "entries" as const,
      income: [] as IncomeEntry[],
      removeIncome: [] as string[],
      expenses: [] as ExpenseEntry[],
      removeExpenses: [] as string[],
    };
    try {
      for (const line of income) {
        if (!line.changed) continue;
        const kind = line.type as IncomeEntry["kind"];
        const key = line.key ?? incomeKey({ owner: line.owner, kind, source: line.name });
        if (!line.key) {
          if (!line.name.trim()) throw new Error("Name the payer for each income line you added.");
          if (income.some((other) => other.key === key))
            throw new Error(`“${line.name.trim()}” is already listed as ${incomeLabels[kind]}; use that line.`);
        }
        // Rebuilt from the latest saved entries, so IDs stay current even if the plan changed meanwhile.
        const entries = plan.income.filter((r) => incomeKey(r) === key);
        const blank = (month: number, status: Status): IncomeEntry => ({
          id: "",
          source: line.name.trim(),
          kind,
          owner: line.owner,
          month,
          status,
          amount: 0,
          expenses: 0,
          withholding: 0,
          notes: "",
        });
        const result = fromGrid(entries, line.grid, blank, newId);
        mutation.income.push(...result.entries);
        mutation.removeIncome.push(...result.remove);
      }
      for (const line of expenses) {
        if (!line.changed) continue;
        const category = line.type as ExpenseEntry["category"];
        const key = line.key ?? expenseKey({ owner: line.owner, category, description: line.name });
        if (!line.key) {
          if (!line.name.trim()) throw new Error("Describe each expense line you added.");
          if (expenses.some((other) => other.key === key)) throw new Error(`“${line.name.trim()}” is already listed; use that line.`);
        }
        const entries = plan.expenses.filter((e) => expenseKey(e) === key);
        const blank = (month: number, status: Status): ExpenseEntry => ({
          id: "",
          description: line.name.trim(),
          category,
          owner: line.owner,
          month,
          status,
          amount: 0,
          notes: "",
        });
        const result = fromGrid(entries, line.grid, blank, newId);
        mutation.expenses.push(...result.entries);
        mutation.removeExpenses.push(...result.remove);
      }
    } catch (e) {
      setError(errorMessage(e, "Check the lines you added."));
      return;
    }
    setSaving(true);
    try {
      await onSave(mutation);
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  const row = (setLines: SetLines, line: Line, heading: React.ReactNode, signed: boolean) => {
    const label = `${line.name || "New line"}, ${months[month]}`;
    return (
      <li key={line.id} className="tax-month-line">
        <div className="tax-month-line-name">{heading}</div>
        <span className="tax-money-input">
          <span aria-hidden="true">$</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={signed ? undefined : 0}
            max={1_000_000_000}
            aria-label={`${label} amount`}
            value={line.grid.amount[m] ?? ""}
            onChange={(e) => setMonthCell(setLines, line.id, "amount", e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </span>
        <StatusPicker
          label={`${label} status`}
          value={line.grid.status[m]}
          disabled={line.grid.amount[m] === undefined}
          onChange={(status) => setMonthCell(setLines, line.id, "status", status)}
        />
      </li>
    );
  };

  const existing = (line: Line, label: string) => (
    <>
      <strong>{line.name}</strong>
      <small>
        {label}
        {line.owner === "spouse" ? " · Spouse" : ""}
      </small>
    </>
  );

  const added = (setLines: SetLines, line: Line, placeholder: string, options: [string, string][]) => (
    <>
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        maxLength={120}
        value={line.name}
        onChange={(e) => patch(setLines, line.id, () => ({ name: e.target.value }))}
      />
      <span className="tax-month-line-pickers">
        <select aria-label="Type" value={line.type} onChange={(e) => patch(setLines, line.id, () => ({ type: e.target.value }))}>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {joint && (
          <select
            aria-label="Whose"
            value={line.owner}
            onChange={(e) => patch(setLines, line.id, () => ({ owner: e.target.value as Owner }))}>
            <option value="taxpayer">You</option>
            <option value="spouse">Spouse</option>
          </select>
        )}
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          aria-label="Remove this line"
          onClick={() => setLines((lines) => lines.filter((l) => l.id !== line.id))}
        />
      </span>
    </>
  );

  const addLine = (setLines: SetLines, type: string) =>
    setLines((lines) => [
      ...lines,
      {
        id: crypto.randomUUID(),
        name: "",
        type,
        owner: "taxpayer",
        grid: toGrid([], plan.year),
        changed: false,
      },
    ]);

  const header = (title: string) => (
    <li className="tax-month-line tax-month-line-head" aria-hidden="true">
      <span>{title}</span>
      <span>Amount</span>
      <span>Status</span>
    </li>
  );

  return (
    <Modal
      open
      title={
        <div className="tax-month-view-title">
          <Button
            type="text"
            icon={<LeftOutlined />}
            aria-label={`Previous month, ${months[month - 1] ?? ""}`}
            disabled={month === 1}
            onClick={() => setMonth(month - 1)}
          />
          <span>
            {months[month]} {plan.year}
          </span>
          <Button
            type="text"
            icon={<RightOutlined />}
            aria-label={`Next month, ${months[month + 1] ?? ""}`}
            disabled={month === 12}
            onClick={() => setMonth(month + 1)}
          />
        </div>
      }
      onCancel={onClose}
      footer={null}
      width={820}
      className="tax-dialog"
      mask={{ closable: !saving && !dirty }}>
      <form onSubmit={save} className="pr-2">
        <ul className="tax-month-lines tax-inputs" aria-label={`Income in ${months[month]}`}>
          {header("Income")}
          {income.map((line) =>
            row(
              setIncome,
              line,
              line.key
                ? existing(line, incomeLabels[line.type as IncomeEntry["kind"]])
                : added(
                    setIncome,
                    line,
                    "Employer / payer",
                    incomeKinds.map((k): [string, string] => [k, incomeLabels[k]]),
                  ),
              ["shortTerm", "longTerm", "other"].includes(line.type),
            ),
          )}
        </ul>
        <Button type="text" icon={<PlusOutlined />} onClick={() => addLine(setIncome, "selfEmployment")}>
          Add Income
        </Button>

        <ul className="tax-month-lines tax-inputs" aria-label={`Business expenses in ${months[month]}`}>
          {header("Business Expenses")}
          {expenses.map((line) =>
            row(
              setExpenses,
              line,
              line.key
                ? existing(line, expenseLabels[line.type as ExpenseEntry["category"]])
                : added(
                    setExpenses,
                    line,
                    "What you paid for",
                    expenseCategories.map((c): [string, string] => [c, expenseLabels[c]]),
                  ),
              false,
            ),
          )}
        </ul>
        <Button type="text" icon={<PlusOutlined />} onClick={() => addLine(setExpenses, "other")}>
          Add Expense
        </Button>

        <section className="tax-result-panel" aria-label={`${months[month]} result`}>
          <div className="tax-result-heading">
            <h3>{months[month]} Result</h3>
            {hasProjected && <small>Includes projected amounts</small>}
          </div>
          <dl className="tax-rows">
            <div>
              <dt>Income</dt>
              <dd>{usd(result.income)}</dd>
            </div>
            <div>
              <dt>Business expenses</dt>
              <dd>{minusUsd(result.businessExpenses)}</dd>
            </div>
            <div className="tax-total-row">
              <dt>Net</dt>
              <dd>{signedUsd(result.net)}</dd>
            </div>
            <div>
              <dt>
                Estimated tax <small>· {percent(rate)} full-year average</small>
              </dt>
              <dd>{minusUsd(result.estimatedTax)}</dd>
            </div>
            <div className="tax-total-row">
              <dt>After tax</dt>
              <dd>{signedUsd(result.afterTax)}</dd>
            </div>
          </dl>
          <p className="tax-footnote">
            Estimated tax applies your {plan.year} average rate (total tax ÷ AGI) to this month’s income after deductible expenses. Tax
            already withheld from paychecks counts toward it.
          </p>
        </section>

        <ErrorNotice error={error} />
        <div className="tax-modal-footer">
          <Button shape="round" onClick={onClose} disabled={saving}>
            {dirty ? "Discard" : "Close"}
          </Button>
          <Button type="primary" shape="round" htmlType="submit" loading={saving} disabled={!dirty}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
