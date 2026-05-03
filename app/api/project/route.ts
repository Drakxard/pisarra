import { NextResponse } from "next/server";
import { getOrCreateProject, saveProjectSnapshot } from "@/lib/server/db";
import type { ProjectSnapshot } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getOrCreateProject());
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar el proyecto.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      snapshot?: ProjectSnapshot;
      expectedVersion?: number;
      clientId?: string | null;
    };

    if (!body.snapshot || typeof body.expectedVersion !== "number") {
      return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
    }

    const result = await saveProjectSnapshot({
      snapshot: body.snapshot,
      expectedVersion: body.expectedVersion,
      clientId: body.clientId ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el proyecto.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
