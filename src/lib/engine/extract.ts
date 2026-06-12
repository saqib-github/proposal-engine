/**
 * Heuristic (NER-style) extraction over raw RFP text.
 * Works fully offline; the Claude-powered layer in ai.ts refines these
 * results when an API key is configured. Keeping this deterministic means
 * the whole pipeline still runs without any external service.
 */

import type {
  ExtractedBudget,
  ExtractedDeadline,
  ExtractedEntities,
  ExtractedQuestion,
  ExtractedRequirement,
  ExtractedWeight,
  RequirementCategory,
  RequirementKind,
  RfpAnalysis,
  Sector,
} from "./types";

export const PKR_PER_USD = 280;

/* ------------------------------------------------------------------ */
/* Text normalisation & sectioning                                     */
/* ------------------------------------------------------------------ */

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface Section {
  heading: string;
  body: string;
  index: number;
}

const HEADING_RE = /^(\d+(?:\.\d+)*)[.)]?\s+(.{2,90})$/;

function looksLikeHeading(line: string): boolean {
  const m = line.match(HEADING_RE);
  if (!m) return false;
  const title = m[2];
  // Headings are short and either ALL CAPS or Title Case, and not sentences.
  if (/[.;:]$/.test(title.trim())) return false;
  const upper = title === title.toUpperCase();
  const titleCase = /^[A-Z]/.test(title) && title.split(" ").length <= 12;
  return upper || titleCase;
}

/** Split document text into numbered sections (falls back to one section). */
export function splitSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: "PREAMBLE", body: "", index: 0 };

  for (const line of lines) {
    const trimmed = line.trim();
    if (looksLikeHeading(trimmed)) {
      if (current.body.trim() || sections.length === 0) sections.push(current);
      current = {
        heading: trimmed,
        body: "",
        index: sections.length,
      };
    } else {
      current.body += line + "\n";
    }
  }
  sections.push(current);
  return sections.filter((s) => s.body.trim().length > 0 || s.index === 0);
}

const BULLET_RE = /^([-•*]|\(?[a-z]\)|[ivx]+\.|\d+[.)]|ME-\d+[:.]|Q\.?\s?\d+[.):])\s+/i;
const RUNNING_HEADER_RE = /page\s+\d+\s*$/i;

/**
 * Re-join wrapped lines into logical paragraphs. PDF extraction yields one
 * line per visual row, so prose sentences wrap mid-clause ("PKR 220" /
 * "million…"); bullets, headings and blank lines start fresh units.
 */
export function reflowParagraphs(body: string): string[] {
  const units: string[] = [];
  let current = "";
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || RUNNING_HEADER_RE.test(line)) {
      if (current) units.push(current);
      current = "";
      continue;
    }
    const allCaps =
      line.length >= 8 && /[A-Z]/.test(line) && line === line.toUpperCase() && !/\d{4}/.test(line);
    const labeledField = /^[A-Z][A-Za-z .]{2,30}:\s/.test(line);
    if (BULLET_RE.test(line) || looksLikeHeading(line) || allCaps || labeledField) {
      if (current) units.push(current);
      current = line;
      continue;
    }
    // A unit ending in ":" ("…Evidence:") prefixes the line below it; bullets
    // and headings were already handled above, so this only glues wrapped
    // label/continuation pairs.
    if (current && /:$/.test(current.trimEnd())) {
      current += " " + line;
      continue;
    }
    // Continuation line — append unless the previous unit clearly ended.
    if (current && !/[.;:!?]$/.test(current.trimEnd())) {
      current += " " + line;
    } else {
      if (current) units.push(current);
      current = line;
    }
  }
  if (current) units.push(current);
  return units;
}

/** Split a section body into clause-level units (sentences + bullets). */
export function splitClauses(body: string): string[] {
  const clauses: string[] = [];
  for (const unit of reflowParagraphs(body)) {
    const line = unit.trim();
    if (!line) continue;
    const isBullet = BULLET_RE.test(line);
    if (isBullet) {
      clauses.push(line.replace(BULLET_RE, ""));
    } else {
      // Sentence split guarded against common abbreviations (approx., No., Rs.)
      // so figures like "(approx. USD 790,000)" stay inside their sentence.
      for (const s of line.split(
        /(?<=[.;])(?<!approx\.)(?<!\bNo\.)(?<!etc\.)(?<!\bRs\.)(?<!e\.g\.)(?<!i\.e\.)(?<!vs\.)\s+(?=[A-Z0-9(])/,
      )) {
        if (s.trim()) clauses.push(s.trim());
      }
    }
  }
  return clauses;
}

/* ------------------------------------------------------------------ */
/* Requirements                                                        */
/* ------------------------------------------------------------------ */

const MANDATORY_SECTION_RE =
  /eligib|mandatory|qualification|instructions to bidders|compliance/i;
const TECH_SECTION_RE = /scope|technical|functional|requirement|specification/i;

const MODAL_RE =
  /\b(shall|must|is required to|are required to|mandatory|should|will be required)\b/i;

const CATEGORY_RULES: Array<[RequirementCategory, RegExp]> = [
  ["certification", /\biso[\s/]|\bcmmi\b|certif|accredit|appraisal|\bpec\b/i],
  [
    "legal",
    /registration|registered|secp|fbr|ntn|strn|\btax\b|affidavit|blacklist|incorporat|licen[cs]e|stamp duty|power of attorney/i,
  ],
  [
    "financial",
    /turnover|financial standing|bank statement|audited|net worth|line of credit|bid security|earnest money|revenue of/i,
  ],
  [
    "personnel",
    /key personnel|\bcvs?\b|key staff|project manager|solution architect|team lead|resumes?|\bpmp\b|togaf|qualified engineers?/i,
  ],
  [
    "experience",
    /experience|similar projects?|past performance|successfully (completed|delivered)|track record|references?/i,
  ],
  [
    "delivery",
    /timeline|delivery schedule|completion period|milestones?|liquidated damages|penalt|within \d+ (days|weeks|months)/i,
  ],
  [
    "technical",
    /system|platform|portal|integration|hosting|architecture|api|security|uptime|sla|data migration|mobile app|software|hardware|gps|tracking/i,
  ],
];

export function categorizeRequirement(text: string): RequirementCategory {
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  return "general";
}

export function extractRequirements(text: string): ExtractedRequirement[] {
  const sections = splitSections(text);
  const out: ExtractedRequirement[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const inMandatorySection = MANDATORY_SECTION_RE.test(section.heading);
    const inTechSection = TECH_SECTION_RE.test(section.heading);

    for (const clause of splitClauses(section.body)) {
      if (clause.length < 25 || clause.length > 600) continue;
      // Skip non-capability noise: evidence sub-annotations, submission
      // procedure ("proposals must be submitted by..."), and meta clauses
      // ("failure to meet any criterion shall result in rejection").
      if (/^evidence\s*[:–-]/i.test(clause)) continue;
      if (/^(clarification|quotations?|proposals?|bids?|sealed bids?|queries)\b[^.]*\b(submitted|delivered|addressed|received)\b/i.test(clause)) continue;
      if (/failure to (meet|comply|furnish)|must meet all of the following|shall remain valid for|validity of/i.test(clause)) continue;
      if (/joint ventures? (are|is) not permitted/i.test(clause)) continue;
      if (/following definitions shall apply|^this (request for proposals?|rfp|rfq|tender|document)\b/i.test(clause)) continue;
      const hasModal = MODAL_RE.test(clause);
      // In eligibility/mandatory sections every listed clause is a requirement
      // even without a modal verb ("Valid PSEB registration certificate").
      if (!hasModal && !inMandatorySection) continue;
      if (!hasModal && !/[a-z]/.test(clause)) continue;

      const key = clause.toLowerCase().replace(/\W+/g, " ").slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);

      let kind: RequirementKind;
      if (
        inMandatorySection ||
        /\bmust\b|\bmandatory\b|disqualif|non-?negotiable/i.test(clause)
      ) {
        kind = "mandatory";
      } else if (/points?|weight|score|marks?/i.test(clause)) {
        kind = "scored";
      } else if (inTechSection || /\bshall\b/i.test(clause)) {
        kind = "technical";
      } else {
        kind = "informational";
      }

      out.push({
        id: `R-${String(out.length + 1).padStart(3, "0")}`,
        text: clause,
        kind,
        category: categorizeRequirement(clause),
        section: section.heading,
      });
      if (out.length >= 80) return out;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Entities: dates, money, weights, contacts                           */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const DATE_RE = new RegExp(
  String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${Object.keys(MONTHS).join("|")})[,]?\s+(\d{4})\b` +
    "|" +
    String.raw`\b(${Object.keys(MONTHS).join("|")})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b` +
    "|" +
    String.raw`\b(\d{4})-(\d{2})-(\d{2})\b`,
  "gi",
);

// Order matters: more specific labels first, generic "submission" last so
// "clarification questions must be submitted..." doesn't get mislabelled.
const DEADLINE_LABELS: Array<[string, RegExp]> = [
  ["Date of issue", /date of issue|issued on|advertisement date/i],
  ["Pre-bid meeting", /pre-?bid|pre-?proposal (meeting|conference)/i],
  ["Clarification questions", /clarification|queries|questions.*(submitted|sent)/i],
  ["Bid opening", /opening of (bids|proposals)|bid opening/i],
  ["Award notification", /award|notification of award|contract signing/i],
  ["Bid validity", /valid(ity)? (for|of|period)/i],
  ["Proposal submission", /submission|submit|closing|due date|deadline/i],
];

function toIso(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function extractDeadlines(text: string): ExtractedDeadline[] {
  const out: ExtractedDeadline[] = [];
  const seen = new Set<string>();
  const sentences = splitClauses(text);

  for (const sentence of sentences) {
    DATE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DATE_RE.exec(sentence))) {
      let iso: string | undefined;
      if (m[1] && m[2] && m[3]) iso = toIso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
      else if (m[4] && m[5] && m[6]) iso = toIso(+m[6], MONTHS[m[4].toLowerCase()], +m[5]);
      else if (m[7]) iso = toIso(+m[7], +m[8], +m[9]);

      let label = "Date mentioned";
      for (const [name, re] of DEADLINE_LABELS) {
        if (re.test(sentence)) {
          label = name;
          break;
        }
      }
      const key = `${label}|${iso ?? m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label, dateIso: iso, raw: sentence.slice(0, 220) });
    }
  }
  // Surface labelled deadlines first, generic date mentions last.
  return out
    .sort((a, b) => Number(a.label === "Date mentioned") - Number(b.label === "Date mentioned"))
    .slice(0, 12);
}

const MONEY_RE =
  /\b(PKR|Rs\.?|USD|US\$|\$|EUR|GBP)\s?([\d,]+(?:\.\d+)?)\s*(million|billion|mn|bn|m|crore|lakh)?\b/gi;

const MULTIPLIERS: Record<string, number> = {
  million: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9, crore: 1e7, lakh: 1e5,
};

/** Parse every money mention in a piece of text (no keyword filtering). */
export function parseMoneyMentions(text: string): ExtractedBudget[] {
  const out: ExtractedBudget[] = [];
  MONEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY_RE.exec(text))) {
    const currency = m[1].replace(/^Rs\.?$/i, "PKR").replace(/^(US\$|\$)$/, "USD");
    const base = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(base) || base === 0) continue;
    const amount = base * (m[3] ? MULTIPLIERS[m[3].toLowerCase()] ?? 1 : 1);
    const amountUsd =
      currency === "USD" ? amount : currency === "PKR" ? amount / PKR_PER_USD : undefined;
    out.push({
      raw: text.slice(0, 220),
      currency,
      amount,
      amountUsd: amountUsd ? Math.round(amountUsd) : undefined,
    });
  }
  return out;
}

export function extractBudgets(text: string): ExtractedBudget[] {
  const out: ExtractedBudget[] = [];
  const seen = new Set<string>();

  for (const sentence of splitClauses(text)) {
    if (!/budget|ceiling|estimated cost|contract value|financial proposal|approx/i.test(sentence))
      continue;
    for (const mention of parseMoneyMentions(sentence)) {
      const key = `${mention.currency}:${mention.amount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...mention, raw: sentence.slice(0, 220) });
    }
  }
  return out.slice(0, 8);
}

export function extractWeights(text: string): ExtractedWeight[] {
  const out: ExtractedWeight[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.length > 160) continue;

    // "Technical Approach | 25", "Technical Approach – 25 points",
    // "Financial Proposal: 20%", and PDF-table rows where the cell separator
    // survives only as whitespace: "Technical Approach and Methodology 25".
    const m =
      line.match(/^(.{3,70}?)\s*(?:\||[-–—:])\s*(\d{1,2})\s*(?:points?|%|percent|marks?)?\s*$/i) ||
      line.match(/^(.{3,70}?)\s*\(\s*(\d{1,2})\s*(?:points?|%|percent|marks?)\s*\)\s*$/i) ||
      line.match(/^([A-Za-z][A-Za-z&,/()' -]{4,69}?)\s+([1-9]\d?)\s*(?:points?|%|percent|marks?)?\s*$/);
    if (!m) continue;

    const criterion = m[1].replace(/^[\d.)\s]+/, "").trim();
    const weightPct = parseInt(m[2], 10);
    if (!criterion || weightPct < 5 || weightPct > 60) continue;
    if (criterion.split(/\s+/).length < 2) continue; // "Month", "Total" etc.
    if (/\bpage\b|\bsection\b|\bannex(ure)?\b|\bforms?\b|\bdeadline\b|\bpkr\b|\busd\b/i.test(criterion))
      continue;
    // Date rows from key-dates tables ("Public Opening ... 28 July 2026 15").
    if (/january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\b20\d{2}\b/i.test(line))
      continue;

    const key = criterion.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ criterion, weightPct, raw: line });
  }

  const sum = out.reduce((s, w) => s + w.weightPct, 0);
  // A real scoring table sums to ~100; otherwise we likely matched noise.
  if (out.length >= 3 && sum >= 60 && sum <= 140) return out;
  return out.length >= 3 ? out : [];
}

export function extractContacts(text: string): string[] {
  const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  return [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, 5);
}

export function extractBidSecurity(text: string): string | undefined {
  for (const sentence of splitClauses(text)) {
    if (/bid security|earnest money|tender security/i.test(sentence) && /%|percent|pkr|usd|rs/i.test(sentence)) {
      return sentence.slice(0, 220);
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

const QUESTION_SECTION_RE = /questionnaire|questions|q\s?&\s?a|response format|technical response/i;

export function extractQuestions(text: string): ExtractedQuestion[] {
  const out: ExtractedQuestion[] = [];
  const seen = new Set<string>();
  const push = (q: string, section?: string) => {
    const cleaned = q.trim().replace(/\s+/g, " ");
    if (cleaned.length < 20 || cleaned.length > 500) return;
    const key = cleaned.toLowerCase().slice(0, 100);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `Q-${String(out.length + 1).padStart(3, "0")}`, text: cleaned, section });
  };

  for (const section of splitSections(text)) {
    const isQSection = QUESTION_SECTION_RE.test(section.heading);
    // Reflow so a question wrapped across visual lines is captured whole.
    for (const rawLine of reflowParagraphs(section.body)) {
      const line = rawLine.trim();
      const qNum = line.match(/^Q\.?\s?(\d{1,2})[.):\s]\s*(.+)$/i);
      if (qNum) {
        push(qNum[2], section.heading);
        continue;
      }
      if (isQSection && /^(describe|explain|provide|detail|outline|how|what|present)\b/i.test(line)) {
        push(line, section.heading);
        continue;
      }
      if (line.endsWith("?") && /^(describe|explain|provide|how|what|which|detail|outline)/i.test(line)) {
        push(line, section.heading);
      }
    }
  }
  return out.slice(0, 15);
}

/* ------------------------------------------------------------------ */
/* Sector classification & title                                       */
/* ------------------------------------------------------------------ */

const SECTOR_LEXICON: Record<Sector, string[]> = {
  "E-Government": ["citizen", "e-services", "government", "portal", "public sector", "ministry", "authority", "e-governance", "civil registration"],
  "IT Services": ["software", "system integration", "erp", "helpdesk", "data center", "network", "cybersecurity", "it services", "application"],
  Fintech: ["payment", "banking", "wallet", "transaction", "fintech", "psp", "settlement"],
  "Health IT": ["hospital", "health", "patient", "telemedicine", "hmis", "clinical"],
  Logistics: ["fleet", "logistics", "warehouse", "tracking", "vehicles", "distribution", "route", "supply chain"],
  Construction: ["construction", "civil works", "cold storage", "hvac", "boq", "bill of quantities", "site engineer", "structural"],
  Education: ["university", "school", "learning", "lms", "education", "campus", "student"],
};

export function classifySector(text: string): Sector | "Unknown" {
  const lower = text.toLowerCase();
  let best: Sector | "Unknown" = "Unknown";
  let bestScore = 0;
  for (const [sector, words] of Object.entries(SECTOR_LEXICON) as [Sector, string[]][]) {
    let score = 0;
    for (const w of words) {
      const count = lower.split(w).length - 1;
      score += count;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sector;
    }
  }
  return bestScore >= 3 ? best : "Unknown";
}

const GENERIC_TITLE_RE =
  /^(request for (proposals?|quotations?)|invitation to (bid|tender)|tender(\s+(notice|document))?|bidding document)\b[:\s]*/i;

export function extractTitle(text: string, fileName: string): string {
  // Reflow so a cover title wrapped over two visual lines comes back whole.
  const lines = reflowParagraphs(text.split("\n").slice(0, 40).join("\n"))
    .map((l) => l.trim())
    // Running headers ("REF-014 | Authority — Page 3") and reference lines are
    // never the document title.
    .filter((l) => l && !RUNNING_HEADER_RE.test(l) && !/^reference no/i.test(l))
    .slice(0, 20);
  const idx = lines.findIndex(
    (l) =>
      /request for (proposal|quotation)s?|invitation to (bid|tender)|^tender\b|\brfp\b|\brfq\b/i.test(l) &&
      l.length >= 6 &&
      l.length < 160,
  );
  if (idx >= 0) {
    let hit = lines[idx].replace(/^[#\d.\s]+/, "");
    // Reflow can merge "REQUEST FOR PROPOSALS" with the real title below it —
    // strip the generic prefix when more text follows.
    if (GENERIC_TITLE_RE.test(hit) && hit.replace(GENERIC_TITLE_RE, "").trim().length >= 15) {
      hit = hit.replace(GENERIC_TITLE_RE, "").trim();
    } else if (new RegExp(GENERIC_TITLE_RE.source + "$", "i").test(hit.trim())) {
      const next = lines
        .slice(idx + 1)
        .find((l) => l.length >= 20 && l.length < 170 && !/^(reference|ref\.|issued|date)/i.test(l));
      if (next) return next.slice(0, 170);
    }
    return hit.slice(0, 170);
  }
  if (lines[0] && lines[0].length < 160) return lines[0];
  return fileName.replace(/\.(pdf|docx|txt)$/i, "");
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                        */
/* ------------------------------------------------------------------ */

export function heuristicAnalyze(rawText: string, fileName: string): RfpAnalysis {
  const text = normalizeText(rawText);
  const entities: ExtractedEntities = {
    deadlines: extractDeadlines(text),
    budget: extractBudgets(text),
    evaluationWeights: extractWeights(text),
    bidSecurity: extractBidSecurity(text),
    contacts: extractContacts(text),
  };

  // Prefer the introduction/background prose over cover-page boilerplate.
  const sections = splitSections(text);
  const intro =
    sections.find(
      (s) =>
        /introduction|background|purpose|invitation|about this/i.test(s.heading) &&
        s.body.trim().length > 120,
    ) ??
    sections.find((s, i) => i > 0 && s.body.trim().length > 120) ??
    sections.find((s) => s.body.trim().length > 120);
  const summary = reflowParagraphs(intro?.body ?? text)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 420);

  return {
    title: extractTitle(text, fileName),
    sector: classifySector(text),
    summary,
    requirements: extractRequirements(text),
    entities,
    questions: extractQuestions(text),
    aiMode: "heuristic",
  };
}
