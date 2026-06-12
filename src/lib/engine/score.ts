/**
 * Win-probability heuristics + GO / NO-GO recommendation.
 *
 * Every factor is derived from observable inputs (historical bid outcomes,
 * extracted budget, compliance coverage) and reported individually so a bid
 * manager can challenge any single number — the dashboard shows the factors,
 * not just the headline probability.
 */

import type {
  BidOutcome,
  ComplianceItem,
  CompanyProfile,
  RfpAnalysis,
  WinAssessment,
  WinFactor,
} from "./types";
import { complianceStats } from "./match";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

interface ScoreInput {
  analysis: RfpAnalysis;
  compliance: ComplianceItem[];
  history: BidOutcome[];
  profile: CompanyProfile;
}

function budgetAlignment(input: ScoreInput): WinFactor {
  const { analysis, history } = input;
  const budgets = analysis.entities.budget
    .map((b) => b.amountUsd)
    .filter((v): v is number => typeof v === "number" && v > 1000);
  const rfpBudget = budgets.length ? Math.max(...budgets) : undefined;

  const wonBudgets = history
    .filter((h) => h.result === "won")
    .map((h) => h.budgetUsd)
    .sort((a, b) => a - b);

  if (!rfpBudget || wonBudgets.length < 5) {
    return {
      key: "budgetAlignment",
      label: "Budget alignment",
      score: 50,
      weight: 0.2,
      detail: rfpBudget
        ? "Not enough historical wins to benchmark the budget."
        : "No budget figure could be extracted from the RFP.",
    };
  }

  const p25 = percentile(wonBudgets, 0.25);
  const p75 = percentile(wonBudgets, 0.75);
  let score: number;
  if (rfpBudget >= p25 && rfpBudget <= p75) {
    score = 95;
  } else {
    // Log-distance decay outside the comfortable band.
    const edge = rfpBudget < p25 ? p25 : p75;
    const ratio = rfpBudget < p25 ? edge / rfpBudget : rfpBudget / edge;
    score = clamp(95 - Math.log2(ratio) * 35, 10, 95);
  }
  return {
    key: "budgetAlignment",
    label: "Budget alignment",
    score: Math.round(score),
    weight: 0.2,
    detail: `RFP ≈ USD ${Math.round(rfpBudget / 1000)}k vs winning sweet spot USD ${Math.round(p25 / 1000)}k–${Math.round(p75 / 1000)}k.`,
  };
}

function domainWinRate(input: ScoreInput): WinFactor {
  const { analysis, history } = input;
  const sectorRows = history.filter((h) => h.sector === analysis.sector);
  const overall = history.filter((h) => h.result === "won").length / (history.length || 1);

  let rate: number;
  let detail: string;
  if (sectorRows.length >= 5) {
    rate = sectorRows.filter((h) => h.result === "won").length / sectorRows.length;
    detail = `Won ${sectorRows.filter((h) => h.result === "won").length} of ${sectorRows.length} past ${analysis.sector} bids.`;
  } else if (sectorRows.length > 0) {
    const sectorRate =
      sectorRows.filter((h) => h.result === "won").length / sectorRows.length;
    rate = 0.5 * sectorRate + 0.5 * overall;
    detail = `Thin history in ${analysis.sector} (${sectorRows.length} bids) — blended with overall win rate ${(overall * 100).toFixed(0)}%.`;
  } else {
    rate = overall * 0.6; // unknown domain: discount the overall rate
    detail = `No past bids in ${analysis.sector} — discounted overall win rate applied.`;
  }
  return {
    key: "domainWinRate",
    label: "Past win rate in domain",
    score: Math.round(clamp(rate * 100)),
    weight: 0.25,
    detail,
  };
}

function complianceCoverage(input: ScoreInput): WinFactor {
  const stats = complianceStats(input.compliance);
  let score = stats.coverage * 100;
  score -= stats.mandatoryGaps.length * 15; // each mandatory gap is a disqualification risk
  return {
    key: "complianceCoverage",
    label: "Compliance coverage",
    score: Math.round(clamp(score, 5)),
    weight: 0.3,
    detail: `${stats.pass} pass / ${stats.partial} partial / ${stats.gap} gap across ${stats.total} requirements; ${stats.mandatoryGaps.length} mandatory gap(s).`,
  };
}

function competitivePressure(input: ScoreInput): WinFactor {
  const { analysis, history } = input;
  const rows = history.filter((h) => h.sector === analysis.sector);
  const sample = rows.length >= 5 ? rows : history;
  const avgCompetitors =
    sample.reduce((s, h) => s + h.competitorsCount, 0) / (sample.length || 1);
  const incumbentShare =
    sample.filter((h) => h.incumbentPresent && !h.weWereIncumbent).length /
    (sample.length || 1);

  // 2 competitors ≈ 90, 8+ ≈ 30; an entrenched-incumbent market knocks more off.
  const score = clamp(110 - avgCompetitors * 10 - incumbentShare * 25, 15, 95);
  return {
    key: "competitivePressure",
    label: "Competitive pressure",
    score: Math.round(score),
    weight: 0.1,
    detail: `Avg ${avgCompetitors.toFixed(1)} competitors per comparable bid; incumbent present in ${(incumbentShare * 100).toFixed(0)}% of them.`,
  };
}

function capabilityDepth(input: ScoreInput): WinFactor {
  const { analysis, compliance } = input;
  const withEvidence = compliance.filter((c) => (c.evidence[0]?.score ?? 0) >= 0.1);
  const evidenceShare = withEvidence.length / (compliance.length || 1);
  const avgTop =
    compliance.reduce((s, c) => s + (c.evidence[0]?.score ?? 0), 0) /
    (compliance.length || 1);
  const score = clamp(evidenceShare * 70 + avgTop * 120);
  return {
    key: "capabilityDepth",
    label: "Capability evidence depth",
    score: Math.round(score),
    weight: 0.15,
    detail: `${withEvidence.length} of ${compliance.length} requirements have library evidence (sector: ${analysis.sector}).`,
  };
}

export function assessWin(input: ScoreInput): WinAssessment {
  const factors: WinFactor[] = [
    budgetAlignment(input),
    domainWinRate(input),
    complianceCoverage(input),
    competitivePressure(input),
    capabilityDepth(input),
  ];

  const probability = Math.round(
    factors.reduce((s, f) => s + f.score * f.weight, 0),
  );
  const mandatoryGaps = complianceStats(input.compliance).mandatoryGaps;

  let decision: WinAssessment["decision"];
  if (probability < 40 || mandatoryGaps.length > 2) {
    decision = "NO-GO";
  } else if (mandatoryGaps.length > 0 || probability < 60) {
    decision = "CONDITIONAL GO";
  } else {
    decision = "GO";
  }

  const strongest = [...factors].sort((a, b) => b.score - a.score)[0];
  const weakest = [...factors].sort((a, b) => a.score - b.score)[0];
  const gapNote =
    mandatoryGaps.length > 0
      ? ` Mandatory gaps to resolve before bidding: ${mandatoryGaps
          .map((g) => g.requirementId)
          .join(", ")} — consider a consortium partner, pre-bid clarification, or fast-track certification.`
      : "";

  const rationale =
    `Estimated win probability ${probability}%. Strongest factor: ${strongest.label.toLowerCase()} (${strongest.score}). ` +
    `Weakest factor: ${weakest.label.toLowerCase()} (${weakest.score}).${gapNote}`;

  return { probability, decision, factors, rationale };
}
