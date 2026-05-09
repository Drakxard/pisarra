import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawProps as BaseExcalidrawProps,
} from "@/vendor-excalidraw/dist/types/excalidraw/types";
import type { FileSystemHandle } from "@/vendor-excalidraw/dist/types/excalidraw/data/filesystem";
import type React from "react";
import {
  Excalidraw as RuntimeExcalidraw,
  convertToExcalidrawElements as runtimeConvertToExcalidrawElements,
} from "@/vendor-excalidraw/dist/dev/index";

export const Excalidraw = RuntimeExcalidraw as React.MemoExoticComponent<
  (props: ExcalidrawProps) => import("react/jsx-runtime").JSX.Element
>;
export const convertToExcalidrawElements = runtimeConvertToExcalidrawElements;

export type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  FileSystemHandle,
};

export type ExcalidrawDropFilePayload = {
  file: File | null;
  fileHandle: FileSystemHandle | null;
  sceneX: number;
  sceneY: number;
  nativeEvent: DragEvent;
};

export type ExcalidrawDropFileHandler = (
  payload: ExcalidrawDropFilePayload,
) => Promise<boolean | void> | boolean | void;

export type ExcalidrawProps = BaseExcalidrawProps & {
  onDropFile?: ExcalidrawDropFileHandler;
};
