"use client";

import { useEffect, useState } from "react";
import type { DraftSection, Workspace } from "@/lib/engine/types";
import { Markdown } from "../ui";

const SECTION_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "AI DRAFT", cls: "text-ink-faint border-line-strong" },
  edited: { label: "EDITED", cls: "text-amber border-amber" },
  approved: { label: "APPROVED", cls: "text-verdant border-verdant" },
};

export default function DraftTab({
  ws,
  onChanged,
}: {
  ws: Workspace;
  onChanged: () => void;
}) {
  const sections = ws.draft ?? [];
  const [activeId, setActiveId] = useState(sections[0]?.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  useEffect(() => {
    setEditing(false);
  }, [activeId]);

  if (!active) {
    return <p className="text-sm text-ink-soft">No draft sections were generated.</p>;
  }

  async function patch(sectionId: string, body: Record<string, string>) {
    setSaving(true);
    await fetch(`/api/workspaces/${ws.id}/sections/${sectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    onChanged();
  }

  const approvedCount = sections.filter((s) => s.status === "approved").length;

  return (
    <div>
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 border border-line bg-paper-2/60 px-4 py-3">
        <p className="font-mono text-[0.68rem] tracking-[0.14em] uppercase">
          <span className="text-verdant font-semibold">{approvedCount}</span>
          <span className="text-ink-faint"> / {sections.length} sections approved</span>
        </p>
        <div className="flex gap-2">
          <a
            href={`/api/workspaces/${ws.id}/export?format=md`}
            className="font-mono text-[0.65rem] tracking-[0.15em] uppercase border border-ink px-4 py-2 rounded-sm hover:bg-ink hover:text-paper transition-colors"
          >
            Export .md ↓
          </a>
          <a
            href={`/api/workspaces/${ws.id}/export?format=docx`}
            className="font-mono text-[0.65rem] tracking-[0.15em] uppercase bg-ink text-paper px-4 py-2 rounded-sm hover:bg-oxide transition-colors"
          >
            Export .docx ↓
          </a>
        </div>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-8 items-start">
        {/* Section rail */}
        <nav className="lg:sticky lg:top-8 border-t-2 border-ink">
          {sections.map((s, i) => {
            const st = SECTION_STATUS[s.status];
            return (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`w-full text-left border-b border-line px-2 py-2.5 transition-colors cursor-pointer ${
                  s.id === active.id ? "bg-paper-2" : "hover:bg-paper-2/50"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.6rem] text-ink-faint">
                    §{String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`font-mono text-[0.52rem] tracking-[0.12em] border px-1 py-px rounded-sm ${st.cls}`}
                  >
                    {st.label}
                  </span>
                </span>
                <span className="block text-[0.8rem] font-medium leading-snug mt-1 line-clamp-2">
                  {s.title}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Editor / preview */}
        <article className="min-w-0">
          <header className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b-2 border-ink mb-4">
            <div>
              <h3 className="font-display text-xl font-semibold leading-tight">
                {active.title}
              </h3>
              <p className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-ink-faint mt-1">
                {active.requirementIds.length > 0 &&
                  `addresses ${active.requirementIds.slice(0, 6).join(", ")}${active.requirementIds.length > 6 ? "…" : ""} · `}
                {active.evidenceIds.length > 0 &&
                  `evidence ${[...new Set(active.evidenceIds)].slice(0, 4).join(", ")} · `}
                status: {active.status}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {!editing && (
                <button
                  onClick={() => {
                    setText(active.content);
                    setEditing(true);
                  }}
                  className="font-mono text-[0.65rem] tracking-[0.15em] uppercase border border-line-strong px-3 py-1.5 rounded-sm hover:border-ink transition-colors cursor-pointer"
                >
                  Edit
                </button>
              )}
              {editing && (
                <>
                  <button
                    onClick={() => setEditing(false)}
                    className="font-mono text-[0.65rem] tracking-[0.15em] uppercase border border-line-strong px-3 py-1.5 rounded-sm hover:border-ink transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={saving}
                    onClick={async () => {
                      await patch(active.id, { content: text });
                      setEditing(false);
                    }}
                    className="font-mono text-[0.65rem] tracking-[0.15em] uppercase bg-ink text-paper px-3 py-1.5 rounded-sm hover:bg-oxide transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </>
              )}
              {!editing && active.status !== "approved" && (
                <button
                  disabled={saving}
                  onClick={() => patch(active.id, { status: "approved" })}
                  className="font-mono text-[0.65rem] tracking-[0.15em] uppercase bg-verdant text-paper px-3 py-1.5 rounded-sm hover:opacity-85 transition-opacity cursor-pointer disabled:opacity-50"
                >
                  Approve ✓
                </button>
              )}
              {!editing && active.status === "approved" && (
                <button
                  disabled={saving}
                  onClick={() => patch(active.id, { status: "edited" })}
                  className="font-mono text-[0.65rem] tracking-[0.15em] uppercase border border-verdant text-verdant px-3 py-1.5 rounded-sm hover:bg-verdant-soft transition-colors cursor-pointer"
                >
                  Unapprove
                </button>
              )}
            </div>
          </header>

          {editing ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="w-full min-h-[420px] bg-paper border border-line-strong rounded-sm p-4 font-mono text-[0.8rem] leading-relaxed focus:outline-none focus:border-ink resize-y"
            />
          ) : (
            <Markdown source={active.content} />
          )}
        </article>
      </div>
    </div>
  );
}
