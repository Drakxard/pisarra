"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
  },
);

export function ExcalidrawMapCanvas(props: ExcalidrawProps) {
  useEffect(() => {
    (window as Window & { EXCALIDRAW_ASSET_PATH?: string | string[] }).EXCALIDRAW_ASSET_PATH =
      "/excalidraw/";
  }, []);

  return (
    <div className="excalidraw-host">
      <Excalidraw {...props} />
    </div>
  );
}
