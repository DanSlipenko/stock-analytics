import { incomeSchema, type IncomeEntry } from './schema';

export function parseMoney(value: string): number {
  const clean = value
    .trim()
    .replace(/[$,\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) throw new Error(`Invalid dollar amount: “${value.slice(0, 40)}”.`);
  return Number(clean);
}
/** RFC 4180 quoting, including embedded commas, escaped quotes and CRLF. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (!quoted && field.length) throw new Error('Invalid CSV quoting.');
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(field);
      field = '';
      if (c !== ',') {
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function parseIncomeCsv(text: string, year: number, createId: () => string): IncomeEntry[] {
  const [header, ...rows] = csvRows(text);
  if (!header || !rows.length) throw new Error('CSV needs a header and at least one income row.');
  if (rows.length > 500) throw new Error('Import up to 500 income rows at a time.');
  const columns = header.map((h) => h.trim());
  for (const name of ['source', 'kind', 'amount', 'year'])
    if (!columns.includes(name))
      throw new Error(`Missing CSV column: ${name}. Download the template for the supported format.`);
  if (new Set(columns).size !== columns.length) throw new Error('CSV contains duplicate column names.');
  return rows.map((row, index) => {
    if (row.length !== columns.length) throw new Error(`Row ${index + 2}: column count does not match the header.`);
    const get = (name: string) => (row[columns.indexOf(name)] || '').trim();
    if (Number(get('year')) !== year)
      throw new Error(`Row ${index + 2} belongs to ${get('year')}, not the selected year ${year}.`);
    const numeric = (key: string, fallback = 0) => (get(key) ? parseMoney(get(key)) : fallback);
    const parsed = incomeSchema.safeParse({
      id: createId(),
      source: get('source'),
      kind: get('kind'),
      amount: numeric('amount'),
      month: numeric('month'),
      owner: get('owner') || 'taxpayer',
      status: get('status') || 'actual',
      expenses: numeric('expenses'),
      withholding: numeric('withholding'),
      notes: get('notes'),
      ...(get('socialSecurityWages') ? { socialSecurityWages: numeric('socialSecurityWages') } : {}),
      ...(get('medicareWages') ? { medicareWages: numeric('medicareWages') } : {}),
    });
    if (!parsed.success) throw new Error(`Row ${index + 2}: ${parsed.error.issues.map((i) => i.message).join(' ')}`);
    return parsed.data;
  });
}
export const incomeCsvTemplate = (year: number) =>
  `year,source,kind,amount,month,status,owner,expenses,withholding\n${year},Example employer,w2,10000,1,actual,taxpayer,0,1500\n${year},Example client,selfEmployment,5000,10,projected,taxpayer,500,0\n`;

// Deliberately conservative: only suggest unambiguous label-adjacent values. Review is mandatory.
export function suggestDocumentIncome(text: string): {
  kind: IncomeEntry['kind'];
  amount?: number;
  withholding?: number;
  year?: number;
} {
  const kind = /W[\s-]?2\b/i.test(text)
    ? 'w2'
    : /1099[\s-]?NEC|nonemployee compensation/i.test(text)
      ? 'selfEmployment'
      : /1099[\s-]?INT/i.test(text)
        ? 'interest'
        : /1099[\s-]?DIV/i.test(text)
          ? 'ordinaryDividends'
          : 'other';
  const amountLabel =
    kind === 'w2'
      ? /wages,?\s*tips,?\s*other\s*comp(?:ensation)?\s*\$?([\d,]+\.\d{2})/gi
      : kind === 'selfEmployment'
        ? /nonemployee\s*compensation\s*\$?([\d,]+\.\d{2})/gi
        : kind === 'interest'
          ? /interest\s*income\s*\$?([\d,]+\.\d{2})/gi
          : /total\s*ordinary\s*dividends\s*\$?([\d,]+\.\d{2})/gi;
  const unique = (regex: RegExp) => {
    const values = [...new Set([...text.matchAll(regex)].map((m) => Number(m[1].replace(/,/g, ''))))];
    return values.length === 1 ? values[0] : undefined;
  };
  const years = [...new Set(text.match(/\b202[5-7]\b/g))];
  // 1099-DIV total includes qualified dividends: require manual split instead of guessing.
  return {
    kind,
    amount: kind === 'ordinaryDividends' ? undefined : unique(amountLabel),
    withholding: unique(/federal\s*income\s*tax\s*withheld\s*\$?([\d,]+\.\d{2})/gi),
    year: years.length === 1 ? Number(years[0]) : undefined,
  };
}

export async function readTaxDocument(
  file: File,
  progress: (message: string) => void,
  signal: AbortSignal,
): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a file smaller than 15 MB.');
  const aborted = () => {
    if (signal.aborted) throw new Error('Document reading canceled.');
  };
  let ocr: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | undefined;
  const stop = () => {
    void ocr?.terminate();
  };
  signal.addEventListener('abort', stop);
  const recognize = async (input: File | HTMLCanvasElement) => {
    aborted();
    if (!ocr) {
      progress('Preparing text recognition…');
      const { createWorker } = await import('tesseract.js');
      ocr = await createWorker('eng', 1, {
        workerPath: '/tax-workers/ocr.worker.min.js',
        corePath: '/tax-workers/',
        logger: (m) => {
          if (!signal.aborted && m.status === 'recognizing text')
            progress(`Reading document… ${Math.round(m.progress * 100)}%`);
        },
      });
    }
    aborted();
    return (await ocr.recognize(input)).data.text;
  };
  try {
    if (/\.pdf$/i.test(file.name)) {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/tax-workers/pdf.worker.min.mjs';
      const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
      const cancelPdf = () => {
        void task.destroy();
      };
      signal.addEventListener('abort', cancelPdf);
      try {
        const pdf = await task.promise;
        if (pdf.numPages > 15) throw new Error('Choose a PDF with 15 pages or fewer. Split larger statements first.');
        const pages: string[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          aborted();
          progress(`Reading page ${n} of ${pdf.numPages}…`);
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          let text = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('');
          if (text.replace(/\s/g, '').length < 30) {
            const initial = page.getViewport({ scale: 2 });
            const viewport = page.getViewport({
              scale: Math.min(2, 2400 / Math.max(initial.width / 2, initial.height / 2)),
            });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvas, viewport }).promise;
            text = await recognize(canvas);
            canvas.width = canvas.height = 0;
          }
          pages.push(text);
          page.cleanup();
        }
        return pages.join('\n\n');
      } finally {
        signal.removeEventListener('abort', cancelPdf);
        await task.destroy();
      }
    }
    if (/\.(png|jpe?g|webp)$/i.test(file.name)) return await recognize(file);
    if (/\.txt$/i.test(file.name)) return await file.text();
    throw new Error('Choose a PDF, PNG, JPEG, WebP, TXT or CSV file.');
  } finally {
    signal.removeEventListener('abort', stop);
    await ocr?.terminate();
  }
}
