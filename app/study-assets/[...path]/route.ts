import { NextRequest, NextResponse } from "next/server";
import { getAsset, readLocalAssetFallback } from "@/lib/server/r2-assets";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await context.params;
  const safeSegments = segments.filter((segment) => segment && segment !== "..");
  const assetPath = `study-assets/${safeSegments.join("/")}`;

  try {
    const asset = await getAsset(assetPath);

    if (asset) {
      return new NextResponse(asset.body, {
        headers: {
          "Content-Type": asset.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  } catch {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Asset no encontrado." }, { status: 404 });
    }
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const localAsset = await readLocalAssetFallback(assetPath);

      return new NextResponse(localAsset.body, {
        headers: {
          "Content-Type": localAsset.contentType,
          "Cache-Control": "public, max-age=60",
        },
      });
    } catch {}
  }

  return NextResponse.json({ error: "Asset no encontrado." }, { status: 404 });
}
