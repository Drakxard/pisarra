import { NextResponse } from "next/server";
import { getCollaborationRoom, saveCollaborationRoomScene } from "@/lib/server/db";
import type { ExcalidrawSceneState } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await context.params;
    const room = await getCollaborationRoom(roomId);

    if (!room) {
      return NextResponse.json({ error: "Sala no encontrada." }, { status: 404 });
    }

    return NextResponse.json(room, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar la sala.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await context.params;
    const body = (await request.json()) as {
      scene?: ExcalidrawSceneState;
    };

    if (!body.scene || !Array.isArray(body.scene.elements) || !body.scene.appState || !body.scene.files) {
      return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
    }

    const room = await saveCollaborationRoomScene({
      roomId,
      scene: body.scene,
    });

    if (!room) {
      return NextResponse.json({ error: "Sala no encontrada." }, { status: 404 });
    }

    return NextResponse.json({ room });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la sala.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
