/**
 * RAG layer: TF-IDF retrieval over the Capability Library plus deterministic
 * rule checks against the company profile for firm-level clauses
 * (certifications, registrations, turnover, project-count thresholds).
 *
 * Retrieval here is intentionally dependency-free so the demo runs anywhere;
 * ai.ts can rerank/augment evidence when a Claude API key is available.
 */

import type {
  CapabilityRecord,
  ComplianceItem,
  ComplianceStatus,
  CompanyProfile,
  EvidenceRef,
  ExtractedRequirement,
  Sector,
} from "./types";
import { parseMoneyMentions } from "./extract";

/* ------------------------------------------------------------------ */
/* Tokenisation + TF-IDF index                                         */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set(
  "a an the and or of to in for with on at by from as is are was were be been this that these those it its their our your we you they shall must should will would may can could have has had not no any all each per under over within".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9./-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

interface IndexedDoc {
  record: CapabilityRecord;
  tf: Map<string, number>;
  norm: number;
}

export interface CapabilityIndex {
  docs: IndexedDoc[];
  idf: Map<string, number>;
}

function recordText(r: CapabilityRecord): string {
  return [
    r.title,
    r.sector,
    r.clientType,
    r.client,
    r.summary,
    r.outcomes,
    r.technologies.join(" "),
    r.certifications.join(" "),
  ].join(" ");
}

export function buildIndex(records: CapabilityRecord[]): CapabilityIndex {
  const df = new Map<string, number>();
  const rawDocs = records.map((record) => {
    const counts = new Map<string, number>();
    for (const tok of tokenize(recordText(record))) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
    for (const tok of counts.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);
    return { record, counts };
  });

  const n = records.length;
  const idf = new Map<string, number>();
  for (const [tok, freq] of df) idf.set(tok, Math.log((n + 1) / (freq + 1)) + 1);

  const docs: IndexedDoc[] = rawDocs.map(({ record, counts }) => {
    const tf = new Map<string, number>();
    let normSq = 0;
    for (const [tok, count] of counts) {
      const w = (1 + Math.log(count)) * (idf.get(tok) ?? 0);
      tf.set(tok, w);
      normSq += w * w;
    }
    return { record, tf, norm: Math.sqrt(normSq) || 1 };
  });

  return { docs, idf };
}

/** Cosine-similarity search; returns top-k evidence refs scored 0–1. */
export function searchCapabilities(
  index: CapabilityIndex,
  query: string,
  k = 3,
): EvidenceRef[] {
  const counts = new Map<string, number>();
  for (const tok of tokenize(query)) counts.set(tok, (counts.get(tok) ?? 0) + 1);

  const qvec = new Map<string, number>();
  let qNormSq = 0;
  for (const [tok, count] of counts) {
    const w = (1 + Math.log(count)) * (index.idf.get(tok) ?? 0);
    if (w > 0) {
      qvec.set(tok, w);
      qNormSq += w * w;
    }
  }
  const qNorm = Math.sqrt(qNormSq) || 1;

  const scored = index.docs.map((doc) => {
    let dot = 0;
    for (const [tok, w] of qvec) {
      const dw = doc.tf.get(tok);
      if (dw) dot += w * dw;
    }
    return { doc, score: dot / (doc.norm * qNorm) };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((s) => s.score > 0.02)
    .map(({ doc, score }) => ({
      recordId: doc.record.id,
      title: doc.record.title,
      score: Math.round(score * 1000) / 1000,
      snippet: doc.record.summary.slice(0, 200),
    }));
}

/* ------------------------------------------------------------------ */
/* Rule checks against the company profile                             */
/* ------------------------------------------------------------------ */

interface RuleResult {
  status: ComplianceStatus;
  confidence: number;
  note: string;
}

function normalizeCertTokens(text: string): string[] {
  const certs: string[] = [];
  const isoMatches = text.matchAll(/iso(?:\/iec)?\s*-?\s*(\d{4,5})/gi);
  for (const m of isoMatches) certs.push(`iso ${m[1]}`);
  const cmmi = text.match(/cmmi(?:-dev)?\s*(?:maturity\s*)?level\s*(\d)/i);
  if (cmmi) certs.push(`cmmi level ${cmmi[1]}`);
  if (/\bpec\b|pakistan engineering council/i.test(text)) certs.push("pec");
  return certs;
}

function checkCertification(text: string, profile: CompanyProfile): RuleResult | null {
  const required = normalizeCertTokens(text);
  if (required.length === 0) return null;
  const held = normalizeCertTokens(
    [...profile.certifications, ...profile.registrations].join(" "),
  );

  const missing = required.filter((c) => !held.includes(c));
  if (missing.length === 0) {
    return {
      status: "pass",
      confidence: 0.95,
      note: `Held certifications cover this clause (${required.join(", ").toUpperCase()}).`,
    };
  }
  const heldCmmi = held.find((h) => h.startsWith("cmmi"));
  const missCmmi = missing.find((m) => m.startsWith("cmmi"));
  const detail =
    missCmmi && heldCmmi
      ? ` Company holds ${heldCmmi.toUpperCase()}, clause demands ${missCmmi.toUpperCase()}.`
      : "";
  return {
    status: "gap",
    confidence: 0.9,
    note: `Missing certification(s): ${missing.join(", ").toUpperCase()}.${detail} Consider partnering or pre-bid clarification.`,
  };
}

function checkLegal(text: string, profile: CompanyProfile): RuleResult | null {
  if (/blacklist/i.test(text)) {
    return profile.blacklisted
      ? { status: "gap", confidence: 0.95, note: "Company is blacklisted — disqualifying." }
      : {
          status: "pass",
          confidence: 0.92,
          note: "Not blacklisted; affidavit can be furnished on stamp paper.",
        };
  }
  const regs = profile.registrations.join(" ").toLowerCase();
  const wanted: string[] = [];
  if (/secp|securities and exchange commission/i.test(text)) wanted.push("secp");
  if (/pseb|software export board/i.test(text)) wanted.push("pseb");
  if (/\bfbr\b|\bntn\b|\bstrn\b|tax registration/i.test(text)) wanted.push("fbr");
  if (wanted.length === 0) return null;
  const missing = wanted.filter((w) => !regs.includes(w));
  return missing.length === 0
    ? {
        status: "pass",
        confidence: 0.95,
        note: `Registered with ${wanted.join(", ").toUpperCase()}; certificates available.`,
      }
    : {
        status: "gap",
        confidence: 0.9,
        note: `Missing registration(s): ${missing.join(", ").toUpperCase()}.`,
      };
}

function checkFinancial(text: string, profile: CompanyProfile): RuleResult | null {
  if (/bid security|earnest money|tender security/i.test(text)) {
    return {
      status: "pass",
      confidence: 0.8,
      note: "Bid security is a submission commitment — bank guarantee/pay order to be arranged before the deadline.",
    };
  }
  if (/turnover|revenue of|financial standing/i.test(text)) {
    const amounts = parseMoneyMentions(text)
      .map((b) => b.amountUsd)
      .filter((v): v is number => typeof v === "number");
    if (amounts.length === 0) return null;
    const required = Math.max(...amounts);
    if (profile.avgAnnualTurnoverUsd >= required) {
      return {
        status: "pass",
        confidence: 0.9,
        note: `Average annual turnover ≈ USD ${Math.round(profile.avgAnnualTurnoverUsd / 1000)}k meets the ≈ USD ${Math.round(required / 1000)}k threshold.`,
      };
    }
    return {
      status: "gap",
      confidence: 0.85,
      note: `Required turnover ≈ USD ${Math.round(required / 1000)}k exceeds company average ≈ USD ${Math.round(profile.avgAnnualTurnoverUsd / 1000)}k.`,
    };
  }
  return null;
}

function checkExperience(
  text: string,
  records: CapabilityRecord[],
  sector: Sector | "Unknown",
  index: CapabilityIndex,
): RuleResult | null {
  const countMatch = text.match(/at least (\d+)|minimum of (\d+)|(\d+) similar/i);
  if (!countMatch) return null;
  const needed = parseInt(countMatch[1] ?? countMatch[2] ?? countMatch[3], 10);
  if (!needed || needed > 20) return null;

  const values = parseMoneyMentions(text)
    .map((b) => b.amountUsd)
    .filter((v): v is number => typeof v === "number");
  const minValue = values.length ? Math.min(...values) : 0;

  const yearsMatch = text.match(/last (\d+)\s*(?:financial\s*)?years/i);
  const sinceYear = yearsMatch
    ? new Date().getFullYear() - parseInt(yearsMatch[1], 10)
    : 0;

  // "Similar" = same sector as the RFP, or strong retrieval relevance.
  const relevantIds = new Set(
    searchCapabilities(index, text, 25)
      .filter((e) => e.score >= 0.08)
      .map((e) => e.recordId),
  );
  const qualifying = records.filter(
    (r) =>
      (r.sector === sector || relevantIds.has(r.id)) &&
      r.contractValueUsd >= minValue &&
      (sinceYear === 0 || r.yearCompleted >= sinceYear),
  );

  if (qualifying.length >= needed) {
    return {
      status: "pass",
      confidence: 0.85,
      note: `${qualifying.length} qualifying projects found (need ${needed}${minValue ? ` ≥ USD ${Math.round(minValue / 1000)}k` : ""}).`,
    };
  }
  if (qualifying.length > 0) {
    return {
      status: "partial",
      confidence: 0.75,
      note: `Only ${qualifying.length} of ${needed} required reference projects qualify — review thresholds or add consortium references.`,
    };
  }
  return {
    status: "gap",
    confidence: 0.8,
    note: `No qualifying reference projects for this clause (need ${needed}).`,
  };
}

const COMMITMENT_RE =
  /within \d+ days of (contract )?award|undertaking|will establish|to be (provided|established|furnished)|commitment/i;

/* ------------------------------------------------------------------ */
/* Compliance assembly                                                 */
/* ------------------------------------------------------------------ */

const PASS_THRESHOLD = 0.22;
const PARTIAL_THRESHOLD = 0.1;

export function checkCompliance(
  requirements: ExtractedRequirement[],
  records: CapabilityRecord[],
  profile: CompanyProfile,
  sector: Sector | "Unknown",
): ComplianceItem[] {
  const index = buildIndex(records);

  return requirements.map((req) => {
    const evidence = searchCapabilities(index, req.text, 3);

    let rule: RuleResult | null = null;
    switch (req.category) {
      case "certification":
        rule = checkCertification(req.text, profile);
        break;
      case "legal":
        rule = checkLegal(req.text, profile);
        break;
      case "financial":
        rule = checkFinancial(req.text, profile);
        break;
      case "experience":
        rule = checkExperience(req.text, records, sector, index);
        break;
    }

    if (rule) {
      return {
        requirementId: req.id,
        requirement: req,
        status: rule.status,
        confidence: rule.confidence,
        evidence,
        note: rule.note,
      };
    }

    // Retrieval-only judgement for capability/technical clauses.
    const best = evidence[0]?.score ?? 0;
    let status: ComplianceStatus;
    let note: string;
    if (best >= PASS_THRESHOLD) {
      status = "pass";
      note = `Strong evidence in capability library (top match: ${evidence[0].title}).`;
    } else if (best >= PARTIAL_THRESHOLD) {
      status = "partial";
      note = `Related but not exact evidence — strengthen the narrative or add a reference (closest: ${evidence[0].title}).`;
    } else if (COMMITMENT_RE.test(req.text)) {
      status = "partial";
      note = "Forward commitment clause — can be covered by an undertaking in the bid letter.";
    } else {
      status = "gap";
      note = "No matching evidence in the capability library — flag for bid/no-bid review.";
    }

    return {
      requirementId: req.id,
      requirement: req,
      status,
      confidence: Math.min(0.9, 0.4 + best),
      evidence,
      note,
    };
  });
}

/** Aggregate compliance counts used by scoring and the UI. */
export function complianceStats(items: ComplianceItem[]) {
  const total = items.length || 1;
  const pass = items.filter((i) => i.status === "pass").length;
  const partial = items.filter((i) => i.status === "partial").length;
  const gap = items.filter((i) => i.status === "gap").length;
  const mandatoryGaps = items.filter(
    (i) => i.status === "gap" && i.requirement.kind === "mandatory",
  );
  return {
    total: items.length,
    pass,
    partial,
    gap,
    coverage: (pass + 0.5 * partial) / total,
    mandatoryGaps,
  };
}
