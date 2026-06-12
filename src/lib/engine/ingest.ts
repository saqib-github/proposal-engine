/**
 * Document ingestion: PDF (unpdf), DOCX (mammoth) and plain text.
 */

import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export type SupportedExt = "pdf" | "docx" | "txt";

export function detectExt(fileName: string): SupportedExt | null {
  const m = fileName.toLowerCase().match(/\.(pdf|docx|txt|md)$/);
  if (!m) return null;
  return (m[1] === "md" ? "txt" : m[1]) as SupportedExt;
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

  if (ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }

  if (ext === "docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  return buffer.toString("utf-8");
}
