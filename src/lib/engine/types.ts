/**
 * Core domain types for the Proposal Engine.
 * The sample datasets in /data and every engine stage conform to these shapes.
 */

export type Sector =
  | "IT Services"
  | "E-Government"
  | "Fintech"
  | "Health IT"
  | "Logistics"
  | "Construction"
  | "Education";

export type ClientType =
  | "Government"
  | "Private Enterprise"
  | "NGO"
  | "Donor-Funded";

/** One past project / capability evidence record (Capability Library). */
export interface CapabilityRecord {
  id: string; // CAP-001
  title: string;
  sector: Sector;
  client: string;
  clientType: ClientType;
  region: string;
  yearCompleted: number;
  contractValueUsd: number;
  durationMonths: number;
  /** 2–4 sentence narrative used for retrieval + drafting. */
  summary: string;
  certifications: string[];
  technologies: string[];
  /** Measurable outcome, e.g. "Cut average processing time from 11 days to 36 hours". */
  outcomes: string;
  referenceAvailable: boolean;
}

/** One historical bid outcome row (120 rows × 18 cols per the problem statement). */
export interface BidOutcome {
  bidId: string; // BID-001
  title: string;
  sector: Sector;
  clientType: ClientType;
  region: string;
  year: number;
  budgetUsd: number;
  ourBidUsd: number;
  competitorsCount: number;
  incumbentPresent: boolean;
  weWereIncumbent: boolean;
  teamSizeProposed: number;
  deliveryMonths: number;
  technicalScore: number; // 0–100
  financialScore: number; // 0–100
  experienceScore: number; // 0–100
  compliancePassed: boolean;
  result: "won" | "lost";
}

/** Evaluation criteria taxonomy entry. */
export interface EvaluationCriterion {
  id: string; // EC-01
  criterion: string;
  /** Sectors where this criterion typically appears, or "all". */
  sectors: Sector[] | "all";
  typicalWeightPct: number;
  description: string;
  /** Lowercase keywords/phrases used to recognise the criterion inside RFP text. */
  keywords: string[];
}

/** Firm-level facts used to answer eligibility/compliance clauses. */
export interface CompanyProfile {
  name: string;
  legalStatus: string;
  founded: number;
  headcount: number;
  headquartersCity: string;
  offices: string[];
  avgAnnualTurnoverUsd: number;
  certifications: string[];
  registrations: string[];
  sectors: Sector[];
  blacklisted: boolean;
  bankLineOfCreditUsd: number;
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

export type RequirementKind =
  | "mandatory" // disqualifying if unmet (shall/must/required)
  | "technical" // technical/functional spec clause
  | "scored" // contributes to evaluation scoring
  | "informational";

export type RequirementCategory =
  | "certification"
  | "experience"
  | "personnel"
  | "financial"
  | "legal"
  | "delivery"
  | "technical"
  | "general";

export interface ExtractedRequirement {
  id: string; // R-001
  text: string;
  kind: RequirementKind;
  category: RequirementCategory;
  section?: string;
}

export interface ExtractedDeadline {
  label: string; // "Proposal submission"
  dateIso?: string; // 2026-07-28
  raw: string; // the sentence it came from
}

export interface ExtractedBudget {
  raw: string;
  currency?: string;
  amount?: number;
  amountUsd?: number;
}

export interface ExtractedWeight {
  criterion: string;
  weightPct: number;
  raw: string;
}

export interface ExtractedEntities {
  deadlines: ExtractedDeadline[];
  budget: ExtractedBudget[];
  evaluationWeights: ExtractedWeight[];
  bidSecurity?: string;
  contacts: string[];
}

export interface ExtractedQuestion {
  id: string; // Q-001
  text: string;
  section?: string;
}

/** Full analysis of one ingested RFP document. */
export interface RfpAnalysis {
  title: string;
  sector: Sector | "Unknown";
  summary: string;
  requirements: ExtractedRequirement[];
  entities: ExtractedEntities;
  questions: ExtractedQuestion[];
  /** Which engine produced the analysis. */
  aiMode: "claude" | "heuristic";
}

/* ------------------------------------------------------------------ */
/* Compliance matching                                                 */
/* ------------------------------------------------------------------ */

export type ComplianceStatus = "pass" | "partial" | "gap";

export interface EvidenceRef {
  recordId: string;
  title: string;
  /** Retrieval similarity score 0–1. */
  score: number;
  snippet: string;
}

export interface ComplianceItem {
  requirementId: string;
  requirement: ExtractedRequirement;
  status: ComplianceStatus;
  confidence: number; // 0–1
  evidence: EvidenceRef[];
  note: string;
}

/* ------------------------------------------------------------------ */
/* Win probability                                                     */
/* ------------------------------------------------------------------ */

export interface WinFactor {
  key: string; // "budgetAlignment"
  label: string; // "Budget alignment"
  score: number; // 0–100
  weight: number; // 0–1, weights sum to 1
  detail: string;
}

export interface WinAssessment {
  probability: number; // 0–100
  decision: "GO" | "CONDITIONAL GO" | "NO-GO";
  factors: WinFactor[];
  rationale: string;
}

/* ------------------------------------------------------------------ */
/* Draft proposal                                                      */
/* ------------------------------------------------------------------ */

export type SectionStatus = "draft" | "edited" | "approved";

export interface DraftSection {
  id: string; // S-001
  title: string;
  /** Markdown content. */
  content: string;
  status: SectionStatus;
  requirementIds: string[];
  evidenceIds: string[];
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

export type WorkspaceStatus = "processing" | "ready" | "error";

export interface Workspace {
  id: string;
  name: string;
  fileName: string;
  createdAt: string; // ISO
  status: WorkspaceStatus;
  step?: string; // human-readable current pipeline step
  analysis?: RfpAnalysis;
  compliance?: ComplianceItem[];
  win?: WinAssessment;
  draft?: DraftSection[];
  error?: string;
}
