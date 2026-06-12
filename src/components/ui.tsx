"use client";

import type { ReactNode } from "react";

/* ---------- Formatting helpers ---------- */

export function fmtUsd(value?: number): string {
  if (typeof value !== "number") return "—";
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}k`;
  return `$${value}`;
}

export function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/* ---------- Decision / status colors ---------- */

export const DECISION_STYLE: Record<string, string> = {
  GO: "text-verdant",
  "CONDITIONAL GO": "text-amber",
  "NO-GO": "text-oxide",
};

export const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  pass: { label: "PASS", cls: "text-verdant bg-verdant-soft" },
  partial: { label: "PARTIAL", cls: "text-amber bg-amber-soft" },
  gap: { label: "GAP", cls: "text-oxide bg-oxide-soft" },
};

export function Stamp({
  children,
  className = "",
  large = false,
}: {
  children: ReactNode;
  className?: string;
  large?: boolean;
}) {
  return (
    <span className={`stamp ${large ? "stamp-lg" : "text-[0.62rem]"} ${className}`}>
      {children}
    </span>
  );
}

/* ---------- Tiny markdown renderer (headings, bold, bullets, tables) ---------- */

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;
  const RE = /(\*\*(.+?)\*\*|_(.+?)_|`(.+?)`)/;
  while (rest) {
    const m = rest.match(RE);
    if (!m || m.index === undefined) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    if (m[2] !== undefined) out.push(<strong key={`${key}-${i}`}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<em key={`${key}-${i}`}>{m[3]}</em>);
    else if (m[4] !== undefined) out.push(<code key={`${key}-${i}`}>{m[4]}</code>);
    rest = rest.slice(m.index + m[1].length);
    i++;
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let table: string[][] = [];
  let k = 0;

  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={k++}>
        {bullets.map((b, i) => (
          <li key={i}>{inline(b, i)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const [head, ...rows] = table;
    blocks.push(
      <table key={k++}>
        <thead>
          <tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c, j)}</td>)}</tr>
          ))}
        </tbody>
      </table>,
    );
    table = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (/^\|.*\|$/.test(trimmed)) {
      flushBullets();
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^[-: ]*$/.test(c))) continue;
      table.push(cells);
      continue;
    }
    flushTable();

    if (/^[-*•] /.test(trimmed)) {
      bullets.push(trimmed.slice(2));
      continue;
    }
    flushBullets();

    if (!trimmed) continue;
    if (trimmed.startsWith("### ")) blocks.push(<h3 key={k++}>{inline(trimmed.slice(4))}</h3>);
    else if (trimmed.startsWith("## ")) blocks.push(<h2 key={k++}>{inline(trimmed.slice(3))}</h2>);
    else if (trimmed.startsWith("# ")) blocks.push(<h1 key={k++}>{inline(trimmed.slice(2))}</h1>);
    else if (trimmed === "---") blocks.push(<div key={k++} className="dotted-rule my-3" />);
    else blocks.push(<p key={k++}>{inline(trimmed)}</p>);
  }
  flushBullets();
  flushTable();

  return <div className="prose-draft">{blocks}</div>;
}
