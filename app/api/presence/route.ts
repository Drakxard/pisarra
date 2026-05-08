import { NextResponse } from "next/server";
import { listPresence, upsertPresence } from "@/lib/server/db";
import type { PresenceState } from "@/lib/realtime-types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ presence: await listPresence() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar presencia.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<PresenceState>;

    if (!body.clientId || !body.name || !body.color) {
      return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
    }

    await upsertPresence({
      clientId: body.clientId,
      name: body.name,
      color: body.color,
      cursor: body.cursor ?? null,
      surface: body.surface === "card-modal" ? "card-modal" : "map",
      activeCategoryId: body.activeCategoryId ?? null,
      activeMapId: body.activeMapId ?? null,
      selectedNodeId: body.selectedNodeId ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar presencia.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
