import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/engine/store";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  const { id, sectionId } = await params;
  const ws = await getWorkspace(id);
  if (!ws?.draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const section = ws.draft.find((s) => s.id === sectionId);
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  const body = (await request.json()) as { content?: string; status?: string };
  if (typeof body.content === "string" && body.content !== section.content) {
    section.content = body.content;
    if (section.status === "draft") section.status = "edited";
  }
  if (body.status && ["draft", "edited", "approved"].includes(body.status)) {
    section.status = body.status as typeof section.status;
  }

  await saveWorkspace(ws);
  return NextResponse.json(section);
}
