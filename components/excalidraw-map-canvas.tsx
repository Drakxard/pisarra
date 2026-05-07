"use client";

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
  return (
    <div className="excalidraw-host">
      <Excalidraw {...props} />
    </div>
  );
}
