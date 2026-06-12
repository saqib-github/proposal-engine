import { NextRequest, NextResponse } from "next/server";
import { deleteWorkspace, getWorkspace } from "@/lib/engine/store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = await getWorkspace(id);
  if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(ws);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteWorkspace(id);
  return NextResponse.json({ ok: true });
}
