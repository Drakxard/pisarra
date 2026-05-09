"use client";

import { createEmptyProjectSnapshot, normalizeProjectSnapshot } from "@/lib/project-snapshot";
import type { ExcalidrawSceneState, PendingImageAsset, ProjectSnapshot, QuestionCardImage } from "@/lib/types";

const DB_NAME = "study-tree-projects";
const DB_VERSION = 3;
const DIRECTORY_HANDLE_DB_NAME = "study-tree-directory-handle";
const DIRECTORY_HANDLE_DB_VERSION = 1;
const HANDLE_STORE_NAME = "handles";
const DIRECTORY_KEY = "active-project-directory";
const PROJECT_FILE_NAME = "study-tree.json";
const ASSETS_DIRECTORY_NAME = "study-assets";
const EXCALIDRAW_DIRECTORY_NAME = "study-excalidraw";

type FileSystemPermissionMode = "read" | "readwrite";
type RawProjectSnapshot = Partial<Omit<ProjectSnapshot, "version">> & {
  version?: number;
  categories?: Record<string, unknown>;
  cards?: Record<string, unknown>;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        database.createObjectStore(HANDLE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

function openDirectoryHandleDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_HANDLE_DB_NAME, DIRECTORY_HANDLE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        database.createObjectStore(HANDLE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

function runIndexedDbRequest<T>(
  openDb: () => Promise<IDBDatabase>,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    openDb()
      .then((database) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = operation(store);
        let settled = false;
        let result: T;

        request.onsuccess = () => {
          result = request.result;
        };

        request.onerror = () => {
          if (settled) {
            return;
          }

          settled = true;
          reject(request.error ?? new Error("Fallo una operacion de IndexedDB."));
        };

        transaction.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve(result);
          }

          database.close();
        };

        transaction.onabort = () => {
          if (!settled) {
            settled = true;
            reject(transaction.error ?? new Error("La transaccion fue cancelada."));
          }

          database.close();
        };

        transaction.onerror = () => {
          if (!settled) {
            settled = true;
            reject(transaction.error ?? new Error("No se pudo completar la transaccion."));
          }

          database.close();
        };
      })
      .catch(reject);
  });
}

function runHandleStoreRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return runIndexedDbRequest(openDatabase, HANDLE_STORE_NAME, mode, operation);
}

function runDedicatedHandleStoreRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return runIndexedDbRequest(openDirectoryHandleDatabase, HANDLE_STORE_NAME, mode, operation);
}

function getImageExtension(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/png":
    default:
      return "png";
  }
}

function sanitizeFileName(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return sanitized || "documento.pdf";
}

async function getNestedDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
) {
  let currentHandle = handle;

  for (const segment of segments) {
    currentHandle = await currentHandle.getDirectoryHandle(segment, { create });
  }

  return currentHandle;
}

async function getRelativeFileHandle(
  handle: FileSystemDirectoryHandle,
  relativePath: string,
  create: boolean,
) {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  if (!normalizedPath) {
    throw new Error("La ruta del archivo es invalida.");
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  const fileName = segments.pop();

  if (!fileName) {
    throw new Error("La ruta del archivo es invalida.");
  }

  const parentHandle =
    segments.length > 0 ? await getNestedDirectoryHandle(handle, segments, create) : handle;

  return parentHandle.getFileHandle(fileName, { create });
}

async function writeImageAsset(handle: FileSystemDirectoryHandle, asset: PendingImageAsset) {
  const fileHandle = await getRelativeFileHandle(handle, asset.path, true);
  const writable = await fileHandle.createWritable();

  await writable.write(asset.blob);
  await writable.close();
}

async function writeBlobAsset(handle: FileSystemDirectoryHandle, relativePath: string, blob: Blob) {
  const fileHandle = await getRelativeFileHandle(handle, relativePath, true);
  const writable = await fileHandle.createWritable();

  await writable.write(blob);
  await writable.close();
}

async function readImageAsset(handle: FileSystemDirectoryHandle, relativePath: string) {
  try {
    const fileHandle = await getRelativeFileHandle(handle, relativePath, false);
    const file = await fileHandle.getFile();
    return file;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotFoundError" || error.name === "TypeMismatchError")
    ) {
      return null;
    }

    throw error;
  }
}

function cloneImageWithPreview(image: QuestionCardImage, previewUrl: string) {
  return {
    ...image,
    previewUrl,
    pendingBlob: null,
  };
}

export class IncompatibleProjectVersionError extends Error {
  version: number | null;

  constructor(version: number | null) {
    super(
      version === null
        ? "El archivo del proyecto no tiene una version compatible."
        : `El archivo del proyecto usa una version incompatible (${version}).`,
    );
    this.name = "IncompatibleProjectVersionError";
    this.version = version;
  }
}

export class MissingProjectFileError extends Error {
  constructor() {
    super(`No se encontro ${PROJECT_FILE_NAME}.`);
    this.name = "MissingProjectFileError";
  }
}

export class EmptyProjectFileError extends Error {
  constructor() {
    super(`${PROJECT_FILE_NAME} esta vacio.`);
    this.name = "EmptyProjectFileError";
  }
}

export class InvalidProjectFileError extends Error {
  constructor(cause?: unknown) {
    super(`No se pudo interpretar ${PROJECT_FILE_NAME}.`);
    this.name = "InvalidProjectFileError";

    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function buildNodeImageAssetPath(nodeId: string, mimeType: string) {
  return `${ASSETS_DIRECTORY_NAME}/${nodeId}.${getImageExtension(mimeType)}`;
}

export function buildPdfAssetPath(id: string, fileName?: string) {
  const safeName = sanitizeFileName(fileName ?? "documento.pdf").replace(/\.pdf$/i, "");
  return `${ASSETS_DIRECTORY_NAME}/pdfs/${id}-${safeName}.pdf`;
}

export async function writePdfAsset(handle: FileSystemDirectoryHandle, assetPath: string, file: File) {
  await writeBlobAsset(handle, assetPath, file);
}

export async function readPdfAsset(handle: FileSystemDirectoryHandle, assetPath: string) {
  const fileHandle = await getRelativeFileHandle(handle, assetPath, false);
  return fileHandle.getFile();
}

export function supportsProjectDirectory() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window && "indexedDB" in window;
}

export async function getStoredDirectoryHandle() {
  if (!supportsProjectDirectory()) {
    return null;
  }

  try {
    const handle = await runHandleStoreRequest<FileSystemDirectoryHandle | null>("readonly", (store) =>
      store.get(DIRECTORY_KEY),
    );

    if (handle) {
      return handle;
    }
  } catch {}

  try {
    return await runDedicatedHandleStoreRequest<FileSystemDirectoryHandle | null>("readonly", (store) =>
      store.get(DIRECTORY_KEY),
    );
  } catch {
    return null;
  }
}

export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle) {
  if (!supportsProjectDirectory()) {
    return;
  }

  await Promise.allSettled([
    runHandleStoreRequest<IDBValidKey>("readwrite", (store) => store.put(handle, DIRECTORY_KEY)),
    runDedicatedHandleStoreRequest<IDBValidKey>("readwrite", (store) =>
      store.put(handle, DIRECTORY_KEY),
    ),
  ]);
}

export async function clearStoredDirectoryHandle() {
  if (!supportsProjectDirectory()) {
    return;
  }

  await Promise.allSettled([
    runHandleStoreRequest<undefined>("readwrite", (store) => store.delete(DIRECTORY_KEY)),
    runDedicatedHandleStoreRequest<undefined>("readwrite", (store) => store.delete(DIRECTORY_KEY)),
  ]);
}

export async function queryDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode = "readwrite",
) {
  return handle.queryPermission({ mode });
}

export async function requestDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode = "readwrite",
) {
  return handle.requestPermission({ mode });
}

export async function selectProjectDirectory() {
  const handle = await window.showDirectoryPicker({
    id: DIRECTORY_KEY,
    mode: "readwrite",
  });
  const permission = await requestDirectoryPermission(handle, "readwrite");

  if (permission !== "granted") {
    throw new Error("No se concedio permiso de lectura y escritura sobre la carpeta.");
  }

  await storeDirectoryHandle(handle);
  return handle;
}

export async function readProjectSnapshot(handle: FileSystemDirectoryHandle) {
  try {
    const fileHandle = await handle.getFileHandle(PROJECT_FILE_NAME);
    const file = await fileHandle.getFile();
    const raw = await file.text();

    if (!raw.trim()) {
      throw new EmptyProjectFileError();
    }

    let parsed: RawProjectSnapshot;

    try {
      parsed = JSON.parse(raw) as RawProjectSnapshot;
    } catch (error) {
      throw new InvalidProjectFileError(error);
    }

    const version = typeof parsed.version === "number" ? parsed.version : null;

    if (version !== 7 && version !== 6 && version !== 5 && version !== 4 && version !== 3 && version !== 2) {
      throw new IncompatibleProjectVersionError(version);
    }

    return normalizeProjectSnapshot(parsed);
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotFoundError" || error.name === "TypeMismatchError")
    ) {
      throw new MissingProjectFileError();
    }

    throw error;
  }
}

export async function hydrateProjectSnapshotAssets(
  handle: FileSystemDirectoryHandle,
  snapshot: ProjectSnapshot,
) {
  if (Object.keys(snapshot.categories).length === 0) {
    return createEmptyProjectSnapshot();
  }

  const nextSnapshot: ProjectSnapshot = {
    ...snapshot,
    categories: {},
  };

  const categoryEntries = await Promise.all(
    Object.entries(snapshot.categories).map(async ([categoryId, category]) => {
      const mapEntries = await Promise.all(
        Object.entries(category.maps).map(async ([mapId, map]) => {
          const nodeEntries = await Promise.all(
            Object.entries(map.nodes).map(async ([nodeId, node]) => {
              if (!node.image?.path) {
                return [nodeId, node] as const;
              }

              const imageFile = await readImageAsset(handle, node.image.path);

              if (!imageFile) {
                return [nodeId, node] as const;
              }

              return [nodeId, { ...node, image: cloneImageWithPreview(node.image, URL.createObjectURL(imageFile)) }] as const;
            }),
          );

          return [
            mapId,
            {
              ...map,
              nodes: Object.fromEntries(nodeEntries),
            },
          ] as const;
        }),
      );

      return [
        categoryId,
        {
          ...category,
          maps: Object.fromEntries(mapEntries),
        },
      ] as const;
    }),
  );

  nextSnapshot.categories = Object.fromEntries(categoryEntries);
  return nextSnapshot;
}

export async function writeProjectSnapshot(
  handle: FileSystemDirectoryHandle,
  snapshot: ProjectSnapshot,
  pendingAssets: PendingImageAsset[] = [],
) {
  for (const asset of pendingAssets) {
    await writeImageAsset(handle, asset);
  }

  const fileHandle = await handle.getFileHandle(PROJECT_FILE_NAME, { create: true });
  const writable = await fileHandle.createWritable();

  await writable.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  await writable.close();
}

function buildExcalidrawSceneFilePath(mapId: string) {
  const encodedMapId = Array.from(mapId)
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");

  return `${EXCALIDRAW_DIRECTORY_NAME}/map-${encodedMapId}.excalidraw`;
}

function createEmptyExcalidrawFileScene(): ExcalidrawSceneState {
  return {
    elements: [],
    appState: {
      scrollX: 0,
      scrollY: 0,
      zoom: {
        value: 1,
      },
      viewBackgroundColor: "#ffffff",
      theme: "light",
      gridSize: null,
    },
    files: {},
  };
}

function normalizeExcalidrawFileScene(value: unknown): ExcalidrawSceneState {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const appState =
    source.appState && typeof source.appState === "object"
      ? (source.appState as Partial<ExcalidrawSceneState["appState"]>)
      : {};

  return {
    elements: Array.isArray(source.elements)
      ? (source.elements as ExcalidrawSceneState["elements"])
      : [],
    appState: {
      scrollX: typeof appState.scrollX === "number" ? appState.scrollX : 0,
      scrollY: typeof appState.scrollY === "number" ? appState.scrollY : 0,
      zoom:
        appState.zoom && typeof appState.zoom === "object" && typeof appState.zoom.value === "number"
          ? { value: appState.zoom.value }
          : { value: 1 },
      viewBackgroundColor:
        typeof appState.viewBackgroundColor === "string" ? appState.viewBackgroundColor : "#ffffff",
      theme: appState.theme === "dark" ? "dark" : "light",
      gridSize: appState.gridSize ?? null,
    },
    files:
      source.files && typeof source.files === "object"
        ? (source.files as ExcalidrawSceneState["files"])
        : {},
  };
}

export async function readPureExcalidrawScene(handle: FileSystemDirectoryHandle, mapId: string) {
  const path = buildExcalidrawSceneFilePath(mapId);

  try {
    const fileHandle = await getRelativeFileHandle(handle, path, false);
    const file = await fileHandle.getFile();
    const raw = await file.text();

    if (!raw.trim()) {
      return createEmptyExcalidrawFileScene();
    }

    return normalizeExcalidrawFileScene(JSON.parse(raw));
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotFoundError" || error.name === "TypeMismatchError")
    ) {
      return createEmptyExcalidrawFileScene();
    }

    throw error;
  }
}

export async function writePureExcalidrawScene(
  handle: FileSystemDirectoryHandle,
  mapId: string,
  scene: ExcalidrawSceneState,
) {
  const path = buildExcalidrawSceneFilePath(mapId);
  const fileHandle = await getRelativeFileHandle(handle, path, true);
  const writable = await fileHandle.createWritable();

  await writable.write(
    `${JSON.stringify(
      {
        type: "excalidraw",
        version: 2,
        source: "study-tree",
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
      },
      null,
      2,
    )}\n`,
  );
  await writable.close();
}

export async function recoverStoredDirectoryHandle() {
  if (!supportsProjectDirectory()) {
    return null;
  }

  return getStoredDirectoryHandle();
}

export { ASSETS_DIRECTORY_NAME, EXCALIDRAW_DIRECTORY_NAME, PROJECT_FILE_NAME };
