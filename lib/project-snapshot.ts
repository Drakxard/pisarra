import {
  FIXED_SECTION_IDS,
  type CardPosition,
  type CardSize,
  type DetailsImage,
  type DetailsTable,
  type DetailsTextBox,
  type ExerciseReferenceItem,
  type ExcalidrawSceneState,
  type LegacyNodeDetails,
  type LegacyQuestionCard,
  type LegacyStudyCategory,
  type LegacyStudySection,
  type MapNodeMeta,
  type PersistedExcalidrawAppState,
  type ProjectSnapshot,
  type QuestionCardImage,
  type StudyCategory,
  type StudyMap,
  type StudySectionId,
} from "@/lib/types";
import { generateNKeysBetween, generateKeyBetween } from "fractional-indexing";

const DEFAULT_VIEW_BACKGROUND = "#f3dfc1";
const DEFAULT_STROKE = "#4f3c2c";
const DEFAULT_SURFACE = "#fff9ef";
const DEFAULT_TEXT = "#1a1a1a";
const DEFAULT_FONT_SIZE = 24;
const DEFAULT_LINE_HEIGHT = 1.25 as number & { _brand: "unitlessLineHeight" };
const LEGACY_SNAPSHOT_VERSIONS = new Set([2, 3, 4, 5, 6]);

const SECTION_LABELS: Record<StudySectionId, string> = {
  definitions: "Definiciones",
  theorems: "Teoremas",
  exams: "Parciales",
  exercises: "Ejercicios",
};

type RawProjectSnapshot = Partial<Omit<ProjectSnapshot, "version">> & {
  version?: number;
  categories?: Record<string, unknown>;
  cards?: Record<string, unknown>;
  selectedCardId?: string | null;
  draftText?: string;
  detailsTextBoxStyleDefaults?: unknown;
};

type SceneNodeElementIds = {
  elementId: string;
  labelElementId: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function createTimestamp() {
  return new Date().toISOString();
}

function createElementUpdatedAt(dateString?: string) {
  const parsed = dateString ? Date.parse(dateString) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function hasValidElementIndex(value: unknown) {
  if (typeof value !== "string" || !value) {
    return false;
  }

  try {
    generateKeyBetween(value, null);
    return true;
  } catch {
    return false;
  }
}

export function createOrderedElementIndices(count: number) {
  if (count <= 0) {
    return [] as string[];
  }

  return generateNKeysBetween(null, null, count);
}

function getOrderedElementIndicesSlice(start: number, count: number) {
  if (count <= 0) {
    return [] as string[];
  }

  return createOrderedElementIndices(start + count).slice(start, start + count);
}

function normalizeElementIndices<T extends ExcalidrawSceneState["elements"][number]>(elements: T[]) {
  if (elements.every((element) => hasValidElementIndex(element.index))) {
    return elements;
  }

  const normalizedIndices = createOrderedElementIndices(elements.length);

  return elements.map((element, index) => ({
    ...element,
    index: normalizedIndices[index],
  }));
}

function clampNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePosition(value: unknown, fallback: CardPosition = { x: 0, y: 0 }): CardPosition {
  const source = asRecord(value);
  return {
    x: Math.round(clampNumber(source.x, fallback.x)),
    y: Math.round(clampNumber(source.y, fallback.y)),
  };
}

function normalizeSize(value: unknown, fallback: CardSize = { width: 320, height: 160 }): CardSize {
  const source = asRecord(value);
  return {
    width: Math.max(180, Math.round(clampNumber(source.width, fallback.width))),
    height: Math.max(96, Math.round(clampNumber(source.height, fallback.height))),
  };
}

function normalizeQuestionCardImage(value: unknown): QuestionCardImage | null {
  const source = asRecord(value);

  if (!source.path || !source.mimeType || !source.name) {
    return null;
  }

  return {
    path: String(source.path),
    mimeType: String(source.mimeType),
    name: String(source.name),
    width: typeof source.width === "number" ? source.width : undefined,
    height: typeof source.height === "number" ? source.height : undefined,
    previewUrl: typeof source.previewUrl === "string" ? source.previewUrl : undefined,
    pendingBlob: null,
  };
}

function normalizeDetailsTable(value: unknown): DetailsTable | null {
  const source = asRecord(value);
  const rawCells = Array.isArray(source.cells) ? source.cells : [];
  const cells = rawCells
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
    .filter((row) => row.length > 0);

  if (cells.length === 0) {
    return null;
  }

  const columnCount = Math.max(...cells.map((row) => row.length));

  return {
    cells: cells.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? "")),
    columnWidths: Array.from({ length: columnCount }, (_, index) =>
      Math.max(72, Math.round(clampNumber((source.columnWidths as unknown[] | undefined)?.[index], 160))),
    ),
    rowHeights: Array.from({ length: cells.length }, (_, index) =>
      Math.max(36, Math.round(clampNumber((source.rowHeights as unknown[] | undefined)?.[index], 48))),
    ),
    x: Math.max(0, Math.round(clampNumber(source.x, 24))),
    y: Math.max(0, Math.round(clampNumber(source.y, 220))),
    insertedAfterText: source.insertedAfterText !== false,
  };
}

function normalizeDetailsImages(value: unknown): DetailsImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const source = asRecord(entry);

    if (!source.id || !source.path || !source.mimeType || !source.name) {
      return [];
    }

    return [
      {
        id: String(source.id),
        path: String(source.path),
        mimeType: String(source.mimeType),
        name: String(source.name),
        x: clampNumber(source.x, 0),
        y: clampNumber(source.y, 0),
        width: Math.max(60, clampNumber(source.width, 320)),
        height: Math.max(60, clampNumber(source.height, 220)),
        rotation: clampNumber(source.rotation, 0),
        previewUrl: typeof source.previewUrl === "string" ? source.previewUrl : undefined,
        pendingBlob: null,
      },
    ];
  });
}

function normalizeDetailsTextBoxes(value: unknown): DetailsTextBox[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const source = asRecord(entry);

    if (!source.id) {
      return [];
    }

    return [
      {
        id: String(source.id),
        text: typeof source.text === "string" ? source.text : "",
        richText: typeof source.richText === "string" ? source.richText : null,
        x: clampNumber(source.x, 0),
        y: clampNumber(source.y, 0),
        width: Math.max(120, clampNumber(source.width, 260)),
        height: Math.max(60, clampNumber(source.height, 120)),
        fontSize:
          source.fontSize === "medium" ||
          source.fontSize === "large" ||
          source.fontSize === "xlarge" ||
          source.fontSize === "huge"
            ? source.fontSize
            : "small",
        color: typeof source.color === "string" ? source.color : "#111111",
        bold: source.bold === true,
        strike: source.strike === true,
        bulleted: source.bulleted === true,
        align: source.align === "center" || source.align === "right" ? source.align : "left",
        linkUrl: typeof source.linkUrl === "string" ? source.linkUrl : null,
      },
    ];
  });
}

function normalizeExerciseReferences(value: unknown): ExerciseReferenceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const source = asRecord(entry);

    if (
      !source.id ||
      (source.sourceSectionId !== "definitions" && source.sourceSectionId !== "theorems") ||
      !source.sourceCardId
    ) {
      return [];
    }

    return [
      {
        id: String(source.id),
        sourceSectionId: source.sourceSectionId,
        sourceCardId: String(source.sourceCardId),
        x: clampNumber(source.x, 0),
        y: clampNumber(source.y, 0),
        width: Math.max(96, clampNumber(source.width, 192)),
        height: Math.max(64, clampNumber(source.height, 132)),
        createdAt: typeof source.createdAt === "string" ? source.createdAt : createTimestamp(),
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : createTimestamp(),
      },
    ];
  });
}

function normalizeLegacyDetails(card: LegacyQuestionCard): LegacyNodeDetails | null {
  const details: LegacyNodeDetails = {
    detailsTable: card.detailsTable ?? null,
    detailsImages: card.detailsImages ?? [],
    detailsTextBoxes: card.detailsTextBoxes ?? [],
    exerciseReferences: card.exerciseReferences ?? [],
  };

  return details.detailsTable ||
    (details.detailsImages?.length ?? 0) > 0 ||
    (details.detailsTextBoxes?.length ?? 0) > 0 ||
    (details.exerciseReferences?.length ?? 0) > 0
    ? details
    : null;
}

function normalizeLegacyCard(cardId: string, value: unknown): LegacyQuestionCard {
  const source = asRecord(value);
  const timestamp = createTimestamp();

  return {
    id: typeof source.id === "string" && source.id ? source.id : cardId,
    text: typeof source.text === "string" ? source.text : "",
    detailsText: typeof source.detailsText === "string" ? source.detailsText : "",
    detailsTable: normalizeDetailsTable(source.detailsTable),
    detailsImages: normalizeDetailsImages(source.detailsImages),
    detailsTextBoxes: normalizeDetailsTextBoxes(source.detailsTextBoxes),
    exerciseReferences: normalizeExerciseReferences(source.exerciseReferences),
    image: normalizeQuestionCardImage(source.image),
    position: normalizePosition(source.position),
    size: normalizeSize(source.size),
    zIndex: Math.max(1, Math.round(clampNumber(source.zIndex, 1))),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : timestamp,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : timestamp,
  };
}

function normalizeLegacySection(sectionId: StudySectionId, value: unknown): LegacyStudySection {
  const source = asRecord(value);
  const timestamp = createTimestamp();
  const cards = Object.fromEntries(
    Object.entries(asRecord(source.cards)).map(([cardId, card]) => [cardId, normalizeLegacyCard(cardId, card)]),
  );

  return {
    id: typeof source.id === "string" && source.id ? source.id : sectionId,
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : SECTION_LABELS[sectionId],
    cards,
    selectedCardId:
      typeof source.selectedCardId === "string" && cards[source.selectedCardId] ? source.selectedCardId : null,
    draftText: typeof source.draftText === "string" ? source.draftText : "",
    createdAt: typeof source.createdAt === "string" ? source.createdAt : timestamp,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : timestamp,
  };
}

function buildRootMapId(categoryId: string, kind: "main" | StudySectionId) {
  return kind === "main" ? `${categoryId}::main` : `${categoryId}::section::${kind}`;
}

function buildChildMapId(nodeId: string) {
  return `${nodeId}::child-map`;
}

function buildNodeElementIds(nodeId: string): SceneNodeElementIds {
  return {
    elementId: `${nodeId}::container`,
    labelElementId: `${nodeId}::label`,
  };
}

function estimateTextBounds(text: string, fontSize = DEFAULT_FONT_SIZE) {
  const lines = text.split(/\r?\n/);
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 1);

  return {
    width: Math.max(72, Math.round(longestLine * fontSize * 0.58)),
    height: Math.max(fontSize * 1.25, Math.round(lines.length * fontSize * 1.25)),
  };
}

function createEmptySceneState(): ExcalidrawSceneState {
  return {
    elements: [],
    appState: {
      scrollX: 0,
      scrollY: 0,
      zoom: {
        value: 1,
      },
      viewBackgroundColor: DEFAULT_VIEW_BACKGROUND,
      theme: "light",
      gridSize: null,
    },
    files: {},
  };
}

export function createEmptyMap(args: {
  id: string;
  title: string;
  kind: StudyMap["kind"];
  parentMapId?: string | null;
  parentNodeId?: string | null;
  rootSectionId?: StudySectionId | null;
  contentInitializedAt?: string | null;
  createdAt?: string;
}): StudyMap {
  const timestamp = args.createdAt ?? createTimestamp();

  return {
    id: args.id,
    title: args.title,
    kind: args.kind,
    parentMapId: args.parentMapId ?? null,
    parentNodeId: args.parentNodeId ?? null,
    rootSectionId: args.rootSectionId ?? null,
    contentInitializedAt: args.contentInitializedAt ?? null,
    nodes: {},
    scene: createEmptySceneState(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createNodeSceneElements(args: {
  nodeId: string;
  label: string;
  position: CardPosition;
  size?: CardSize;
  groupId?: string;
  createdAt?: string;
  order?: number;
}): ExcalidrawSceneState["elements"] {
  const label = args.label.trim() || "Nueva tarjeta";
  const timestamp = createElementUpdatedAt(args.createdAt);
  const size = args.size ?? { width: 320, height: 160 };
  const textBounds = estimateTextBounds(label);
  const groupId = args.groupId ?? `${args.nodeId}::group`;
  const { elementId, labelElementId } = buildNodeElementIds(args.nodeId);
  const [containerIndex, labelIndex] = getOrderedElementIndicesSlice((args.order ?? 0) * 2, 2);

  return [
    {
      id: elementId,
      type: "rectangle",
      x: args.position.x,
      y: args.position.y,
      width: size.width,
      height: size.height,
      strokeColor: DEFAULT_STROKE,
      backgroundColor: DEFAULT_SURFACE,
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roundness: null,
      roughness: 0,
      opacity: 100,
      angle: 0,
      seed: Math.floor(Math.random() * 10_000_000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 10_000_000),
      index: containerIndex,
      isDeleted: false,
      groupIds: [groupId],
      frameId: null,
      boundElements: [
        {
          id: labelElementId,
          type: "text",
        },
      ],
      updated: timestamp,
      link: null,
      locked: false,
      customData: {
        nodeId: args.nodeId,
        role: "map-card-container",
      },
    },
    {
      id: labelElementId,
      type: "text",
      x: args.position.x + Math.max(24, (size.width - textBounds.width) / 2),
      y: args.position.y + Math.max(24, (size.height - textBounds.height) / 2),
      width: textBounds.width,
      height: textBounds.height,
      strokeColor: DEFAULT_TEXT,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roundness: null,
      roughness: 0,
      opacity: 100,
      angle: 0,
      seed: Math.floor(Math.random() * 10_000_000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 10_000_000),
      index: labelIndex,
      isDeleted: false,
      groupIds: [groupId],
      frameId: null,
      boundElements: null,
      updated: timestamp,
      link: null,
      locked: false,
      customData: {
        nodeId: args.nodeId,
        role: "map-card-label",
      },
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily: 1,
      text: label,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: elementId,
      originalText: label,
      autoResize: true,
      lineHeight: DEFAULT_LINE_HEIGHT,
    },
  ];
}

function migrateLegacyCardsToMap(args: {
  cards: Record<string, LegacyQuestionCard>;
  categoryId: string;
  mapId: string;
  title: string;
  kind: StudyMap["kind"];
  createdAt: string;
  parentMapId?: string | null;
  parentNodeId?: string | null;
  rootSectionId?: StudySectionId | null;
}): { map: StudyMap; childMaps: Record<string, StudyMap> } {
  const map = createEmptyMap({
    id: args.mapId,
    title: args.title,
    kind: args.kind,
    createdAt: args.createdAt,
    parentMapId: args.parentMapId ?? null,
    parentNodeId: args.parentNodeId ?? null,
    rootSectionId: args.rootSectionId ?? null,
  });
  const childMaps: Record<string, StudyMap> = {};
  const orderedCards = Object.values(args.cards).sort((left, right) => {
    if (left.zIndex !== right.zIndex) {
      return left.zIndex - right.zIndex;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });

  const elements = orderedCards.flatMap((card, index) => {
    const childMapId = buildChildMapId(card.id);
    const { elementId, labelElementId } = buildNodeElementIds(card.id);
    const label = card.text.trim() || "Tarjeta sin titulo";

    map.nodes[card.id] = {
      nodeId: card.id,
      elementId,
      labelElementId,
      label,
      childMapId,
      note: card.detailsText,
      image: card.image,
      legacyDetails: normalizeLegacyDetails(card),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };

    childMaps[childMapId] = createEmptyMap({
      id: childMapId,
      title: label,
      kind: "child",
      createdAt: card.createdAt,
      parentMapId: args.mapId,
      parentNodeId: card.id,
    });

    return createNodeSceneElements({
      nodeId: card.id,
      label,
      position: card.position,
      size: card.size,
      createdAt: card.createdAt,
      order: index,
    });
  });

  map.scene.elements = elements;
  return { map, childMaps };
}

export function serializeSceneAppState(appState: Partial<PersistedExcalidrawAppState> | undefined | null) {
  return {
    scrollX: clampNumber(appState?.scrollX, 0),
    scrollY: clampNumber(appState?.scrollY, 0),
    zoom: {
      value: clampNumber(appState?.zoom?.value, 1),
    },
    viewBackgroundColor:
      typeof appState?.viewBackgroundColor === "string" && appState.viewBackgroundColor
        ? appState.viewBackgroundColor
        : DEFAULT_VIEW_BACKGROUND,
    theme: appState?.theme === "dark" ? "dark" : "light",
    gridSize: appState?.gridSize ?? null,
  } satisfies PersistedExcalidrawAppState;
}

function normalizeBinaryFiles(value: unknown): ExcalidrawSceneState["files"] {
  const source = asRecord(value);
  const files: ExcalidrawSceneState["files"] = {};

  for (const [fileId, rawFile] of Object.entries(source)) {
    const file = asRecord(rawFile);

    if (!fileId || typeof file.mimeType !== "string" || typeof file.dataURL !== "string") {
      continue;
    }

    files[fileId] = {
      id: fileId as never,
      mimeType: file.mimeType as never,
      dataURL: file.dataURL as never,
      created: Math.max(0, clampNumber(file.created, Date.now())),
      lastRetrieved: typeof file.lastRetrieved === "number" ? file.lastRetrieved : undefined,
      version: typeof file.version === "number" ? file.version : undefined,
    };
  }

  return files;
}

function normalizeSceneElements(value: unknown): ExcalidrawSceneState["elements"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const elements = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    return [entry as ExcalidrawSceneState["elements"][number]];
  });

  return normalizeElementIndices(elements);
}

function normalizeNodeMeta(nodeId: string, value: unknown): MapNodeMeta | null {
  const source = asRecord(value);

  if (!source.childMapId || !source.elementId || !source.labelElementId) {
    return null;
  }

  return {
    nodeId,
    elementId: String(source.elementId),
    labelElementId: String(source.labelElementId),
    label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : "Tarjeta sin titulo",
    childMapId: String(source.childMapId),
    note: typeof source.note === "string" ? source.note : "",
    image: normalizeQuestionCardImage(source.image),
    legacyDetails: source.legacyDetails && typeof source.legacyDetails === "object"
      ? {
          detailsTable: normalizeDetailsTable(asRecord(source.legacyDetails).detailsTable),
          detailsImages: normalizeDetailsImages(asRecord(source.legacyDetails).detailsImages),
          detailsTextBoxes: normalizeDetailsTextBoxes(asRecord(source.legacyDetails).detailsTextBoxes),
          exerciseReferences: normalizeExerciseReferences(asRecord(source.legacyDetails).exerciseReferences),
        }
      : null,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : createTimestamp(),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : createTimestamp(),
  };
}

function normalizeStudyMap(mapId: string, value: unknown): StudyMap {
  const source = asRecord(value);
  const timestamp = createTimestamp();
  const nodes = Object.fromEntries(
    Object.entries(asRecord(source.nodes)).flatMap(([nodeId, node]) => {
      const normalized = normalizeNodeMeta(nodeId, node);
      return normalized ? [[nodeId, normalized] as const] : [];
    }),
  );

  return {
    id: typeof source.id === "string" && source.id ? source.id : mapId,
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : "Mapa",
    kind: source.kind === "section" || source.kind === "child" ? source.kind : "main",
    parentMapId: typeof source.parentMapId === "string" ? source.parentMapId : null,
    parentNodeId: typeof source.parentNodeId === "string" ? source.parentNodeId : null,
    rootSectionId: FIXED_SECTION_IDS.includes(source.rootSectionId as StudySectionId)
      ? (source.rootSectionId as StudySectionId)
      : null,
    contentInitializedAt:
      typeof source.contentInitializedAt === "string" && source.contentInitializedAt
        ? source.contentInitializedAt
        : null,
    nodes,
    scene: {
      elements: normalizeSceneElements(asRecord(source.scene).elements),
      appState: serializeSceneAppState(asRecord(source.scene).appState as PersistedExcalidrawAppState),
      files: normalizeBinaryFiles(asRecord(source.scene).files),
    },
    createdAt: typeof source.createdAt === "string" ? source.createdAt : timestamp,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : timestamp,
  };
}

export function createEmptyCategory(id: string, name: string, createdAt = createTimestamp()): StudyCategory {
  const mainMapId = buildRootMapId(id, "main");
  const sectionMapIds = Object.fromEntries(
    FIXED_SECTION_IDS.map((sectionId) => [sectionId, buildRootMapId(id, sectionId)]),
  ) as Record<StudySectionId, string>;
  const maps: Record<string, StudyMap> = {
    [mainMapId]: createEmptyMap({
      id: mainMapId,
      title: name,
      kind: "main",
      createdAt,
    }),
  };

  for (const sectionId of FIXED_SECTION_IDS) {
    maps[sectionMapIds[sectionId]] = createEmptyMap({
      id: sectionMapIds[sectionId],
      title: SECTION_LABELS[sectionId],
      kind: "section",
      rootSectionId: sectionId,
      createdAt,
    });
  }

  return {
    id,
    name,
    maps,
    mainMapId,
    sectionMapIds,
    createdAt,
    updatedAt: createdAt,
  };
}

function migrateLegacyCategory(categoryId: string, value: unknown): StudyCategory {
  const source = asRecord(value);
  const timestamp = typeof source.createdAt === "string" ? source.createdAt : createTimestamp();
  const category = createEmptyCategory(
    categoryId,
    typeof source.name === "string" && source.name.trim() ? source.name.trim() : "Sin nombre",
    timestamp,
  );
  const mainCards = Object.fromEntries(
    Object.entries(asRecord(source.cards)).map(([cardId, card]) => [cardId, normalizeLegacyCard(cardId, card)]),
  );
  const mainResult = migrateLegacyCardsToMap({
    cards: mainCards,
    categoryId,
    mapId: category.mainMapId,
    title: category.name,
    kind: "main",
    createdAt: timestamp,
  });

  category.maps[category.mainMapId] = mainResult.map;

  for (const [mapId, map] of Object.entries(mainResult.childMaps)) {
    category.maps[mapId] = map;
  }

  const sectionsSource = asRecord(source.sections);

  for (const sectionId of FIXED_SECTION_IDS) {
    const section = normalizeLegacySection(sectionId, sectionsSource[sectionId]);
    const result = migrateLegacyCardsToMap({
      cards: section.cards,
      categoryId,
      mapId: category.sectionMapIds[sectionId],
      title: section.name,
      kind: "section",
      createdAt: section.createdAt,
      rootSectionId: sectionId,
    });

    category.maps[category.sectionMapIds[sectionId]] = result.map;

    for (const [mapId, map] of Object.entries(result.childMaps)) {
      category.maps[mapId] = map;
    }
  }

  category.updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : timestamp;
  return category;
}

function normalizeStudyCategory(categoryId: string, value: unknown): StudyCategory {
  const source = asRecord(value);
  const isV7Category =
    source.maps && source.mainMapId && source.sectionMapIds && typeof source.mainMapId === "string";

  if (!isV7Category) {
    return migrateLegacyCategory(categoryId, value);
  }

  const createdAt = typeof source.createdAt === "string" ? source.createdAt : createTimestamp();
  const base = createEmptyCategory(
    typeof source.id === "string" && source.id ? source.id : categoryId,
    typeof source.name === "string" && source.name.trim() ? source.name.trim() : "Sin nombre",
    createdAt,
  );
  const mapsSource = asRecord(source.maps);

  base.maps = Object.fromEntries(
    Object.entries(mapsSource).map(([mapId, map]) => [mapId, normalizeStudyMap(mapId, map)]),
  );
  base.mainMapId =
    typeof source.mainMapId === "string" && base.maps[source.mainMapId] ? source.mainMapId : base.mainMapId;

  for (const sectionId of FIXED_SECTION_IDS) {
    const rawSectionMapId = asRecord(source.sectionMapIds)[sectionId];
    const sectionMapId =
      typeof rawSectionMapId === "string" && base.maps[rawSectionMapId]
        ? rawSectionMapId
        : buildRootMapId(base.id, sectionId);

    base.sectionMapIds[sectionId] = sectionMapId;

    if (!base.maps[sectionMapId]) {
      base.maps[sectionMapId] = createEmptyMap({
        id: sectionMapId,
        title: SECTION_LABELS[sectionId],
        kind: "section",
        rootSectionId: sectionId,
        createdAt,
      });
    }
  }

  if (!base.maps[base.mainMapId]) {
    base.maps[base.mainMapId] = createEmptyMap({
      id: base.mainMapId,
      title: base.name,
      kind: "main",
      createdAt,
    });
  }

  base.updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : createdAt;
  return base;
}

export function createEmptyProjectSnapshot(): ProjectSnapshot {
  return {
    version: 7,
    categories: {},
    selectedCategoryId: null,
    categoryDraftText: "",
    activeCategoryId: null,
    activeMapId: null,
    savedAt: createTimestamp(),
  };
}

export function normalizeProjectSnapshot(snapshot: RawProjectSnapshot): ProjectSnapshot {
  const version = typeof snapshot.version === "number" ? snapshot.version : null;

  if (version !== 7 && !LEGACY_SNAPSHOT_VERSIONS.has(version ?? -1)) {
    return createEmptyProjectSnapshot();
  }

  const timestamp = typeof snapshot.savedAt === "string" && snapshot.savedAt ? snapshot.savedAt : createTimestamp();
  const legacyCards = asRecord(snapshot.cards);
  const categoriesSource =
    snapshot.categories && Object.keys(snapshot.categories).length > 0
      ? snapshot.categories
      : legacyCards
        ? {
            migrated: {
              id: "migrated",
              name: "Sin nombre",
              cards: legacyCards,
              sections: {},
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          }
        : {};
  const categories = Object.fromEntries(
    Object.entries(categoriesSource).map(([categoryId, category]) => [
      categoryId,
      normalizeStudyCategory(categoryId, category),
    ]),
  );
  const selectedCategoryId =
    typeof snapshot.selectedCategoryId === "string" && categories[snapshot.selectedCategoryId]
      ? snapshot.selectedCategoryId
      : Object.keys(categories)[0] ?? null;
  const activeCategoryId =
    typeof snapshot.activeCategoryId === "string" && categories[snapshot.activeCategoryId]
      ? snapshot.activeCategoryId
      : null;
  const activeMapId =
    activeCategoryId &&
    typeof snapshot.activeMapId === "string" &&
    categories[activeCategoryId]?.maps[snapshot.activeMapId]
      ? snapshot.activeMapId
      : null;

  return {
    version: 7,
    categories,
    selectedCategoryId,
    categoryDraftText: typeof snapshot.categoryDraftText === "string" ? snapshot.categoryDraftText : "",
    activeCategoryId,
    activeMapId,
    savedAt: timestamp,
  };
}

export function getSectionLabel(sectionId: StudySectionId) {
  return SECTION_LABELS[sectionId];
}

export function getNodeElementIds(nodeId: string) {
  return buildNodeElementIds(nodeId);
}

export function getDefaultViewBackground() {
  return DEFAULT_VIEW_BACKGROUND;
}
