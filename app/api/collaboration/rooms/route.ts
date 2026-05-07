import { NextRequest, NextResponse } from "next/server";
import { createCollaborationRoom } from "@/lib/server/db";
import type { ExcalidrawSceneState } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      scene?: ExcalidrawSceneState;
      source?: {
        categoryId?: string | null;
        mapId?: string | null;
      };
    };

    if (!body.scene || !Array.isArray(body.scene.elements) || !body.scene.appState || !body.scene.files) {
      return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
    }

    const room = await createCollaborationRoom({
      scene: body.scene,
      source: body.source,
    });
    const url = new URL(`/collab/${room.roomId}`, request.url);

    return NextResponse.json({
      room,
      presence: [],
      url: url.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la sala.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
