import { NextResponse } from "next/server";
import { upsertCollaborationPresence } from "@/lib/server/db";
import type { CollaborationPresence } from "@/lib/collaboration-types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await context.params;
    const body = (await request.json()) as Partial<CollaborationPresence>;

    if (!body.clientId || !body.name || !body.color) {
      return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
    }

    await upsertCollaborationPresence({
      roomId,
      presence: {
        clientId: body.clientId,
        name: body.name,
        color: body.color,
        pointer: body.pointer ?? null,
        button: body.button === "down" ? "down" : "up",
        selectedElementIds: body.selectedElementIds ?? {},
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar presencia.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
