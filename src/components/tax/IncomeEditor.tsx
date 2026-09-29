'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { FileUp } from 'lucide-react';
import {
  errorMessage,
  incomeKinds,
  incomeLabels,
  incomeSchema,
  type IncomeEntry,
  type TaxPlan,
} from '@/lib/tax/schema';
import { incomeCsvTemplate, parseIncomeCsv, readTaxDocument, suggestDocumentIncome } from '@/lib/tax/import';
import { ErrorNotice, Field, MoneyField, downloadText, months } from './controls';

function blankIncome(): IncomeEntry {
  return {
    id: crypto.randomUUID(),
    source: '',
    kind: 'w2',
    owner: 'taxpayer',
    month: 0,
    status: 'actual',
    amount: 0,
    expenses: 0,
    withholding: 0,
    notes: '',
  };
}
export default function IncomeEditor({
  plan,
  entry,
  upload,
  forecastMonth,
  onClose,
  onSave,
}: {
  plan: TaxPlan;
  entry?: IncomeEntry;
  upload?: boolean;
  forecastMonth?: number;
  onClose: () => void;
  onSave: (entries: IncomeEntry[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<IncomeEntry[]>(() => [
    entry || { ...blankIncome(), ...(forecastMonth ? { month: forecastMonth, status: 'projected' as const } : {}) },
  ]);
  const [active, setActive] = useState(0);
  const [endMonth, setEndMonth] = useState(0);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState('');
  const [error, setError] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [documentYear, setDocumentYear] = useState<number>();
  const [reviewed, setReviewed] = useState(false);
  const [fileName, setFileName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [isPdf, setIsPdf] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  const draft = rows[active];
  const update = (patch: Partial<IncomeEntry>) => {
    setRows((current) => current.map((r, i) => (i === active ? { ...r, ...patch } : r)));
    setReviewed(false);
  };
  async function importFile(file: File) {
    setError('');
    setReading('Opening document…');
    setReviewed(false);
    setDocumentText('');
    setPreviewUrl('');
    setFileName('');
    setDocumentYear(undefined);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Choose a file smaller than 15 MB.');
      const bytes = await file.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      if (plan.income.some((r) => r.documentHash === hash))
        throw new Error(
          'This document has already been imported. Edit its existing income entries to make corrections.',
        );
      let imported: IncomeEntry[];
      if (/\.csv$/i.test(file.name)) imported = parseIncomeCsv(await file.text(), plan.year, () => crypto.randomUUID());
      else {
        const text = await readTaxDocument(file, setReading, controller.signal);
        if (controller.signal.aborted) return;
        setDocumentText(text);
        const suggestion = suggestDocumentIncome(text);
        setDocumentYear(suggestion.year);
        const row = blankIncome();
        row.kind = suggestion.kind;
        row.amount = suggestion.amount ?? 0;
        row.withholding = suggestion.withholding ?? 0;
        imported = [row];
        if (/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) {
          setPreviewUrl(URL.createObjectURL(file));
          setIsPdf(/\.pdf$/i.test(file.name));
        }
      }
      if (controller.signal.aborted) return;
      setRows(imported.map((r) => ({ ...r, documentName: file.name.slice(0, 200), documentHash: hash })));
      setActive(0);
      setEndMonth(0);
      setFileName(file.name);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(errorMessage(e, 'Could not read this document. Enter the amounts manually.'));
    } finally {
      if (!controller.signal.aborted) setReading('');
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (fileName && !reviewed) {
      setError('Review the amounts and confirm the document year before saving.');
      return;
    }
    setSaving(true);
    try {
      let entries = rows.map((r) => incomeSchema.parse(r));
      if (!entry && !fileName && rows.length === 1 && draft.month > 0 && endMonth > draft.month) {
        entries = Array.from({ length: endMonth - draft.month + 1 }, (_, i) => ({
          ...entries[0],
          id: i ? crypto.randomUUID() : entries[0].id,
          month: draft.month + i,
        }));
      }
      await onSave(entries);
      onClose();
    } catch (e) {
      setError(errorMessage(e, 'Could not save income.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      title={entry ? 'Edit Income' : forecastMonth ? 'Add Forecast' : 'Add Income'}
      onCancel={onClose}
      footer={null}
      width={780}
      className="tax-dialog"
      mask={{ closable: !saving && !reading }}
    >
      <form onSubmit={save}>
        <p className="tax-description">
          {plan.year} · Record what you’ve earned, or forecast the months ahead. A payer’s full-year total and its
          monthly entries can’t overlap.
        </p>
        {upload && (
          <div className="tax-import-area">
            <FileUp size={24} strokeWidth={1.6} aria-hidden="true" />
            <div>
              <strong>Import a W-2, 1099 or spreadsheet</strong>
              <p>PDF, photo, TXT or CSV · up to 15 MB</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                e.target.value = '';
              }}
            />
            <Button shape="round" disabled={!!reading || saving} onClick={() => fileRef.current?.click()}>
              Choose File
            </Button>
            <Button
              type="text"
              onClick={() => downloadText(`income-template-${plan.year}.csv`, incomeCsvTemplate(plan.year))}
            >
              CSV Template
            </Button>
            <small>
              Documents are read in your browser and never uploaded. Only the amounts you confirm and the file name are
              saved. Reading a scan downloads a text-recognition model the first time.
            </small>
          </div>
        )}
        {reading && (
          <div role="status" className="tax-notice">
            {reading}
            <Button
              type="text"
              onClick={() => {
                abort.current?.abort();
                setReading('');
              }}
            >
              Cancel
            </Button>
          </div>
        )}
        {fileName && (
          <div className="tax-notice">
            <strong>{fileName}</strong>
            <p>
              Review every amount against the original. For 1099-DIV, enter qualified dividends separately and subtract
              them from total ordinary dividends. For 1099-B, enter net gains after basis and adjustments, not sale
              proceeds.
            </p>
            {documentYear && documentYear !== plan.year && (
              <p className="tax-negative">
                Detected year {documentYear}; this plan is {plan.year}. Switch years unless the detection is incorrect.
              </p>
            )}
          </div>
        )}
        {previewUrl && (
          <details className="tax-disclosure">
            <summary>View Original Document</summary>
            {isPdf ? (
              <object
                data={previewUrl}
                type="application/pdf"
                className="tax-document-preview"
                aria-label="Uploaded tax document"
              >
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  Open PDF for review
                </a>
              </object>
            ) : (
              <img
                src={previewUrl}
                alt="Uploaded tax document for amount verification"
                className="tax-document-preview"
              />
            )}
          </details>
        )}
        {documentText && (
          <details className="tax-disclosure">
            <summary>Extracted Text</summary>
            <pre className="tax-extracted-text">{documentText}</pre>
          </details>
        )}
        {rows.length > 1 && (
          <Field label={`Review Entry ${active + 1} of ${rows.length}`}>
            <select value={active} onChange={(e) => setActive(Number(e.target.value))}>
              {rows.map((r, i) => (
                <option key={r.id} value={i}>
                  {i + 1}. {r.source || 'Unnamed source'} · {incomeLabels[r.kind]} · {months[r.month]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="tax-form-grid">
          <Field label="Income Type">
            <select
              value={draft.kind}
              onChange={(e) =>
                update({
                  kind: e.target.value as IncomeEntry['kind'],
                  expenses: 0,
                  socialSecurityWages: undefined,
                  medicareWages: undefined,
                })
              }
            >
              {incomeKinds.map((k) => (
                <option value={k} key={k}>
                  {incomeLabels[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Employer / Payer" hint="Use the same name when updating a source’s monthly income.">
            <input
              required
              maxLength={120}
              value={draft.source}
              onChange={(e) => update({ source: e.target.value })}
              placeholder="e.g. Employer or client name"
            />
          </Field>
          <Field label="Entry Status">
            <select value={draft.status} onChange={(e) => update({ status: e.target.value as IncomeEntry['status'] })}>
              <option value="actual">Actual · already earned</option>
              <option value="projected">Projected · expected income</option>
            </select>
          </Field>
          <Field label="Period">
            <select
              value={draft.month}
              onChange={(e) => {
                update({ month: Number(e.target.value) });
                setEndMonth(0);
              }}
            >
              {months.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          {!entry && !fileName && rows.length === 1 && draft.month > 0 && (
            <Field label="Repeat Monthly Through" hint="Creates a separate editable entry for each month.">
              <select value={endMonth || draft.month} onChange={(e) => setEndMonth(Number(e.target.value))}>
                {months.map(
                  (m, i) =>
                    i >= draft.month && (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ),
                )}
              </select>
            </Field>
          )}
          {plan.profile.filingStatus === 'joint' && (
            <Field label="Income Owner">
              <select value={draft.owner} onChange={(e) => update({ owner: e.target.value as IncomeEntry['owner'] })}>
                <option value="taxpayer">You</option>
                <option value="spouse">Spouse</option>
              </select>
            </Field>
          )}
          <MoneyField
            label={
              draft.kind === 'w2'
                ? 'Taxable Wages · W-2 Box 1'
                : draft.kind === 'selfEmployment'
                  ? 'Gross Business Income'
                  : ['shortTerm', 'longTerm'].includes(draft.kind)
                    ? 'Net Gain / Loss'
                    : 'Income Amount'
            }
            value={draft.amount}
            signed
            onChange={(n) => update({ amount: n ?? 0 })}
            hint={
              draft.kind === 'selfEmployment'
                ? 'Before costs. Record what the work costs under Business Expenses.'
                : undefined
            }
          />
          <MoneyField
            label="Federal Income Tax Withheld"
            value={draft.withholding}
            onChange={(n) => update({ withholding: n ?? 0 })}
            hint="W-2 box 2 / 1099 box 4. Exclude state tax and regular payroll taxes."
          />
          {/* Costs now live in the Business Expenses list; only entries saved with costs keep this field. */}
          {draft.kind === 'selfEmployment' && (entry?.expenses ?? 0) > 0 && (
            <MoneyField
              label="Business Expenses on This Entry"
              value={draft.expenses}
              onChange={(n) => update({ expenses: n ?? 0 })}
              hint="Set to $0 if you move these costs to Business Expenses, so they aren’t counted twice."
            />
          )}
          {draft.kind === 'w2' && (
            <>
              <MoneyField
                label="Social Security Wages · Box 3"
                value={draft.socialSecurityWages}
                optional
                onChange={(n) => update({ socialSecurityWages: n })}
                hint="If blank, defaults to taxable wages."
              />
              <MoneyField
                label="Medicare Wages · Box 5"
                value={draft.medicareWages}
                optional
                onChange={(n) => update({ medicareWages: n })}
                hint="If blank, defaults to taxable wages."
              />
            </>
          )}
        </div>
        {['shortTerm', 'longTerm'].includes(draft.kind) && plan.profile.stockSource === 'portfolio' && (
          <p className="tax-notice">
            First set Stock Gains to “1099-B / reported totals” in Settings, so your recorded stock sales aren’t counted
            twice.
          </p>
        )}
        <Field label="Notes">
          <textarea rows={2} maxLength={1000} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
        </Field>
        {upload && !reading && (
          <div className="tax-actions">
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={() => {
                const row = blankIncome();
                setRows((r) => [
                  ...r,
                  { ...row, source: draft.source, documentName: draft.documentName, documentHash: draft.documentHash },
                ]);
                setActive(rows.length);
                setReviewed(false);
              }}
            >
              Add Another Line
            </Button>
            {rows.length > 1 && (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  setRows((r) => r.filter((_, i) => i !== active));
                  setActive(0);
                  setReviewed(false);
                }}
              >
                Remove This Line
              </Button>
            )}
          </div>
        )}
        {fileName && (
          <label className="tax-check">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            {rows.length === 1
              ? `I checked this entry against the document, and it belongs to ${plan.year}.`
              : `I checked all ${rows.length} entries against the document, and they belong to ${plan.year}.`}
          </label>
        )}
        <ErrorNotice error={error} />
        <div className="tax-modal-footer">
          <Button shape="round" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="primary"
            shape="round"
            htmlType="submit"
            loading={saving}
            disabled={!!reading || (!!fileName && !reviewed)}
          >
            {rows.length > 1 ? `Save ${rows.length} Entries` : 'Save Income'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
