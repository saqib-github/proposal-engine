"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Workspace } from "@/lib/engine/types";
import { DECISION_STYLE, Stamp } from "./ui";
import OverviewTab from "./tabs/OverviewTab";
import ComplianceTab from "./tabs/ComplianceTab";
import WinTab from "./tabs/WinTab";
import DraftTab from "./tabs/DraftTab";

const TABS = ["Overview", "Compliance", "Win Analysis", "Draft Response"] as const;
type Tab = (typeof TABS)[number];

export default function WorkspaceView({ id }: { id: string }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${id}`, { cache: "no-store" });
    if (res.status === 404) {
      setMissing(true);
      return;
    }
    if (res.ok) setWs(await res.json());
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (ws?.status !== "processing") return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [ws?.status, refresh]);

  if (missing) {
    return (
      <p className="font-mono text-sm text-ink-soft">
        Workspace not found.{" "}
        <Link href="/" className="underline text-link">
          Return to registry
        </Link>
        .
      </p>
    );
  }

  if (!ws) {
    return (
      <p className="font-mono text-xs tracking-[0.2em] uppercase text-ink-faint py-16 text-center">
        Opening workspace…
      </p>
    );
  }

  return (
    <div>
      {/* Breadcrumb + title */}
      <p className="font-mono text-[0.62rem] tracking-[0.2em] uppercase text-ink-faint">
        <Link href="/" className="hover:text-oxide transition-colors">
          Registry
        </Link>{" "}
        / {ws.id}
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold leading-tight max-w-3xl">
            {ws.name}
          </h1>
          <p className="font-mono text-[0.65rem] tracking-[0.1em] text-ink-faint mt-1.5">
            {ws.fileName} · ingested {new Date(ws.createdAt).toLocaleString("en-GB")}
            {ws.analysis ? ` · sector: ${ws.analysis.sector}` : ""}
            {ws.analysis ? ` · engine: ${ws.analysis.aiMode === "claude" ? "Claude + NER" : "heuristic NER"}` : ""}
          </p>
        </div>
        {ws.status === "ready" && ws.win && (
          <div className="flex items-center gap-4">
            <span className="font-mono text-3xl font-semibold tabular-nums">
              {ws.win.probability}
              <span className="text-xs text-ink-faint align-super">%</span>
            </span>
            <Stamp large className={DECISION_STYLE[ws.win.decision] ?? "text-ink"}>
              {ws.win.decision}
            </Stamp>
          </div>
        )}
      </div>

      {/* Processing state */}
      {ws.status === "processing" && (
        <div className="py-20 text-center">
          <div className="mx-auto w-64 h-2 processing-bar opacity-60 mb-6" />
          <p className="font-display text-lg font-medium">{ws.step ?? "Processing…"}</p>
          <p className="font-mono text-[0.65rem] tracking-[0.18em] uppercase text-ink-faint mt-2">
            ingest → extract → match → score → draft
          </p>
        </div>
      )}

      {/* Error state */}
      {ws.status === "error" && (
        <div className="py-16 text-center max-w-xl mx-auto">
          <Stamp large className="text-oxide mb-6">
            Processing failed
          </Stamp>
          <p className="text-sm text-ink-soft mt-4">{ws.error}</p>
          <Link
            href="/"
            className="inline-block mt-6 font-mono text-xs uppercase tracking-[0.15em] underline text-link"
          >
            Back to registry
          </Link>
        </div>
      )}

      {/* Ready: tabs */}
      {ws.status === "ready" && (
        <>
          <nav className="flex gap-1 border-b border-line mt-1 mb-8 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 font-mono text-[0.68rem] tracking-[0.16em] uppercase whitespace-nowrap transition-colors cursor-pointer ${
                  tab === t ? "tab-active text-ink font-semibold" : "text-ink-faint hover:text-ink"
                }`}
              >
                {t}
                {t === "Compliance" && ws.compliance && (
                  <span className="ml-2 text-oxide">
                    {ws.compliance.filter((c) => c.status === "gap").length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {tab === "Overview" && <OverviewTab ws={ws} />}
          {tab === "Compliance" && <ComplianceTab ws={ws} />}
          {tab === "Win Analysis" && <WinTab ws={ws} />}
          {tab === "Draft Response" && <DraftTab ws={ws} onChanged={refresh} />}
        </>
      )}
    </div>
  );
}
