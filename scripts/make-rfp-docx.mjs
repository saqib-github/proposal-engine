#!/usr/bin/env node
/**
 * Render the fleet-tracking sample RFP source as a .docx using the "docx" package.
 *
 * Reads:  data/sample-rfps/src/rfp-fleet-tracking-system.txt
 * Writes: data/sample-rfps/rfp-fleet-tracking-system.docx
 *
 * Parsing rules mirror scripts/make-rfp-docs.py (kept deliberately simple):
 *   "1. HEADING IN CAPS"  -> HeadingLevel.HEADING_1
 *   "1.1 Subheading"      -> HeadingLevel.HEADING_2
 *   "- bullet"            -> bulleted paragraph
 *   "Q1. question"        -> paragraph with bold "Q1." run
 *   "a | b | c"           -> kept as a plain text row (extractable)
 *   anything else         -> justified body paragraph
 *
 * npm install may still be running in parallel: if node_modules/docx is not
 * present yet, wait ~60s and retry, up to 5 attempts, before giving up.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'sample-rfps', 'src', 'rfp-fleet-tracking-system.txt');
const OUT = path.join(ROOT, 'data', 'sample-rfps', 'rfp-fleet-tracking-system.docx');

const H1_RE = /^(\d+)\.\s+([A-Z][A-Z0-9 ,&/()'\-:]*)$/;
const H2_RE = /^(\d+(?:\.\d+)+)\s+(.+)$/;
const Q_RE = /^(Q\d+)\.\s+(.+)$/;
const META_RE = /^([A-Za-z][A-Za-z .]*?):\s+(.+)$/;
const META_KEYS = new Set([
  'Reference No',
  'Issued by',
  'Date of Issue',
  'Procurement Method',
  'Contact Email',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadDocx() {
  const pkgDir = path.join(ROOT, 'node_modules', 'docx');
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (fs.existsSync(pkgDir)) {
      try {
        return await import('docx');
      } catch (err) {
        console.warn(`node_modules/docx exists but could not be imported yet: ${err.message}`);
      }
    }
    if (attempt < maxAttempts) {
      console.log(
        `[attempt ${attempt}/${maxAttempts}] "docx" package not ready ` +
        '(npm install may still be running); waiting 60s before retrying...',
      );
      await sleep(60_000);
    }
  }
  throw new Error('The "docx" package is not installed after 5 attempts. Run: npm install');
}

function parseSource(text) {
  const lines = text.split(/\r?\n/);
  let bodyStart = lines.findIndex((raw) => H1_RE.test(raw.trim()));
  if (bodyStart < 0) bodyStart = 0;

  const cover = { doctype: '', title: '', meta: [] };
  for (const raw of lines.slice(0, bodyStart)) {
    const line = raw.trim();
    if (!line) continue;
    const metaMatch = line.match(META_RE);
    if (metaMatch && META_KEYS.has(metaMatch[1])) {
      cover.meta.push([metaMatch[1], metaMatch[2]]);
    } else if (!cover.doctype) {
      cover.doctype = line;
    } else {
      cover.title = `${cover.title} ${line}`.trim();
    }
  }

  const blocks = [];
  for (const raw of lines.slice(bodyStart)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(H1_RE))) {
      blocks.push({ kind: 'h1', text: `${m[1]}. ${m[2].trim()}` });
    } else if (line.includes(' | ')) {
      blocks.push({ kind: 'tablerow', text: line });
    } else if ((m = line.match(H2_RE))) {
      blocks.push({ kind: 'h2', text: `${m[1]} ${m[2].trim()}` });
    } else if (line.startsWith('- ')) {
      blocks.push({ kind: 'bullet', text: line.slice(2).trim() });
    } else if ((m = line.match(Q_RE))) {
      blocks.push({ kind: 'question', label: m[1], text: m[2] });
    } else {
      blocks.push({ kind: 'para', text: line });
    }
  }
  return { cover, blocks };
}

async function main() {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
    await loadDocx();

  const { cover, blocks } = parseSource(fs.readFileSync(SRC, 'utf8'));
  const children = [];

  // --- cover block ---
  if (cover.doctype) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 240 },
      children: [new TextRun({ text: cover.doctype, bold: true, size: 30 })],
    }));
  }
  if (cover.title) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({ text: cover.title, bold: true, size: 40 })],
    }));
  }
  for (const [key, value] of cover.meta) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({ text: `${key}: `, bold: true }),
        new TextRun({ text: value }),
      ],
    }));
  }
  children.push(new Paragraph({ pageBreakBefore: true, children: [] }));

  // --- body ---
  for (const block of blocks) {
    if (block.kind === 'h1') {
      children.push(new Paragraph({
        text: block.text,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
      }));
    } else if (block.kind === 'h2') {
      children.push(new Paragraph({
        text: block.text,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 80 },
      }));
    } else if (block.kind === 'bullet') {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60 },
        children: [new TextRun({ text: block.text })],
      }));
    } else if (block.kind === 'question') {
      children.push(new Paragraph({
        spacing: { after: 100 },
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({ text: `${block.label}. `, bold: true }),
          new TextRun({ text: block.text }),
        ],
      }));
    } else if (block.kind === 'tablerow') {
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: block.text })],
      }));
    } else {
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 100 },
        children: [new TextRun({ text: block.text })],
      }));
    }
  }

  const metaMap = Object.fromEntries(cover.meta);
  const doc = new Document({
    creator: metaMap['Issued by'] || 'Sample RFP Generator',
    title: cover.title,
    description: cover.doctype,
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buffer);
  console.log(`wrote ${OUT} (${fs.statSync(OUT).size} bytes)`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
