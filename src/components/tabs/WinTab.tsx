"use client";

import { useEffect, useState } from "react";
import type { Workspace } from "@/lib/engine/types";
import { DECISION_STYLE, Stamp } from "../ui";

function Dial({ value }: { value: number }) {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(value), 80);
    return () => clearTimeout(t);
  }, [value]);

  const r = 84;
  const circumference = Math.PI * r; // half circle
  const offset = circumference * (1 - animated / 100);
  const color =
    value >= 60 ? "var(--color-verdant)" : value >= 40 ? "var(--color-amber)" : "var(--color-oxide)";

  return (
    <svg viewBox="0 0 200 120" className="w-full max-w-[280px]">
      {/* ticks */}
      {Array.from({ length: 21 }, (_, i) => {
        const angle = Math.PI - (i / 20) * Math.PI;
        const x1 = 100 + Math.cos(angle) * 96;
        const y1 = 104 - Math.sin(angle) * 96;
        const x2 = 100 + Math.cos(angle) * (i % 5 === 0 ? 88 : 92);
        const y2 = 104 - Math.sin(angle) * (i % 5 === 0 ? 88 : 92);
        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="var(--color-line-strong)"
            strokeWidth={i % 5 === 0 ? 1.5 : 0.75}
          />
        );
      })}
      <path
        d={`M ${100 - r} 104 A ${r} ${r} 0 0 1 ${100 + r} 104`}
        fill="none"
        stroke="var(--color-paper-3)"
        strokeWidth="13"
      />
      <path
        d={`M ${100 - r} 104 A ${r} ${r} 0 0 1 ${100 + r} 104`}
        fill="none"
        stroke={color}
        strokeWidth="13"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="win-dial-arc"
      />
      <text
        x="100" y="92"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="34"
        fontWeight="600"
        fill="var(--color-ink)"
      >
        {value}
      </text>
      <text
        x="100" y="110"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="9"
        letterSpacing="3"
        fill="var(--color-ink-faint)"
      >
        WIN PROBABILITY %
      </text>
    </svg>
  );
}

export default function WinTab({ ws }: { ws: Workspace }) {
  const win = ws.win!;

  return (
    <div className="grid lg:grid-cols-[1fr_1.6fr] gap-10 items-start">
      <section className="text-center lg:sticky lg:top-8">
        <Dial value={win.probability} />
        <div className="mt-5">
          <Stamp large className={DECISION_STYLE[win.decision] ?? "text-ink"}>
            {win.decision}
          </Stamp>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-ink-soft text-left border-t border-line pt-4">
          {win.rationale}
        </p>
      </section>

      <section>
        <h3 className="font-mono text-[0.65rem] tracking-[0.25em] uppercase text-oxide mb-4">
          Scoring Factors
        </h3>
        <ul className="space-y-5">
          {win.factors.map((f, i) => (
            <li key={f.key} className="ledger-row" style={{ animationDelay: `${i * 90}ms` }}>
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-display font-semibold text-[0.95rem]">{f.label}</p>
                <p className="font-mono text-lg font-semibold tabular-nums">
                  {f.score}
                  <span className="text-[0.6rem] text-ink-faint font-normal ml-1.5">
                    × {(f.weight * 100).toFixed(0)}% wt
                  </span>
                </p>
              </div>
              <div className="mt-1.5 h-2.5 bg-paper-3 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 transition-all duration-700"
                  style={{
                    width: `${f.score}%`,
                    background:
                      f.score >= 60
                        ? "var(--color-verdant)"
                        : f.score >= 40
                          ? "var(--color-amber)"
                          : "var(--color-oxide)",
                  }}
                />
                {/* weight marker */}
                <div
                  className="absolute inset-y-0 w-px bg-ink"
                  style={{ left: `${f.score}%` }}
                />
              </div>
              <p className="text-[0.8rem] text-ink-soft mt-1.5 leading-relaxed">{f.detail}</p>
            </li>
          ))}
        </ul>

        <div className="mt-8 border border-line bg-paper-2/60 px-4 py-3">
          <p className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-ink-faint">
            Method note
          </p>
          <p className="text-[0.78rem] text-ink-soft leading-relaxed mt-1">
            Probability is the weighted sum of the five factors. Budget alignment and domain
            win rate derive from the 120-bid historical outcomes dataset; compliance coverage
            and evidence depth derive from the capability-library match; mandatory gaps apply
            a −15 pt penalty each to coverage and cap the decision at CONDITIONAL GO.
          </p>
        </div>
      </section>
    </div>
  );
}
