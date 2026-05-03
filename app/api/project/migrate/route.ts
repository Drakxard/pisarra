import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { migrateProjectIfMissing } from "@/lib/server/db";
import { normalizeProjectSnapshot } from "@/lib/server/project-normalize";

export const runtime = "nodejs";

export async function POST() {
  try {
    const raw = await readFile("study-tree.json", "utf8");
    const snapshot = normalizeProjectSnapshot(JSON.parse(raw));
    const result = await migrateProjectIfMissing(snapshot);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo migrar el proyecto.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
