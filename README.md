# Proposal Engine — AI-Powered Bid & Proposal Response Engine

**CUST Hackathon · Problem #1** · Procurement, Sourcing & Contract Management · Difficulty: Advanced

An intelligent assistant for bid teams: deposit an RFP/RFQ/Tender (PDF or DOCX) and the engine extracts every requirement, checks it against the company's capability library, flags compliance gaps, scores win probability, recommends **GO / CONDITIONAL GO / NO-GO**, and drafts a structured proposal response you can review, edit, approve and export.

## Quickstart

```bash
npm install
npm run dev          # → http://localhost:3000
```

No configuration required — the bundled sample data and deterministic NER/RAG engine work fully offline. To enable Claude-powered extraction refinement and narrative drafting:

```bash
cp .env.example .env
# put your ANTHROPIC_API_KEY in .env, then restart
```

**Demo in 30 seconds:** open the dashboard → click a bundled sample (e.g. *e-Gov Citizen Portal*) → watch the pipeline run → explore the four tabs → export the draft as `.docx`.

The three bundled samples are designed to exercise the whole decision spectrum:

| Sample | Format | Expected outcome |
|---|---|---|
| e-Gov Citizen Portal RFP | PDF, 12 pages | **CONDITIONAL GO** — planted mandatory gaps (CMMI L5, ISO 22301) are caught |
| Fleet Tracking Platform RFQ | DOCX | **GO** — strong capability match |
| Warehouse Construction Tender | PDF | **NO-GO** — out-of-domain, PEC licence gap, 0/8 historical win rate |

## How it works

```
 upload (PDF/DOCX/TXT)
   │
   ▼
 ingest.ts      pdf.js text items → line-structure reconstruction (PDF), mammoth (DOCX)
   │
   ▼
 extract.ts     heuristic NER: requirements (mandatory/technical/scored), deadlines,
   │            budgets (PKR/USD with conversion), evaluation weights, Q&A sections,
   │            bid security, contacts, sector classification
   ▼
 ai.ts          optional Claude pass (claude-opus-4-8, structured outputs via
   │            output_config json_schema) refines the analysis; deterministic
   │            fallback keeps everything working without a key
   ▼
 match.ts       RAG: TF-IDF retrieval over the 50-record capability library +
   │            deterministic rule checks (certifications, registrations, turnover
   │            thresholds, N-similar-projects clauses) → pass / partial / gap
   ▼
 score.ts       win probability = 5 weighted factors derived from the 120-bid
   │            historical dataset (budget alignment, domain win rate, compliance
   │            coverage, competitive pressure, capability depth) → GO/NO-GO
   ▼
 draft.ts       structured proposal: exec summary, eligibility, approach, one
   │            response section per RFP question (evidence-cited), experience,
   │            compliance matrix, gap mitigation — Claude narratives when available
   ▼
 workspace      per-RFP workspace persisted under data/workspaces/<id>/
                review → edit → approve per section → export .md / .docx
```

## Hackathon deliverables mapping

| Required deliverable | Where |
|---|---|
| Working prototype: sample RFP → structured draft response | Upload or one-click samples on the dashboard |
| Separate workspace per RFP/RFQ/Tender | `data/workspaces/<id>/`, registry on the dashboard |
| Auto-generated compliance checklist with pass/fail vs capability library | **Compliance** tab — pass/partial/gap, evidence, confidence, filters |
| Win-probability dashboard across key criteria | **Win Analysis** tab — dial, factor bars, rationale |
| GO/NO-GO decision | Stamped verdict (GO / CONDITIONAL GO / NO-GO) with reasoning |
| ≥50% manual-effort reduction | Minutes from upload to reviewable draft vs. the 60–80% of time bid managers spend reading/extracting/drafting manually; every extraction is traceable for review rather than re-derived by hand |
| Review / edit / approve UI before export | **Draft Response** tab — per-section editor, approve flow, `.md`/`.docx` export |

### AI components required by the brief

- **LLM** — Claude (`claude-opus-4-8`) for document parsing refinement and narrative generation (`src/lib/engine/ai.ts`), with strict JSON-schema structured outputs
- **RAG** — TF-IDF retrieval over the capability library feeding evidence into compliance checks and drafted sections (`src/lib/engine/match.ts`)
- **NER** — deterministic entity extraction for deadlines, budget figures, evaluation weights, certifications and compliance clauses (`src/lib/engine/extract.ts`)
- **Scoring model** — win-probability heuristics calibrated on the historical bid outcomes dataset (`src/lib/engine/score.ts`)

## Sample datasets (per the brief)

All generated deterministically by `npm run seed` (`scripts/generate-datasets.mjs`, seed 42):

- `data/library/capability_library.json` — 50 past-project records (sector, client type, value, duration, certifications, technologies, measurable outcomes)
- `data/library/bid_history.json` — 120 bids × 18 columns with learnable win/loss patterns (sector win rates, budget sweet spot, competitor & incumbency effects, compliance failures always lose)
- `data/library/evaluation_criteria.json` — 16-entry criteria taxonomy with keywords
- `data/library/company_profile.json` — the bidding firm ("Axiom Digital Systems"), used for firm-level eligibility checks
- `data/sample-rfps/` — 3 authored anonymized RFPs (IT services / logistics / construction) rendered to PDF & DOCX via `scripts/make-rfp-docs.py`

## Testing

```bash
npm test        # 39 tests
```

Unit tests cover extraction, matching and scoring; integration tests run the **real bundled PDFs/DOCX** end-to-end and assert the ground truth: the 28 July 2026 deadline, the PKR 220M/USD 790k budget, the 100-point weight table, the planted CMMI L5 / ISO 22301 gaps, and the GO / CONDITIONAL GO / NO-GO decisions.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · Anthropic SDK · unpdf (pdf.js) · mammoth · docx · vitest. File-backed persistence — no database to set up.

## Limitations & next steps

- Heuristic NER is tuned for structured procurement documents; scanned/image-only PDFs need OCR (out of scope).
- Retrieval is TF-IDF; swapping in embeddings (e.g. Voyage) is a drop-in upgrade behind `searchCapabilities()`.
- Win weights are expert-set; with more outcome data they should be fit by logistic regression on `bid_history.json`.
