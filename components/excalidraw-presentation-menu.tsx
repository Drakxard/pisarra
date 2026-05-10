"use client";

import { MainMenu } from "@excalidraw/excalidraw";

export function ExcalidrawPresentationMenu({
  onStartPresentation,
}: {
  onStartPresentation: () => void;
}) {
  return (
    <MainMenu>
      <MainMenu.Item onSelect={onStartPresentation}>Iniciar presentacion</MainMenu.Item>
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
      <MainMenu.DefaultItems.ToggleTheme />
    </MainMenu>
  );
}
