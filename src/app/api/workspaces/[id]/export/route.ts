import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { getWorkspace, loadLibrary } from "@/lib/engine/store";
import { renderDraftMarkdown } from "@/lib/engine/draft";

/** Minimal markdown → docx paragraph conversion (headings, bullets, tables). */
function markdownToDocxChildren(md: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const lines = md.split("\n");
  let tableRows: string[][] = [];

  const flushTable = () => {
    if (tableRows.length === 0) return;
    out.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: tableRows.map(
          (cells, i) =>
            new TableRow({
              children: cells.map(
                (c) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: c, bold: i === 0, size: 18 })],
                      }),
                    ],
                  }),
              ),
            }),
        ),
      }),
    );
    tableRows = [];
  };

  const plain = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/_(.+?)_/g, "$1").replace(/`(.+?)`/g, "$1");

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|.*\|$/.test(line.trim())) {
      const cells = line.trim().slice(1, -1).split("|").map((c) => plain(c.trim()));
      if (cells.every((c) => /^[-: ]*$/.test(c))) continue; // separator row
      tableRows.push(cells);
      continue;
    }
    flushTable();

    if (!line.trim()) continue;
    if (line.startsWith("# ")) {
      out.push(new Paragraph({ text: plain(line.slice(2)), heading: HeadingLevel.HEADING_1 }));
    } else if (line.startsWith("## ")) {
      out.push(new Paragraph({ text: plain(line.slice(3)), heading: HeadingLevel.HEADING_2 }));
    } else if (line.startsWith("### ")) {
      out.push(new Paragraph({ text: plain(line.slice(4)), heading: HeadingLevel.HEADING_3 }));
    } else if (/^[-*•] /.test(line.trim())) {
      out.push(new Paragraph({ text: plain(line.trim().slice(2)), bullet: { level: 0 } }));
    } else if (line.trim() === "---") {
      out.push(new Paragraph({ text: "" }));
    } else {
      out.push(new Paragraph({ children: [new TextRun(plain(line))] }));
    }
  }
  flushTable();
  return out;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format") ?? "md";
  const ws = await getWorkspace(id);
  if (!ws?.analysis || !ws.draft) {
    return NextResponse.json({ error: "Workspace not ready" }, { status: 404 });
  }
  const { profile } = await loadLibrary();
  const markdown = renderDraftMarkdown(ws.analysis, profile, ws.draft);
  const baseName = ws.name.replace(/[^\w-]+/g, "-").slice(0, 60) || "proposal";

  if (format === "docx") {
    const doc = new Document({
      sections: [{ children: markdownToDocxChildren(markdown) }],
    });
    const buffer = await Packer.toBuffer(doc);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${baseName}.docx"`,
      },
    });
  }

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.md"`,
    },
  });
}
