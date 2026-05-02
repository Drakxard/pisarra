"use client";

import { create } from "zustand";
import { buildImageAssetPath } from "@/lib/project-persistence";
import type {
  CardPosition,
  CardSize,
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

function cloneCard(card: QuestionCard): QuestionCard {
  return {
    ...card,
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

function revokeCardImageUrls(cards: Record<string, QuestionCard>) {
  for (const card of Object.values(cards)) {
    if (card.image?.previewUrl) {
      URL.revokeObjectURL(card.image.previewUrl);
    }
  }
}

function disposeUndoSnapshot(snapshot: UndoSnapshot | null) {
  if (!snapshot) {
    return;
  }

  revokeCardImageUrls(snapshot.cards);
  revokeDraftImageUrl(snapshot.draftImage);
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
    version: 2,
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
    disposeUndoSnapshot(lastDeletionSnapshot);
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

    disposeUndoSnapshot(lastDeletionSnapshot);
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
    revokeCardImageUrls(currentState.cards);
    revokeDraftImageUrl(currentState.draftImage);
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
    disposeUndoSnapshot(lastDeletionSnapshot);
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
      version: 2,
      cards: Object.fromEntries(
        Object.entries(cards).map(([cardId, card]) => [cardId, createPersistedCard(card)]),
      ),
      selectedCardId: selectedCardId && cards[selectedCardId] ? selectedCardId : null,
      draftText,
      savedAt: get().snapshotUpdatedAt,
    };
  },
  getPendingImageAssets: () => {
    return Object.values(get().cards)
      .filter((card) => card.image?.pendingBlob)
      .map((card) => ({
        cardId: card.id,
        path: card.image!.path,
        blob: card.image!.pendingBlob!,
      }));
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

      if (!card?.image?.pendingBlob) {
        continue;
      }

      nextCards[cardId] = {
        ...card,
        image: {
          ...card.image,
          pendingBlob: null,
        },
      };
      hasChanged = true;
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
    revokeCardImageUrls(currentState.cards);
    revokeDraftImageUrl(currentState.draftImage);
    disposeUndoSnapshot(lastDeletionSnapshot);
    lastDeletionSnapshot = null;

    const normalized = normalizeProjectSnapshot(snapshot);

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
    revokeCardImageUrls(currentState.cards);
    revokeDraftImageUrl(currentState.draftImage);
    disposeUndoSnapshot(lastDeletionSnapshot);
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
