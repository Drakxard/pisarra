"use client";

import { create } from "zustand";
import { buildDetailsImageAssetPath, buildImageAssetPath } from "@/lib/project-persistence";
import type {
  CardPosition,
  CardSize,
  DetailsTable,
  DetailsImage,
  DetailsTextBox,
  DraftImage,
  ExerciseReferenceItem,
  PasteFeedback,
  PendingImageAsset,
  ProjectSnapshot,
  QuestionCard,
  SearchFeedback,
  SearchResult,
  StudyCategory,
  StudySection,
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

type CardOpenOrigin = {
  categoryId: string;
  mapKind: "main" | "section";
  sectionId: string | null;
  selectedCardId: string | null;
  openedCardId: string | null;
};

type TreeStore = {
  categories: Record<string, StudyCategory>;
  activeCategoryId: string | null;
  activeMapKind: "main" | "section" | null;
  activeSectionId: string | null;
  selectedCategoryId: string | null;
  categoryDraftText: string;
  cards: Record<string, QuestionCard>;
  selectedCardId: string | null;
  openedCardId: string | null;
  cardOpenOrigin: CardOpenOrigin | null;
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
  createCategory: (name: string) => string | null;
  renameCategory: (categoryId: string, name: string) => void;
  selectCategory: (categoryId: string | null) => void;
  openCategory: (categoryId: string) => void;
  openMainCategoryMap: (categoryId: string) => void;
  openCategorySection: (categoryId: string, sectionId: string) => void;
  closeCategory: () => void;
  closeActiveMap: () => void;
  selectNextCategory: () => void;
  selectPreviousCategory: () => void;
  appendCategoryDraftCharacter: (value: string) => void;
  backspaceCategoryDraft: () => void;
  clearCategoryDraft: () => void;
  confirmCategoryDraft: () => void;
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
  moveDetailsTable: (cardId: string, position: CardPosition) => void;
  resizeDetailsTableColumn: (cardId: string, columnIndex: number, width: number) => void;
  resizeDetailsTableRow: (cardId: string, rowIndex: number, height: number) => void;
  deleteDetailsTable: (cardId: string) => void;
  addDetailsImage: (
    cardId: string,
    image: DraftImage,
    placement: { x: number; y: number; width: number; height: number },
  ) => string | null;
  moveDetailsImage: (cardId: string, imageId: string, position: CardPosition) => void;
  resizeDetailsImage: (cardId: string, imageId: string, size: CardSize) => void;
  rotateDetailsImage: (cardId: string, imageId: string, rotation: number) => void;
  deleteDetailsImage: (cardId: string, imageId: string) => void;
  addDetailsTextBox: (
    cardId: string,
    placement: { x: number; y: number; width: number; height: number },
  ) => string | null;
  updateDetailsTextBox: (cardId: string, textBoxId: string, text: string) => void;
  updateDetailsTextBoxStyle: (
    cardId: string,
    textBoxId: string,
    patch: Partial<Pick<DetailsTextBox, "fontSize" | "color" | "bold" | "strike" | "bulleted" | "align" | "linkUrl">>,
  ) => void;
  moveDetailsTextBox: (cardId: string, textBoxId: string, position: CardPosition) => void;
  resizeDetailsTextBox: (cardId: string, textBoxId: string, size: CardSize) => void;
  deleteDetailsTextBox: (cardId: string, textBoxId: string) => void;
  replaceExerciseReferences: (cardId: string, references: ExerciseReferenceItem[]) => void;
  moveExerciseReference: (cardId: string, referenceId: string, position: CardPosition) => void;
  deleteExerciseReference: (cardId: string, referenceId: string) => void;
  selectCard: (cardId: string | null, options?: CardSelectionOptions) => void;
  openCard: (cardId: string) => void;
  openCardFromExerciseReference: (cardId: string, origin: CardOpenOrigin) => void;
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
  mergeRemoteProjectSnapshot: (snapshot: ProjectSnapshot) => void;
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
const DEFAULT_TABLE_COLUMN_WIDTH = 160;
const DEFAULT_TABLE_ROW_HEIGHT = 48;
const MIN_TABLE_COLUMN_WIDTH = 72;
const MIN_TABLE_ROW_HEIGHT = 36;
const DEFAULT_TEXT_BOX_STYLE = {
  fontSize: "small" as const,
  color: "#111111",
  bold: false,
  strike: false,
  bulleted: false,
  align: "left" as const,
  linkUrl: null as string | null,
};
const EXERCISE_REFERENCE_WIDTH = 192;
const EXERCISE_REFERENCE_HEIGHT = 132;
const EXERCISE_REFERENCE_GAP = 12;
const FIXED_SECTIONS = [
  ["definitions", "Definiciones"],
  ["theorems", "Teoremas"],
  ["exams", "Parciales"],
  ["exercises", "Ejercicios"],
] as const;

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
    x: Number.isFinite(value.x) ? Math.max(0, Math.round(value.x)) : 24,
    y: Number.isFinite(value.y) ? Math.max(0, Math.round(value.y)) : 220,
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

function normalizeDetailsTextBoxes(value: DetailsTextBox[] | null | undefined): DetailsTextBox[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((textBox): DetailsTextBox | null => {
      if (!textBox?.id) {
        return null;
      }

      return {
        id: textBox.id,
        text: normalizeDraftText(textBox.text ?? ""),
        x: Number.isFinite(textBox.x) ? textBox.x : 0,
        y: Number.isFinite(textBox.y) ? textBox.y : 0,
        width: Number.isFinite(textBox.width) && textBox.width > 0 ? textBox.width : 260,
        height: Number.isFinite(textBox.height) && textBox.height > 0 ? textBox.height : 120,
        fontSize:
          textBox.fontSize === "medium" ||
          textBox.fontSize === "large" ||
          textBox.fontSize === "xlarge" ||
          textBox.fontSize === "huge"
            ? textBox.fontSize
            : DEFAULT_TEXT_BOX_STYLE.fontSize,
        color: typeof textBox.color === "string" && textBox.color ? textBox.color : DEFAULT_TEXT_BOX_STYLE.color,
        bold: textBox.bold === true,
        strike: textBox.strike === true,
        bulleted: textBox.bulleted === true,
        align:
          textBox.align === "center" || textBox.align === "right"
            ? textBox.align
            : DEFAULT_TEXT_BOX_STYLE.align,
        linkUrl: typeof textBox.linkUrl === "string" && textBox.linkUrl ? textBox.linkUrl : null,
      };
    })
    .filter((textBox): textBox is DetailsTextBox => Boolean(textBox));
}

function normalizeExerciseReferences(value: ExerciseReferenceItem[] | null | undefined): ExerciseReferenceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((reference): ExerciseReferenceItem | null => {
      if (
        !reference?.id ||
        (reference.sourceSectionId !== "definitions" && reference.sourceSectionId !== "theorems") ||
        !reference.sourceCardId
      ) {
        return null;
      }

      return {
        id: reference.id,
        sourceSectionId: reference.sourceSectionId,
        sourceCardId: reference.sourceCardId,
        x: Number.isFinite(reference.x) ? reference.x : 0,
        y: Number.isFinite(reference.y) ? reference.y : 0,
        width:
          Number.isFinite(reference.width) && reference.width > 0
            ? Math.round(reference.width)
            : EXERCISE_REFERENCE_WIDTH,
        height:
          Number.isFinite(reference.height) && reference.height > 0
            ? Math.round(reference.height)
            : EXERCISE_REFERENCE_HEIGHT,
        createdAt: typeof reference.createdAt === "string" ? reference.createdAt : createSnapshotTimestamp(),
        updatedAt: typeof reference.updatedAt === "string" ? reference.updatedAt : createSnapshotTimestamp(),
      };
    })
    .filter((reference): reference is ExerciseReferenceItem => Boolean(reference));
}

function normalizeLegacyExerciseSet(value: unknown): ExerciseReferenceItem[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const source = value as {
    x?: number;
    y?: number;
    width?: number;
    createdAt?: string;
    updatedAt?: string;
    references?: Array<{ sourceSectionId?: unknown; sourceCardId?: unknown }>;
  };

  if (!Array.isArray(source.references) || source.references.length === 0) {
    return [];
  }

  const originX =
    typeof source.x === "number" && Number.isFinite(source.x) ? Math.max(0, Math.round(source.x)) : 24;
  const originY =
    typeof source.y === "number" && Number.isFinite(source.y) ? Math.max(0, Math.round(source.y)) : 24;
  const width = Number.isFinite(source.width) && source.width && source.width > 0 ? source.width : 420;
  const columns = Math.max(
    1,
    Math.min(2, Math.floor(width / (EXERCISE_REFERENCE_WIDTH + EXERCISE_REFERENCE_GAP)) || 1),
  );
  const timestamp = createSnapshotTimestamp();

  return source.references.flatMap((reference, index) => {
    if (
      !reference ||
      (reference.sourceSectionId !== "definitions" && reference.sourceSectionId !== "theorems") ||
      typeof reference.sourceCardId !== "string" ||
      !reference.sourceCardId
    ) {
      return [];
    }

    const column = index % columns;
    const row = Math.floor(index / columns);

    return [
      {
        id: makeId(),
        sourceSectionId: reference.sourceSectionId,
        sourceCardId: reference.sourceCardId,
        x: originX + column * (EXERCISE_REFERENCE_WIDTH + EXERCISE_REFERENCE_GAP),
        y: originY + row * (EXERCISE_REFERENCE_HEIGHT + EXERCISE_REFERENCE_GAP),
        width: EXERCISE_REFERENCE_WIDTH,
        height: EXERCISE_REFERENCE_HEIGHT,
        createdAt: typeof source.createdAt === "string" ? source.createdAt : timestamp,
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : timestamp,
      } satisfies ExerciseReferenceItem,
    ];
  });
}

function clampTableSize(value: number | undefined, min: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback;
}

function createDefaultDetailsTable(): DetailsTable {
  return {
    cells: [[""]],
    columnWidths: [DEFAULT_TABLE_COLUMN_WIDTH],
    rowHeights: [DEFAULT_TABLE_ROW_HEIGHT],
    x: 24,
    y: 220,
    insertedAfterText: true,
  };
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

function ensureFixedSections(sections: Record<string, StudySection> | undefined, timestamp: string) {
  const nextSections = { ...(sections ?? {}) };

  for (const [id, name] of FIXED_SECTIONS) {
    if (!nextSections[id]) {
      nextSections[id] = createEmptySection(id, name, timestamp);
    }
  }

  return nextSections;
}

function cloneCard(card: QuestionCard): QuestionCard {
  const exerciseReferences = normalizeExerciseReferences(card.exerciseReferences);

  return {
    ...card,
    detailsTable: card.detailsTable
      ? {
          cells: card.detailsTable.cells.map((row) => [...row]),
          columnWidths: [...card.detailsTable.columnWidths],
          rowHeights: [...card.detailsTable.rowHeights],
          x: card.detailsTable.x,
          y: card.detailsTable.y,
          insertedAfterText: card.detailsTable.insertedAfterText,
      }
      : null,
    detailsImages: normalizeDetailsImages(card.detailsImages).map((image) => ({ ...image })),
    detailsTextBoxes: normalizeDetailsTextBoxes(card.detailsTextBoxes).map((textBox) => ({ ...textBox })),
    exerciseReferences: exerciseReferences.map((reference) => ({ ...reference })),
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

function cloneCategory(category: StudyCategory): StudyCategory {
  return {
    ...category,
    cards: cloneCards(category.cards),
    sections: cloneSections(category.sections),
  };
}

function cloneCategories(categories: Record<string, StudyCategory>) {
  return Object.fromEntries(
    Object.entries(categories).map(([categoryId, category]) => [categoryId, cloneCategory(category)]),
  );
}

function cloneSection(section: StudySection): StudySection {
  return {
    ...section,
    cards: cloneCards(section.cards),
  };
}

function cloneSections(sections: Record<string, StudySection> = {}) {
  return Object.fromEntries(
    Object.entries(sections).map(([sectionId, section]) => [sectionId, cloneSection(section)]),
  );
}

function getAllCategoryCards(category: StudyCategory) {
  return [
    ...Object.values(category.cards),
    ...Object.values(category.sections ?? {}).flatMap((section) => Object.values(section.cards)),
  ];
}

function getAllCardsFromCategories(categories: Record<string, StudyCategory>) {
  return Object.values(categories).flatMap(getAllCategoryCards);
}

function getSelectedCategoryIndex(categories: StudyCategory[], selectedCategoryId: string | null) {
  const selectedIndex = categories.findIndex((category) => category.id === selectedCategoryId);
  return selectedIndex >= 0 ? selectedIndex : 0;
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
    categories: {} as Record<string, StudyCategory>,
    activeCategoryId: null as string | null,
    activeMapKind: null as "main" | "section" | null,
    activeSectionId: null as string | null,
    selectedCategoryId: null as string | null,
    categoryDraftText: "",
    cards: {} as Record<string, QuestionCard>,
    selectedCardId: null,
    openedCardId: null,
    cardOpenOrigin: null as CardOpenOrigin | null,
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

function createCategorySnapshot(
  category: StudyCategory,
  cards: Record<string, QuestionCard>,
  selectedCardId: string | null,
  draftText: string,
  timestamp: string,
  mapKind: "main" | "section" | null,
  sectionId: string | null,
): StudyCategory {
  if (mapKind === "section" && sectionId && category.sections[sectionId]) {
    return {
      ...category,
      activeSectionId: sectionId,
      sections: {
        ...category.sections,
        [sectionId]: {
          ...category.sections[sectionId],
          cards: cloneCards(cards),
          selectedCardId: selectedCardId && cards[selectedCardId] ? selectedCardId : null,
          draftText,
          updatedAt: timestamp,
        },
      },
      updatedAt: timestamp,
    };
  }

  return {
    ...category,
    cards: cloneCards(cards),
    selectedCardId: selectedCardId && cards[selectedCardId] ? selectedCardId : null,
    draftText,
    updatedAt: timestamp,
  };
}

function getSyncedCategories(state: TreeStore) {
  if (!state.activeCategoryId || !state.categories[state.activeCategoryId]) {
    return cloneCategories(state.categories);
  }

  return {
    ...cloneCategories(state.categories),
    [state.activeCategoryId]: createCategorySnapshot(
      state.categories[state.activeCategoryId],
      state.cards,
      state.selectedCardId,
      state.draftText,
      state.snapshotUpdatedAt,
      state.activeMapKind,
      state.activeSectionId,
    ),
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

type LayoutRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function createLayoutRect(x: number, y: number, width: number, height: number): LayoutRect {
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

function rectsOverlap(a: LayoutRect, b: LayoutRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function findAvailableRect(
  candidate: LayoutRect,
  occupiedRects: LayoutRect[],
  stepX: number,
  stepY: number,
) {
  let nextRect = { ...candidate };
  let attempts = 0;

  while (occupiedRects.some((occupiedRect) => rectsOverlap(nextRect, occupiedRect))) {
    attempts += 1;

    if (attempts % 4 === 0) {
      nextRect = createLayoutRect(
        Math.max(AUTO_LAYOUT_PADDING, candidate.left + stepX),
        Math.max(AUTO_LAYOUT_PADDING, nextRect.top + stepY),
        candidate.right - candidate.left,
        candidate.bottom - candidate.top,
      );
      continue;
    }

    nextRect = createLayoutRect(
      Math.max(AUTO_LAYOUT_PADDING, candidate.left),
      Math.max(AUTO_LAYOUT_PADDING, nextRect.top + stepY),
      candidate.right - candidate.left,
      candidate.bottom - candidate.top,
    );
  }

  return nextRect;
}

function getAutoCardPosition(
  cards: Record<string, QuestionCard>,
  viewport: CardSize,
  visibleOrigin: CardPosition = { x: 0, y: 0 },
): CardPosition {
  const safeWidth = Math.max(viewport.width, AUTO_LAYOUT_CARD_WIDTH + AUTO_LAYOUT_PADDING * 2);
  const nextWidth = AUTO_LAYOUT_CARD_WIDTH;
  const nextHeight = AUTO_LAYOUT_CARD_HEIGHT;
  const baseX = Math.max(
    AUTO_LAYOUT_PADDING,
    visibleOrigin.x + Math.max(AUTO_LAYOUT_PADDING, (safeWidth - nextWidth) / 2),
  );
  const baseY = Math.max(AUTO_LAYOUT_PADDING, visibleOrigin.y + AUTO_LAYOUT_PADDING);
  const occupiedRects = Object.values(cards).map((card) =>
    createLayoutRect(
      card.position.x,
      card.position.y,
      card.size?.width ?? AUTO_LAYOUT_CARD_WIDTH,
      card.size?.height ?? AUTO_LAYOUT_CARD_HEIGHT,
    ),
  );
  const nextRect = findAvailableRect(
    createLayoutRect(baseX, baseY, nextWidth, nextHeight),
    occupiedRects,
    AUTO_LAYOUT_CARD_WIDTH + AUTO_LAYOUT_GAP,
    AUTO_LAYOUT_CARD_HEIGHT + AUTO_LAYOUT_GAP,
  );

  return {
    x: Math.round(nextRect.left),
    y: Math.round(nextRect.top),
  };
}

function normalizeCards(sourceCards: Record<string, QuestionCard> = {}) {
  return Object.fromEntries(
    Object.entries(sourceCards).map(([cardId, card]) => [
      cardId,
      {
        ...card,
        text: normalizeCardText(card.text ?? ""),
        detailsText: normalizeCardDetailsText(card.detailsText ?? ""),
        detailsTable: normalizeDetailsTable(card.detailsTable),
        detailsImages: normalizeDetailsImages(card.detailsImages),
        detailsTextBoxes: normalizeDetailsTextBoxes(card.detailsTextBoxes),
        exerciseReferences: normalizeExerciseReferences(card.exerciseReferences).length
          ? normalizeExerciseReferences(card.exerciseReferences)
          : normalizeLegacyExerciseSet((card as QuestionCard & { exerciseSet?: unknown }).exerciseSet),
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
}

function normalizeCategory(category: StudyCategory): StudyCategory {
  const timestamp = createSnapshotTimestamp();
  const cards = normalizeCards(category.cards);
  const sections = Object.fromEntries(
    Object.entries(ensureFixedSections(category.sections, timestamp)).map(([sectionId, section]) => [
      sectionId,
      normalizeSection({ ...section, id: section.id || sectionId }),
    ]),
  );

  return {
    id: category.id || makeId(),
    name: normalizeCardText(category.name || "Sin nombre") || "Sin nombre",
    cards,
    selectedCardId: category.selectedCardId && cards[category.selectedCardId] ? category.selectedCardId : null,
    draftText: normalizeDraftText(category.draftText ?? ""),
    sections,
    activeSectionId: category.activeSectionId && sections[category.activeSectionId] ? category.activeSectionId : null,
    createdAt: typeof category.createdAt === "string" ? category.createdAt : timestamp,
    updatedAt: typeof category.updatedAt === "string" ? category.updatedAt : timestamp,
  };
}

function normalizeSection(section: StudySection): StudySection {
  const timestamp = createSnapshotTimestamp();
  const cards = normalizeCards(section.cards);

  return {
    id: section.id,
    name: normalizeCardText(section.name || "Sin nombre") || "Sin nombre",
    cards,
    selectedCardId: section.selectedCardId && cards[section.selectedCardId] ? section.selectedCardId : null,
    draftText: normalizeDraftText(section.draftText ?? ""),
    createdAt: typeof section.createdAt === "string" ? section.createdAt : timestamp,
    updatedAt: typeof section.updatedAt === "string" ? section.updatedAt : timestamp,
  };
}

function normalizeProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  const timestamp = createSnapshotTimestamp();
  const legacyCards = normalizeCards(snapshot.cards ?? {});
  const legacyCategoryId = makeId();
  const sourceCategories =
    snapshot.categories && Object.keys(snapshot.categories).length > 0
      ? snapshot.categories
      : {
          [legacyCategoryId]: {
            id: legacyCategoryId,
            name: "Sin nombre",
            cards: legacyCards,
            selectedCardId:
              snapshot.selectedCardId && legacyCards[snapshot.selectedCardId]
                ? snapshot.selectedCardId
                : null,
            draftText: normalizeDraftText(snapshot.draftText ?? ""),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
  const categories = Object.fromEntries(
    Object.entries(sourceCategories).map(([categoryId, category]) => [
      categoryId,
      normalizeCategory({ ...category, id: category.id || categoryId }),
    ]),
  );
  const selectedCategoryId =
    snapshot.selectedCategoryId && categories[snapshot.selectedCategoryId]
      ? snapshot.selectedCategoryId
      : Object.keys(categories)[0] ?? null;

  return {
    version: 6,
    categories,
    activeCategoryId: null,
    activeMapKind: null,
    activeSectionId: null,
    selectedCategoryId,
    categoryDraftText: normalizeDraftText(snapshot.categoryDraftText ?? ""),
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
  const exerciseReferences = normalizeExerciseReferences(card.exerciseReferences);

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
    detailsTextBoxes: normalizeDetailsTextBoxes(card.detailsTextBoxes).map((textBox) => ({
      ...textBox,
    })),
    exerciseReferences: exerciseReferences.map((reference) => ({ ...reference })),
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

function createPersistedCategory(category: StudyCategory): StudyCategory {
  return {
    ...category,
    cards: Object.fromEntries(
      Object.entries(category.cards).map(([cardId, card]) => [cardId, createPersistedCard(card)]),
    ),
    sections: Object.fromEntries(
      Object.entries(ensureFixedSections(category.sections, category.updatedAt)).map(
        ([sectionId, section]) => [
          sectionId,
          {
            ...section,
            cards: Object.fromEntries(
              Object.entries(section.cards).map(([cardId, card]) => [
                cardId,
                createPersistedCard(card),
              ]),
            ),
            selectedCardId:
              section.selectedCardId && section.cards[section.selectedCardId]
                ? section.selectedCardId
                : null,
          },
        ],
      ),
    ),
    selectedCardId:
      category.selectedCardId && category.cards[category.selectedCardId]
        ? category.selectedCardId
        : null,
    draftText: category.draftText,
  };
}

export const useTreeStore = create<TreeStore>((set, get) => ({
  ...createEmptyState(),
  createCategory: (name) => {
    const normalizedName = normalizeCardText(name);

    if (!normalizedName) {
      return null;
    }

    const id = makeId();
    const timestamp = createSnapshotTimestamp();
    const category: StudyCategory = {
      id,
      name: normalizedName,
      cards: {},
      selectedCardId: null,
      draftText: "",
      sections: ensureFixedSections(undefined, timestamp),
      activeSectionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    set((state) => ({
      categories: {
        ...getSyncedCategories(state),
        [id]: category,
      },
      selectedCategoryId: id,
      categoryDraftText: "",
      snapshotUpdatedAt: timestamp,
    }));

    return id;
  },
  renameCategory: (categoryId, name) => {
    const normalizedName = normalizeCardText(name) || "Sin nombre";
    const state = get();
    const categories = getSyncedCategories(state);
    const category = categories[categoryId];

    if (!category || category.name === normalizedName) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      categories: {
        ...categories,
        [categoryId]: {
          ...category,
          name: normalizedName,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  selectCategory: (categoryId) => {
    const { categories } = get();

    set({
      selectedCategoryId: categoryId && categories[categoryId] ? categoryId : null,
    });
  },
  openCategory: (categoryId) => {
    get().openMainCategoryMap(categoryId);
  },
  openMainCategoryMap: (categoryId) => {
    const state = get();
    const categories = getSyncedCategories(state);
    const category = categories[categoryId];

    if (!category) {
      return;
    }

    disposeUndoSnapshot(lastDeletionSnapshot, state.cards);
    lastDeletionSnapshot = null;
    revokeDraftImageUrl(state.draftImage);

    set({
      categories,
      activeCategoryId: categoryId,
      activeMapKind: "main",
      activeSectionId: null,
      selectedCategoryId: categoryId,
      cards: cloneCards(category.cards),
      selectedCardId: category.selectedCardId,
      openedCardId: null,
      cardOpenOrigin: null,
      draftText: category.draftText,
      draftImage: null,
      canUndoDeletion: false,
      nextZIndex: getNextZIndex(category.cards),
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
    });
  },
  openCategorySection: (categoryId, sectionId) => {
    const state = get();
    const categories = getSyncedCategories(state);
    const category = categories[categoryId];
    const sections = category ? ensureFixedSections(category.sections, createSnapshotTimestamp()) : {};
    const section = sections[sectionId];

    if (!category || !section) {
      return;
    }

    disposeUndoSnapshot(lastDeletionSnapshot, state.cards);
    lastDeletionSnapshot = null;
    revokeDraftImageUrl(state.draftImage);

    set({
      categories: {
        ...categories,
        [categoryId]: {
          ...category,
          sections,
          activeSectionId: sectionId,
        },
      },
      activeCategoryId: categoryId,
      activeMapKind: "section",
      activeSectionId: sectionId,
      selectedCategoryId: categoryId,
      cards: cloneCards(section.cards),
      selectedCardId: section.selectedCardId,
      openedCardId: null,
      cardOpenOrigin: null,
      draftText: section.draftText,
      draftImage: null,
      canUndoDeletion: false,
      nextZIndex: getNextZIndex(section.cards),
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
    });
  },
  closeCategory: () => {
    get().closeActiveMap();
  },
  closeActiveMap: () => {
    const state = get();

    if (!state.activeCategoryId) {
      return;
    }

    revokeDraftImageUrl(state.draftImage);

    set({
      categories: getSyncedCategories(state),
      selectedCategoryId: state.activeCategoryId,
      activeCategoryId: null,
      activeMapKind: null,
      activeSectionId: null,
      cards: {},
      selectedCardId: null,
      openedCardId: null,
      cardOpenOrigin: null,
      draftText: "",
      draftImage: null,
      canUndoDeletion: false,
      nextZIndex: 1,
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
    });
  },
  selectNextCategory: () => {
    const state = get();
    const categories = Object.values(getSyncedCategories(state)).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );

    if (categories.length === 0) {
      return;
    }

    const currentIndex = getSelectedCategoryIndex(categories, state.selectedCategoryId);
    set({
      categories: Object.fromEntries(categories.map((category) => [category.id, category])),
      selectedCategoryId: categories[(currentIndex + 1) % categories.length].id,
    });
  },
  selectPreviousCategory: () => {
    const state = get();
    const categories = Object.values(getSyncedCategories(state)).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );

    if (categories.length === 0) {
      return;
    }

    const currentIndex = getSelectedCategoryIndex(categories, state.selectedCategoryId);
    set({
      categories: Object.fromEntries(categories.map((category) => [category.id, category])),
      selectedCategoryId: categories[(currentIndex - 1 + categories.length) % categories.length].id,
    });
  },
  appendCategoryDraftCharacter: (value) => {
    if (!value) {
      return;
    }

    set((state) => ({
      categoryDraftText: `${state.categoryDraftText}${value}`,
      snapshotUpdatedAt: createSnapshotTimestamp(),
    }));
  },
  backspaceCategoryDraft: () => {
    set((state) => ({
      categoryDraftText: state.categoryDraftText.slice(0, -1),
      snapshotUpdatedAt: createSnapshotTimestamp(),
    }));
  },
  clearCategoryDraft: () => {
    set({
      categoryDraftText: "",
      snapshotUpdatedAt: createSnapshotTimestamp(),
    });
  },
  confirmCategoryDraft: () => {
    const { categoryDraftText } = get();
    get().createCategory(categoryDraftText);
  },
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
      detailsTextBoxes: [],
      exerciseReferences: [],
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
            x: currentTable?.x ?? 24,
            y: currentTable?.y ?? 220,
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
  moveDetailsTable: (cardId, position) => {
    const { cards } = get();
    const card = cards[cardId];
    const table = normalizeDetailsTable(card?.detailsTable);

    if (!card || !table) {
      return;
    }

    const nextPosition = {
      x: Math.max(0, Math.round(position.x)),
      y: Math.max(0, Math.round(position.y)),
    };

    if (table.x === nextPosition.x && table.y === nextPosition.y) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: {
            ...table,
            ...nextPosition,
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
  deleteDetailsTable: (cardId) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card || !card.detailsTable) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTable: null,
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
  deleteDetailsImage: (cardId, imageId) => {
    const { cards } = get();
    const card = cards[cardId];
    const detailsImages = normalizeDetailsImages(card?.detailsImages);

    if (!card || detailsImages.length === 0) {
      return;
    }

    const nextImages = detailsImages.filter((image) => image.id !== imageId);

    if (nextImages.length === detailsImages.length) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

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
  addDetailsTextBox: (cardId, placement) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card) {
      return null;
    }

    const textBoxId = makeId();
    const snapshotUpdatedAt = createSnapshotTimestamp();
    const textBox: DetailsTextBox = {
      id: textBoxId,
      text: "",
      x: Math.max(0, Math.round(placement.x)),
      y: Math.max(0, Math.round(placement.y)),
      width: Math.max(120, Math.round(placement.width)),
      height: Math.max(48, Math.round(placement.height)),
      ...DEFAULT_TEXT_BOX_STYLE,
    };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTextBoxes: [...normalizeDetailsTextBoxes(card.detailsTextBoxes), textBox],
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });

    return textBoxId;
  },
  updateDetailsTextBox: (cardId, textBoxId, text) => {
    const { cards } = get();
    const card = cards[cardId];
    const textBoxes = normalizeDetailsTextBoxes(card?.detailsTextBoxes);
    const textBoxIndex = textBoxes.findIndex((textBox) => textBox.id === textBoxId);

    if (!card || textBoxIndex === -1) {
      return;
    }

    const nextText = normalizeDraftText(text);

    if (textBoxes[textBoxIndex].text === nextText) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const nextTextBoxes = [...textBoxes];
    nextTextBoxes[textBoxIndex] = { ...textBoxes[textBoxIndex], text: nextText };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTextBoxes: nextTextBoxes,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  updateDetailsTextBoxStyle: (cardId, textBoxId, patch) => {
    const { cards } = get();
    const card = cards[cardId];
    const textBoxes = normalizeDetailsTextBoxes(card?.detailsTextBoxes);
    const textBoxIndex = textBoxes.findIndex((textBox) => textBox.id === textBoxId);

    if (!card || textBoxIndex === -1) {
      return;
    }

    const currentTextBox = textBoxes[textBoxIndex];
    const nextTextBox = {
      ...currentTextBox,
      ...patch,
      linkUrl: patch.linkUrl === undefined ? currentTextBox.linkUrl : patch.linkUrl || null,
    };

    if (JSON.stringify(currentTextBox) === JSON.stringify(nextTextBox)) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const nextTextBoxes = [...textBoxes];
    nextTextBoxes[textBoxIndex] = nextTextBox;

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTextBoxes: nextTextBoxes,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  moveDetailsTextBox: (cardId, textBoxId, position) => {
    const { cards } = get();
    const card = cards[cardId];
    const textBoxes = normalizeDetailsTextBoxes(card?.detailsTextBoxes);
    const textBoxIndex = textBoxes.findIndex((textBox) => textBox.id === textBoxId);

    if (!card || textBoxIndex === -1) {
      return;
    }

    const textBox = textBoxes[textBoxIndex];

    if (textBox.x === position.x && textBox.y === position.y) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const nextTextBoxes = [...textBoxes];
    nextTextBoxes[textBoxIndex] = { ...textBox, x: position.x, y: position.y };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTextBoxes: nextTextBoxes,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  resizeDetailsTextBox: (cardId, textBoxId, size) => {
    const { cards } = get();
    const card = cards[cardId];
    const textBoxes = normalizeDetailsTextBoxes(card?.detailsTextBoxes);
    const textBoxIndex = textBoxes.findIndex((textBox) => textBox.id === textBoxId);

    if (!card || textBoxIndex === -1) {
      return;
    }

    const textBox = textBoxes[textBoxIndex];
    const width = Math.max(120, Math.round(size.width));
    const height = Math.max(48, Math.round(size.height));

    if (textBox.width === width && textBox.height === height) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const nextTextBoxes = [...textBoxes];
    nextTextBoxes[textBoxIndex] = { ...textBox, width, height };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTextBoxes: nextTextBoxes,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  deleteDetailsTextBox: (cardId, textBoxId) => {
    const { cards } = get();
    const card = cards[cardId];
    const textBoxes = normalizeDetailsTextBoxes(card?.detailsTextBoxes);
    const nextTextBoxes = textBoxes.filter((textBox) => textBox.id !== textBoxId);

    if (!card || nextTextBoxes.length === textBoxes.length) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          detailsTextBoxes: nextTextBoxes,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  replaceExerciseReferences: (cardId, references) => {
    const { cards } = get();
    const card = cards[cardId];

    if (!card) {
      return;
    }

    const nextExerciseReferences = normalizeExerciseReferences(references);

    if (JSON.stringify(normalizeExerciseReferences(card.exerciseReferences)) === JSON.stringify(nextExerciseReferences)) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          exerciseReferences: nextExerciseReferences.map((reference) => ({ ...reference })),
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  moveExerciseReference: (cardId, referenceId, position) => {
    const { cards } = get();
    const card = cards[cardId];
    const exerciseReferences = normalizeExerciseReferences(card?.exerciseReferences);
    const referenceIndex = exerciseReferences.findIndex((reference) => reference.id === referenceId);

    if (!card || referenceIndex === -1) {
      return;
    }

    const reference = exerciseReferences[referenceIndex];
    const nextX = Math.max(0, Math.round(position.x));
    const nextY = Math.max(0, Math.round(position.y));

    if (reference.x === nextX && reference.y === nextY) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();
    const nextExerciseReferences = [...exerciseReferences];
    nextExerciseReferences[referenceIndex] = {
      ...reference,
      x: nextX,
      y: nextY,
      updatedAt: snapshotUpdatedAt,
    };

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          exerciseReferences: nextExerciseReferences,
          updatedAt: snapshotUpdatedAt,
        },
      },
      snapshotUpdatedAt,
    });
  },
  deleteExerciseReference: (cardId, referenceId) => {
    const { cards } = get();
    const card = cards[cardId];
    const exerciseReferences = normalizeExerciseReferences(card?.exerciseReferences);
    const nextExerciseReferences = exerciseReferences.filter((reference) => reference.id !== referenceId);

    if (!card || nextExerciseReferences.length === exerciseReferences.length) {
      return;
    }

    const snapshotUpdatedAt = createSnapshotTimestamp();

    set({
      cards: {
        ...cards,
        [cardId]: {
          ...card,
          exerciseReferences: nextExerciseReferences,
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
      cardOpenOrigin: null,
    });
  },
  openCardFromExerciseReference: (cardId, origin) => {
    const { cards } = get();

    if (!cards[cardId]) {
      return;
    }

    set({
      openedCardId: cardId,
      cardOpenOrigin: origin,
    });
  },
  closeCard: () => {
    const state = get();

    if (!state.cardOpenOrigin) {
      set({
        openedCardId: null,
        cardOpenOrigin: null,
      });
      return;
    }

    const categories = getSyncedCategories(state);
    const originCategory = categories[state.cardOpenOrigin.categoryId];

    if (!originCategory) {
      set({
        categories,
        openedCardId: null,
        cardOpenOrigin: null,
      });
      return;
    }

    if (state.cardOpenOrigin.mapKind === "section" && state.cardOpenOrigin.sectionId) {
      const originSection = originCategory.sections[state.cardOpenOrigin.sectionId];

      if (originSection) {
        set({
          categories: {
            ...categories,
            [originCategory.id]: {
              ...originCategory,
              activeSectionId: originSection.id,
            },
          },
          activeCategoryId: originCategory.id,
          activeMapKind: "section",
          activeSectionId: originSection.id,
          selectedCategoryId: originCategory.id,
          cards: cloneCards(originSection.cards),
          selectedCardId:
            state.cardOpenOrigin.selectedCardId && originSection.cards[state.cardOpenOrigin.selectedCardId]
              ? state.cardOpenOrigin.selectedCardId
              : originSection.selectedCardId,
          openedCardId:
            state.cardOpenOrigin.openedCardId && originSection.cards[state.cardOpenOrigin.openedCardId]
              ? state.cardOpenOrigin.openedCardId
              : null,
          cardOpenOrigin: null,
          draftText: originSection.draftText,
          draftImage: null,
          canUndoDeletion: false,
          nextZIndex: getNextZIndex(originSection.cards),
          ...getEmptySearchState(),
          ...getEmptyPasteFeedback(),
        });
        return;
      }
    }

    set({
      categories,
      activeCategoryId: originCategory.id,
      activeMapKind: "main",
      activeSectionId: null,
      selectedCategoryId: originCategory.id,
      cards: cloneCards(originCategory.cards),
      selectedCardId:
        state.cardOpenOrigin.selectedCardId && originCategory.cards[state.cardOpenOrigin.selectedCardId]
          ? state.cardOpenOrigin.selectedCardId
          : originCategory.selectedCardId,
      openedCardId:
        state.cardOpenOrigin.openedCardId && originCategory.cards[state.cardOpenOrigin.openedCardId]
          ? state.cardOpenOrigin.openedCardId
          : null,
      cardOpenOrigin: null,
      draftText: originCategory.draftText,
      draftImage: null,
      canUndoDeletion: false,
      nextZIndex: getNextZIndex(originCategory.cards),
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
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
    const state = get();
    const categories = getSyncedCategories(state);

    return {
      version: 6,
      categories: Object.fromEntries(
        Object.entries(categories).map(([categoryId, category]) => [
          categoryId,
          createPersistedCategory(category),
        ]),
      ),
      activeCategoryId: null,
      activeMapKind: null,
      activeSectionId: null,
      selectedCategoryId:
        state.selectedCategoryId && categories[state.selectedCategoryId]
          ? state.selectedCategoryId
          : Object.keys(categories)[0] ?? null,
      categoryDraftText: state.categoryDraftText,
      savedAt: state.snapshotUpdatedAt,
    };
  },
  getPendingImageAssets: () => {
    const cards = getAllCardsFromCategories(getSyncedCategories(get()));

    return cards.flatMap((card) => [
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

    const state = get();
    const categories = getSyncedCategories(state);
    let hasChanged = false;
    const nextCategories = { ...categories };

    const clearPendingBlobs = (sourceCards: Record<string, QuestionCard>) => {
      const nextCards = { ...sourceCards };

      for (const cardId of cardIds) {
        const card = nextCards[cardId];

        if (!card) {
          continue;
        }

        let nextCard = card;

        if (card.image?.pendingBlob) {
          nextCard = {
            ...nextCard,
            image: {
              ...card.image,
              pendingBlob: null,
            },
          };
          hasChanged = true;
        }

        const detailsImages = normalizeDetailsImages(card.detailsImages);
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

      return nextCards;
    };

    for (const category of Object.values(nextCategories)) {
      const nextCards = clearPendingBlobs(category.cards);
      const nextSections = Object.fromEntries(
        Object.entries(category.sections).map(([sectionId, section]) => [
          sectionId,
          {
            ...section,
            cards: clearPendingBlobs(section.cards),
          },
        ]),
      );

      nextCategories[category.id] = {
        ...category,
        cards: nextCards,
        sections: nextSections,
      };
    }

    if (!hasChanged) {
      return;
    }

    set({
      categories: nextCategories,
      cards:
        state.activeCategoryId && nextCategories[state.activeCategoryId]
          ? state.activeMapKind === "section" &&
            state.activeSectionId &&
            nextCategories[state.activeCategoryId].sections[state.activeSectionId]
            ? cloneCards(nextCategories[state.activeCategoryId].sections[state.activeSectionId].cards)
            : cloneCards(nextCategories[state.activeCategoryId].cards)
          : state.cards,
    });
  },
  loadProjectSnapshot: (snapshot, draftImage = null) => {
    const currentState = get();
    revokeDraftImageUrl(currentState.draftImage);
    disposeUndoSnapshot(lastDeletionSnapshot, currentState.cards);
    lastDeletionSnapshot = null;

    const normalized = normalizeProjectSnapshot(snapshot);
    const nextCards = Object.fromEntries(
      getAllCardsFromCategories(normalized.categories).map((card) => [card.id, card]),
    );
    revokeUnusedCardImageUrls(currentState.cards, nextCards);

    set({
      categories: normalized.categories,
      activeCategoryId: null,
      activeMapKind: null,
      activeSectionId: null,
      selectedCategoryId: normalized.selectedCategoryId,
      categoryDraftText: normalized.categoryDraftText,
      cards: {},
      selectedCardId: null,
      openedCardId: null,
      cardOpenOrigin: null,
      draftText: "",
      draftImage,
      snapshotUpdatedAt: normalized.savedAt,
      canUndoDeletion: false,
      nextZIndex: 1,
      ...getEmptySearchState(),
      ...getEmptyPasteFeedback(),
    });
  },
  mergeRemoteProjectSnapshot: (snapshot) => {
    const currentState = get();
    const normalized = normalizeProjectSnapshot(snapshot);
    const currentActiveCategory =
      currentState.activeCategoryId ? normalized.categories[currentState.activeCategoryId] : null;
    const currentActiveSection =
      currentActiveCategory &&
      currentState.activeMapKind === "section" &&
      currentState.activeSectionId
        ? currentActiveCategory.sections[currentState.activeSectionId]
        : null;
    const canKeepActiveMap =
      Boolean(currentActiveCategory) &&
      (currentState.activeMapKind === "main" ||
        (currentState.activeMapKind === "section" && Boolean(currentActiveSection)));
    const nextCards = canKeepActiveMap
      ? cloneCards(
          currentState.activeMapKind === "section" && currentActiveSection
            ? currentActiveSection.cards
            : currentActiveCategory!.cards,
        )
      : {};

    const allNextCards = Object.fromEntries(
      getAllCardsFromCategories(normalized.categories).map((card) => [card.id, card]),
    );
    revokeUnusedCardImageUrls(currentState.cards, allNextCards);

    if (!canKeepActiveMap) {
      revokeDraftImageUrl(currentState.draftImage);
      disposeUndoSnapshot(lastDeletionSnapshot, currentState.cards);
      lastDeletionSnapshot = null;

      set({
        categories: normalized.categories,
        activeCategoryId: null,
        activeMapKind: null,
        activeSectionId: null,
        selectedCategoryId: normalized.selectedCategoryId,
        categoryDraftText: normalized.categoryDraftText,
        cards: {},
        selectedCardId: null,
        openedCardId: null,
        cardOpenOrigin: null,
        draftText: "",
        draftImage: null,
        snapshotUpdatedAt: normalized.savedAt,
        canUndoDeletion: false,
        nextZIndex: 1,
        ...getEmptySearchState(),
        ...getEmptyPasteFeedback(),
      });
      return;
    }

    set({
      categories: normalized.categories,
      activeCategoryId: currentState.activeCategoryId,
      activeMapKind: currentState.activeMapKind,
      activeSectionId: currentState.activeSectionId,
      selectedCategoryId: currentState.activeCategoryId,
      categoryDraftText: normalized.categoryDraftText,
      cards: nextCards,
      selectedCardId:
        currentState.selectedCardId && nextCards[currentState.selectedCardId]
          ? currentState.selectedCardId
          : null,
      openedCardId:
        currentState.openedCardId && nextCards[currentState.openedCardId]
          ? currentState.openedCardId
          : null,
      cardOpenOrigin:
        currentState.cardOpenOrigin &&
        normalized.categories[currentState.cardOpenOrigin.categoryId] &&
        (currentState.cardOpenOrigin.mapKind === "main" ||
          (currentState.cardOpenOrigin.sectionId &&
            normalized.categories[currentState.cardOpenOrigin.categoryId].sections[
              currentState.cardOpenOrigin.sectionId
            ]))
          ? currentState.cardOpenOrigin
          : null,
      draftText: currentState.draftText,
      draftImage: currentState.draftImage,
      snapshotUpdatedAt: normalized.savedAt,
      canUndoDeletion: false,
      nextZIndex: getNextZIndex(nextCards),
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
