import { describe, expect, it } from "vitest";
import type { CapabilityRecord, CompanyProfile, ExtractedRequirement } from "./types";
import { buildIndex, checkCompliance, complianceStats, searchCapabilities } from "./match";

const PROFILE: CompanyProfile = {
  name: "Axiom Digital Systems (Pvt) Ltd",
  legalStatus: "Private Limited",
  founded: 2012,
  headcount: 180,
  headquartersCity: "Islamabad",
  offices: ["Islamabad", "Lahore", "Karachi"],
  avgAnnualTurnoverUsd: 1_600_000,
  certifications: ["ISO 9001:2015", "ISO/IEC 27001:2022", "CMMI-DEV Level 3"],
  registrations: ["SECP", "PSEB", "FBR NTN"],
  sectors: ["IT Services", "E-Government", "Fintech"],
  blacklisted: false,
  bankLineOfCreditUsd: 500_000,
};

function cap(partial: Partial<CapabilityRecord> & { id: string }): CapabilityRecord {
  return {
    title: "Generic project",
    sector: "IT Services",
    client: "Client",
    clientType: "Government",
    region: "Punjab",
    yearCompleted: 2024,
    contractValueUsd: 300_000,
    durationMonths: 12,
    summary: "A software project.",
    certifications: [],
    technologies: [],
    outcomes: "Delivered on time.",
    referenceAvailable: true,
    ...partial,
  };
}

const LIBRARY: CapabilityRecord[] = [
  cap({
    id: "CAP-001",
    title: "Provincial Citizen e-Services Portal",
    sector: "E-Government",
    yearCompleted: 2024,
    contractValueUsd: 650_000,
    summary:
      "Designed and operated a bilingual Urdu and English citizen portal offering 35 e-services with national payment gateway integration, WCAG accessibility and 99.9% uptime SLA.",
    technologies: ["Java", "Spring", "React", "PostgreSQL"],
  }),
  cap({
    id: "CAP-002",
    title: "Land Records Digitization & Data Migration",
    sector: "E-Government",
    yearCompleted: 2023,
    contractValueUsd: 420_000,
    summary:
      "Migrated 12 million legacy land records into a new system with automated validation, achieving 99.7% data accuracy during data migration from legacy systems.",
  }),
  cap({
    id: "CAP-003",
    title: "e-Procurement Platform for Provincial Government",
    sector: "E-Government",
    yearCompleted: 2025,
    contractValueUsd: 510_000,
    summary:
      "Built an end-to-end e-procurement portal for government departments with supplier registration, online bidding and evaluation workflows.",
  }),
  cap({
    id: "CAP-004",
    title: "Payment Gateway Integration for Microfinance Bank",
    sector: "Fintech",
    yearCompleted: 2024,
    contractValueUsd: 280_000,
    summary:
      "Integrated card, wallet and bank transfer rails into a unified payment gateway processing 2 million monthly transactions.",
  }),
  cap({
    id: "CAP-005",
    title: "Fleet Tracking Platform for Distribution Company",
    sector: "Logistics",
    yearCompleted: 2023,
    contractValueUsd: 240_000,
    summary:
      "Deployed GPS IoT trackers across 300 vehicles with route optimization, geofencing and fuel monitoring dashboards.",
  }),
];

function req(
  id: string,
  text: string,
  category: ExtractedRequirement["category"],
  kind: ExtractedRequirement["kind"] = "mandatory",
): ExtractedRequirement {
  return { id, text, kind, category };
}

describe("searchCapabilities", () => {
  it("ranks the bilingual portal first for a portal-language query", () => {
    const index = buildIndex(LIBRARY);
    const hits = searchCapabilities(
      index,
      "The portal shall support both Urdu and English languages across citizen-facing interfaces",
      3,
    );
    expect(hits[0]?.recordId).toBe("CAP-001");
    expect(hits[0].score).toBeGreaterThan(0.1);
  });
});

describe("checkCompliance rule checks", () => {
  const requirements: ExtractedRequirement[] = [
    req("R-001", "The bidder must hold a valid ISO/IEC 27001 certification for information security management.", "certification"),
    req("R-002", "A CMMI Level 5 appraisal is mandatory for the prime bidder.", "certification"),
    req("R-003", "The bidder must hold ISO 22301 business continuity certification.", "certification"),
    req("R-004", "The bidder must be registered with the Securities and Exchange Commission of Pakistan (SECP).", "legal"),
    req("R-005", "The bidder must demonstrate an average annual turnover of at least PKR 150 million over the last three financial years.", "financial"),
    req("R-006", "The bidder must have successfully completed at least 3 similar projects each valued at PKR 50 million or above during the last 5 years.", "experience"),
    req("R-007", "The portal shall support both Urdu and English languages across all citizen-facing interfaces.", "technical", "technical"),
    req("R-008", "The contractor shall install industrial HVAC and cold storage refrigeration plants.", "technical", "technical"),
  ];

  const items = checkCompliance(requirements, LIBRARY, PROFILE, "E-Government");
  const byId = Object.fromEntries(items.map((i) => [i.requirementId, i]));

  it("passes held certifications", () => {
    expect(byId["R-001"].status).toBe("pass");
  });

  it("flags CMMI level mismatch as a gap and explains it", () => {
    expect(byId["R-002"].status).toBe("gap");
    expect(byId["R-002"].note).toMatch(/level 3/i);
  });

  it("flags missing ISO 22301 as a gap", () => {
    expect(byId["R-003"].status).toBe("gap");
  });

  it("passes SECP registration", () => {
    expect(byId["R-004"].status).toBe("pass");
  });

  it("passes the turnover threshold (PKR 150M ≈ USD 536k < USD 1.6M)", () => {
    expect(byId["R-005"].status).toBe("pass");
  });

  it("passes the 3-similar-projects clause via sector + value + recency", () => {
    expect(byId["R-006"].status).toBe("pass");
  });

  it("supports technical clauses with retrieval evidence", () => {
    expect(["pass", "partial"]).toContain(byId["R-007"].status);
    expect(byId["R-007"].evidence[0]?.recordId).toBe("CAP-001");
  });

  it("flags out-of-domain clauses as gaps", () => {
    expect(byId["R-008"].status).toBe("gap");
  });

  it("aggregates stats with mandatory gaps surfaced", () => {
    const stats = complianceStats(items);
    expect(stats.total).toBe(8);
    expect(stats.gap).toBeGreaterThanOrEqual(3);
    expect(stats.mandatoryGaps.map((g) => g.requirementId)).toContain("R-002");
    expect(stats.coverage).toBeGreaterThan(0.4);
    expect(stats.coverage).toBeLessThan(0.9);
  });
});
