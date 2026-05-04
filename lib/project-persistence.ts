"use client";

import type {
  DetailsImage,
  DetailsTable,
  DetailsTextBox,
  PendingImageAsset,
  ProjectSnapshot,
  QuestionCard,
  StudyCategory,
  StudySection,
} from "@/lib/types";

const DB_NAME = "study-tree-projects";
const DB_VERSION = 3;
const DIRECTORY_HANDLE_DB_NAME = "study-tree-directory-handle";
const DIRECTORY_HANDLE_DB_VERSION = 1;
const HANDLE_STORE_NAME = "handles";
const DIRECTORY_KEY = "active-project-directory";
const PROJECT_FILE_NAME = "study-tree.json";
const ASSETS_DIRECTORY_NAME = "study-assets";
const FIXED_SECTIONS = [
  ["definitions", "Definiciones"],
  ["theorems", "Teoremas"],
  ["exams", "Parciales"],
] as const;

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
    x: typeof table.x === "number" && Number.isFinite(table.x) ? Math.max(0, Math.round(table.x)) : 24,
    y: typeof table.y === "number" && Number.isFinite(table.y) ? Math.max(0, Math.round(table.y)) : 220,
    insertedAfterText: table.insertedAfterText !== false,
  };
}

function normalizeDetailsImages(value: unknown): DetailsImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((image): DetailsImage | null => {
      if (!image || typeof image !== "object") {
        return null;
      }

      const source = image as Partial<DetailsImage>;

      if (!source.id || !source.path || !source.mimeType || !source.name) {
        return null;
      }

      return {
        id: source.id,
        path: source.path,
        mimeType: source.mimeType,
        name: source.name,
        x: typeof source.x === "number" && Number.isFinite(source.x) ? source.x : 0,
        y: typeof source.y === "number" && Number.isFinite(source.y) ? source.y : 0,
        width:
          typeof source.width === "number" && Number.isFinite(source.width) && source.width > 0
            ? source.width
            : 320,
        height:
          typeof source.height === "number" && Number.isFinite(source.height) && source.height > 0
            ? source.height
            : 220,
        rotation:
          typeof source.rotation === "number" && Number.isFinite(source.rotation)
            ? source.rotation
            : 0,
        previewUrl: source.previewUrl,
        pendingBlob: null,
      };
    })
    .filter((image): image is DetailsImage => Boolean(image));
}

function normalizeDetailsTextBoxes(value: unknown): DetailsTextBox[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((textBox): DetailsTextBox | null => {
      if (!textBox || typeof textBox !== "object") {
        return null;
      }

      const source = textBox as Partial<DetailsTextBox>;

      if (!source.id) {
        return null;
      }

      return {
        id: source.id,
        text: typeof source.text === "string" ? source.text : "",
        x: typeof source.x === "number" && Number.isFinite(source.x) ? source.x : 0,
        y: typeof source.y === "number" && Number.isFinite(source.y) ? source.y : 0,
        width:
          typeof source.width === "number" && Number.isFinite(source.width) && source.width > 0
            ? source.width
            : 260,
        height:
          typeof source.height === "number" && Number.isFinite(source.height) && source.height > 0
            ? source.height
            : 120,
        fontSize:
          source.fontSize === "medium" ||
          source.fontSize === "large" ||
          source.fontSize === "xlarge" ||
          source.fontSize === "huge"
            ? source.fontSize
            : "small",
        color: typeof source.color === "string" && source.color ? source.color : "#111111",
        bold: source.bold === true,
        strike: source.strike === true,
        bulleted: source.bulleted === true,
        align: source.align === "center" || source.align === "right" ? source.align : "left",
        linkUrl: typeof source.linkUrl === "string" && source.linkUrl ? source.linkUrl : null,
      };
    })
    .filter((textBox): textBox is DetailsTextBox => Boolean(textBox));
}

function normalizeCards(value: unknown) {
  const cards = value && typeof value === "object" ? (value as Record<string, QuestionCard>) : {};

  return Object.fromEntries(
    Object.entries(cards).map(([cardId, card]) => [
      cardId,
      {
        ...card,
        detailsText: typeof card.detailsText === "string" ? card.detailsText : "",
        detailsTable: normalizeDetailsTable(card.detailsTable),
        detailsImages: normalizeDetailsImages(card.detailsImages),
        detailsTextBoxes: normalizeDetailsTextBoxes(card.detailsTextBoxes),
      },
    ]),
  );
}

function createEmptySection(id: string, name: string, timestamp: string): StudySection {
  return {
    id,
    name,
    cards: {},
    selectedCardId: null,
    draftText: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeSection(sectionId: string, value: unknown, timestamp: string): StudySection {
  const source = value && typeof value === "object" ? (value as Partial<StudySection>) : {};
  const cards = normalizeCards(source.cards);

  return {
    id: typeof source.id === "string" && source.id ? source.id : sectionId,
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : "Sin nombre",
    cards,
    selectedCardId: source.selectedCardId && cards[source.selectedCardId] ? source.selectedCardId : null,
    draftText: typeof source.draftText === "string" ? source.draftText : "",
    createdAt: typeof source.createdAt === "string" ? source.createdAt : timestamp,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : timestamp,
  };
}

function normalizeSections(value: unknown, timestamp: string) {
  const sourceSections =
    value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};

  for (const [sectionId, sectionName] of FIXED_SECTIONS) {
    if (!sourceSections[sectionId]) {
      sourceSections[sectionId] = createEmptySection(sectionId, sectionName, timestamp);
    }
  }

  return Object.fromEntries(
    Object.entries(sourceSections).map(([sectionId, section]) => [
      sectionId,
      normalizeSection(sectionId, section, timestamp),
    ]),
  );
}

function normalizeProjectSnapshot(snapshot: RawProjectSnapshot): ProjectSnapshot {
  const timestamp = new Date().toISOString();
  const legacyCards = normalizeCards(snapshot.cards);
  const legacyCategoryId = crypto.randomUUID();
  const sourceCategories =
    snapshot.categories && Object.keys(snapshot.categories).length > 0
      ? snapshot.categories
      : {
          [legacyCategoryId]: {
            id: legacyCategoryId,
            name: "Sin nombre",
            cards: legacyCards,
            selectedCardId: snapshot.selectedCardId ?? null,
            draftText: snapshot.draftText ?? "",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
  const categories = Object.fromEntries(
    Object.entries(sourceCategories).map(([categoryId, category]) => {
      const source = category as StudyCategory;
      const cards = normalizeCards(source.cards);
      const sections = normalizeSections(source.sections, timestamp);

      return [
        categoryId,
        {
          id: source.id || categoryId,
          name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : "Sin nombre",
          cards,
          selectedCardId: source.selectedCardId && cards[source.selectedCardId] ? source.selectedCardId : null,
          draftText: typeof source.draftText === "string" ? source.draftText : "",
          sections,
          activeSectionId:
            source.activeSectionId && sections[source.activeSectionId] ? source.activeSectionId : null,
          createdAt: typeof source.createdAt === "string" ? source.createdAt : timestamp,
          updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : timestamp,
        } satisfies StudyCategory,
      ];
    }),
  );

  return {
    version: 6,
    categories,
    activeCategoryId: null,
    activeMapKind: null,
    activeSectionId: null,
    selectedCategoryId:
      snapshot.selectedCategoryId && categories[snapshot.selectedCategoryId]
        ? snapshot.selectedCategoryId
        : Object.keys(categories)[0] ?? null,
    categoryDraftText: typeof snapshot.categoryDraftText === "string" ? snapshot.categoryDraftText : "",
    savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : "",
  };
}

export function buildImageAssetPath(cardId: string, mimeType: string) {
  return `${ASSETS_DIRECTORY_NAME}/${cardId}.${getImageExtension(mimeType)}`;
}

export function buildDetailsImageAssetPath(cardId: string, imageId: string, mimeType: string) {
  return `${ASSETS_DIRECTORY_NAME}/${cardId}-details-${imageId}.${getImageExtension(mimeType)}`;
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

    if (
      parsed.version !== 2 &&
      parsed.version !== 3 &&
      parsed.version !== 4 &&
      parsed.version !== 5 &&
      parsed.version !== 6
    ) {
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
    categories: {},
  };

  const hydrateCard = async (cardId: string, card: QuestionCard) => {
      const mainImageFile = card.image?.path ? await readImageAsset(handle, card.image.path) : null;
      const detailsImages = await Promise.all(
        (card.detailsImages ?? []).map(async (image) => {
          const imageFile = await readImageAsset(handle, image.path);

          if (!imageFile) {
            return image;
          }

          return {
            ...image,
            previewUrl: URL.createObjectURL(imageFile),
          };
        }),
      );

      return {
          ...card,
          detailsImages,
          image:
            card.image && mainImageFile
              ? {
                  ...card.image,
                  previewUrl: URL.createObjectURL(mainImageFile),
                }
              : card.image,
        };
  };

  const categoryEntries = await Promise.all(
    Object.entries(snapshot.categories).map(async ([categoryId, category]) => {
      const cardEntries = await Promise.all(
        Object.entries(category.cards).map(async ([cardId, card]) => [
          cardId,
          await hydrateCard(cardId, card),
        ] as const),
      );
      const sectionEntries = await Promise.all(
        Object.entries(category.sections).map(async ([sectionId, section]) => {
          const sectionCardEntries = await Promise.all(
            Object.entries(section.cards).map(async ([cardId, card]) => [
              cardId,
              await hydrateCard(cardId, card),
            ] as const),
          );

          return [
            sectionId,
            {
              ...section,
              cards: Object.fromEntries(sectionCardEntries),
            },
          ] as const;
        }),
      );

      return [
        categoryId,
        {
          ...category,
          cards: Object.fromEntries(cardEntries),
          sections: Object.fromEntries(sectionEntries),
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

export async function recoverStoredDirectoryHandle() {
  if (!supportsProjectDirectory()) {
    return null;
  }

  return getStoredDirectoryHandle();
}

export { ASSETS_DIRECTORY_NAME, PROJECT_FILE_NAME };
