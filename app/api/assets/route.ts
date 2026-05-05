import { NextResponse } from "next/server";
import { createAssetUploadUrl } from "@/lib/server/r2-assets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      assets?: Array<{
        path?: unknown;
        contentType?: unknown;
      }>;
    };

    if (!Array.isArray(body.assets) || body.assets.length === 0) {
      return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
    }

    const uploads = await Promise.all(
      body.assets.map(async (asset) => {
        if (!asset || typeof asset.path !== "string" || !asset.path) {
          throw new Error("Payload invalido.");
        }

        const contentType =
          typeof asset.contentType === "string" && asset.contentType.trim().length > 0
            ? asset.contentType.trim()
            : undefined;

        return createAssetUploadUrl({
          assetPath: asset.path,
          contentType,
        });
      }),
    ).catch((error: unknown) => {
      if (error instanceof Error && error.message === "Payload invalido.") {
        return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
      }
      throw error;
    });

    if (uploads instanceof NextResponse) {
      return uploads;
    }

    return NextResponse.json({
      uploads: uploads.map((upload) => ({
        path: upload.key,
        contentType: upload.contentType,
        uploadUrl: upload.uploadUrl,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron preparar los assets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
