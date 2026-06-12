/**
 * Assembles the structured draft proposal. Section skeletons and the
 * compliance matrix are deterministic; narrative bodies are upgraded by
 * Claude (ai.ts) when an API key is configured, otherwise an evidence-based
 * template fallback keeps the output useful offline.
 */

import type {
  CapabilityRecord,
  ComplianceItem,
  CompanyProfile,
  DraftSection,
  RfpAnalysis,
} from "./types";
import { complianceStats } from "./match";
import { draftNarratives, type NarrativeRequest } from "./ai";

const STATUS_ICON = { pass: "✅ Pass", partial: "⚠️ Partial", gap: "❌ Gap" } as const;

function evidenceBullets(items: ComplianceItem[], max = 4): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of items) {
    for (const ev of item.evidence) {
      if (seen.has(ev.recordId) || ev.score < 0.08) continue;
      seen.add(ev.recordId);
      lines.push(`- **${ev.title}** [${ev.recordId}]: ${ev.snippet}`);
      if (lines.length >= max) return lines.join("\n");
    }
  }
  return lines.join("\n");
}

function templateQuestionResponse(
  brief: string,
  evidence: ComplianceItem[],
  profile: CompanyProfile,
): string {
  const ev = evidenceBullets(evidence, 3);
  return (
    `${profile.name} will address this requirement drawing on directly relevant delivery experience:\n\n` +
    (ev ||
      "- Our team brings transferable capability from adjacent engagements; a tailored approach will be detailed during solution design.") +
    `\n\nOur response approach: we map the stated requirement to a proven delivery pattern, assign accountable owners from our PMO, and verify acceptance criteria with the client at each milestone.\n\n_${brief.slice(0, 160)}_`
  );
}

export async function buildDraft(
  analysis: RfpAnalysis,
  compliance: ComplianceItem[],
  profile: CompanyProfile,
  records: CapabilityRecord[],
): Promise<DraftSection[]> {
  const stats = complianceStats(compliance);
  const sections: DraftSection[] = [];
  let n = 0;
  const nextId = () => `S-${String(++n).padStart(3, "0")}`;

  /* -- 1. Executive summary ---------------------------------------- */
  const execId = nextId();
  sections.push({
    id: execId,
    title: "Executive Summary",
    content:
      `${profile.name} is pleased to submit this proposal for **${analysis.title}**. ` +
      `With ${new Date().getFullYear() - profile.founded}+ years of delivery, ${profile.headcount} professionals and certifications including ${profile.certifications.join(", ")}, we meet ${stats.pass} of ${stats.total} extracted requirements outright, with mitigation plans for the remainder.`,
    status: "draft",
    requirementIds: [],
    evidenceIds: [],
  });

  /* -- 2. Company profile & eligibility ----------------------------- */
  const eligibility = compliance.filter(
    (c) => c.requirement.kind === "mandatory",
  );
  sections.push({
    id: nextId(),
    title: "Company Profile & Eligibility",
    content:
      `**${profile.name}** (${profile.legalStatus}, est. ${profile.founded}) — HQ ${profile.headquartersCity}; offices: ${profile.offices.join(", ")}.\n\n` +
      `- Registrations: ${profile.registrations.join(", ")}\n` +
      `- Certifications: ${profile.certifications.join(", ")}\n` +
      `- Average annual turnover: ≈ USD ${(profile.avgAnnualTurnoverUsd / 1e6).toFixed(1)}M\n` +
      `- Sectors served: ${profile.sectors.join(", ")}\n\n` +
      `Of ${eligibility.length} mandatory eligibility clauses extracted from the RFP, ${eligibility.filter((e) => e.status === "pass").length} are met with documentary evidence (see Compliance Matrix).`,
    status: "draft",
    requirementIds: eligibility.map((e) => e.requirementId),
    evidenceIds: [],
  });

  /* -- 3. Understanding of scope ------------------------------------ */
  const techItems = compliance.filter((c) => c.requirement.kind === "technical");
  const understandingId = nextId();
  sections.push({
    id: understandingId,
    title: "Understanding of Requirements & Proposed Approach",
    content:
      `${analysis.summary}\n\nOur approach addresses the ${techItems.length} technical requirements through proven delivery patterns:\n\n` +
      (evidenceBullets(techItems, 5) || "- Detailed approach to be elaborated."),
    status: "draft",
    requirementIds: techItems.map((t) => t.requirementId),
    evidenceIds: [],
  });

  /* -- 4. Question responses ---------------------------------------- */
  const questionSections: { id: string; brief: string; items: ComplianceItem[] }[] = [];
  for (const q of analysis.questions) {
    const id = nextId();
    // Find compliance items most related to the question (cheap keyword overlap).
    const qTokens = new Set(q.text.toLowerCase().split(/\W+/).filter((t) => t.length > 4));
    const related = compliance
      .map((c) => ({
        c,
        overlap: c.requirement.text
          .toLowerCase()
          .split(/\W+/)
          .filter((t) => qTokens.has(t)).length,
      }))
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3)
      .filter((x) => x.overlap > 0)
      .map((x) => x.c);

    questionSections.push({ id, brief: q.text, items: related });
    sections.push({
      id,
      title: `Response: ${q.text.slice(0, 90)}${q.text.length > 90 ? "…" : ""}`,
      content: templateQuestionResponse(q.text, related.length ? related : compliance, profile),
      status: "draft",
      requirementIds: related.map((r) => r.requirementId),
      evidenceIds: related.flatMap((r) => r.evidence.slice(0, 2).map((e) => e.recordId)),
    });
  }

  /* -- 5. Relevant experience ---------------------------------------- */
  const sectorRecords = records
    .filter((r) => r.sector === analysis.sector)
    .sort((a, b) => b.yearCompleted - a.yearCompleted)
    .slice(0, 6);
  const expRecords = sectorRecords.length >= 3 ? sectorRecords : records.slice(0, 6);
  sections.push({
    id: nextId(),
    title: "Relevant Experience & Past Performance",
    content: expRecords
      .map(
        (r) =>
          `**${r.title}** [${r.id}] — ${r.client} (${r.clientType}), ${r.yearCompleted}, USD ${(r.contractValueUsd / 1000).toFixed(0)}k, ${r.durationMonths} months.\n${r.summary} _Outcome: ${r.outcomes}_`,
      )
      .join("\n\n"),
    status: "draft",
    requirementIds: [],
    evidenceIds: expRecords.map((r) => r.id),
  });

  /* -- 6. Compliance matrix ------------------------------------------ */
  sections.push({
    id: nextId(),
    title: "Compliance Matrix",
    content:
      `| # | Requirement | Type | Status | Evidence / Note |\n|---|---|---|---|---|\n` +
      compliance
        .map(
          (c) =>
            `| ${c.requirementId} | ${c.requirement.text.slice(0, 90).replace(/\|/g, "/")}${c.requirement.text.length > 90 ? "…" : ""} | ${c.requirement.kind} | ${STATUS_ICON[c.status]} | ${(c.evidence[0] ? `[${c.evidence[0].recordId}] ` : "") + c.note.slice(0, 80).replace(/\|/g, "/")} |`,
        )
        .join("\n"),
    status: "draft",
    requirementIds: compliance.map((c) => c.requirementId),
    evidenceIds: [],
  });

  /* -- 7. Gap mitigation --------------------------------------------- */
  const gaps = compliance.filter((c) => c.status !== "pass");
  if (gaps.length) {
    sections.push({
      id: nextId(),
      title: "Gap Mitigation Plan",
      content: gaps
        .map(
          (g) =>
            `- **${g.requirementId}** (${g.requirement.category}, ${g.status}): ${g.requirement.text.slice(0, 120)}\n  - _Mitigation_: ${g.note}`,
        )
        .join("\n"),
      status: "draft",
      requirementIds: gaps.map((g) => g.requirementId),
      evidenceIds: [],
    });
  }

  /* -- AI narrative upgrade ------------------------------------------ */
  const narrativeRequests: NarrativeRequest[] = [
    {
      sectionId: execId,
      title: "Executive Summary",
      brief: `Executive summary for our bid. Compliance: ${stats.pass} pass / ${stats.partial} partial / ${stats.gap} gaps of ${stats.total}. Win the evaluator in the first paragraph.`,
      evidence: compliance.slice(0, 4).flatMap((c) => c.evidence.slice(0, 1)),
    },
    {
      sectionId: understandingId,
      title: "Understanding of Requirements & Proposed Approach",
      brief: `Demonstrate understanding of the scope and outline our delivery approach for: ${techItems.slice(0, 8).map((t) => t.requirement.text.slice(0, 80)).join(" | ")}`,
      evidence: techItems.slice(0, 5).flatMap((t) => t.evidence.slice(0, 1)),
    },
    ...questionSections.map((q) => ({
      sectionId: q.id,
      title: sections.find((s) => s.id === q.id)?.title ?? q.id,
      brief: q.brief,
      evidence: q.items.flatMap((i) => i.evidence.slice(0, 2)),
    })),
  ];

  const narratives = await draftNarratives(
    { title: analysis.title, sector: analysis.sector, summary: analysis.summary },
    profile,
    narrativeRequests,
  );
  if (narratives) {
    for (const section of sections) {
      if (narratives[section.id]) section.content = narratives[section.id];
    }
  }

  return sections;
}

/** Render the approved/edited draft as a single Markdown document. */
export function renderDraftMarkdown(
  analysis: RfpAnalysis,
  profile: CompanyProfile,
  sections: DraftSection[],
): string {
  return (
    `# Proposal Response — ${analysis.title}\n\n` +
    `_Prepared by ${profile.name} · ${new Date().toISOString().slice(0, 10)}_\n\n---\n\n` +
    sections.map((s) => `## ${s.title}\n\n${s.content}`).join("\n\n---\n\n")
  );
}
