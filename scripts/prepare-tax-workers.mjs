import { mkdir, copyFile, readdir } from 'node:fs/promises';

// Host executable PDF/OCR workers with the app; document bytes stay in the browser.
const destination = new URL('../public/tax-workers/', import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(
  new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
  new URL('pdf.worker.min.mjs', destination),
);
await copyFile(
  new URL('../node_modules/tesseract.js/dist/worker.min.js', import.meta.url),
  new URL('ocr.worker.min.js', destination),
);
const core = new URL('../node_modules/tesseract.js-core/', import.meta.url);
for (const name of await readdir(core)) {
  if (name.startsWith('tesseract-core') && /\.(js|wasm)$/.test(name))
    await copyFile(new URL(name, core), new URL(name, destination));
}
