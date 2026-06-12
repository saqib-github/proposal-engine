/**
 * Claude-powered layer: refines the heuristic extraction and writes proposal
 * narratives. Every function degrades gracefully — if ANTHROPIC_API_KEY is
 * absent or a call fails, callers keep the deterministic heuristic result, so
 * the demo never hard-depends on network access.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CompanyProfile, EvidenceRef, RfpAnalysis } from "./types";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

/* ------------------------------------------------------------------ */
/* Structured extraction refinement                                    */
/* ------------------------------------------------------------------ */

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    sector: {
      type: "string",
      enum: [
        "IT Services", "E-Government", "Fintech", "Health IT",
        "Logistics", "Construction", "Education", "Unknown",
      ],
    },
    summary: { type: "string", description: "3-4 sentence executive summary of the RFP" },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", description: "The requirement clause, verbatim or lightly cleaned" },
          kind: { type: "string", enum: ["mandatory", "technical", "scored", "informational"] },
          category: {
            type: "string",
            enum: ["certification", "experience", "personnel", "financial", "legal", "delivery", "technical", "general"],
          },
          section: { type: "string" },
        },
        required: ["text", "kind", "category"],
      },
    },
    deadlines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          dateIso: { type: "string", description: "YYYY-MM-DD if determinable" },
          raw: { type: "string" },
        },
        required: ["label", "raw"],
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          section: { type: "string" },
        },
        required: ["text"],
      },
    },
  },
  required: ["title", "sector", "summary", "requirements", "deadlines", "questions"],
} as const;

/**
 * Run a Claude pass over the raw RFP text to refine the heuristic analysis.
 * Returns the heuristic analysis untouched when AI is unavailable or fails.
 */
export async function refineAnalysis(
  rawText: string,
  heuristic: RfpAnalysis,
): Promise<RfpAnalysis> {
  if (!aiAvailable()) return heuristic;

  try {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system:
        "You are a senior bid manager's analyst. You extract requirements, deadlines and bidder questions from RFP/RFQ/Tender documents precisely, without inventing anything that is not in the document.",
      messages: [
        {
          role: "user",
          content: `Extract the structured analysis from this RFP document. Include EVERY mandatory eligibility clause and technical "shall" requirement (verbatim where possible), every labelled date, and every question bidders must answer.\n\n<rfp>\n${rawText}\n</rfp>`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
      },
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return heuristic;
    const parsed = JSON.parse(textBlock.text) as {
      title: string;
      sector: RfpAnalysis["sector"];
      summary: string;
      requirements: Array<{
        text: string;
        kind: RfpAnalysis["requirements"][number]["kind"];
        category: RfpAnalysis["requirements"][number]["category"];
        section?: string;
      }>;
      deadlines: Array<{ label: string; dateIso?: string; raw: string }>;
      questions: Array<{ text: string; section?: string }>;
    };

    return {
      title: parsed.title || heuristic.title,
      sector: parsed.sector ?? heuristic.sector,
      summary: parsed.summary || heuristic.summary,
      requirements: parsed.requirements.slice(0, 80).map((r, i) => ({
        id: `R-${String(i + 1).padStart(3, "0")}`,
        text: r.text,
        kind: r.kind,
        category: r.category,
        section: r.section,
      })),
      entities: {
        ...heuristic.entities,
        // Keep heuristic NER results, prefer LLM deadlines when richer.
        deadlines:
          parsed.deadlines.length >= heuristic.entities.deadlines.length
            ? parsed.deadlines.slice(0, 12)
            : heuristic.entities.deadlines,
      },
      questions: parsed.questions.slice(0, 15).map((q, i) => ({
        id: `Q-${String(i + 1).padStart(3, "0")}`,
        text: q.text,
        section: q.section,
      })),
      aiMode: "claude",
    };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`Claude refinement failed (${error.status}): ${error.message}`);
    } else {
      console.error("Claude refinement failed:", error);
    }
    return heuristic;
  }
}

/* ------------------------------------------------------------------ */
/* Narrative drafting                                                  */
/* ------------------------------------------------------------------ */

export interface NarrativeRequest {
  sectionId: string;
  title: string;
  /** What this section must respond to (question text or requirement list). */
  brief: string;
  evidence: EvidenceRef[];
}

const NARRATIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sectionId: { type: "string" },
          content: { type: "string", description: "Markdown narrative for the section" },
        },
        required: ["sectionId", "content"],
      },
    },
  },
  required: ["sections"],
} as const;

/**
 * Draft narrative content for multiple proposal sections in one call.
 * Returns a map of sectionId → markdown, or null when AI is unavailable/fails
 * (callers then keep their template-based fallback content).
 */
export async function draftNarratives(
  rfp: { title: string; sector: string; summary: string },
  profile: CompanyProfile,
  requests: NarrativeRequest[],
): Promise<Record<string, string> | null> {
  if (!aiAvailable() || requests.length === 0) return null;

  const sectionsBrief = requests
    .map(
      (r) =>
        `### Section ${r.sectionId}: ${r.title}\nBrief: ${r.brief}\nEvidence from our past projects:\n${
          r.evidence.length
            ? r.evidence.map((e) => `- [${e.recordId}] ${e.title}: ${e.snippet}`).join("\n")
            : "- (no directly matching evidence — write honestly, lean on transferable capability)"
        }`,
    )
    .join("\n\n");

  try {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system:
        `You are the lead proposal writer at ${profile.name}, a ${profile.headquartersCity}-based firm (founded ${profile.founded}, ${profile.headcount} staff, certifications: ${profile.certifications.join(", ")}). ` +
        "Write winning, specific, evidence-backed proposal narratives. Cite past projects by their [CAP-xxx] id where evidence is given. Never fabricate projects, certifications, or metrics that are not in the provided evidence. Use confident, professional bid language. Output markdown (paragraphs and bullet lists, no top-level heading — the section title is added by the system).",
      messages: [
        {
          role: "user",
          content: `RFP: ${rfp.title} (sector: ${rfp.sector})\nRFP summary: ${rfp.summary}\n\nWrite the narrative for each of these proposal sections (160-320 words each):\n\n${sectionsBrief}`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: NARRATIVE_SCHEMA },
      },
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = JSON.parse(textBlock.text) as {
      sections: Array<{ sectionId: string; content: string }>;
    };
    return Object.fromEntries(parsed.sections.map((s) => [s.sectionId, s.content]));
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`Claude drafting failed (${error.status}): ${error.message}`);
    } else {
      console.error("Claude drafting failed:", error);
    }
    return null;
  }
}
