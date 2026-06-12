/**
 * Document ingestion: PDF (unpdf/pdf.js), DOCX (mammoth) and plain text.
 *
 * For PDFs we rebuild line structure from text-item coordinates instead of
 * using unpdf's flat extractText — the heuristic NER layer depends on real
 * lines (headings, bullets, "Q1." anchors, table rows), and merged extraction
 * collapses the whole document into a single line.
 */

import { getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export type SupportedExt = "pdf" | "docx" | "txt";

export function detectExt(fileName: string): SupportedExt | null {
  const m = fileName.toLowerCase().match(/\.(pdf|docx|txt|md)$/);
  if (!m) return null;
  return (m[1] === "md" ? "txt" : m[1]) as SupportedExt;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line = "";
    let lastY: number | null = null;

    for (const raw of content.items) {
      const item = raw as PdfTextItem;
      if (typeof item.str !== "string") continue;
      const y = item.transform?.[5];

      // New line when the baseline moves vertically (>2pt) or pdf.js marks EOL.
      if (lastY !== null && typeof y === "number" && Math.abs(y - lastY) > 2) {
        if (line.trim()) lines.push(line.trimEnd());
        line = "";
      }
      line += item.str + " ";
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.trimEnd());
        line = "";
        lastY = null;
        continue;
      }
      if (typeof y === "number") lastY = y;
    }
    if (line.trim()) lines.push(line.trimEnd());
    pages.push(lines.join("\n"));
  }

  return pages.join("\n\n");
}

export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const ext = detectExt(fileName);
  if (!ext) {
    throw new Error(
      `Unsupported file type for "${fileName}" — upload a PDF, DOCX or TXT document.`,
    );
  }

  if (ext === "pdf") return extractPdfText(buffer);

  if (ext === "docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  return buffer.toString("utf-8");
}
