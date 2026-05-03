import { NextRequest, NextResponse } from "next/server";
import { getProjectSyncState } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const sinceEventId = Number(request.nextUrl.searchParams.get("sinceEventId") ?? "0");
    const snapshotVersion = Number(request.nextUrl.searchParams.get("snapshotVersion") ?? "0");
    const clientId = request.nextUrl.searchParams.get("clientId");
    const sync = await getProjectSyncState({
      sinceEventId: Number.isFinite(sinceEventId) ? sinceEventId : 0,
      snapshotVersion: Number.isFinite(snapshotVersion) ? snapshotVersion : 0,
      clientId,
    });

    return NextResponse.json(sync, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
