'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Segmented, Select, Skeleton } from 'antd';
import { DownloadOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import MetaLine from '@/components/shared/MetaLine';
import {
  applyMutation,
  errorMessage,
  planSchema,
  type ExpenseEntry,
  type IncomeEntry,
  type PlanMutation,
  type TaxPlan,
  type TaxScenario,
} from '@/lib/tax/schema';
import { comparePlan } from '@/lib/tax/calculate';
import { TAX_SOURCES, filingLabels } from '@/lib/tax/rules';
import type { TaxPortfolio } from '@/lib/tax/portfolio';
import { onRefresh } from '@/lib/refresh';
import { ErrorNotice, Summary, Toggle, downloadText, percent, usd } from '@/components/tax/controls';
import Overview from '@/components/tax/Overview';
import IncomeList, { PlanAhead } from '@/components/tax/IncomeList';
import ExpenseList from '@/components/tax/ExpenseList';
import ExpenseEditor from '@/components/tax/ExpenseEditor';
import Investments from '@/components/tax/Investments';
import Scenarios from '@/components/tax/Scenarios';
import IncomeEditor from '@/components/tax/IncomeEditor';
import ProfileEditor from '@/components/tax/ProfileEditor';
import ScenarioEditor from '@/components/tax/ScenarioEditor';
import './taxes.css';

type Context = { plan: TaxPlan; portfolio: TaxPortfolio };
type Editor =
  | { type: 'income'; entry?: IncomeEntry; forecastMonth?: number }
  | { type: 'expense'; entry?: ExpenseEntry }
  | { type: 'profile' }
  | { type: 'scenario'; kind: 'rental' | 'deduction'; scenario?: TaxScenario };
const TABS = ['Overview', 'Income', 'Stocks', 'Scenarios'] as const;
type Tab = (typeof TABS)[number];
const YEARS = [2025, 2026, 2027];

class PlanChanged extends Error {}

export default function TaxesPage() {
  const { message } = App.useApp();
  const [year, setYear] = useState(Math.min(2027, Math.max(2025, new Date().getFullYear())));
  const [context, setContext] = useState<Context | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Overview');
  const [month, setMonth] = useState(-1);
  const [includeProjected, setIncludeProjected] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);

  // A newer request supersedes an older one, and background refreshes never replace
  // the plan under an open editor or an in-flight save.
  const requestId = useRef(0);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const savingRef = useRef(false);

  const refresh = useCallback(
    async (quiet = false) => {
      if (quiet && (editorRef.current || savingRef.current)) return;
      const id = ++requestId.current;
      if (!quiet) setLoading(true);
      try {
        const res = await fetch(`/api/tax-plans/${year}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load the tax plan.');
        if (id === requestId.current && !(quiet && editorRef.current)) {
          setContext({ plan: planSchema.parse(data.plan), portfolio: data.portfolio });
          setError('');
        }
      } catch (e) {
        if (id === requestId.current) setError(errorMessage(e, 'Could not load the tax plan.'));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [year],
  );

  useEffect(() => {
    setContext(null);
    void refresh();
    return () => {
      requestId.current++;
    };
  }, [refresh]);

  // Picks up edits made through MCP or another window.
  useEffect(() => {
    const focus = () => void refresh(true);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, 30_000);
    window.addEventListener('focus', focus);
    const unsubscribe = onRefresh(() => refresh(true));
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      unsubscribe();
    };
  }, [refresh]);

  const comparison = useMemo(
    () => (context ? comparePlan(context.plan, context.portfolio, includeProjected) : null),
    [context, includeProjected],
  );

  async function save(mutation: PlanMutation) {
    if (!context || savingRef.current) throw new Error('Wait for the current save to finish.');
    try {
      applyMutation(context.plan, mutation);
    } catch (e) {
      throw new Error(errorMessage(e, 'Check the highlighted values.'));
    }
    savingRef.current = true;
    setSaving(true);
    requestId.current++;
    try {
      const res = await fetch(`/api/tax-plans/${year}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: context.plan.revision, mutation }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) throw new PlanChanged(data.error);
      if (!res.ok) throw new Error(data.error || 'Could not save the plan.');
      const plan = planSchema.parse(data);
      const scopeChanged =
        mutation.action === 'profile' &&
        JSON.stringify(plan.profile.excludedLocationIds) !== JSON.stringify(context.plan.profile.excludedLocationIds);
      setContext({ plan, portfolio: context.portfolio });
      setError('');
      message.success('Saved');
      // Excluding or including an account changes which stock sales count.
      if (scopeChanged) void refresh();
    } catch (e) {
      if (e instanceof PlanChanged) {
        // Load the newer plan under the open editor so the same changes can be saved on top of it.
        await refresh();
        throw new Error(
          'This plan was just changed elsewhere, such as through MCP. The latest version is loaded; save again to apply your changes.',
        );
      }
      throw e;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function act(mutation: PlanMutation) {
    try {
      await save(mutation);
    } catch (e) {
      setError(errorMessage(e, 'Could not save.'));
    }
  }

  const header = (
    <div className="page-header">
      <div className="campaign-page-heading">
        <h1>Tax Planning</h1>
        {context && (
          <MetaLine
            className="campaign-page-subtitle"
            parts={[
              filingLabels[context.plan.profile.filingStatus],
              context.plan.profile.stateRate === null
                ? 'Federal only'
                : `Federal + ${context.plan.profile.stateName || 'state'} ${context.plan.profile.stateRate}%`,
              context.plan.profile.stockSource === 'portfolio' ? 'Stock sales linked' : 'Reported stock gains',
            ]}
          />
        )}
      </div>
      <div className="tax-header-actions">
        <Select
          aria-label="Tax year"
          size="large"
          className="tax-year-select"
          value={year}
          disabled={saving || !!editor}
          onChange={(value) => {
            setYear(value);
            setMonth(-1);
          }}
          options={YEARS.map((y) => ({ value: y, label: y === 2027 ? `${y} · projected` : String(y) }))}
        />
        <Button
          shape="round"
          size="large"
          icon={<SettingOutlined />}
          disabled={!context}
          onClick={() => setEditor({ type: 'profile' })}
        >
          Settings
        </Button>
        <Button
          type="primary"
          shape="round"
          size="large"
          icon={<PlusOutlined />}
          className="campaigns-primary-action"
          disabled={!context}
          onClick={() => setEditor({ type: 'income' })}
        >
          Add Income
        </Button>
      </div>
    </div>
  );

  if (!context || !comparison) {
    return (
      <div className="page-container campaigns-page campaigns-container tax-page">
        {header}
        {loading ? (
          <div className="campaigns-panel campaigns-panel-padded" role="status" aria-label="Loading your tax plan">
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : (
          <div className="campaigns-panel campaigns-panel-padded">
            <ErrorNotice error={error} />
            <Button shape="round" onClick={() => void refresh()}>
              Try Again
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { plan, portfolio } = context;
  const { planned, savings } = comparison;
  const refund = planned.balance < 0;
  const activeScenarios = plan.scenarios.filter((s) => s.enabled).length;

  return (
    <div className="page-container campaigns-page campaigns-container tax-page" aria-busy={loading || saving}>
      {header}

      {!plan.profile.confirmed && (
        <div className="campaigns-panel tax-setup">
          <div>
            <strong>Confirm your filing status</strong>
            <p>And choose which investment accounts are taxable, so retirement accounts stay out of the estimate.</p>
          </div>
          <Button shape="round" onClick={() => setEditor({ type: 'profile' })}>
            Review Settings
          </Button>
        </div>
      )}
      {year === 2027 && (
        <p className="tax-notice">
          2027 brackets aren’t published yet, so this projection uses the 2026 rates and deductions.
        </p>
      )}
      <ErrorNotice error={error} />

      <Summary
        hero={{
          label: 'Estimated Federal Tax',
          value: usd(planned.federalTax),
          detail: [
            `${percent(planned.effectiveRate)} effective`,
            `${percent(planned.marginalRate)} bracket`,
            ...(plan.profile.stateRate !== null ? [`${usd(planned.totalTax)} with state`] : []),
          ].join(' · '),
        }}
        cells={[
          { label: 'Taxable Income', value: usd(planned.taxableIncome), detail: `AGI ${usd(planned.agi)}` },
          { label: 'Withheld & Paid', value: usd(planned.payments), detail: 'Withholding and estimated payments' },
          {
            label: refund ? 'Estimated Refund' : 'Still to Pay',
            value: usd(Math.abs(planned.balance)),
            tone: refund && planned.balance < -0.5 ? 'gain' : undefined,
            detail: refund ? 'Paid more than the estimate' : 'Federal, after payments so far',
          },
          {
            label: 'Scenario Savings',
            value: usd(savings),
            tone: savings > 0.5 ? 'gain' : undefined,
            detail: activeScenarios
              ? `${activeScenarios} active ${activeScenarios === 1 ? 'scenario' : 'scenarios'}`
              : 'No scenarios on',
          },
        ]}
      />

      <div className="tax-toolbar">
        <Segmented<Tab> aria-label="Tax planning sections" options={[...TABS]} value={tab} onChange={setTab} />
        <Toggle checked={includeProjected} onChange={setIncludeProjected}>
          Include projected income
        </Toggle>
      </div>
      {!includeProjected && (
        <p className="tax-notice">
          Showing income already earned, without annualizing it. Scenarios and the sale simulator still use full-year
          amounts.
        </p>
      )}

      <div role="region" aria-label={tab}>
        {tab === 'Overview' && (
          <Overview
            plan={plan}
            estimate={planned}
            includeProjected={includeProjected}
            onAddIncome={() => setEditor({ type: 'income' })}
            onMonth={(m) => {
              setMonth(m);
              setTab('Income');
            }}
          />
        )}
        {tab === 'Income' && (
          <>
            <IncomeList
              plan={plan}
              month={month}
              saving={saving}
              onMonth={setMonth}
              onAdd={() => setEditor({ type: 'income' })}
              onForecast={() =>
                setEditor({
                  type: 'income',
                  forecastMonth: month > 0 ? month : Math.min(12, new Date().getMonth() + 1),
                })
              }
              onEdit={(entry) => setEditor({ type: 'income', entry })}
              onDelete={(entry) => void act({ action: 'deleteIncome', id: entry.id })}
            />
            <ExpenseList
              plan={plan}
              month={month}
              saving={saving}
              onAdd={() => setEditor({ type: 'expense' })}
              onEdit={(entry) => setEditor({ type: 'expense', entry })}
              onDelete={(entry) => void act({ action: 'deleteExpense', id: entry.id })}
            />
            <PlanAhead
              year={year}
              onNextYear={
                year < 2027
                  ? () => {
                      setYear(year + 1);
                      setMonth(-1);
                    }
                  : undefined
              }
            />
          </>
        )}
        {tab === 'Stocks' && <Investments key={year} plan={plan} portfolio={portfolio} />}
        {tab === 'Scenarios' && (
          <Scenarios
            plan={plan}
            portfolio={portfolio}
            comparison={comparison}
            saving={saving}
            onAdd={(kind) => setEditor({ type: 'scenario', kind })}
            onEdit={(scenario) => setEditor({ type: 'scenario', kind: scenario.type, scenario })}
            onToggle={(scenario, enabled) => void act({ action: 'scenario', scenario: { ...scenario, enabled } })}
            onDelete={(scenario) => void act({ action: 'deleteScenario', id: scenario.id })}
          />
        )}
      </div>

      <footer className="tax-footer">
        <details className="tax-disclosure">
          <summary>Assumptions & Sources</summary>
          <ul>
            {planned.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div className="tax-source-links">
            {TAX_SOURCES.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            ))}
          </div>
        </details>
        <div className="tax-footer-actions">
          <MetaLine
            parts={[
              plan.updatedAt ? `Saved ${new Date(plan.updatedAt).toLocaleString()}` : 'Nothing saved yet',
              'Shared with your MCP connection',
            ]}
          />
          <Button
            type="text"
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadText(
                `tax-plan-${year}.json`,
                JSON.stringify({ plan, estimate: comparison, sources: TAX_SOURCES }, null, 2),
                'application/json',
              )
            }
          >
            Export Plan
          </Button>
        </div>
        <p className="tax-footnote">
          A planning estimate, not a tax return. Check the assumptions with a tax professional before you buy property
          or claim a deduction.
        </p>
      </footer>

      {editor?.type === 'income' && (
        <IncomeEditor
          plan={plan}
          entry={editor.entry}
          upload={!editor.entry && !editor.forecastMonth}
          forecastMonth={editor.forecastMonth}
          onClose={() => setEditor(null)}
          onSave={(entries) => save({ action: 'income', entries })}
        />
      )}
      {editor?.type === 'expense' && (
        <ExpenseEditor
          plan={plan}
          portfolio={portfolio}
          entry={editor.entry}
          onClose={() => setEditor(null)}
          onSave={(entries) => save({ action: 'expenses', entries })}
        />
      )}
      {editor?.type === 'profile' && (
        <ProfileEditor
          plan={plan}
          portfolio={portfolio}
          onClose={() => setEditor(null)}
          onSave={(profile) => save({ action: 'profile', profile })}
        />
      )}
      {editor?.type === 'scenario' && (
        <ScenarioEditor
          plan={plan}
          portfolio={portfolio}
          scenario={editor.scenario}
          kind={editor.kind}
          onClose={() => setEditor(null)}
          onSave={(scenario) => save({ action: 'scenario', scenario })}
        />
      )}
    </div>
  );
}
