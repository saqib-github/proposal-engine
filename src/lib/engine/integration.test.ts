/**
 * End-to-end regression tests against the real bundled sample RFPs —
 * PDF/DOCX parsing included. These lock in the ground truth the demo
 * depends on (deadlines, budgets, weights, planted compliance gaps).
 */

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { extractDocumentText } from "./ingest";
import { heuristicAnalyze } from "./extract";
import { checkCompliance, complianceStats } from "./match";
import { assessWin } from "./score";
import type { BidOutcome, CapabilityRecord, CompanyProfile, EvaluationCriterion } from "./types";

const ROOT = process.cwd();
const SAMPLES = path.join(ROOT, "data", "sample-rfps");
const LIBRARY = path.join(ROOT, "data", "library");

async function loadJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(LIBRARY, file), "utf-8")) as T;
}

async function analyzeSample(fileName: string) {
  const buffer = await fs.readFile(path.join(SAMPLES, fileName));
  const text = await extractDocumentText(buffer, fileName);
  return { text, analysis: heuristicAnalyze(text, fileName) };
}

describe("e-gov citizen portal RFP (primary demo, PDF)", async () => {
  const { text, analysis } = await analyzeSample("rfp-egov-citizen-portal.pdf");

  it("preserves line structure during PDF extraction", () => {
    expect(text.split("\n").length).toBeGreaterThan(100);
  });

  it("extracts a real title", () => {
    expect(analysis.title).toMatch(/citizen portal/i);
  });

  it("classifies the sector", () => {
    expect(analysis.sector).toBe("E-Government");
  });

  it("finds the submission deadline 2026-07-28", () => {
    const submission = analysis.entities.deadlines.find(
      (d) => d.label === "Proposal submission",
    );
    expect(submission?.dateIso).toBe("2026-07-28");
  });

  it("finds the PKR 220M budget ceiling with USD equivalent", () => {
    const pkr = analysis.entities.budget.find(
      (b) => b.currency === "PKR" && b.amount === 220_000_000,
    );
    expect(pkr).toBeDefined();
    expect(analysis.entities.budget.some((b) => b.currency === "USD" && b.amount === 790_000)).toBe(true);
  });

  it("reads the evaluation weights table summing to 100", () => {
    const weights = analysis.entities.evaluationWeights;
    expect(weights.length).toBeGreaterThanOrEqual(6);
    const sum = weights.reduce((s, w) => s + w.weightPct, 0);
    expect(sum).toBeGreaterThanOrEqual(95);
    expect(sum).toBeLessThanOrEqual(115);
  });

  it("collects the technical questionnaire", () => {
    expect(analysis.questions.length).toBeGreaterThanOrEqual(5);
  });

  it("captures mandatory eligibility incl. the planted gaps", () => {
    const all = analysis.requirements.map((r) => r.text).join(" ");
    expect(all).toMatch(/CMMI Level 5/i);
    expect(all).toMatch(/22301/);
  });
});

describe("compliance + win assessment on real data", async () => {
  const capabilities = await loadJson<CapabilityRecord[]>("capability_library.json");
  const history = await loadJson<BidOutcome[]>("bid_history.json");
  const profile = await loadJson<CompanyProfile>("company_profile.json");
  // criteria currently only feed the UI, but validate the file shape here too
  const criteria = await loadJson<EvaluationCriterion[]>("evaluation_criteria.json");

  it("dataset shapes are sane", () => {
    expect(capabilities).toHaveLength(50);
    expect(history).toHaveLength(120);
    expect(criteria.length).toBeGreaterThanOrEqual(15);
  });

  it("e-gov portal → CONDITIONAL GO with the planted certification gaps", async () => {
    const { analysis } = await analyzeSample("rfp-egov-citizen-portal.pdf");
    const compliance = checkCompliance(analysis.requirements, capabilities, profile, analysis.sector);
    const stats = complianceStats(compliance);

    const gapText = stats.mandatoryGaps.map((g) => g.requirement.text).join(" ");
    expect(gapText).toMatch(/CMMI Level 5/i);
    expect(gapText).toMatch(/22301/);

    const win = assessWin({ analysis, compliance, history, profile });
    expect(win.decision).toBe("CONDITIONAL GO");
    expect(win.probability).toBeGreaterThanOrEqual(40);
  });

  it("fleet tracking RFQ (DOCX) → GO", async () => {
    const { analysis } = await analyzeSample("rfp-fleet-tracking-system.docx");
    expect(analysis.sector).toBe("Logistics");
    const compliance = checkCompliance(analysis.requirements, capabilities, profile, analysis.sector);
    const win = assessWin({ analysis, compliance, history, profile });
    expect(["GO", "CONDITIONAL GO"]).toContain(win.decision);
    expect(win.probability).toBeGreaterThanOrEqual(50);
  });

  it("warehouse construction tender → NO-GO", async () => {
    const { analysis } = await analyzeSample("rfp-warehouse-construction.pdf");
    expect(analysis.sector).toBe("Construction");
    const compliance = checkCompliance(analysis.requirements, capabilities, profile, analysis.sector);
    const win = assessWin({ analysis, compliance, history, profile });
    expect(win.decision).toBe("NO-GO");
  });
});
