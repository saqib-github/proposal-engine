import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createWorkspace } from "@/lib/engine/pipeline";
import { listWorkspaces } from "@/lib/engine/store";

export async function GET() {
  const workspaces = await listWorkspaces();
  // List view only needs the headline fields, not full drafts.
  return NextResponse.json(
    workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      fileName: w.fileName,
      createdAt: w.createdAt,
      status: w.status,
      step: w.step,
      error: w.error,
      sector: w.analysis?.sector,
      probability: w.win?.probability,
      decision: w.win?.decision,
      requirements: w.analysis?.requirements.length,
      gaps: w.compliance?.filter((c) => c.status === "gap").length,
    })),
  );
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  // Demo path: create a workspace from a bundled sample RFP.
  if (contentType.includes("application/json")) {
    const { sample } = (await request.json()) as { sample?: string };
    if (!sample || !/^[\w.-]+\.(pdf|docx|txt)$/i.test(sample)) {
      return NextResponse.json({ error: "Invalid sample name" }, { status: 400 });
    }
    const samplePath = path.join(process.cwd(), "data", "sample-rfps", path.basename(sample));
    try {
      const buffer = await fs.readFile(samplePath);
      const ws = await createWorkspace(sample, buffer);
      return NextResponse.json(ws, { status: 201 });
    } catch {
      return NextResponse.json({ error: `Sample not found: ${sample}` }, { status: 404 });
    }
  }

  // Upload path: multipart form with a "file" field.
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File exceeds 25MB limit" }, { status: 413 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const ws = await createWorkspace(file.name, buffer);
    return NextResponse.json(ws, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
