"use client";

import type { Workspace } from "@/lib/engine/types";
import { daysUntil, fmtDate, fmtUsd } from "../ui";

export default function OverviewTab({ ws }: { ws: Workspace }) {
  const a = ws.analysis!;
  const weights = a.entities.evaluationWeights;

  return (
    <div className="grid lg:grid-cols-[1.7fr_1fr] gap-10">
      <div className="space-y-8">
        {/* Summary */}
        <section>
          <h3 className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-oxide mb-3">
            Document Summary
          </h3>
          <p className="font-display text-lg leading-relaxed">{a.summary}</p>
        </section>

        {/* Questions */}
        <section>
          <h3 className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-oxide mb-3">
            Questionnaire — {a.questions.length} item{a.questions.length === 1 ? "" : "s"} requiring narrative response
          </h3>
          {a.questions.length === 0 && (
            <p className="text-sm text-ink-soft">No explicit question section detected.</p>
          )}
          <ol className="space-y-2.5">
            {a.questions.map((q) => (
              <li key={q.id} className="flex gap-3 items-baseline">
                <span className="font-mono text-[0.65rem] text-ink-faint shrink-0">{q.id}</span>
                <span className="text-sm leading-relaxed">{q.text}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Evaluation weights */}
        {weights.length > 0 && (
          <section>
            <h3 className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-oxide mb-3">
              Evaluation Criteria &amp; Weights
            </h3>
            <div className="space-y-1.5">
              {weights.map((w) => (
                <div key={w.criterion} className="grid grid-cols-[1fr_auto] gap-3 items-center">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm truncate">{w.criterion}</span>
                    <span className="flex-1 dotted-rule hidden sm:block" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-28 h-2 bg-paper-3">
                      <span className="block h-full bg-ink" style={{ width: `${Math.min(100, w.weightPct * 2.5)}%` }} />
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums w-8 text-right">
                      {w.weightPct}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Side rail: key facts */}
      <aside className="space-y-6 lg:border-l lg:border-line lg:pl-8">
        <section>
          <h3 className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-oxide mb-3">
            Key Dates
          </h3>
          <ul className="space-y-3">
            {a.entities.deadlines.slice(0, 6).map((d, i) => {
              const days = daysUntil(d.dateIso);
              return (
                <li key={i} className="flex gap-3">
                  <div className="border border-line-strong rounded-sm px-2 py-1 text-center shrink-0 w-[4.4rem]">
                    <span className="block font-mono text-[0.85rem] font-semibold leading-none mt-0.5">
                      {d.dateIso ? fmtDate(d.dateIso).slice(0, 6) : "—"}
                    </span>
                    <span className="block font-mono text-[0.55rem] text-ink-faint mt-1">
                      {d.dateIso?.slice(0, 4) ?? ""}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.82rem] font-medium leading-tight">{d.label}</p>
                    {days !== null && (
                      <p className={`font-mono text-[0.62rem] mt-0.5 ${days < 14 ? "text-oxide" : "text-ink-faint"}`}>
                        {days >= 0 ? `T-minus ${days} day${days === 1 ? "" : "s"}` : `${-days}d elapsed`}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
            {a.entities.deadlines.length === 0 && (
              <li className="text-sm text-ink-soft">No dated milestones extracted.</li>
            )}
          </ul>
        </section>

        <section>
          <h3 className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-oxide mb-3">
            Budget Signals
          </h3>
          {a.entities.budget.length === 0 && (
            <p className="text-sm text-ink-soft">No budget figure extracted.</p>
          )}
          <ul className="space-y-2">
            {a.entities.budget.slice(0, 4).map((b, i) => (
              <li key={i}>
                <p className="font-mono text-lg font-semibold tabular-nums">
                  {b.currency} {b.amount?.toLocaleString()}
                  {b.amountUsd && b.currency !== "USD" && (
                    <span className="text-[0.7rem] text-ink-faint font-normal ml-2">
                      ≈ {fmtUsd(b.amountUsd)}
                    </span>
                  )}
                </p>
                <p className="text-[0.7rem] text-ink-soft leading-snug mt-0.5 line-clamp-2">{b.raw}</p>
              </li>
            ))}
          </ul>
        </section>

        {a.entities.bidSecurity && (
          <section>
            <h3 className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-oxide mb-2">
              Bid Security
            </h3>
            <p className="text-[0.82rem] leading-relaxed">{a.entities.bidSecurity}</p>
          </section>
        )}

        {a.entities.contacts.length > 0 && (
          <section>
            <h3 className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-oxide mb-2">
              Procurement Contact
            </h3>
            {a.entities.contacts.map((c) => (
              <p key={c} className="font-mono text-sm">{c}</p>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}
