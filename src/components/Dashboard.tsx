"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DECISION_STYLE, Stamp } from "./ui";

interface WorkspaceSummary {
  id: string;
  name: string;
  fileName: string;
  createdAt: string;
  status: "processing" | "ready" | "error";
  step?: string;
  error?: string;
  sector?: string;
  probability?: number;
  decision?: string;
  requirements?: number;
  gaps?: number;
}

const SAMPLES = [
  { file: "rfp-egov-citizen-portal.pdf", label: "e-Gov Citizen Portal", kind: "RFP · PDF" },
  { file: "rfp-fleet-tracking-system.docx", label: "Fleet Tracking Platform", kind: "RFQ · DOCX" },
  { file: "rfp-warehouse-construction.pdf", label: "Warehouse Construction", kind: "Tender · PDF" },
];

export default function Dashboard() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/workspaces", { cache: "no-store" });
    if (res.ok) setWorkspaces(await res.json());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while anything is processing.
  useEffect(() => {
    if (!workspaces?.some((w) => w.status === "processing")) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [workspaces, refresh]);

  async function uploadFile(file: File) {
    setBusy(`Uploading ${file.name}…`);
    setUploadError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/workspaces", { method: "POST", body: form });
    setBusy(null);
    if (res.ok) {
      const ws = await res.json();
      router.push(`/workspace/${ws.id}`);
    } else {
      const body = await res.json().catch(() => ({}));
      setUploadError(body.error ?? "Upload failed");
    }
  }

  async function openSample(sample: string) {
    setBusy(`Ingesting ${sample}…`);
    setUploadError(null);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sample }),
    });
    setBusy(null);
    if (res.ok) {
      const ws = await res.json();
      router.push(`/workspace/${ws.id}`);
    } else {
      const body = await res.json().catch(() => ({}));
      setUploadError(body.error ?? "Could not open sample");
    }
  }

  return (
    <div>
      {/* Masthead */}
      <section className="mb-10">
        <p className="font-mono text-[0.65rem] tracking-[0.3em] uppercase text-oxide mb-3">
          Intake Desk
        </p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-[1.05] max-w-3xl">
          Every tender, parsed.
          <br />
          <span className="italic font-medium text-ink-soft">
            Every clause, answered.
          </span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Deposit an RFP, RFQ or tender document below. The engine extracts mandatory
          requirements, deadlines and evaluation criteria; checks them against the
          capability library; scores win probability; and drafts a structured response
          for your review.
        </p>
      </section>

      {/* Intake tray */}
      <section
        className={`relative border-2 border-dashed rounded-sm transition-colors ${
          dragOver ? "border-oxide bg-oxide-soft/40" : "border-line-strong bg-paper-2/60"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void uploadFile(file);
        }}
      >
        <div className="px-6 py-8 flex flex-col sm:flex-row sm:items-center gap-6 justify-between">
          <div>
            <p className="font-display text-lg font-semibold">
              Deposit bid document
            </p>
            <p className="font-mono text-[0.68rem] tracking-[0.14em] uppercase text-ink-faint mt-1">
              PDF · DOCX · TXT — max 25 MB
            </p>
            {busy && (
              <p className="mt-3 font-mono text-xs text-ink-soft">
                <span className="inline-block w-24 h-1.5 align-middle mr-2 processing-bar opacity-60" />
                {busy}
              </p>
            )}
            {uploadError && (
              <p className="mt-3 font-mono text-xs text-oxide">✗ {uploadError}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInput.current?.click()}
              className="bg-ink text-paper font-mono text-xs tracking-[0.18em] uppercase px-5 py-3 rounded-sm hover:bg-oxide transition-colors cursor-pointer"
            >
              Select file ↗
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <div className="border-t border-line px-6 py-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.62rem] tracking-[0.2em] uppercase text-ink-faint mr-1">
            Or run a bundled sample:
          </span>
          {SAMPLES.map((s) => (
            <button
              key={s.file}
              onClick={() => void openSample(s.file)}
              disabled={busy !== null}
              className="group border border-line-strong rounded-sm px-3 py-1.5 text-xs hover:border-ink hover:bg-paper transition-colors cursor-pointer disabled:opacity-50"
            >
              <span className="font-medium">{s.label}</span>
              <span className="font-mono text-[0.6rem] text-ink-faint ml-2 group-hover:text-oxide">
                {s.kind}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Registry */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between border-b-2 border-ink pb-2">
          <h2 className="font-display text-xl font-semibold">Bid Registry</h2>
          <span className="font-mono text-[0.65rem] tracking-[0.18em] uppercase text-ink-faint">
            {workspaces ? `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}` : "loading…"}
          </span>
        </div>

        {workspaces && workspaces.length === 0 && (
          <p className="py-10 text-center font-mono text-xs tracking-[0.15em] uppercase text-ink-faint">
            Registry empty — deposit a document or run a sample above.
          </p>
        )}

        <ol>
          {workspaces?.map((w, i) => (
            <li
              key={w.id}
              className="ledger-row border-b border-line"
              style={{ animationDelay: `${Math.min(i * 70, 500)}ms` }}
            >
              <Link
                href={`/workspace/${w.id}`}
                className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_auto_auto_auto] gap-x-5 gap-y-1 items-center px-2 py-4 hover:bg-paper-2/70 transition-colors"
              >
                <span className="font-mono text-[0.65rem] text-ink-faint w-8">
                  {String(workspaces.length - i).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block font-display font-semibold text-[0.95rem] leading-snug truncate">
                    {w.name}
                  </span>
                  <span className="block font-mono text-[0.62rem] tracking-[0.08em] text-ink-faint mt-0.5 truncate">
                    {w.fileName} · {new Date(w.createdAt).toLocaleDateString("en-GB")}
                    {w.sector ? ` · ${w.sector}` : ""}
                    {typeof w.requirements === "number" ? ` · ${w.requirements} reqs` : ""}
                    {typeof w.gaps === "number" ? ` · ${w.gaps} gaps` : ""}
                  </span>
                </span>

                {w.status === "processing" && (
                  <span className="col-span-3 sm:col-span-3 flex items-center gap-3 sm:justify-end">
                    <span className="w-28 h-1.5 processing-bar opacity-50" />
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-soft">
                      {w.step ?? "Processing…"}
                    </span>
                  </span>
                )}
                {w.status === "error" && (
                  <span className="col-span-3 sm:col-span-3 sm:justify-self-end">
                    <Stamp className="text-oxide">Error</Stamp>
                  </span>
                )}
                {w.status === "ready" && (
                  <>
                    <span className="hidden sm:block font-mono text-2xl font-semibold tabular-nums">
                      {w.probability}
                      <span className="text-[0.65rem] text-ink-faint align-super">%</span>
                    </span>
                    <span className="hidden sm:block w-20 h-1.5 bg-paper-3 relative">
                      <span
                        className="absolute inset-y-0 left-0 bg-ink"
                        style={{ width: `${w.probability ?? 0}%` }}
                      />
                    </span>
                    <Stamp className={DECISION_STYLE[w.decision ?? ""] ?? "text-ink"}>
                      {w.decision}
                    </Stamp>
                  </>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
