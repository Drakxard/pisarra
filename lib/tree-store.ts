"use client";

import { create } from "zustand";
import { buildDetailsImageAssetPath, buildImageAssetPath } from "@/lib/project-persistence";
import type {
  CardPosition,
  CardSize,
  DetailsTable,
  DetailsImage,
  DraftImage,
  PasteFeedback,
  PendingImageAsset,
  ProjectSnapshot,
  QuestionCard,
  SearchFeedback,
  SearchResult,
} from "@/lib/types";

type UndoSnapshot = {
  cards: Record<string, QuestionCard>;
  selectedCardId: string | null;
  draftText: string;
  draftImage: DraftImage | null;
  nextZIndex: number;
  snapshotUpdatedAt: string;
};

type CardSelectionOptions = {
  bringToFront?: boolean;
};

type TreeStore = {
  cards: Record<string, QuestionCard>;
  selectedCardId: string | null;
  openedCardId: string | null;
  draftText: string;
  draftImage: DraftImage | null;
  snapshotUpdatedAt: string;
  canUndoDeletion: boolean;
  nextZIndex: number;
  lastSearchQuery: string | null;
  searchResults: SearchResult[];
  activeSearchResultIndex: number;
  searchFeedback: SearchFeedback;
  pasteFeedback: PasteFeedback;
  pasteFeedbackVersion: number;
  appendDraftCharacter: (value: string) => void;
  appendDraftText: (value: string) => void;
  pasteStructuredText: (value: string) => void;
  attachDraftImage: (image: DraftImage) => void;
  clearDraftImage: () => void;
  backspaceDraft: () => void;
  clearDraft: () => void;
  confirmDraft: (viewport: CardSize, visibleOrigin?: CardPosition) => void;
  updateCardDetails: (cardId: string, detailsText: string) => void;
  ensureDetailsTable: (cardId: string) => void;
  addDetailsTableRow: (cardId: string) => void;
  addDetailsTableColumn: (cardId: string) => void;
  setDetailsTableFromCells: (cardId: string, cells: string[][]) => void;
  updateDetailsTableCell: (
    cardId: string,
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) => void;
  resizeDetailsTableColumn: (cardId: string, columnIndex: number, width: number) => void;
  resizeDetailsTableRow: (cardId: string, rowIndex: number, height: number) => void;
  addDetailsImage: (
    cardId: string,
    image: DraftImage,
    placement: { x: number; y: number; width: number; height: number },
  ) => string | null;
  moveDetailsImage: (cardId: string, imageId: string, position: CardPosition) => void;
  resizeDetailsImage: (cardId: string, imageId: string, size: CardSize) => void;
  rotateDetailsImage: (cardId: string, imageId: string, rotation: number) => void;
  selectCard: (cardId: string | null, options?: CardSelectionOptions) => void;
  openCard: (cardId: string) => void;
  closeCard: () => void;
  moveCard: (cardId: string, position: CardPosition) => void;
  setCardSize: (cardId: string, size: CardSize) => void;
  deleteCard: (cardId: string) => void;
  deleteSelectedCard: () => void;
  undoLastDeletion: () => void;
  clearDeletionUndo: () => void;
  clearPasteFeedback: () => void;
  setPasteFeedback: (feedback: PasteFeedback) => void;
  getProjectSnapshot: () => ProjectSnapshot;
  getPendingImageAssets: () => PendingImageAsset[];
  markCardImagesPersisted: (cardIds: string[]) => void;
  loadProjectSnapshot: (snapshot: ProjectSnapshot, draftImage?: DraftImage | null) => void;
  resetProject: () => void;
  runSearch: (query: string) => boolean;
  goToNextSearchResult: () => boolean;
  goToPreviousSearchResult: () => boolean;
  clearSearchState: () => void;
};

const AUTO_LAYOUT_PADDING = 32;
const AUTO_LAYOUT_GAP = 24;
const AUTO_LAYOUT_CARD_WIDTH = 320;
const AUTO_LAYOUT_CARD_HEIGHT = 220;
const AUTO_LAYOUT_CYCLE_OFFSET = 16;
const DEFAULT_TABLE_COLUMN_WIDTH = 160;
const DEFAULT_TABLE_ROW_HEIGHT = 48;
const MIN_TABLE_COLUMN_WIDTH = 72;
const MIN_TABLE_ROW_HEIGHT = 36;

const makeId = () => crypto.randomUUID();
let lastDeletionSnapshot: UndoSnapshot | null = null;

function getEmptySearchState() {
  return {
    lastSearchQuery: null,
    searchResults: [] as SearchResult[],
    activeSearchResultIndex: -1,
    searchFeedback: "none" as SearchFeedback,
  };
}

function getEmptyPasteFeedback() {
  return {
    pasteFeedback: "none" as PasteFeedback,
  };
}

function createSnapshotTimestamp() {
  return new Date().toISOString();
}

function normalizeDraftText(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeCardText(value: string) {
  return normalizeDraftText(value).trim();
}

function normalizeCardDetailsText(value: string) {
  return normalizeDraftText(value).trim();
}

function normalizeDetailsTable(value: DetailsTable | null | undefined): DetailsTable | null {
  if (!value || !Array.isArray(value.cells) || value.cells.length === 0) {
    return null;
  }

  const columnCount = Math.max(1, ...value.cells.map((row) => (Array.isArray(row) ? row.length : 0)));
  const cells = value.cells.map((row) =>
    Array.from({ length: columnCount }, (_, index) =>
      Array.isArray(row) && typeof row[index] === "string" ? row[index] : "",
    ),
  );

  return {
    cells,
    columnWidths: Array.from({ length: columnCount }, (_, index) =>
      clampTableSize(value.columnWidths?.[index], MIN_TABLE_COLUMN_WIDTH, DEFAULT_TABLE_COLUMN_WIDTH),
    ),
    rowHeights: Array.from({ length: cells.length }, (_, index) =>
      clampTableSize(value.rowHeights?.[index], MIN_TABLE_ROW_HEIGHT, DEFAULT_TABLE_ROW_HEIGHT),
    ),
    insertedAfterText: value.insertedAfterText !== false,
  };
}

function normalizeDetailsImages(value: DetailsImage[] | null | undefined): DetailsImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const images: DetailsImage[] = [];

  for (const image of value) {
    if (!image?.id || !image.path || !image.mimeType || !image.name) {
      continue;
    }

    images.push({
        ...image,
        x: Number.isFinite(image.x) ? image.x : 0,
        y: Number.isFinite(image.y) ? image.y : 0,
        width: Number.isFinite(image.width) && image.width > 0 ? image.width : 320,
        height: Number.isFinite(image.height) && image.height > 0 ? image.height : 220,
        rotation: Number.isFinite(image.rotation) ? image.rotation : 0,
        pendingBlob: image.pendingBlob ?? null,
    });
  }

  return images;
}

function clampTableSize(value: number | undefined, min: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback;
}

function createDefaultDetailsTable(): DetailsTable {
  return {
    cells: [[""]],
    columnWidths: [DEFAULT_TABLE_COLUMN_WIDTH],
    rowHeights: [DEFAULT_TABLE_ROW_HEIGHT],
    insertedAfterText: true,
  };
}

function cloneCard(card: QuestionCard): QuestionCard {
  return {
    ...card,
    detailsTable: card.detailsTable
      ? {
          cells: card.detailsTable.cells.map((row) => [...row]),
          columnWidths: [...card.detailsTable.columnWidths],
          rowHeights: [...card.detailsTable.rowHeights],
          insertedAfterText: card.detailsTable.insertedAfterText,
        }
      : null,
    detailsImages: normalizeDetailsImages(card.detailsImages).map((image) => ({ ...image })),
    position: { ...card.position },
    size: card.size ? { ...card.size } : undefined,
    image: card.image
      ? {
          ...card.image,
        }
      : null,
  };
}

function cloneCards(cards: Record<string, QuestionCard>) {
  return Object.fromEntries(Object.entries(cards).map(([cardId, card]) => [cardId, cloneCard(card)]));
}

function revokeDraftImageUrl(draftImage: DraftImage | null) {
  if (draftImage?.previewUrl) {
    URL.revokeObjectURL(draftImage.previewUrl);
  }
}

function revokeReplacedDraftImageUrl(
  previousDraftImage: DraftImage | null,
  nextDraftImage: DraftImage | null,
) {
  if (
    previousDraftImage?.previewUrl &&
    previousDraftImage.previewUrl !== nextDraftImage?.previewUrl
  ) {
    URL.revokeObjectURL(previousDraftImage.previewUrl);
  }
}

function collectCardImageUrls(cards: Record<string, QuestionCard>) {
  return new Set(
    Object.values(cards)
      .flatMap((card) => [
        card.image?.previewUrl,
        ...normalizeDetailsImages(card.detailsImages).map((image) => image.previewUrl),
      ])
      .filter((previewUrl): previewUrl is string => Boolean(previewUrl)),
  );
}

function revokeUnusedCardImageUrls(
  previousCards: Record<string, QuestionCard>,
  nextCards: Record<string, QuestionCard>,
) {
  const nextUrls = collectCardImageUrls(nextCards);

  for (const previewUrl of collectCardImageUrls(previousCards)) {
    if (!nextUrls.has(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
    }
  }
}

function disposeUndoSnapshot(snapshot: UndoSnapshot | null, liveCards: Record<string, QuestionCard>) {
  if (!snapshot) {
    return;
  }

  revokeUnusedCardImageUrls(snapshot.cards, liveCards);
}

function getNextZIndex(cards: Record<string, QuestionCard>) {
  const maxZIndex = Object.values(cards).reduce(
    (currentMax, card) => Math.max(currentMax, card.zIndex),
    0,
  );

  return maxZIndex + 1;
}

function createEmptyState() {
  return {
    cards: {} as Record<string, QuestionCard>,
    selectedCardId: null,
    openedCardId: null,
    draftText: "",
    draftImage: null as DraftImage | null,
    snapshotUpdatedAt: createSnapshotTimestamp(),
    canUndoDeletion: false,
    nextZIndex: 1,
    pasteFeedbackVersion: 0,
    ...getEmptySearchState(),
    ...getEmptyPasteFeedback(),
  };
}

function createUndoSnapshot(state: TreeStore): UndoSnapshot {
  return {
    cards: cloneCards(state.cards),
    selectedCardId: state.selectedCardId,
    draftText: state.draftText,
    draftImage: state.draftImage
      ? {
          ...state.draftImage,
        }
      : null,
    nextZIndex: state.nextZIndex,
    snapshotUpdatedAt: state.snapshotUpdatedAt,
  };
}

function getCardCount(cards: Record<string, QuestionCard>) {
  return Object.keys(cards).length;
}

function getAutoCardPosition(
  cards: Record<string, QuestionCard>,
  viewport: CardSize,
  visibleOrigin: CardPosition = { x: 0, y: 0 },
): CardPosition {
  const safeWidth = Math.max(viewport.width, AUTO_LAYOUT_CARD_WIDTH + AUTO_LAYOUT_PADDING * 2);
  const safeHeight = Math.max(viewport.height, AUTO_LAYOUT_CARD_HEIGHT + AUTO_LAYOUT_PADDING * 2);
  const columns = Math.max(
    1,
    Math.floor((safeWidth - AUTO_LAYOUT_PADDING * 2 + AUTO_LAYOUT_GAP) / (AUTO_LAYOUT_CARD_WIDTH + AUTO_LAYOUT_GAP)),
  );
  const rows = Math.max(
    1,
    Math.floor(
      (safeHeight - AUTO_LAYOUT_PADDING * 2 + AUTO_LAYOUT_GAP) /
        (AUTO_LAYOUT_CARD_HEIGHT + AUTO_LAYOUT_GAP),
    ),
  );
  const capacity = Math.max(1, columns * rows);
  const index = getCardCount(cards);
  const cycle = Math.floor(index / capacity);
  const slot = index % capacity;
  const column = slot % columns;
  const row = Math.floor(slot / columns);
  const offset = cycle * AUTO_LAYOUT_CYCLE_OFFSET;

  return {
    x: visibleOrigin.x + AUTO_LAYOUT_PADDING + column * (AUTO_LAYOUT_CARD_WIDTH + AUTO_LAYOUT_GAP) + offset,
    y: visibleOrigin.y + AUTO_LAYOUT_PADDING + row * (AUTO_LAYOUT_CARD_HEIGHT + AUTO_LAYOUT_GAP) + offset,
  };
}

function normalizeProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  const sourceCards = snapshot.cards ?? {};
  const cards = Object.fromEntries(
    Object.entries(sourceCards).map(([cardId, card]) => [
      cardId,
      {
        ...card,
        text: normalizeCardText(card.text ?? ""),
        detailsText: normalizeCardDetailsText(card.detailsText ?? ""),
        detailsTable: normalizeDetailsTable(card.detailsTable),
        detailsImages: normalizeDetailsImages(card.detailsImages),
        position: {
          x: Number.isFinite(card.position?.x) ? card.position.x : AUTO_LAYOUT_PADDING,
          y: Number.isFinite(card.position?.y) ? card.position.y : AUTO_LAYOUT_PADDING,
        },
        size:
          card.size &&
          Number.isFinite(card.size.width) &&
          Number.isFinite(card.size.height) &&
          card.size.width > 0 &&
          card.size.height > 0
            ? {
                width: card.size.width,
                height: card.size.height,
              }
            : undefined,
        image: card.image
          ? {
              path: card.image.path,
              mimeType: card.image.mimeType,
              name: card.image.name,
              width: card.image.width,
              height: card.image.height,
              previewUrl: card.image.previewUrl,
              pendingBlob: null,
            }
          : null,
      } satisfies QuestionCard,
    ]),
  );

  const selectedCardId =
    snapshot.selectedCardId && cards[snapshot.selectedCardId] ? snapshot.selectedCardId : null;

  return {
    version: 4,
    cards,
    selectedCardId,
    draftText: normalizeDraftText(snapshot.draftText ?? ""),
    savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : "",
  };
}

function normalizeSearchQuery(value: string) {
  return value.trim().toLocaleLowerCase();
}

function collectSearchResults(cards: Record<string, QuestionCard>, query: string) {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  return Object.values(cards)
    .filter((card) => card.text.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((card) => ({
      cardId: card.id,
      matchedText: card.text,
    }));
}

function createPersistedCard(card: QuestionCard): QuestionCard {
  return {
    ...card,
    detailsTable: normalizeDetailsTable(card.detailsTable),
    detailsImages: normalizeDetailsImages(card.detailsImages).map((image) => ({
      id: image.id,
      path: image.path,
      mimeType: image.mimeType,
      name: image.name,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      rotation: image.rotation,
    })),
    position: { ...card.position },
    image: card.image
      ? {
          path: card.image.path,
          mimeType: card.image.mimeType,
          name: card.image.name,
          width: card.image.width,
          height: card.image.height,
        }
      : null,
  };
}

export const useTreeStore = create<TreeStore>((set, get) => ({
  ...createEmptyState(),
  appendDraftCharacter: (value) => {
    if (!value) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set((state) => ({
      draftText: `${state.draftText}${value}`,
      snapshotUpdatedAt,
    }));
  },
  appendDraftText: (value) => {
    if (!value) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set((state) => ({
      draftText: `${state.draftText}${normalizeDraftText(value)}`,
      snapshotUpdatedAt,
    }));
  },
  pasteStructuredText: (value) => {
    get().appendDraftText(value);
  },
  attachDraftImage: (image) => {
    const currentDraftImage = get().draftImage;

    if (currentDraftImage?.previewUrl && currentDraftImage.previewUrl !== image.previewUrl) {
      revokeDraftImageUrl(currentDraftImage);
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      draftImage: image,
      snapshotUpdatedAt,
      ...getEmptyPasteFeedback(),
    });
  },
  clearDraftImage: () => {
    const currentDraftImage = get().draftImage;
    revokeDraftImageUrl(currentDraftImage);
    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      draftImage: null,
      snapshotUpdatedAt,
    });
  },
  backspaceDraft: () => {
    const snapshotUpdatedAt = createSnapshotTimestamp();

    set((state) => ({
      draftText: state.draftText.slice(0, -1),
      snapshotUpdatedAt,
    }));
  },
  clearDraft: () => {
    const currentDraftImage = get().draftImage;
    revokeDraftImageUrl(currentDraftImage);
    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      draftText: "",
      draftImage: null,
      snapshotUpdatedAt,
    });
  },
  confirmDraft: (viewport, visibleOrigin) => {
    const state = get();
    const normalizedText = normalizeCardText(state.draftText);
    const hasImage = Boolean(state.draftImage);

    if (!normalizedText && !hasImage) {
      return;
    }

    if (!hasImage && normalizedText === "->") {
      state.goToNextSearchResult();
      return;
    }

    if (!hasImage && normalizedText === "<-") {
      state.goToPreviousSearchResult();
      return;
    }

    if (!hasImage && normalizedText.startsWith(">")) {
      state.runSearch(normalizedText.slice(1));
      return;
    }

    const id = makeId();
    const timestamp = createSnapshotTimestamp();
    const card: QuestionCard = {
      id,
      text: normalizedText,
      detailsText: "",
      detailsTable: null,
      detailsImages: [],
      image: state.draftImage
        ? {
            path: buildImageAssetPath(id, state.draftImage.mimeType),
            mimeType: state.draftImage.mimeType,
            name: state.draftImage.name,
            width: state.draftImage.width,
            height: state.draftImage.height,
            previewUrl: state.draftImage.previewUrl,
            pendingBlob: state.draftImage.blob,
          }
        : null,
      position: getAutoCardPosition(state.cards, viewport, visibleOrigin),
      zIndex: state.nextZIndex,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    set({
      cards: {
        ...state.cards,
        [id]: card,
      },
      selectedCardId: id,
      openedCardId: null,
      draftText: "",
      draftImage: null,
      snapshotUpdatedAt: timestamp,
      nextZIndex: state.nextZIndex + 1,
      canUndoDeletion: false,
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
    });
    disposeUndoSnapshot(lastDeletionSnapshot, {
      ...state.cards,
      [id]: card,
    });
    lastDeletionSnapshot = null;
  },
  updateCardDetails: (cardId, detailsText) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card) {
      return;
    }

    const normalizedDetailsText = normalizeCardDetailsText(detailsText);

    if (card.detailsText === normalizedDetailsText) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsText: normalizedDetailsText,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  ensureDetailsTable: (cardId) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card || card.detailsTable) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: createDefaultDetailsTable(),
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  addDetailsTableRow: (cardId) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card) {
      return;
    }

    const table = normalizeDetailsTable(card.detailsTable) ?? createDefaultDetailsTable();
    const columnCount = table.columnWidths.length;
    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: {
            ...table,
            cells: [...table.cells, Array.from({ length: columnCount }, () => "")],
            rowHeights: [...table.rowHeights, DEFAULT_TABLE_ROW_HEIGHT],
          },
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  addDetailsTableColumn: (cardId) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card) {
      return;
    }

    const table = normalizeDetailsTable(card.detailsTable) ?? createDefaultDetailsTable();
    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: {
            ...table,
            cells: table.cells.map((row) => [...row, ""]),
            columnWidths: [...table.columnWidths, DEFAULT_TABLE_COLUMN_WIDTH],
          },
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  setDetailsTableFromCells: (cardId, cells) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card || cells.length === 0) {
      return;
    }

    const columnCount = Math.max(1, ...cells.map((row) => row.length));
    const normalizedCells = cells.map((row) =>
      Array.from({ length: columnCount }, (_, index) => normalizeDraftText(row[index] ?? "")),
    );
    const currentTable = normalizeDetailsTable(card.detailsTable);
    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: {
            cells: normalizedCells,
            columnWidths: Array.from({ length: columnCount }, (_, index) =>
              clampTableSize(
                currentTable?.columnWidths[index],
                MIN_TABLE_COLUMN_WIDTH,
                DEFAULT_TABLE_COLUMN_WIDTH,
              ),
            ),
            rowHeights: Array.from({ length: normalizedCells.length }, (_, index) =>
              clampTableSize(
                currentTable?.rowHeights[index],
                MIN_TABLE_ROW_HEIGHT,
                DEFAULT_TABLE_ROW_HEIGHT,
              ),
            ),
            insertedAfterText: true,
          },
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  updateDetailsTableCell: (cardId, rowIndex, columnIndex, value) => {
    const { cards } = get();
    const card = cards[cardId];
    const table = normalizeDetailsTable(card?.detailsTable);

    if (!card || !table?.cells[rowIndex] || table.cells[rowIndex][columnIndex] === undefined) {
      return;
    }

    if (table.cells[rowIndex][columnIndex] === value) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const cells = table.cells.map((row) => [...row]);
    cells[rowIndex][columnIndex] = normalizeDraftText(value);

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: {
            ...table,
            cells,
          },
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  resizeDetailsTableColumn: (cardId, columnIndex, width) => {
    const { cards } = get();
    const card = cards[cardId];
    const table = normalizeDetailsTable(card?.detailsTable);

    if (!card || !table || table.columnWidths[columnIndex] === undefined) {
      return;
    }

    const nextWidth = clampTableSize(width, MIN_TABLE_COLUMN_WIDTH, DEFAULT_TABLE_COLUMN_WIDTH);

    if (table.columnWidths[columnIndex] === nextWidth) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const columnWidths = [...table.columnWidths];
    columnWidths[columnIndex] = nextWidth;

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: {
            ...table,
            columnWidths,
          },
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  resizeDetailsTableRow: (cardId, rowIndex, height) => {
    const { cards } = get();
    const card = cards[cardId];
    const table = normalizeDetailsTable(card?.detailsTable);

    if (!card || !table || table.rowHeights[rowIndex] === undefined) {
      return;
    }

    const nextHeight = clampTableSize(height, MIN_TABLE_ROW_HEIGHT, DEFAULT_TABLE_ROW_HEIGHT);

    if (table.rowHeights[rowIndex] === nextHeight) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const rowHeights = [...table.rowHeights];
    rowHeights[rowIndex] = nextHeight;

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: {
            ...table,
            rowHeights,
          },
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  addDetailsImage: (cardId, image, placement) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card) {
      return null;
    }

    const imageId = makeId();
    const snapshotUpdatedAt = createSnapshotTimestamp();
    const detailsImage: DetailsImage = {
      id: imageId,
      path: buildDetailsImageAssetPath(cardId, imageId, image.mimeType),
      mimeType: image.mimeType,
      name: image.name,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotation: 0,
      previewUrl: image.previewUrl,
      pendingBlob: image.blob,
    };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsImages: [...normalizeDetailsImages(card.detailsImages), detailsImage],
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });

    return imageId;
  },
  moveDetailsImage: (cardId, imageId, position) => {
    const { cards } = get();
    const card = cards[cardId];
    const detailsImages = normalizeDetailsImages(card?.detailsImages);
    const imageIndex = detailsImages.findIndex((image) => image.id === imageId);

    if (!card || imageIndex === -1) {
      return;
    }

    const image = detailsImages[imageIndex];

    if (image.x === position.x && image.y === position.y) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const nextImages = [...detailsImages];
    nextImages[imageIndex] = { ...image, x: position.x, y: position.y };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsImages: nextImages,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  resizeDetailsImage: (cardId, imageId, size) => {
    const { cards } = get();
    const card = cards[cardId];
    const detailsImages = normalizeDetailsImages(card?.detailsImages);
    const imageIndex = detailsImages.findIndex((image) => image.id === imageId);

    if (!card || imageIndex === -1) {
      return;
    }

    const image = detailsImages[imageIndex];
    const width = Math.max(48, Math.round(size.width));
    const height = Math.max(48, Math.round(size.height));

    if (image.width === width && image.height === height) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const nextImages = [...detailsImages];
    nextImages[imageIndex] = { ...image, width, height };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsImages: nextImages,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  rotateDetailsImage: (cardId, imageId, rotation) => {
    const { cards } = get();
    const card = cards[cardId];
    const detailsImages = normalizeDetailsImages(card?.detailsImages);
    const imageIndex = detailsImages.findIndex((image) => image.id === imageId);

    if (!card || imageIndex === -1) {
      return;
    }

    const image = detailsImages[imageIndex];
    const nextRotation = Math.round(rotation);

    if (image.rotation === nextRotation) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const nextImages = [...detailsImages];
    nextImages[imageIndex] = { ...image, rotation: nextRotation };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsImages: nextImages,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  selectCard: (cardId, options) => {
    const { cards, nextZIndex } = get();

    if (!cardId) {
      const snapshotUpdatedAt = createSnapshotTimestamp();

      set({
        selectedCardId: null,
        snapshotUpdatedAt,
      });
      return;
    }

    const card = cards[cardId];

    if (!card) {
      return;
    }

    if (!options?.bringToFront) {
      const snapshotUpdatedAt = createSnapshotTimestamp();

      set({
        selectedCardId: cardId,
        snapshotUpdatedAt,
      });
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          zIndex: nextZIndex,
        },
      },
      selectedCardId: cardId,
      snapshotUpdatedAt,
      nextZIndex: nextZIndex + 1,
    });
  },
  openCard: (cardId) => {
    const { cards } = get();

    if (!cards[cardId]) {
      return;
    }

    set({
      openedCardId: cardId,
    });
  },
  closeCard: () => {
    set({
      openedCardId: null,
    });
  },
  moveCard: (cardId, position) => {
    const { cards, selectedCardId } = get();
    const card = cards[cardId];

    if (!card) {
      return;
    }

    if (card.position.x === position.x && card.position.y === position.y) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          position,
          updatedAt: new Date().toISOString(),
        },
      },
      selectedCardId: selectedCardId ?? cardId,
      snapshotUpdatedAt,
    });
  },
  setCardSize: (cardId, size) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card) {
      return;
    }

    if (card.size?.width === size.width && card.size?.height === size.height) {
      return;
    }

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          size,
        },
      },
    });
  },
  deleteCard: (cardId) => {
    const state = get();
    const { cards } = state;

    if (!cards[cardId]) {
      return;
    }

    disposeUndoSnapshot(lastDeletionSnapshot, cards);
    lastDeletionSnapshot = createUndoSnapshot(state);
    const nextCards = { ...cards };

    delete nextCards[cardId];

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: nextCards,
      selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
      openedCardId: state.openedCardId === cardId ? null : state.openedCardId,
      snapshotUpdatedAt,
      canUndoDeletion: true,
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
    });
  },
  deleteSelectedCard: () => {
    const { selectedCardId } = get();

    if (!selectedCardId) {
      return;
    }

    get().deleteCard(selectedCardId);
  },
  undoLastDeletion: () => {
    const snapshot = lastDeletionSnapshot;

    if (!snapshot) {
      return;
    }

    const currentState = get();
    revokeUnusedCardImageUrls(currentState.cards, snapshot.cards);
    revokeReplacedDraftImageUrl(currentState.draftImage, snapshot.draftImage);
    lastDeletionSnapshot = null;

    set({
      cards: cloneCards(snapshot.cards),
      selectedCardId: snapshot.selectedCardId,
      openedCardId: null,
      draftText: snapshot.draftText,
      draftImage: snapshot.draftImage
        ? {
            ...snapshot.draftImage,
          }
        : null,
      snapshotUpdatedAt: snapshot.snapshotUpdatedAt,
      canUndoDeletion: false,
      nextZIndex: snapshot.nextZIndex,
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
    });
  },
  clearDeletionUndo: () => {
    disposeUndoSnapshot(lastDeletionSnapshot, get().cards);
    lastDeletionSnapshot = null;
    set({
      canUndoDeletion: false,
    });
  },
  clearPasteFeedback: () => {
    set({
      ...getEmptyPasteFeedback(),
    });
  },
  setPasteFeedback: (feedback) => {
    set((state) => ({
      pasteFeedback: feedback,
      pasteFeedbackVersion: state.pasteFeedbackVersion + 1,
    }));
  },
  getProjectSnapshot: () => {
    const { cards, selectedCardId, draftText } = get();

    return {
      version: 4,
      cards: Object.fromEntries(
        Object.entries(cards).map(([cardId, card]) => [cardId, createPersistedCard(card)]),
      ),
      selectedCardId: selectedCardId && cards[selectedCardId] ? selectedCardId : null,
      draftText,
      savedAt: get().snapshotUpdatedAt,
    };
  },
  getPendingImageAssets: () => {
    return Object.values(get().cards).flatMap((card) => [
      ...(card.image?.pendingBlob
        ? [{
        cardId: card.id,
        path: card.image!.path,
        blob: card.image!.pendingBlob!,
        }]
        : []),
      ...normalizeDetailsImages(card.detailsImages)
        .filter((image) => image.pendingBlob)
        .map((image) => ({
          cardId: card.id,
          detailsImageId: image.id,
          path: image.path,
          blob: image.pendingBlob!,
        })),
    ]);
  },
  markCardImagesPersisted: (cardIds) => {
    if (cardIds.length === 0) {
      return;
    }

    const { cards } = get();
    let hasChanged = false;
    const nextCards = { ...cards };

    for (const cardId of cardIds) {
      const card = nextCards[cardId];

      let nextCard = card;

      if (card?.image?.pendingBlob) {
        nextCard = {
          ...nextCard,
          image: {
            ...card.image,
            pendingBlob: null,
          },
        };
        hasChanged = true;
      }

      const detailsImages = normalizeDetailsImages(card?.detailsImages);
      const nextDetailsImages = detailsImages.map((image) =>
        image.pendingBlob ? { ...image, pendingBlob: null } : image,
      );

      if (nextDetailsImages.some((image, index) => image !== detailsImages[index])) {
        nextCard = {
          ...nextCard,
          detailsImages: nextDetailsImages,
        };
        hasChanged = true;
      }

      if (nextCard !== card) {
        nextCards[cardId] = nextCard;
      }
    }

    if (!hasChanged) {
      return;
    }

    set({
      cards: nextCards,
    });
  },
  loadProjectSnapshot: (snapshot, draftImage = null) => {
    const currentState = get();
    revokeDraftImageUrl(currentState.draftImage);
    disposeUndoSnapshot(lastDeletionSnapshot, currentState.cards);
    lastDeletionSnapshot = null;

    const normalized = normalizeProjectSnapshot(snapshot);
    revokeUnusedCardImageUrls(currentState.cards, normalized.cards);

    set({
      cards: normalized.cards,
      selectedCardId: normalized.selectedCardId,
      openedCardId: null,
      draftText: normalized.draftText,
      draftImage,
      snapshotUpdatedAt: normalized.savedAt,
      canUndoDeletion: false,
      nextZIndex: getNextZIndex(normalized.cards),
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
    });
  },
  resetProject: () => {
    const currentState = get();
    revokeUnusedCardImageUrls(currentState.cards, {});
    revokeDraftImageUrl(currentState.draftImage);
    disposeUndoSnapshot(lastDeletionSnapshot, {});
    lastDeletionSnapshot = null;

    set(createEmptyState());
  },
  runSearch: (query) => {
    const trimmedQuery = query.trim();
    const { cards } = get();
    const results = collectSearchResults(cards, trimmedQuery);

    if (results.length === 0) {
      set({
        draftText: "",
        lastSearchQuery: trimmedQuery || null,
        searchResults: [],
        activeSearchResultIndex: -1,
        searchFeedback: "no-results",
        snapshotUpdatedAt: createSnapshotTimestamp(),
        ...getEmptyPasteFeedback(),
      });
      return false;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      draftText: "",
      selectedCardId: results[0].cardId,
      openedCardId: null,
      lastSearchQuery: trimmedQuery,
      searchResults: results,
      activeSearchResultIndex: 0,
      searchFeedback: "none",
      snapshotUpdatedAt,
      ...getEmptyPasteFeedback(),
    });
    return true;
  },
  goToNextSearchResult: () => {
    const { searchResults, activeSearchResultIndex, cards } = get();

    if (searchResults.length === 0) {
      set({
        draftText: "",
        searchFeedback: "no-results",
        snapshotUpdatedAt: createSnapshotTimestamp(),
        ...getEmptyPasteFeedback(),
      });
      return false;
    }

    const nextIndex = (activeSearchResultIndex + 1 + searchResults.length) % searchResults.length;
    const nextResult = searchResults[nextIndex];
    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      draftText: "",
      selectedCardId: cards[nextResult.cardId] ? nextResult.cardId : null,
      openedCardId: null,
      activeSearchResultIndex: nextIndex,
      searchFeedback: "none",
      snapshotUpdatedAt,
      ...getEmptyPasteFeedback(),
    });
    return true;
  },
  goToPreviousSearchResult: () => {
    const { searchResults, activeSearchResultIndex, cards } = get();

    if (searchResults.length === 0) {
      set({
        draftText: "",
        searchFeedback: "no-results",
        snapshotUpdatedAt: createSnapshotTimestamp(),
        ...getEmptyPasteFeedback(),
      });
      return false;
    }

    const nextIndex = (activeSearchResultIndex - 1 + searchResults.length) % searchResults.length;
    const nextResult = searchResults[nextIndex];
    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      draftText: "",
      selectedCardId: cards[nextResult.cardId] ? nextResult.cardId : null,
      openedCardId: null,
      activeSearchResultIndex: nextIndex,
      searchFeedback: "none",
      snapshotUpdatedAt,
      ...getEmptyPasteFeedback(),
    });
    return true;
  },
  clearSearchState: () => {
    set({
      ...getEmptySearchState(),
    });
  },
}));
