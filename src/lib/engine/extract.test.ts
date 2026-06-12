import { describe, expect, it } from "vitest";
import {
  classifySector,
  extractBudgets,
  extractDeadlines,
  extractQuestions,
  extractRequirements,
  extractWeights,
  heuristicAnalyze,
  splitSections,
} from "./extract";

const FIXTURE = `
REQUEST FOR PROPOSALS
Design, Development and Operation of the Provincial e-Services Citizen Portal
RFP No. PITA/2026/017

1. INTRODUCTION
The Provincial Information Technology Authority (PITA) invites sealed proposals from
qualified firms for the design, development and operation of a citizen e-services portal.
The total budget ceiling for this assignment is PKR 220 million (approx. USD 790,000).

2. KEY DATES
- Pre-bid meeting shall be held on 30 June 2026 at PITA Secretariat.
- Clarification questions must be submitted no later than 7 July 2026.
- Proposals must be submitted no later than 15:00 PKT on 28 July 2026.
- Bids shall remain valid for 120 days from the submission date.

3. MANDATORY ELIGIBILITY REQUIREMENTS
- The bidder must be registered with the Securities and Exchange Commission of Pakistan (SECP).
- The bidder must hold a valid ISO/IEC 27001 certification for information security management.
- The bidder must demonstrate an average annual turnover of at least PKR 150 million over the last three financial years.
- The bidder must have successfully completed at least 3 similar projects each valued at PKR 50 million or above during the last 5 years.
- A CMMI Level 5 appraisal is mandatory for the prime bidder.
- Bid security of 2% of the total bid value must accompany the proposal.

4. SCOPE OF WORK AND TECHNICAL REQUIREMENTS
4.1 Portal Platform
The portal shall support both Urdu and English languages across all citizen-facing interfaces.
The system shall integrate with the national payment gateway for online fee collection.
The solution shall achieve 99.9% monthly uptime measured at the application tier.
The supplier shall complete data migration from legacy systems within 6 months of contract award.

5. EVALUATION CRITERIA
Proposals will be evaluated against the following weighted criteria:
Technical Approach and Methodology | 25
Relevant Experience | 20
Key Personnel | 15
Project Management | 10
Information Security | 10
Financial Proposal | 20

6. TECHNICAL QUESTIONNAIRE
Bidders must answer the following questions in their technical proposal:
Q1. Describe your proposed solution architecture, including hosting and scalability approach.
Q2. Explain your implementation methodology and quality assurance processes.
Q3. Describe your approach to data migration from legacy systems.

7. CONTACT
All correspondence shall be addressed to procurement@pita.gov.pk.
`;

describe("splitSections", () => {
  it("detects numbered sections", () => {
    const sections = splitSections(FIXTURE);
    const headings = sections.map((s) => s.heading);
    expect(headings.some((h) => /MANDATORY ELIGIBILITY/.test(h))).toBe(true);
    expect(headings.some((h) => /EVALUATION CRITERIA/.test(h))).toBe(true);
  });
});

describe("extractRequirements", () => {
  const reqs = extractRequirements(FIXTURE);

  it("finds mandatory eligibility clauses", () => {
    const mandatory = reqs.filter((r) => r.kind === "mandatory");
    expect(mandatory.length).toBeGreaterThanOrEqual(5);
    expect(mandatory.some((r) => /ISO\/IEC 27001/i.test(r.text))).toBe(true);
    expect(mandatory.some((r) => /CMMI Level 5/i.test(r.text))).toBe(true);
  });

  it("finds technical shall-clauses", () => {
    const technical = reqs.filter((r) => r.kind === "technical");
    expect(technical.some((r) => /Urdu and English/i.test(r.text))).toBe(true);
    expect(technical.some((r) => /99\.9% monthly uptime/i.test(r.text))).toBe(true);
  });

  it("categorises clauses sensibly", () => {
    const iso = reqs.find((r) => /ISO\/IEC 27001/i.test(r.text));
    expect(iso?.category).toBe("certification");
    const turnover = reqs.find((r) => /annual turnover/i.test(r.text));
    expect(turnover?.category).toBe("financial");
    const similar = reqs.find((r) => /similar projects/i.test(r.text));
    expect(similar?.category).toBe("experience");
  });
});

describe("extractDeadlines", () => {
  const deadlines = extractDeadlines(FIXTURE);

  it("parses the submission deadline to ISO", () => {
    const submission = deadlines.find((d) => d.label === "Proposal submission");
    expect(submission?.dateIso).toBe("2026-07-28");
  });

  it("labels the pre-bid meeting", () => {
    const prebid = deadlines.find((d) => d.label === "Pre-bid meeting");
    expect(prebid?.dateIso).toBe("2026-06-30");
  });
});

describe("extractBudgets", () => {
  const budgets = extractBudgets(FIXTURE);

  it("captures the PKR ceiling with USD conversion", () => {
    const pkr = budgets.find((b) => b.currency === "PKR");
    expect(pkr?.amount).toBe(220_000_000);
    expect(pkr?.amountUsd).toBeGreaterThan(700_000);
    expect(pkr?.amountUsd).toBeLessThan(800_000);
  });

  it("captures the explicit USD figure", () => {
    const usd = budgets.find((b) => b.currency === "USD");
    expect(usd?.amount).toBe(790_000);
  });
});

describe("extractWeights", () => {
  const weights = extractWeights(FIXTURE);

  it("reads the full scoring table", () => {
    expect(weights.length).toBe(6);
    const sum = weights.reduce((s, w) => s + w.weightPct, 0);
    expect(sum).toBe(100);
    expect(
      weights.find((w) => /technical approach/i.test(w.criterion))?.weightPct,
    ).toBe(25);
  });
});

describe("extractQuestions", () => {
  it("collects the numbered questionnaire", () => {
    const questions = extractQuestions(FIXTURE);
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions[0].text).toMatch(/solution architecture/i);
  });
});

describe("classifySector / heuristicAnalyze", () => {
  it("classifies the fixture as E-Government", () => {
    expect(classifySector(FIXTURE)).toBe("E-Government");
  });

  it("produces a coherent full analysis", () => {
    const analysis = heuristicAnalyze(FIXTURE, "rfp-egov.txt");
    expect(analysis.title).toMatch(/REQUEST FOR PROPOSALS|Citizen Portal/i);
    expect(analysis.requirements.length).toBeGreaterThanOrEqual(8);
    expect(analysis.entities.bidSecurity).toMatch(/2%/);
    expect(analysis.entities.contacts).toContain("procurement@pita.gov.pk");
    expect(analysis.aiMode).toBe("heuristic");
  });
});
