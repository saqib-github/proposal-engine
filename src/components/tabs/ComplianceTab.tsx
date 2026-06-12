"use client";

import { useMemo, useState } from "react";
import type { ComplianceStatus, Workspace } from "@/lib/engine/types";
import { STATUS_STYLE } from "../ui";

type Filter = "all" | ComplianceStatus | "mandatory";

export default function ComplianceTab({ ws }: { ws: Workspace }) {
  const items = useMemo(() => ws.compliance ?? [], [ws.compliance]);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const counts = {
    pass: items.filter((i) => i.status === "pass").length,
    partial: items.filter((i) => i.status === "partial").length,
    gap: items.filter((i) => i.status === "gap").length,
  };
  const mandatoryGaps = items.filter(
    (i) => i.status === "gap" && i.requirement.kind === "mandatory",
  );

  const visible = items.filter((i) => {
    if (filter === "all") return true;
    if (filter === "mandatory") return i.requirement.kind === "mandatory";
    return i.status === filter;
  });

  return (
    <div>
      {/* Tallies */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border border-line mb-6">
        {(
          [
            ["Checked", items.length, "text-ink"],
            ["Pass", counts.pass, "text-verdant"],
            ["Partial", counts.partial, "text-amber"],
            ["Gap", counts.gap, "text-oxide"],
          ] as const
        ).map(([label, value, cls]) => (
          <div key={label} className="bg-paper px-4 py-3">
            <p className="font-mono text-[0.6rem] tracking-[0.22em] uppercase text-ink-faint">
              {label}
            </p>
            <p className={`font-mono text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
          </div>
        ))}
      </div>

      {mandatoryGaps.length > 0 && (
        <div className="border-l-4 border-oxide bg-oxide-soft/50 px-4 py-3 mb-6">
          <p className="font-mono text-[0.65rem] tracking-[0.2em] uppercase text-oxide font-semibold">
            ⚠ Disqualification risk
          </p>
          <p className="text-sm mt-1 leading-relaxed">
            {mandatoryGaps.length} mandatory requirement{mandatoryGaps.length === 1 ? "" : "s"}{" "}
            unmet ({mandatoryGaps.map((g) => g.requirementId).join(", ")}). Resolve via
            consortium partner, pre-bid clarification or certification fast-track before
            committing to this bid.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(
          [
            ["all", `All (${items.length})`],
            ["gap", `Gaps (${counts.gap})`],
            ["partial", `Partial (${counts.partial})`],
            ["pass", `Pass (${counts.pass})`],
            ["mandatory", "Mandatory only"],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`font-mono text-[0.65rem] tracking-[0.14em] uppercase px-3 py-1.5 border rounded-sm transition-colors cursor-pointer ${
              filter === f
                ? "border-ink bg-ink text-paper"
                : "border-line-strong text-ink-soft hover:border-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Checklist */}
      <ul className="border-t-2 border-ink">
        {visible.map((item) => {
          const style = STATUS_STYLE[item.status];
          const expanded = open === item.requirementId;
          return (
            <li key={item.requirementId} className="border-b border-line">
              <button
                onClick={() => setOpen(expanded ? null : item.requirementId)}
                className="w-full grid grid-cols-[auto_auto_1fr_auto] gap-4 items-start px-2 py-3.5 text-left hover:bg-paper-2/60 transition-colors cursor-pointer"
              >
                <span className="font-mono text-[0.65rem] text-ink-faint pt-0.5 w-12">
                  {item.requirementId}
                </span>
                <span
                  className={`font-mono text-[0.58rem] tracking-[0.12em] px-1.5 py-0.5 rounded-sm font-semibold ${style.cls}`}
                >
                  {style.label}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm leading-relaxed">
                    {item.requirement.text}
                  </span>
                  <span className="block font-mono text-[0.6rem] tracking-[0.1em] uppercase text-ink-faint mt-1">
                    {item.requirement.kind} · {item.requirement.category}
                    {item.requirement.section ? ` · ${item.requirement.section.slice(0, 50)}` : ""}
                    {` · confidence ${(item.confidence * 100).toFixed(0)}%`}
                  </span>
                </span>
                <span className="font-mono text-ink-faint text-xs pt-1">
                  {expanded ? "−" : "+"}
                </span>
              </button>

              {expanded && (
                <div className="px-2 pb-4 pl-[4.5rem]">
                  <p className="text-[0.84rem] leading-relaxed border-l-2 border-line-strong pl-3 text-ink-soft">
                    {item.note}
                  </p>
                  {item.evidence.length > 0 && (
                    <div className="mt-3">
                      <p className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-ink-faint mb-2">
                        Library evidence
                      </p>
                      <ul className="space-y-2">
                        {item.evidence.map((ev) => (
                          <li key={ev.recordId} className="text-[0.82rem] leading-relaxed">
                            <span className="font-mono text-[0.62rem] text-link mr-1.5">
                              [{ev.recordId}]
                            </span>
                            <span className="font-medium">{ev.title}</span>
                            <span className="font-mono text-[0.6rem] text-ink-faint ml-2">
                              match {(ev.score * 100).toFixed(0)}%
                            </span>
                            <span className="block text-ink-soft mt-0.5">{ev.snippet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && (
        <p className="py-8 text-center font-mono text-xs uppercase tracking-[0.15em] text-ink-faint">
          Nothing matches this filter.
        </p>
      )}
    </div>
  );
}
