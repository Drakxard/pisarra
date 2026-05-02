"use client";

import type { DetailsTable, PendingImageAsset, ProjectSnapshot } from "@/lib/types";

const DB_NAME = "study-tree-projects";
const DB_VERSION = 3;
const DIRECTORY_HANDLE_DB_NAME = "study-tree-directory-handle";
const DIRECTORY_HANDLE_DB_VERSION = 1;
const HANDLE_STORE_NAME = "handles";
const DIRECTORY_KEY = "active-project-directory";
const PROJECT_FILE_NAME = "study-tree.json";
const ASSETS_DIRECTORY_NAME = "study-assets";

type FileSystemPermissionMode = "read" | "readwrite";
type RawProjectSnapshot = Partial<Omit<ProjectSnapshot, "version">> & {
  version?: number;
};

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

function normalizeDetailsTable(value: unknown): DetailsTable | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const table = value as Partial<DetailsTable>;
  const cells = Array.isArray(table.cells)
    ? table.cells.map((row) =>
        Array.isArray(row) ? row.map((cell) => (typeof cell === "string" ? cell : "")) : [],
      )
    : [];

  if (cells.length === 0) {
    return null;
  }

  const columnCount = Math.max(1, ...cells.map((row) => row.length));
  const normalizedCells = cells.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ""),
  );

  return {
    cells: normalizedCells,
    columnWidths: Array.from({ length: columnCount }, (_, index) => {
      const width = table.columnWidths?.[index];
      return typeof width === "number" && Number.isFinite(width) && width >= 72 ? width : 160;
    }),
    rowHeights: Array.from({ length: normalizedCells.length }, (_, index) => {
      const height = table.rowHeights?.[index];
      return typeof height === "number" && Number.isFinite(height) && height >= 36 ? height : 48;
    }),
    insertedAfterText: table.insertedAfterText !== false,
  };
}

function normalizeProjectSnapshot(snapshot: RawProjectSnapshot): ProjectSnapshot {
  return {
    version: 3,
    cards: Object.fromEntries(
      Object.entries(snapshot.cards ?? {}).map(([cardId, card]) => [
        cardId,
        {
          ...card,
          detailsText: typeof card.detailsText === "string" ? card.detailsText : "",
          detailsTable: normalizeDetailsTable(card.detailsTable),
        },
      ]),
    ),
    selectedCardId: snapshot.selectedCardId ?? null,
    draftText: snapshot.draftText ?? "",
    savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : "",
  };
}

export function buildImageAssetPath(cardId: string, mimeType: string) {
  return `${ASSETS_DIRECTORY_NAME}/${cardId}.${getImageExtension(mimeType)}`;
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

    if (parsed.version !== 2 && parsed.version !== 3) {
      throw new IncompatibleProjectVersionError(
        typeof parsed.version === "number" ? parsed.version : null,
      );
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
  const nextSnapshot: ProjectSnapshot = {
    ...snapshot,
    cards: {},
  };

  const entries = await Promise.all(
    Object.entries(snapshot.cards).map(async ([cardId, card]) => {
      if (!card.image?.path) {
        return [cardId, card] as const;
      }

      const imageFile = await readImageAsset(handle, card.image.path);

      if (!imageFile) {
        return [cardId, card] as const;
      }

      return [
        cardId,
        {
          ...card,
          image: {
            ...card.image,
            previewUrl: URL.createObjectURL(imageFile),
          },
        },
      ] as const;
    }),
  );

  nextSnapshot.cards = Object.fromEntries(entries);
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

export async function recoverStoredDirectoryHandle() {
  if (!supportsProjectDirectory()) {
    return null;
  }

  return getStoredDirectoryHandle();
}

export { ASSETS_DIRECTORY_NAME, PROJECT_FILE_NAME };
