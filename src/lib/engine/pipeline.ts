/**
 * The end-to-end pipeline for one RFP workspace:
 *   ingest → extract (heuristic NER) → refine (Claude, optional) →
 *   compliance matching (RAG) → win scoring → draft generation.
 *
 * Progress is persisted after every stage so the UI can poll and show
 * the workspace coming alive step by step.
 */

import type { Workspace } from "./types";
import { heuristicAnalyze } from "./extract";
import { refineAnalysis, aiAvailable } from "./ai";
import { checkCompliance } from "./match";
import { assessWin } from "./score";
import { buildDraft } from "./draft";
import { extractDocumentText } from "./ingest";
import {
  getWorkspace,
  loadLibrary,
  newWorkspaceId,
  saveWorkspace,
  saveWorkspaceFile,
} from "./store";

export async function createWorkspace(
  fileName: string,
  buffer: Buffer,
): Promise<Workspace> {
  const ws: Workspace = {
    id: newWorkspaceId(),
    name: fileName.replace(/\.(pdf|docx|txt|md)$/i, ""),
    fileName,
    createdAt: new Date().toISOString(),
    status: "processing",
    step: "Uploaded — queued for analysis",
  };
  await saveWorkspaceFile(ws.id, fileName, buffer);
  await saveWorkspace(ws);

  // Fire and forget — the route returns immediately, UI polls status.
  void runPipeline(ws.id, fileName, buffer).catch(async (error) => {
    const current = (await getWorkspace(ws.id)) ?? ws;
    current.status = "error";
    current.error = error instanceof Error ? error.message : String(error);
    await saveWorkspace(current);
  });

  return ws;
}

async function step(ws: Workspace, text: string): Promise<void> {
  ws.step = text;
  await saveWorkspace(ws);
}

export async function runPipeline(
  id: string,
  fileName: string,
  buffer: Buffer,
): Promise<void> {
  const ws = await getWorkspace(id);
  if (!ws) throw new Error(`Workspace ${id} not found`);
  const library = await loadLibrary();

  await step(ws, "Extracting text from document…");
  const rawText = await extractDocumentText(buffer, fileName);
  if (rawText.trim().length < 200) {
    throw new Error(
      "Could not extract meaningful text from the document (is it scanned/image-only?).",
    );
  }
  await saveWorkspaceFile(id, "extracted.txt", rawText);

  await step(ws, "Extracting requirements, deadlines & budgets (NER)…");
  const heuristic = heuristicAnalyze(rawText, fileName);

  await step(
    ws,
    aiAvailable()
      ? "Refining analysis with Claude…"
      : "Claude API key not set — using heuristic analysis…",
  );
  ws.analysis = await refineAnalysis(rawText, heuristic);
  ws.name = ws.analysis.title.slice(0, 120) || ws.name;
  await saveWorkspace(ws);

  await step(ws, "Matching requirements against capability library…");
  ws.compliance = checkCompliance(
    ws.analysis.requirements,
    library.capabilities,
    library.profile,
    ws.analysis.sector,
  );
  await saveWorkspace(ws);

  await step(ws, "Scoring win probability & GO/NO-GO…");
  ws.win = assessWin({
    analysis: ws.analysis,
    compliance: ws.compliance,
    history: library.bidHistory,
    profile: library.profile,
  });
  await saveWorkspace(ws);

  await step(ws, "Drafting proposal response sections…");
  ws.draft = await buildDraft(
    ws.analysis,
    ws.compliance,
    library.profile,
    library.capabilities,
  );

  ws.status = "ready";
  ws.step = undefined;
  await saveWorkspace(ws);
}
