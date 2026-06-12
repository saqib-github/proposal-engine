#!/usr/bin/env python3
"""Render the anonymized sample RFP .txt sources into professional multi-page PDFs.

Reads:  data/sample-rfps/src/*.txt
Writes: data/sample-rfps/<same-basename>.pdf

Parsing rules (line based):
  - "1. HEADING IN CAPS"          -> Heading 1
  - "1.1 Subheading"              -> Heading 2 (also 1.1.1 etc.)
  - "- bullet text"               -> bullet item
  - "Q1. question text"           -> numbered question item
  - lines containing " | "        -> rows of a pipe-separated table (consecutive
                                     rows are grouped; first row is the header)
  - anything else                 -> justified body paragraph
The block of lines before the first Heading 1 is treated as the cover/title
block: first non-empty line is the document type, "Key: Value" lines are
metadata, the remaining line is the document title.

Usage: python3 scripts/make-rfp-docs.py
"""

import os
import re
import sys
from functools import partial
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "data", "sample-rfps", "src")
OUT_DIR = os.path.join(ROOT, "data", "sample-rfps")

PAGE_W, PAGE_H = A4
MARGIN = 22 * mm
AVAIL_W = PAGE_W - 2 * MARGIN

H1_RE = re.compile(r"^(\d+)\.\s+([A-Z][A-Z0-9 ,&/()'\-:]*)$")
H2_RE = re.compile(r"^(\d+(?:\.\d+)+)\s+(.+)$")
Q_RE = re.compile(r"^(Q\d+)\.\s+(.+)$")
CLAUSE_ID_RE = re.compile(r"^([A-Z]{1,3}-\d+):\s+(.+)$")
META_KEYS = (
    "Reference No",
    "Issued by",
    "Date of Issue",
    "Procurement Method",
    "Contact Email",
)

ACCENT = colors.HexColor("#1F3A5F")
GRID = colors.HexColor("#8C8C8C")
HEADER_BG = colors.HexColor("#DCE3EC")

S_DOCTYPE = ParagraphStyle(
    "DocType", fontName="Helvetica-Bold", fontSize=13, leading=17,
    alignment=TA_CENTER, textColor=ACCENT, spaceAfter=4,
)
S_TITLE = ParagraphStyle(
    "DocTitle", fontName="Helvetica-Bold", fontSize=19, leading=25,
    alignment=TA_CENTER, textColor=colors.black, spaceBefore=10, spaceAfter=10,
)
S_META = ParagraphStyle(
    "Meta", fontName="Helvetica", fontSize=10.5, leading=17, alignment=TA_CENTER,
)
S_H1 = ParagraphStyle(
    "H1", fontName="Helvetica-Bold", fontSize=12.5, leading=16,
    textColor=ACCENT, spaceBefore=16, spaceAfter=6, keepWithNext=1,
)
S_H2 = ParagraphStyle(
    "H2", fontName="Helvetica-Bold", fontSize=10.5, leading=14,
    textColor=colors.black, spaceBefore=10, spaceAfter=4, keepWithNext=1,
)
S_BODY = ParagraphStyle(
    "Body", fontName="Helvetica", fontSize=9.5, leading=13.5,
    alignment=TA_JUSTIFY, spaceBefore=2, spaceAfter=5,
)
S_BULLET = ParagraphStyle(
    "Bullet", parent=S_BODY, leftIndent=16, bulletIndent=5,
    spaceBefore=1, spaceAfter=3,
)
S_QITEM = ParagraphStyle(
    "QItem", parent=S_BODY, leftIndent=14, spaceBefore=4, spaceAfter=6,
)
S_CELL = ParagraphStyle(
    "Cell", fontName="Helvetica", fontSize=8.5, leading=11, spaceAfter=0,
)
S_CELL_HEAD = ParagraphStyle(
    "CellHead", parent=S_CELL, fontName="Helvetica-Bold",
)


def parse_source(text):
    """Split a source file into a cover dict and a list of (kind, payload) blocks."""
    lines = text.splitlines()

    # --- locate the first Heading 1: everything before it is the cover block.
    body_start = 0
    for i, raw in enumerate(lines):
        if H1_RE.match(raw.strip()):
            body_start = i
            break

    cover = {"doctype": "", "title": "", "meta": []}
    for raw in lines[:body_start]:
        line = raw.strip()
        if not line:
            continue
        key_match = re.match(r"^([A-Za-z][A-Za-z .]*?):\s+(.+)$", line)
        if key_match and key_match.group(1) in META_KEYS:
            cover["meta"].append((key_match.group(1), key_match.group(2)))
        elif not cover["doctype"]:
            cover["doctype"] = line
        else:
            cover["title"] = (cover["title"] + " " + line).strip()

    # --- classify body lines into blocks, grouping consecutive table rows.
    blocks = []
    table_rows = []

    def flush_table():
        if table_rows:
            blocks.append(("table", list(table_rows)))
            table_rows.clear()

    for raw in lines[body_start:]:
        line = raw.strip()
        if not line:
            flush_table()
            continue
        if " | " in line:
            table_rows.append([cell.strip() for cell in line.split(" | ")])
            continue
        flush_table()
        m = H1_RE.match(line)
        if m:
            blocks.append(("h1", "%s. %s" % (m.group(1), m.group(2).strip())))
            continue
        m = H2_RE.match(line)
        if m:
            blocks.append(("h2", "%s %s" % (m.group(1), m.group(2).strip())))
            continue
        if line.startswith("- "):
            blocks.append(("bullet", line[2:].strip()))
            continue
        m = Q_RE.match(line)
        if m:
            blocks.append(("question", (m.group(1), m.group(2))))
            continue
        blocks.append(("para", line))
    flush_table()
    return cover, blocks


def build_table(rows):
    """Turn pipe-split rows into a styled reportlab Table."""
    n_cols = max(len(r) for r in rows)
    rows = [r + [""] * (n_cols - len(r)) for r in rows]

    # Column widths proportional to the longest cell in each column.
    weights = []
    for c in range(n_cols):
        longest = max(len(r[c]) for r in rows)
        weights.append(max(longest, 8))
    total = float(sum(weights))
    widths = [max(AVAIL_W * w / total, 20 * mm) for w in weights]
    scale = AVAIL_W / sum(widths)
    widths = [w * scale for w in widths]

    data = []
    for i, row in enumerate(rows):
        style = S_CELL_HEAD if i == 0 else S_CELL
        data.append([Paragraph(escape(cell), style) for cell in row])

    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("GRID", (0, 0), (-1, -1), 0.5, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F6F9")]),
    ]))
    return table


def cover_flowables(cover):
    flow = [Spacer(1, 55 * mm)]
    if cover["doctype"]:
        flow.append(Paragraph(escape(cover["doctype"]), S_DOCTYPE))
    flow.append(HRFlowable(width="70%", thickness=1, color=ACCENT, hAlign="CENTER",
                           spaceBefore=6, spaceAfter=6))
    if cover["title"]:
        flow.append(Paragraph(escape(cover["title"]), S_TITLE))
    flow.append(HRFlowable(width="70%", thickness=1, color=ACCENT, hAlign="CENTER",
                           spaceBefore=6, spaceAfter=18))
    for key, value in cover["meta"]:
        flow.append(Paragraph("<b>%s:</b> %s" % (escape(key), escape(value)), S_META))
    flow.append(PageBreak())
    return flow


def body_flowables(blocks):
    flow = []
    for kind, payload in blocks:
        if kind == "h1":
            flow.append(Paragraph(escape(payload), S_H1))
        elif kind == "h2":
            flow.append(Paragraph(escape(payload), S_H2))
        elif kind == "bullet":
            m = CLAUSE_ID_RE.match(payload)
            if m:
                text = "<b>%s:</b> %s" % (escape(m.group(1)), escape(m.group(2)))
            else:
                text = escape(payload)
            flow.append(Paragraph(text, S_BULLET, bulletText="•"))
        elif kind == "question":
            label, text = payload
            flow.append(Paragraph("<b>%s.</b> %s" % (escape(label), escape(text)), S_QITEM))
        elif kind == "table":
            flow.append(Spacer(1, 3))
            flow.append(build_table(payload))
            flow.append(Spacer(1, 6))
        else:
            flow.append(Paragraph(escape(payload), S_BODY))
    return flow


def draw_footer(canvas, doc, ref, issuer):
    """onPage callback: rule, reference number and page number on every page."""
    canvas.saveState()
    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(0.4)
    canvas.line(MARGIN, 15 * mm, PAGE_W - MARGIN, 15 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#555555"))
    canvas.drawString(MARGIN, 11 * mm, "%s  |  %s" % (ref, issuer))
    canvas.drawRightString(PAGE_W - MARGIN, 11 * mm,
                           "Page %d" % canvas.getPageNumber())
    canvas.restoreState()


def render_pdf(src_path, out_path):
    with open(src_path, "r", encoding="utf-8") as fh:
        cover, blocks = parse_source(fh.read())

    meta = dict(cover["meta"])
    ref = meta.get("Reference No", os.path.basename(src_path))
    issuer = meta.get("Issued by", "")

    doc = SimpleDocTemplate(
        out_path,
        pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=20 * mm, bottomMargin=22 * mm,
        title=cover["title"] or os.path.basename(src_path),
        author=issuer,
        subject=cover["doctype"],
    )
    footer = partial(draw_footer, ref=ref, issuer=issuer)
    story = cover_flowables(cover) + body_flowables(blocks)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def main():
    if not os.path.isdir(SRC_DIR):
        print("Source directory not found: %s" % SRC_DIR, file=sys.stderr)
        return 1
    sources = sorted(
        f for f in os.listdir(SRC_DIR)
        if f.lower().endswith(".txt")
    )
    if not sources:
        print("No .txt sources found in %s" % SRC_DIR, file=sys.stderr)
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    for name in sources:
        src = os.path.join(SRC_DIR, name)
        out = os.path.join(OUT_DIR, os.path.splitext(name)[0] + ".pdf")
        render_pdf(src, out)
        print("wrote %s (%d bytes)" % (out, os.path.getsize(out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
