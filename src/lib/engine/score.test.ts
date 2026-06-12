import { describe, expect, it } from "vitest";
import type {
  BidOutcome,
  ComplianceItem,
  CompanyProfile,
  ExtractedRequirement,
  RfpAnalysis,
} from "./types";
import { assessWin } from "./score";

const PROFILE: CompanyProfile = {
  name: "Axiom Digital Systems (Pvt) Ltd",
  legalStatus: "Private Limited",
  founded: 2012,
  headcount: 180,
  headquartersCity: "Islamabad",
  offices: ["Islamabad"],
  avgAnnualTurnoverUsd: 1_600_000,
  certifications: ["ISO 9001:2015", "ISO/IEC 27001:2022"],
  registrations: ["SECP", "PSEB"],
  sectors: ["IT Services", "E-Government"],
  blacklisted: false,
  bankLineOfCreditUsd: 500_000,
};

/** History: strong in E-Government (8/10 wins, budgets 200k–900k), weak in Construction (0/4). */
function makeHistory(): BidOutcome[] {
  const rows: BidOutcome[] = [];
  const base: Omit<BidOutcome, "bidId" | "sector" | "budgetUsd" | "result"> = {
    title: "Bid",
    clientType: "Government",
    region: "Punjab",
    year: 2024,
    ourBidUsd: 0,
    competitorsCount: 3,
    incumbentPresent: false,
    weWereIncumbent: false,
    teamSizeProposed: 10,
    deliveryMonths: 12,
    technicalScore: 75,
    financialScore: 70,
    experienceScore: 72,
    compliancePassed: true,
  };
  const egovBudgets = [200, 300, 400, 450, 500, 600, 700, 800, 850, 900];
  egovBudgets.forEach((b, i) =>
    rows.push({
      ...base,
      bidId: `BID-${i}`,
      sector: "E-Government",
      budgetUsd: b * 1000,
      ourBidUsd: b * 950,
      result: i < 8 ? "won" : "lost",
    }),
  );
  for (let i = 0; i < 4; i++) {
    rows.push({
      ...base,
      bidId: `BID-C${i}`,
      sector: "Construction",
      budgetUsd: 1_500_000,
      ourBidUsd: 1_400_000,
      competitorsCount: 7,
      incumbentPresent: true,
      result: "lost",
    });
  }
  return rows;
}

function analysis(sector: RfpAnalysis["sector"], budgetUsd?: number): RfpAnalysis {
  return {
    title: "Test RFP",
    sector,
    summary: "",
    requirements: [],
    entities: {
      deadlines: [],
      budget: budgetUsd ? [{ raw: "", currency: "USD", amount: budgetUsd, amountUsd: budgetUsd }] : [],
      evaluationWeights: [],
      contacts: [],
    },
    questions: [],
    aiMode: "heuristic",
  };
}

function item(
  id: string,
  status: ComplianceItem["status"],
  kind: ExtractedRequirement["kind"] = "technical",
  evidenceScore = 0.3,
): ComplianceItem {
  return {
    requirementId: id,
    requirement: { id, text: "req text long enough to matter", kind, category: "technical" },
    status,
    confidence: 0.8,
    evidence:
      evidenceScore > 0
        ? [{ recordId: "CAP-001", title: "Evidence", score: evidenceScore, snippet: "" }]
        : [],
    note: "",
  };
}

describe("assessWin", () => {
  const history = makeHistory();

  it("recommends GO for a well-aligned bid with full coverage", () => {
    const compliance = [
      item("R-001", "pass", "mandatory"),
      item("R-002", "pass"),
      item("R-003", "pass"),
      item("R-004", "partial"),
    ];
    const win = assessWin({
      analysis: analysis("E-Government", 500_000),
      compliance,
      history,
      profile: PROFILE,
    });
    expect(win.decision).toBe("GO");
    expect(win.probability).toBeGreaterThanOrEqual(60);
    expect(win.factors).toHaveLength(5);
    expect(win.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
  });

  it("downgrades to CONDITIONAL GO when mandatory gaps exist", () => {
    const compliance = [
      item("R-001", "gap", "mandatory", 0),
      item("R-002", "pass", "mandatory"),
      item("R-003", "pass"),
      item("R-004", "pass"),
      item("R-005", "pass"),
      item("R-006", "partial"),
    ];
    const win = assessWin({
      analysis: analysis("E-Government", 500_000),
      compliance,
      history,
      profile: PROFILE,
    });
    expect(win.decision).toBe("CONDITIONAL GO");
    expect(win.rationale).toMatch(/R-001/);
  });

  it("recommends NO-GO for out-of-domain bids with poor coverage", () => {
    const compliance = [
      item("R-001", "gap", "mandatory", 0),
      item("R-002", "gap", "mandatory", 0),
      item("R-003", "gap", "mandatory", 0),
      item("R-004", "gap", "technical", 0),
      item("R-005", "partial"),
    ];
    const win = assessWin({
      analysis: analysis("Construction", 1_700_000),
      compliance,
      history,
      profile: PROFILE,
    });
    expect(win.decision).toBe("NO-GO");
    expect(win.probability).toBeLessThan(40);
  });

  it("scores in-band budgets higher than far-out-of-band budgets", () => {
    const compliance = [item("R-001", "pass")];
    const inBand = assessWin({
      analysis: analysis("E-Government", 500_000),
      compliance,
      history,
      profile: PROFILE,
    });
    const outOfBand = assessWin({
      analysis: analysis("E-Government", 8_000_000),
      compliance,
      history,
      profile: PROFILE,
    });
    const f = (w: typeof inBand, key: string) => w.factors.find((x) => x.key === key)!.score;
    expect(f(inBand, "budgetAlignment")).toBeGreaterThan(f(outOfBand, "budgetAlignment"));
    expect(f(outOfBand, "budgetAlignment")).toBeLessThan(60);
  });

  it("stays neutral on budget when the RFP has no figure", () => {
    const win = assessWin({
      analysis: analysis("E-Government"),
      compliance: [item("R-001", "pass")],
      history,
      profile: PROFILE,
    });
    expect(win.factors.find((f) => f.key === "budgetAlignment")!.score).toBe(50);
  });
});
