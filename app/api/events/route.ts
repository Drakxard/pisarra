import { NextRequest, NextResponse } from "next/server";
import { listProjectEvents } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const since = Number(request.nextUrl.searchParams.get("since") ?? "0");
    const events = await listProjectEvents("default", Number.isFinite(since) ? since : 0);

    return NextResponse.json({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron cargar eventos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
