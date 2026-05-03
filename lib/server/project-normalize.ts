import type {
  DetailsImage,
  DetailsTable,
  DetailsTextBox,
  ProjectSnapshot,
  QuestionCard,
  StudyCategory,
  StudySection,
} from "@/lib/types";

const FIXED_SECTIONS = [
  ["definitions", "Definiciones"],
  ["theorems", "Teoremas"],
  ["exams", "Parciales"],
] as const;

type RawProjectSnapshot = Partial<Omit<ProjectSnapshot, "version">> & {
  version?: number;
};

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

function withAssetPreviewUrl<T extends { path: string; previewUrl?: string }>(asset: T): T {
  if (asset.previewUrl || !asset.path) {
    return asset;
  }

  return {
    ...asset,
    previewUrl: `/${asset.path.replace(/\\/g, "/").replace(/^\/+/, "")}`,
  };
}

function normalizeCards(value: unknown) {
  const cards = value && typeof value === "object" ? (value as Record<string, QuestionCard>) : {};

  return Object.fromEntries(
    Object.entries(cards).map(([cardId, card]) => [
      cardId,
      {
        ...card,
        id: card.id || cardId,
        text: typeof card.text === "string" ? card.text : "",
        detailsText: typeof card.detailsText === "string" ? card.detailsText : "",
        detailsTable: normalizeDetailsTable(card.detailsTable),
        detailsImages: normalizeDetailsImages(card.detailsImages).map(withAssetPreviewUrl),
        detailsTextBoxes: normalizeDetailsTextBoxes(card.detailsTextBoxes),
        image: card.image
          ? withAssetPreviewUrl({
              path: card.image.path,
              mimeType: card.image.mimeType,
              name: card.image.name,
              width: card.image.width,
              height: card.image.height,
              previewUrl: card.image.previewUrl,
              pendingBlob: null,
            })
          : null,
      } satisfies QuestionCard,
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

export function normalizeProjectSnapshot(snapshot: RawProjectSnapshot): ProjectSnapshot {
  const timestamp = new Date().toISOString();
  const legacyCards = normalizeCards(snapshot.cards);
  const legacyCategoryId = "migrated";
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
    savedAt: typeof snapshot.savedAt === "string" && snapshot.savedAt ? snapshot.savedAt : timestamp,
  };
}
