"use client";

import { create } from "zustand";
import {
  createEmptyCategory,
  createEmptyMap,
  createEmptyProjectSnapshot,
  createNodeSceneElements,
  getNodeElementIds,
  normalizeProjectSnapshot,
  serializeSceneAppState,
} from "@/lib/project-snapshot";
import { buildNodeImageAssetPath } from "@/lib/project-persistence";
import type {
  ExcalidrawSceneState,
  MapNodeMeta,
  PendingImageAsset,
  ProjectSnapshot,
  QuestionCardImage,
  StudyCategory,
  StudyMap,
  StudySectionId,
} from "@/lib/types";

type NodeImageDraft = {
  blob: Blob;
  previewUrl: string;
  mimeType: string;
  name: string;
  width?: number;
  height?: number;
};

type TreeStore = {
  categories: Record<string, StudyCategory>;
  selectedCategoryId: string | null;
  categoryDraftText: string;
  activeCategoryId: string | null;
  activeMapId: string | null;
  selectedNodeId: string | null;
  snapshotUpdatedAt: string;
  createCategory: (name: string) => string | null;
  renameCategory: (categoryId: string, name: string) => void;
  selectCategory: (categoryId: string | null) => void;
  setCategoryDraftText: (value: string) => void;
  openMainCategoryMap: (categoryId: string) => void;
  openCategorySection: (categoryId: string, sectionId: StudySectionId) => void;
  openMap: (categoryId: string, mapId: string, nodeId?: string | null) => void;
  openNodeChildMap: (nodeId: string) => void;
  goToParentMap: () => void;
  closeActiveMap: () => void;
  selectNode: (nodeId: string | null) => void;
  createMapNode: (label: string, placement?: { x: number; y: number }) => string | null;
  updateNodeLabel: (nodeId: string, label: string) => void;
  updateNodeNote: (nodeId: string, note: string) => void;
  setNodeImage: (nodeId: string, image: NodeImageDraft) => void;
  clearNodeImage: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  setMapScene: (scene: ExcalidrawSceneState) => void;
  getProjectSnapshot: () => ProjectSnapshot;
  getPendingImageAssets: () => PendingImageAsset[];
  markNodeImagesPersisted: (nodeIds: string[]) => void;
  loadProjectSnapshot: (snapshot: ProjectSnapshot) => void;
  mergeRemoteProjectSnapshot: (snapshot: ProjectSnapshot) => void;
  resetProject: () => void;
};

function createSnapshotTimestamp() {
  return new Date().toISOString();
}

function normalizeText(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function getNumericElementField(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cloneImage(image: QuestionCardImage | null): QuestionCardImage | null {
  if (!image) {
    return null;
  }

  return {
    ...image,
    pendingBlob: image.pendingBlob ?? null,
  };
}

function cloneNode(node: MapNodeMeta): MapNodeMeta {
  return {
    ...node,
    image: cloneImage(node.image),
    legacyDetails: node.legacyDetails
      ? {
          detailsTable: node.legacyDetails.detailsTable
            ? {
                ...node.legacyDetails.detailsTable,
                cells: node.legacyDetails.detailsTable.cells.map((row) => [...row]),
                columnWidths: [...node.legacyDetails.detailsTable.columnWidths],
                rowHeights: [...node.legacyDetails.detailsTable.rowHeights],
              }
            : null,
          detailsImages: node.legacyDetails.detailsImages?.map((image) => ({ ...image, pendingBlob: null })) ?? [],
          detailsTextBoxes: node.legacyDetails.detailsTextBoxes?.map((textBox) => ({ ...textBox })) ?? [],
          exerciseReferences:
            node.legacyDetails.exerciseReferences?.map((reference) => ({ ...reference })) ?? [],
        }
      : null,
  };
}

function cloneScene(scene: ExcalidrawSceneState): ExcalidrawSceneState {
  return {
    elements: scene.elements.map((element) => ({ ...element })),
    appState: serializeSceneAppState(scene.appState),
    files: Object.fromEntries(Object.entries(scene.files).map(([fileId, file]) => [fileId, { ...file }])),
  };
}

function areScenesEqual(left: ExcalidrawSceneState, right: ExcalidrawSceneState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneMap(map: StudyMap): StudyMap {
  return {
    ...map,
    nodes: Object.fromEntries(Object.entries(map.nodes).map(([nodeId, node]) => [nodeId, cloneNode(node)])),
    scene: cloneScene(map.scene),
  };
}

function cloneCategory(category: StudyCategory): StudyCategory {
  return {
    ...category,
    maps: Object.fromEntries(Object.entries(category.maps).map(([mapId, map]) => [mapId, cloneMap(map)])),
  };
}

function cloneCategories(categories: Record<string, StudyCategory>) {
  return Object.fromEntries(
    Object.entries(categories).map(([categoryId, category]) => [categoryId, cloneCategory(category)]),
  );
}

function revokeImageUrl(image: QuestionCardImage | null) {
  if (image?.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

function collectImagePreviewUrls(categories: Record<string, StudyCategory>) {
  return new Set(
    Object.values(categories)
      .flatMap((category) =>
        Object.values(category.maps).flatMap((map) =>
          Object.values(map.nodes).map((node) => node.image?.previewUrl).filter(Boolean),
        ),
      )
      .filter((value): value is string => Boolean(value)),
  );
}

function revokeUnusedImageUrls(
  previousCategories: Record<string, StudyCategory>,
  nextCategories: Record<string, StudyCategory>,
) {
  const nextUrls = collectImagePreviewUrls(nextCategories);

  for (const url of collectImagePreviewUrls(previousCategories)) {
    if (!nextUrls.has(url) && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
}

function createEmptyState() {
  const snapshot = createEmptyProjectSnapshot();

  return {
    categories: snapshot.categories,
    selectedCategoryId: snapshot.selectedCategoryId,
    categoryDraftText: snapshot.categoryDraftText,
    activeCategoryId: snapshot.activeCategoryId,
    activeMapId: snapshot.activeMapId,
    selectedNodeId: null,
    snapshotUpdatedAt: snapshot.savedAt,
  };
}

function getActiveCategory(state: TreeStore | ReturnType<typeof createEmptyState>) {
  return state.activeCategoryId ? state.categories[state.activeCategoryId] ?? null : null;
}

function getActiveMap(state: TreeStore | ReturnType<typeof createEmptyState>) {
  const category = getActiveCategory(state);
  return category && state.activeMapId ? category.maps[state.activeMapId] ?? null : null;
}

function updateNodeSceneLabel(map: StudyMap, node: MapNodeMeta, label: string) {
  const textBoundsWidth = Math.max(72, Math.round(label.length * 24 * 0.58));

  map.scene.elements = map.scene.elements.map((element) => {
    if (element.id !== node.labelElementId || element.type !== "text") {
      return element;
    }

    return {
      ...element,
      text: label,
      originalText: label,
      width: textBoundsWidth,
      version: getNumericElementField(element.version, 1) + 1,
      versionNonce: Math.floor(Math.random() * 10_000_000),
      updated: Date.now(),
    };
  });
}

function updateNodeSelection(state: ReturnType<typeof createEmptyState>, nodeId: string | null) {
  return {
    ...state,
    selectedNodeId: nodeId,
  };
}

function recursivelyDeleteChildMaps(category: StudyCategory, mapId: string) {
  const map = category.maps[mapId];

  if (!map) {
    return;
  }

  for (const node of Object.values(map.nodes)) {
    recursivelyDeleteChildMaps(category, node.childMapId);
  }

  delete category.maps[mapId];
}

function deleteNodeFromCategory(category: StudyCategory, mapId: string, nodeId: string) {
  const map = category.maps[mapId];
  const node = map?.nodes[nodeId];

  if (!map || !node) {
    return false;
  }

  recursivelyDeleteChildMaps(category, node.childMapId);
  delete map.nodes[nodeId];
  map.scene.elements = map.scene.elements.filter(
    (element) => element.id !== node.elementId && element.id !== node.labelElementId,
  );
  map.updatedAt = createSnapshotTimestamp();
  category.updatedAt = map.updatedAt;
  return true;
}

function removeDeletedNodesFromMap(category: StudyCategory, mapId: string) {
  const map = category.maps[mapId];

  if (!map) {
    return [] as string[];
  }

  const liveElementIds = new Set(
    map.scene.elements.filter((element) => !element.isDeleted).map((element) => element.id),
  );
  const deletedNodeIds = Object.values(map.nodes)
    .filter((node) => !liveElementIds.has(node.elementId) || !liveElementIds.has(node.labelElementId))
    .map((node) => node.nodeId);

  for (const nodeId of deletedNodeIds) {
    deleteNodeFromCategory(category, mapId, nodeId);
  }

  return deletedNodeIds;
}

function syncNodeLabelsFromScene(map: StudyMap) {
  const labelElements = new Map(
    map.scene.elements
      .filter((element) => element.type === "text" && !element.isDeleted)
      .map((element) => [element.id, element]),
  );
  let updated = false;

  for (const node of Object.values(map.nodes)) {
    const element = labelElements.get(node.labelElementId);

    if (!element || element.type !== "text") {
      continue;
    }

    const nextLabel = typeof element.text === "string" && element.text.trim() ? element.text.trim() : node.label;

    if (nextLabel !== node.label) {
      node.label = nextLabel;
      node.updatedAt = createSnapshotTimestamp();
      updated = true;
    }
  }

  return updated;
}

function buildNodeImage(nodeId: string, image: NodeImageDraft): QuestionCardImage {
  return {
    path: buildNodeImageAssetPath(nodeId, image.mimeType),
    mimeType: image.mimeType,
    name: image.name,
    width: image.width,
    height: image.height,
    previewUrl: image.previewUrl,
    pendingBlob: image.blob,
  };
}

export const useTreeStore = create<TreeStore>((set, get) => ({
  ...createEmptyState(),
  createCategory: (name) => {
    const normalizedName = normalizeText(name);

    if (!normalizedName) {
      return null;
    }

    const id = crypto.randomUUID();
    const createdAt = createSnapshotTimestamp();
    const category = createEmptyCategory(id, normalizedName, createdAt);

    set((state) => ({
      categories: {
        ...cloneCategories(state.categories),
        [id]: category,
      },
      selectedCategoryId: id,
      categoryDraftText: "",
      snapshotUpdatedAt: createdAt,
    }));

    return id;
  },
  renameCategory: (categoryId, name) => {
    const normalizedName = normalizeText(name) || "Sin nombre";
    const state = get();
    const category = state.categories[categoryId];

    if (!category || category.name === normalizedName) {
      return;
    }

    const categories = cloneCategories(state.categories);
    const nextCategory = categories[categoryId];
    nextCategory.name = normalizedName;
    nextCategory.maps[nextCategory.mainMapId].title = normalizedName;
    nextCategory.updatedAt = createSnapshotTimestamp();

    set({
      categories,
      snapshotUpdatedAt: nextCategory.updatedAt,
    });
  },
  selectCategory: (categoryId) => {
    const { categories } = get();

    set({
      selectedCategoryId: categoryId && categories[categoryId] ? categoryId : null,
    });
  },
  setCategoryDraftText: (value) => {
    set({
      categoryDraftText: value,
    });
  },
  openMainCategoryMap: (categoryId) => {
    const state = get();
    const category = state.categories[categoryId];

    if (!category) {
      return;
    }

    set({
      activeCategoryId: categoryId,
      activeMapId: category.mainMapId,
      selectedCategoryId: categoryId,
      selectedNodeId: null,
    });
  },
  openCategorySection: (categoryId, sectionId) => {
    const state = get();
    const category = state.categories[categoryId];

    if (!category) {
      return;
    }

    set({
      activeCategoryId: categoryId,
      activeMapId: category.sectionMapIds[sectionId],
      selectedCategoryId: categoryId,
      selectedNodeId: null,
    });
  },
  openMap: (categoryId, mapId, nodeId = null) => {
    const state = get();
    const category = state.categories[categoryId];

    if (!category || !category.maps[mapId]) {
      return;
    }

    set({
      activeCategoryId: categoryId,
      activeMapId: mapId,
      selectedCategoryId: categoryId,
      selectedNodeId: nodeId,
    });
  },
  openNodeChildMap: (nodeId) => {
    const state = get();
    const category = getActiveCategory(state);
    const map = getActiveMap(state);
    const node = map?.nodes[nodeId];

    if (!category || !map || !node || !category.maps[node.childMapId]) {
      return;
    }

    set({
      activeCategoryId: category.id,
      activeMapId: node.childMapId,
      selectedCategoryId: category.id,
      selectedNodeId: null,
    });
  },
  goToParentMap: () => {
    const state = get();
    const category = getActiveCategory(state);
    const map = getActiveMap(state);

    if (!category || !map?.parentMapId) {
      return;
    }

    set({
      activeCategoryId: category.id,
      activeMapId: map.parentMapId,
      selectedCategoryId: category.id,
      selectedNodeId: map.parentNodeId,
    });
  },
  closeActiveMap: () => {
    set({
      activeCategoryId: null,
      activeMapId: null,
      selectedNodeId: null,
    });
  },
  selectNode: (nodeId) => {
    const state = get();
    const map = getActiveMap(state);
    const nextSelectedNodeId = nodeId && map?.nodes[nodeId] ? nodeId : null;

    if (state.selectedNodeId === nextSelectedNodeId) {
      return;
    }

    set({
      selectedNodeId: nextSelectedNodeId,
    });
  },
  createMapNode: (label, placement) => {
    const normalizedLabel = normalizeText(label) || "Nuevo nodo";
    const state = get();
    const activeCategory = getActiveCategory(state);
    const activeMap = getActiveMap(state);

    if (!activeCategory || !activeMap) {
      return null;
    }

    const categories = cloneCategories(state.categories);
    const category = categories[activeCategory.id];
    const map = category.maps[activeMap.id];
    const nodeId = crypto.randomUUID();
    const childMapId = crypto.randomUUID();
    const timestamp = createSnapshotTimestamp();
    const position = placement ?? { x: 120, y: 120 };
    const nodeElementIds = getNodeElementIds(nodeId);

    map.nodes[nodeId] = {
      nodeId,
      elementId: nodeElementIds.elementId,
      labelElementId: nodeElementIds.labelElementId,
      label: normalizedLabel,
      childMapId,
      note: "",
      image: null,
      legacyDetails: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    map.scene.elements = [
      ...map.scene.elements.filter((element) => !element.isDeleted),
      ...createNodeSceneElements({
        nodeId,
        label: normalizedLabel,
        position,
        createdAt: timestamp,
        order: Object.keys(map.nodes).length,
      }),
    ];
    map.updatedAt = timestamp;
    category.maps[childMapId] = createEmptyMap({
      id: childMapId,
      title: normalizedLabel,
      kind: "child",
      parentMapId: map.id,
      parentNodeId: nodeId,
      createdAt: timestamp,
    });
    category.updatedAt = timestamp;

    set({
      categories,
      selectedNodeId: nodeId,
      snapshotUpdatedAt: timestamp,
    });

    return nodeId;
  },
  updateNodeLabel: (nodeId, label) => {
    const normalizedLabel = normalizeText(label) || "Sin titulo";
    const state = get();
    const activeCategory = getActiveCategory(state);
    const activeMap = getActiveMap(state);

    if (!activeCategory || !activeMap) {
      return;
    }

    const categories = cloneCategories(state.categories);
    const category = categories[activeCategory.id];
    const map = category.maps[activeMap.id];
    const node = map.nodes[nodeId];

    if (!node || node.label === normalizedLabel) {
      return;
    }

    const timestamp = createSnapshotTimestamp();
    node.label = normalizedLabel;
    node.updatedAt = timestamp;
    map.updatedAt = timestamp;
    category.updatedAt = timestamp;
    updateNodeSceneLabel(map, node, normalizedLabel);

    if (category.maps[node.childMapId]) {
      category.maps[node.childMapId].title = normalizedLabel;
      category.maps[node.childMapId].updatedAt = timestamp;
    }

    set({
      categories,
      snapshotUpdatedAt: timestamp,
    });
  },
  updateNodeNote: (nodeId, note) => {
    const state = get();
    const activeCategory = getActiveCategory(state);
    const activeMap = getActiveMap(state);

    if (!activeCategory || !activeMap) {
      return;
    }

    const categories = cloneCategories(state.categories);
    const category = categories[activeCategory.id];
    const map = category.maps[activeMap.id];
    const node = map.nodes[nodeId];

    if (!node) {
      return;
    }

    const normalizedNote = note.replace(/\r\n?/g, "\n");

    if (node.note === normalizedNote) {
      return;
    }

    const timestamp = createSnapshotTimestamp();
    node.note = normalizedNote;
    node.updatedAt = timestamp;
    map.updatedAt = timestamp;
    category.updatedAt = timestamp;

    set({
      categories,
      snapshotUpdatedAt: timestamp,
    });
  },
  setNodeImage: (nodeId, image) => {
    const state = get();
    const activeCategory = getActiveCategory(state);
    const activeMap = getActiveMap(state);

    if (!activeCategory || !activeMap) {
      return;
    }

    const categories = cloneCategories(state.categories);
    const category = categories[activeCategory.id];
    const map = category.maps[activeMap.id];
    const node = map.nodes[nodeId];

    if (!node) {
      return;
    }

    revokeImageUrl(node.image);
    const nextImage = buildNodeImage(nodeId, image);
    const timestamp = createSnapshotTimestamp();
    node.image = nextImage;
    node.updatedAt = timestamp;
    map.updatedAt = timestamp;
    category.updatedAt = timestamp;

    set({
      categories,
      snapshotUpdatedAt: timestamp,
    });
  },
  clearNodeImage: (nodeId) => {
    const state = get();
    const activeCategory = getActiveCategory(state);
    const activeMap = getActiveMap(state);

    if (!activeCategory || !activeMap) {
      return;
    }

    const categories = cloneCategories(state.categories);
    const category = categories[activeCategory.id];
    const map = category.maps[activeMap.id];
    const node = map.nodes[nodeId];

    if (!node?.image) {
      return;
    }

    revokeImageUrl(node.image);
    const timestamp = createSnapshotTimestamp();
    node.image = null;
    node.updatedAt = timestamp;
    map.updatedAt = timestamp;
    category.updatedAt = timestamp;

    set({
      categories,
      snapshotUpdatedAt: timestamp,
    });
  },
  deleteNode: (nodeId) => {
    const state = get();
    const activeCategory = getActiveCategory(state);
    const activeMap = getActiveMap(state);

    if (!activeCategory || !activeMap) {
      return;
    }

    const categories = cloneCategories(state.categories);
    const category = categories[activeCategory.id];

    if (!deleteNodeFromCategory(category, activeMap.id, nodeId)) {
      return;
    }

    const timestamp = createSnapshotTimestamp();
    category.updatedAt = timestamp;

    set({
      categories,
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      snapshotUpdatedAt: timestamp,
    });
  },
  setMapScene: (scene) => {
    const state = get();
    const activeCategory = getActiveCategory(state);
    const activeMap = getActiveMap(state);

    if (!activeCategory || !activeMap) {
      return;
    }

    const categories = cloneCategories(state.categories);
    const category = categories[activeCategory.id];
    const map = category.maps[activeMap.id];
    const nextScene = cloneScene({
      elements: scene.elements.filter((element) => element.type !== "selection"),
      appState: serializeSceneAppState(scene.appState),
      files: scene.files,
    });
    const sceneChanged = !areScenesEqual(activeMap.scene, nextScene);
    map.scene = nextScene;

    const removedNodeIds = removeDeletedNodesFromMap(category, map.id);
    const labelsChanged = syncNodeLabelsFromScene(map);
    const nextSelectedNodeId =
      state.selectedNodeId && !removedNodeIds.includes(state.selectedNodeId) ? state.selectedNodeId : null;

    if (!sceneChanged && !labelsChanged && removedNodeIds.length === 0 && state.selectedNodeId === nextSelectedNodeId) {
      return;
    }

    const timestamp = createSnapshotTimestamp();

    if (sceneChanged || labelsChanged || removedNodeIds.length > 0) {
      map.updatedAt = timestamp;
      category.updatedAt = timestamp;
    }

    set({
      categories,
      selectedNodeId: nextSelectedNodeId,
      snapshotUpdatedAt: timestamp,
    });
  },
  getProjectSnapshot: () => {
    const state = get();

    return {
      version: 7,
      categories: cloneCategories(state.categories),
      selectedCategoryId: state.selectedCategoryId,
      categoryDraftText: state.categoryDraftText,
      activeCategoryId: state.activeCategoryId,
      activeMapId: state.activeMapId,
      savedAt: state.snapshotUpdatedAt,
    };
  },
  getPendingImageAssets: () => {
    const categories = get().categories;

    return Object.values(categories).flatMap((category) =>
      Object.values(category.maps).flatMap((map) =>
        Object.values(map.nodes).flatMap((node) =>
          node.image?.pendingBlob
            ? [
                {
                  nodeId: node.nodeId,
                  path: node.image.path,
                  blob: node.image.pendingBlob,
                } satisfies PendingImageAsset,
              ]
            : [],
        ),
      ),
    );
  },
  markNodeImagesPersisted: (nodeIds) => {
    if (nodeIds.length === 0) {
      return;
    }

    const state = get();
    const categories = cloneCategories(state.categories);
    let changed = false;

    for (const category of Object.values(categories)) {
      for (const map of Object.values(category.maps)) {
        for (const node of Object.values(map.nodes)) {
          if (!nodeIds.includes(node.nodeId) || !node.image?.pendingBlob) {
            continue;
          }

          node.image = {
            ...node.image,
            pendingBlob: null,
          };
          changed = true;
        }
      }
    }

    if (!changed) {
      return;
    }

    set({
      categories,
    });
  },
  loadProjectSnapshot: (snapshot) => {
    const normalized = normalizeProjectSnapshot(snapshot);
    const previousCategories = get().categories;
    revokeUnusedImageUrls(previousCategories, normalized.categories);

    set({
      categories: normalized.categories,
      selectedCategoryId: normalized.selectedCategoryId,
      categoryDraftText: normalized.categoryDraftText,
      activeCategoryId: normalized.activeCategoryId,
      activeMapId: normalized.activeMapId,
      selectedNodeId: null,
      snapshotUpdatedAt: normalized.savedAt,
    });
  },
  mergeRemoteProjectSnapshot: (snapshot) => {
    const normalized = normalizeProjectSnapshot(snapshot);
    const previousCategories = get().categories;
    revokeUnusedImageUrls(previousCategories, normalized.categories);

    set((state) => ({
      categories: normalized.categories,
      selectedCategoryId: normalized.selectedCategoryId,
      categoryDraftText: normalized.categoryDraftText,
      activeCategoryId:
        state.activeCategoryId && normalized.categories[state.activeCategoryId]
          ? state.activeCategoryId
          : normalized.activeCategoryId,
      activeMapId:
        state.activeCategoryId &&
        state.activeMapId &&
        normalized.categories[state.activeCategoryId]?.maps[state.activeMapId]
          ? state.activeMapId
          : normalized.activeMapId,
      selectedNodeId: null,
      snapshotUpdatedAt: normalized.savedAt,
    }));
  },
  resetProject: () => {
    revokeUnusedImageUrls(get().categories, {});
    set(createEmptyState());
  },
}));
