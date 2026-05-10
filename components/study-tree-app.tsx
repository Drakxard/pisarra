"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ExcalidrawMapCanvas } from "@/components/excalidraw-map-canvas";
import {
  EmptyProjectFileError,
  hydrateProjectSnapshotAssets,
  InvalidProjectFileError,
  IncompatibleProjectVersionError,
  MissingProjectFileError,
  queryDirectoryPermission,
  readPureExcalidrawScene,
  readProjectSnapshot,
  recoverStoredDirectoryHandle,
  requestDirectoryPermission,
  selectProjectDirectory,
  supportsProjectDirectory,
  writePureExcalidrawScene,
  writeProjectSnapshot,
} from "@/lib/project-persistence";
import {
  FIXED_SECTION_IDS,
  type ExcalidrawSceneState,
  type MapNodeMeta,
  type StudyCategory,
  type StudyMap,
  type StudySectionId,
} from "@/lib/types";
import {
  getSectionLabel,
  hasValidExcalidrawElementIndex,
  normalizeSceneForRuntime,
} from "@/lib/project-snapshot";
import { useTreeStore } from "@/lib/tree-store";

const AUTOSAVE_DEBOUNCE_MS = 450;
const CANVAS_MOUNT_TIMEOUT_MS = 6_000;
const ExcalidrawPresentationMenu = dynamic(
  async () => (await import("@/components/excalidraw-presentation-menu")).ExcalidrawPresentationMenu,
  {
    ssr: false,
  },
);

type AppBootState = "loading" | "needs-directory" | "ready";
type MapCanvasStatus = "idle" | "loading" | "ready" | "error";

type CanvasFailure = {
  mapId: string;
  title: string;
  message: string;
  stack: string | null;
  timestamp: string;
  persistedElementCount: number;
};

type SearchHit = {
  nodeId: string;
  score: number;
};

type BuildInfo = {
  commitSha: string | null;
  deploymentId: string | null;
  environment: string | null;
};

type PureMapSession = {
  categoryId: string;
  mapId: string;
  title: string;
  breadcrumbLabel: string;
  loadKey: number;
};

type PureMapSaveStatus = "idle" | "loading" | "saving" | "saved" | "error";
type PresentationFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function collectSearchHits(map: StudyMap | null, query: string) {
  if (!map) {
    return [] as SearchHit[];
  }

  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  return Object.values(map.nodes)
    .map((node) => {
      const haystack = normalizeSearchText(`${node.label}\n${node.note}`);
      let score = 0;

      if (haystack.includes(normalizedQuery)) {
        score += 4;
      }

      for (const token of normalizedQuery.split(/\s+/)) {
        if (token.length < 2) {
          continue;
        }

        if (haystack.includes(token)) {
          score += 1;
        }
      }

      return { nodeId: node.nodeId, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}

function getNodeFromSelection(map: StudyMap | null, selectedElementIds: Record<string, boolean>) {
  if (!map) {
    return null;
  }

  const selectedIds = new Set(Object.keys(selectedElementIds).filter((id) => selectedElementIds[id]));

  for (const node of Object.values(map.nodes)) {
    if (selectedIds.has(node.elementId) || selectedIds.has(node.labelElementId)) {
      return node.nodeId;
    }
  }

  return null;
}

function hasSelectedExcalidrawElements(api: ExcalidrawImperativeAPI | null) {
  if (!api) {
    return false;
  }

  return Object.values(api.getAppState().selectedElementIds ?? {}).some(Boolean);
}

function isExcalidrawSelectionToolActive(api: ExcalidrawImperativeAPI | null) {
  if (!api) {
    return false;
  }

  return api.getAppState().activeTool.type === "selection";
}

function getNodeFromElementId(map: StudyMap | null, elementId: string | null | undefined) {
  if (!map || !elementId) {
    return null;
  }

  return (
    Object.values(map.nodes).find(
      (node) => node.elementId === elementId || node.labelElementId === elementId,
    ) ?? null
  );
}

function serializeCanvasScene(api: ExcalidrawImperativeAPI): ExcalidrawSceneState {
  const appState = api.getAppState();

  return {
    elements: api
      .getSceneElementsIncludingDeleted()
      .filter((element) => element.type !== "selection")
      .map((element) => ({ ...element })),
    appState: {
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
      viewBackgroundColor: appState.viewBackgroundColor,
      theme: appState.theme,
      gridSize: appState.gridSize,
    },
    files: { ...api.getFiles() },
  };
}

function getPresentationFrames(scene: ExcalidrawSceneState | null) {
  if (!scene) {
    return [] as PresentationFrame[];
  }

  return scene.elements
    .filter((element): element is PresentationFrame & { type: "frame"; isDeleted?: boolean } => {
      return (
        element.type === "frame" &&
        !element.isDeleted &&
        typeof element.x === "number" &&
        typeof element.y === "number" &&
        typeof element.width === "number" &&
        typeof element.height === "number" &&
        element.width > 0 &&
        element.height > 0
      );
    })
    .map((element) => ({
      id: element.id,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    }))
    .sort((left, right) => {
      if (left.y !== right.y) {
        return left.y - right.y;
      }

      return left.x - right.x;
    });
}

function focusPresentationFrame(api: ExcalidrawImperativeAPI, frame: PresentationFrame) {
  const appState = api.getAppState();
  const padding = 64;
  const availableWidth = Math.max(240, appState.width - padding * 2);
  const availableHeight = Math.max(160, appState.height - padding * 2);
  const zoomValue = Math.max(0.1, Math.min(4, Math.min(availableWidth / frame.width, availableHeight / frame.height)));
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;

  api.updateFrameRendering({
    enabled: true,
    clip: true,
    name: true,
    outline: false,
  });
  api.updateScene({
    appState: {
      scrollX: appState.width / 2 - centerX * zoomValue,
      scrollY: appState.height / 2 - centerY * zoomValue,
      zoom: {
        value: zoomValue as typeof appState.zoom.value,
      },
      selectedElementIds: {},
    },
  });
}

function HomeScreen({
  categories,
  selectedCategoryId,
  onSelectCategory,
  onOpenMain,
  onOpenSection,
  onCreateCategory,
  onRenameCategory,
}: {
  categories: StudyCategory[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string) => void;
  onOpenMain: (categoryId: string) => void;
  onOpenSection: (categoryId: string, sectionId: StudySectionId) => void;
  onCreateCategory: (name: string) => void;
  onRenameCategory: (categoryId: string, name: string) => void;
}) {
  const [renameDraft, setRenameDraft] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const createDraftRef = useRef("");
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (categories.length === 0) {
        return;
      }

      const selectedIndex = categories.findIndex((category) => category.id === selectedCategory?.id);
      const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
      const nextIndex = (currentIndex + direction + categories.length) % categories.length;
      createDraftRef.current = "";
      setCreateDraft("");
      onSelectCategory(categories[nextIndex].id);
    },
    [categories, onSelectCategory, selectedCategory?.id],
  );

  const startRenaming = useCallback(() => {
    if (!selectedCategory) {
      return;
    }

    setRenameDraft(selectedCategory.name);
    setIsRenaming(true);
  }, [selectedCategory]);

  useEffect(() => {
    setRenameDraft(selectedCategory?.name ?? "");
    setIsRenaming(false);
    createDraftRef.current = "";
    setCreateDraft("");
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
  }, [clearLongPressTimer, selectedCategory?.id, selectedCategory?.name]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isRenaming || isTextInput || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        createDraftRef.current = "";
        setCreateDraft("");
        moveSelection(-1);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        createDraftRef.current = "";
        setCreateDraft("");
        moveSelection(1);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const nextName = createDraftRef.current.trim();
        createDraftRef.current = "";
        setCreateDraft("");

        if (nextName) {
          onCreateCategory(nextName);
        }
        return;
      }

      if (event.key === "Escape") {
        createDraftRef.current = "";
        setCreateDraft("");
        return;
      }

      if (event.key === "Backspace") {
        createDraftRef.current = createDraftRef.current.slice(0, -1);
        setCreateDraft(createDraftRef.current);
        return;
      }

      if (event.key.length === 1) {
        if (/^[\p{L}\p{N} ]$/u.test(event.key)) {
          createDraftRef.current += event.key;
          setCreateDraft(createDraftRef.current);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRenaming, moveSelection, onCreateCategory]);

  const commitRename = useCallback(() => {
    if (!selectedCategory) {
      return;
    }

    onRenameCategory(selectedCategory.id, renameDraft);
    setIsRenaming(false);
  }, [onRenameCategory, renameDraft, selectedCategory]);

  const cancelRename = useCallback(() => {
    setRenameDraft(selectedCategory?.name ?? "");
    setIsRenaming(false);
  }, [selectedCategory?.name]);

  const handleOrbPointerDown = useCallback(() => {
    if (!selectedCategory || isRenaming) {
      return;
    }

    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      startRenaming();
    }, 800);
  }, [clearLongPressTimer, isRenaming, selectedCategory, startRenaming]);

  const handleOrbPointerUp = useCallback(() => {
    if (!selectedCategory || isRenaming) {
      clearLongPressTimer();
      return;
    }

    const wasLongPress = longPressTriggeredRef.current;
    clearLongPressTimer();
    longPressTriggeredRef.current = false;

    if (!wasLongPress) {
      onOpenMain(selectedCategory.id);
    }
  }, [clearLongPressTimer, isRenaming, onOpenMain, selectedCategory]);

  const handleOrbKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!selectedCategory || isRenaming) {
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpenMain(selectedCategory.id);
      }
    },
    [isRenaming, onOpenMain, selectedCategory],
  );

  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitRename();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        cancelRename();
      }
    },
    [cancelRename, commitRename],
  );

  return (
    <div className="category-home" aria-label="Materias">
      <div className="question-stage-backdrop" />
      <div className="category-home-shell">
        <div className="category-map-home">
          {FIXED_SECTION_IDS.filter((sectionId) => sectionId !== "theorems").map((sectionId) => (
            <button
              key={sectionId}
              type="button"
              className={`category-section-card is-${sectionId}`}
              disabled={!selectedCategory}
              onClick={() => {
                if (selectedCategory) {
                  onOpenSection(selectedCategory.id, sectionId);
                }
              }}
            >
              {getSectionLabel(sectionId)}
            </button>
          ))}

          <div
            role={selectedCategory && !isRenaming ? "button" : undefined}
            tabIndex={selectedCategory && !isRenaming ? 0 : -1}
            className="category-main-orb is-selected"
            aria-disabled={!selectedCategory}
            onPointerDown={handleOrbPointerDown}
            onPointerUp={handleOrbPointerUp}
            onPointerLeave={clearLongPressTimer}
            onPointerCancel={clearLongPressTimer}
            onKeyDown={handleOrbKeyDown}
          >
            {selectedCategory && isRenaming ? (
              <form
                className="category-rename-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  commitRename();
                }}
              >
                <input
                  id={`category-rename-${selectedCategory.id}`}
                  name="category_rename_name"
                  className="category-rename-input"
                  value={renameDraft}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setRenameDraft(event.currentTarget.value)}
                  onKeyDown={handleRenameKeyDown}
                />
                <span className="category-rename-hint">Enter para guardar</span>
              </form>
            ) : (
              <span>{selectedCategory?.name ?? "Crea una materia"}</span>
            )}
          </div>
        </div>
      </div>
      {createDraft ? (
        <div className="category-global-draft" aria-live="polite">
          {createDraft}
        </div>
      ) : null}
    </div>
  );
}

export function StudyTreeApp({ buildInfo }: { buildInfo: BuildInfo }) {
  const {
    categories,
    selectedCategoryId,
    activeCategoryId,
    activeMapId,
    selectedNodeId,
    createCategory,
    renameCategory,
    selectCategory,
    openNodeChildMap,
    closeActiveMap,
    selectNode,
    createMapNode,
    deleteNode,
    setMapScene,
    initializeMapContent,
    getProjectSnapshot,
    getPendingImageAssets,
    markNodeImagesPersisted,
    loadProjectSnapshot,
  } = useTreeStore();
  const [bootState, setBootState] = useState<AppBootState>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isPickingDirectory, setIsPickingDirectory] = useState(false);
  const [hasResolvedDirectorySupport, setHasResolvedDirectorySupport] = useState(false);
  const [canUseProjectDirectory, setCanUseProjectDirectory] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [mapEntryError, setMapEntryError] = useState<string | null>(null);
  const [canvasStatus, setCanvasStatus] = useState<MapCanvasStatus>("idle");
  const [canvasFailure, setCanvasFailure] = useState<CanvasFailure | null>(null);
  const [canvasRetryKey, setCanvasRetryKey] = useState(0);
  const [pureMapSession, setPureMapSession] = useState<PureMapSession | null>(null);
  const [pureMapLoadedScene, setPureMapLoadedScene] = useState<ExcalidrawSceneState | null>(null);
  const [pureMapSaveStatus, setPureMapSaveStatus] = useState<PureMapSaveStatus>("idle");
  const [pureMapError, setPureMapError] = useState<string | null>(null);
  const [isPresentationOpen, setIsPresentationOpen] = useState(false);
  const [presentationIndex, setPresentationIndex] = useState(0);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const pureMapSaveTimeoutRef = useRef<number | null>(null);
  const pureMapLastSavedSignatureRef = useRef("");
  const pureMapLastQueuedSignatureRef = useRef("");
  const lastPersistedProjectSignatureRef = useRef("");
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const pureMapApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const presentationApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const sceneSyncSignatureRef = useRef("");
  const sceneAppliedRef = useRef(false);
  const ignoredEmptyMountChangeRef = useRef(false);
  const isApplyingSceneRef = useRef(false);
  const hasCanvasAcceptedInitialSceneRef = useRef(false);
  const lastAcceptedSceneSignatureRef = useRef("");
  const hasLoggedCanvasApiReadyRef = useRef(false);
  const activeCategoryRef = useRef<StudyCategory | null>(null);
  const activeMapRef = useRef<StudyMap | null>(null);
  const buildInfoRef = useRef(buildInfo);
  const runtimeSceneRef = useRef<ExcalidrawSceneState | null>(null);

  const categoriesList = useMemo(() => Object.values(categories), [categories]);
  const selectedCategory =
    selectedCategoryId && categories[selectedCategoryId]
      ? categories[selectedCategoryId]
      : categoriesList[0] ?? null;
  const activeCategory = activeCategoryId ? categories[activeCategoryId] ?? null : null;
  const activeMap = activeCategory && activeMapId ? activeCategory.maps[activeMapId] ?? null : null;
  const hasActiveMapRequest = Boolean(activeCategoryId || activeMapId);
  const activeMapRouteError =
    hasActiveMapRequest && (!activeCategory || !activeMap)
      ? "No se pudo abrir el mapa seleccionado porque ya no existe en el proyecto cargado."
      : null;
  const selectedNode = activeMap && selectedNodeId ? activeMap.nodes[selectedNodeId] ?? null : null;
  const projectSignature = JSON.stringify(getProjectSnapshot());
  const activeMapSceneSignature = activeMap ? JSON.stringify(activeMap.scene) : "";
  const searchHits = useMemo(() => collectSearchHits(activeMap, searchText), [activeMap, searchText]);
  const activeSearchHit = searchHits.length > 0 ? searchHits[searchIndex % searchHits.length] : null;
  const runtimeSceneState = useMemo(
    () => (activeMap ? normalizeSceneForRuntime(activeMap.scene) : null),
    [activeMapSceneSignature, activeMap?.id],
  );
  const runtimeScene = runtimeSceneState?.scene ?? activeMap?.scene ?? null;
  const presentationFrames = useMemo(() => getPresentationFrames(runtimeScene), [runtimeScene]);
  const activePresentationFrame = presentationFrames[presentationIndex] ?? null;
  const excalidrawInitialData = useMemo(
    () =>
      activeMap
        ? ({
            elements: runtimeScene?.elements ?? activeMap.scene.elements ?? [],
            appState: runtimeScene?.appState ?? activeMap.scene.appState,
            files: runtimeScene?.files ?? activeMap.scene.files ?? {},
            scrollToContent: true,
          } as never)
        : null,
    [activeMap, runtimeScene],
  );
  const presentationInitialData = useMemo(
    () =>
      runtimeScene
        ? ({
            elements: runtimeScene.elements,
            appState: runtimeScene.appState,
            files: runtimeScene.files,
            scrollToContent: false,
          } as never)
        : null,
    [runtimeScene],
  );
  const closePresentation = useCallback(() => {
    setIsPresentationOpen(false);
    setPresentationIndex(0);
  }, []);

  const goToPreviousPresentationFrame = useCallback(() => {
    setPresentationIndex((current) => Math.max(0, current - 1));
  }, []);

  const goToNextPresentationFrame = useCallback(() => {
    setPresentationIndex((current) => Math.min(presentationFrames.length - 1, current + 1));
  }, [presentationFrames.length]);

  const startPresentation = useCallback(() => {
    const api = excalidrawApiRef.current;

    if (presentationFrames.length === 0) {
      api?.setToast({
        message: "Este mapa no tiene frames para presentar.",
        closable: true,
      });
      return;
    }

    setPresentationIndex(0);
    setIsPresentationOpen(true);
  }, [presentationFrames]);
  const viewState = activeMapRouteError
    ? "invalid-map"
    : activeCategory && activeMap
      ? canvasStatus === "ready"
        ? "map-ready"
        : canvasStatus === "error"
          ? "canvas-error"
          : "map-loading"
      : "home";

  useEffect(() => {
    activeCategoryRef.current = activeCategory;
    activeMapRef.current = activeMap;
    buildInfoRef.current = buildInfo;
    runtimeSceneRef.current = runtimeScene;
  }, [activeCategory, activeMap, buildInfo, runtimeScene]);

  useEffect(() => {
    if (!activeMap) {
      closePresentation();
    }
  }, [activeMap, closePresentation]);

  useEffect(() => {
    if (presentationFrames.length === 0 && isPresentationOpen) {
      closePresentation();
      return;
    }

    setPresentationIndex((current) => {
      if (presentationFrames.length === 0) {
        return 0;
      }

      return Math.min(current, presentationFrames.length - 1);
    });
  }, [closePresentation, isPresentationOpen, presentationFrames.length]);

  useEffect(() => {
    if (!isPresentationOpen || !activePresentationFrame) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const api = presentationApiRef.current;

      if (!api) {
        return;
      }

      focusPresentationFrame(api, activePresentationFrame);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activePresentationFrame, isPresentationOpen]);

  const centerNodeInViewport = useEffectEvent((node: MapNodeMeta) => {
    const api = excalidrawApiRef.current;
    const map = activeMap;

    if (!api || !map) {
      return;
    }

    const container = map.scene.elements.find((element) => element.id === node.elementId);

    if (!container) {
      return;
    }

    const appState = api.getAppState();
    const zoomValue = appState.zoom.value || 1;
    const centerX = container.x + container.width / 2;
    const centerY = container.y + container.height / 2;

    api.updateScene({
      appState: {
        scrollX: appState.width / 2 - centerX * zoomValue,
        scrollY: appState.height / 2 - centerY * zoomValue,
        selectedElementIds: {
          [node.elementId]: true,
        },
      },
    });
  });

  const readSnapshotFromHandle = useEffectEvent(async (handle: FileSystemDirectoryHandle) => {
    const snapshot = await readProjectSnapshot(handle);
    return await hydrateProjectSnapshotAssets(handle, snapshot);
  });

  const flushProjectNow = useEffectEvent(async () => {
    const handle = directoryHandle;

    if (!handle) {
      return;
    }

    const snapshot = useTreeStore.getState().getProjectSnapshot();
    const pendingAssets = useTreeStore.getState().getPendingImageAssets();

    try {
      await writeProjectSnapshot(handle, snapshot, pendingAssets);
      if (pendingAssets.length > 0) {
        useTreeStore.getState().markNodeImagesPersisted(pendingAssets.map((asset) => asset.nodeId));
      }
      lastPersistedProjectSignatureRef.current = JSON.stringify(useTreeStore.getState().getProjectSnapshot());
      setPersistenceError(null);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : "No se pudo guardar el proyecto.");
    }
  });

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const supported = supportsProjectDirectory();

      if (cancelled) {
        return;
      }

      setCanUseProjectDirectory(supported);
      setHasResolvedDirectorySupport(true);

      if (!supported) {
        setBootState("ready");
        return;
      }

      const storedHandle = await recoverStoredDirectoryHandle();

      if (!storedHandle) {
        if (!cancelled) {
          setBootState("needs-directory");
        }
        return;
      }

      try {
        const permission = await queryDirectoryPermission(storedHandle, "readwrite");

        if (permission !== "granted") {
          if (!cancelled) {
            setBootState("needs-directory");
          }
          return;
        }

        const snapshot = await readSnapshotFromHandle(storedHandle);

        if (cancelled) {
          return;
        }

        loadProjectSnapshot(snapshot);
        setDirectoryHandle(storedHandle);
        setBootState("ready");
        lastPersistedProjectSignatureRef.current = JSON.stringify(useTreeStore.getState().getProjectSnapshot());
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (
          error instanceof MissingProjectFileError ||
          error instanceof EmptyProjectFileError ||
          error instanceof InvalidProjectFileError ||
          error instanceof IncompatibleProjectVersionError
        ) {
          setBootError(error.message);
        } else {
          setBootError(error instanceof Error ? error.message : "No se pudo cargar el proyecto.");
        }

        setBootState("needs-directory");
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [loadProjectSnapshot, readSnapshotFromHandle]);

  useEffect(() => {
    if (!directoryHandle) {
      return;
    }

    const hasPendingAssets = getPendingImageAssets().length > 0;
    const hasSnapshotChanges = projectSignature !== lastPersistedProjectSignatureRef.current;

    if (!hasPendingAssets && !hasSnapshotChanges) {
      return;
    }

    if (autosaveTimeoutRef.current !== null) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(() => {
      autosaveTimeoutRef.current = null;
      void flushProjectNow();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimeoutRef.current !== null) {
        window.clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, [directoryHandle, flushProjectNow, getPendingImageAssets, projectSignature]);

  useEffect(() => {
    if (!activeSearchHit || !activeMap?.nodes[activeSearchHit.nodeId]) {
      return;
    }

    selectNode(activeSearchHit.nodeId);
    centerNodeInViewport(activeMap.nodes[activeSearchHit.nodeId]);
  }, [activeMap, activeSearchHit, centerNodeInViewport, selectNode]);

  useEffect(() => {
    setSearchIndex(0);
  }, [searchText, activeMapId]);

  useEffect(() => {
    if (!activeMapId) {
      setIsInspectorOpen(false);
      setMapEntryError(null);
      setCanvasStatus("idle");
      excalidrawApiRef.current = null;
      sceneSyncSignatureRef.current = "";
      sceneAppliedRef.current = false;
      ignoredEmptyMountChangeRef.current = false;
      isApplyingSceneRef.current = false;
      hasCanvasAcceptedInitialSceneRef.current = false;
      lastAcceptedSceneSignatureRef.current = "";
      hasLoggedCanvasApiReadyRef.current = false;
      return;
    }

    void initializeMapContent(activeMapId);
  }, [activeMapId, initializeMapContent]);

  useEffect(() => {
    setMapEntryError(null);
    setCanvasStatus(activeMap ? "loading" : "idle");
    excalidrawApiRef.current = null;
    sceneSyncSignatureRef.current = "";
    sceneAppliedRef.current = false;
    ignoredEmptyMountChangeRef.current = false;
    isApplyingSceneRef.current = false;
    hasCanvasAcceptedInitialSceneRef.current = false;
    lastAcceptedSceneSignatureRef.current = "";
    hasLoggedCanvasApiReadyRef.current = false;
  }, [activeMap?.id]);

  useEffect(() => {
    if (!activeMap || canvasStatus !== "loading") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (excalidrawApiRef.current) {
        return;
      }

      console.error("[StudyTree] canvas-timeout", {
        build: buildInfo,
        categoryId: activeCategory?.id ?? null,
        mapId: activeMap.id,
      });
      setCanvasStatus("error");
      const message = `No se pudo montar el mapa "${activeMap.title}": Excalidraw no respondio a tiempo.`;
      setMapEntryError(message);
      setCanvasFailure({
        mapId: activeMap.id,
        title: activeMap.title,
        message,
        stack: null,
        timestamp: new Date().toISOString(),
        persistedElementCount: runtimeSceneRef.current?.elements.filter((element) => !element.isDeleted).length ?? 0,
      });
    }, CANVAS_MOUNT_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeCategory?.id, activeMap, buildInfo, canvasStatus]);

  useEffect(() => {
    if (!activeMap || !runtimeSceneState?.changed) {
      return;
    }

    setMapScene(runtimeSceneState.scene);
  }, [activeMap?.id, runtimeSceneState, setMapScene]);

  useEffect(() => {
    if (!activeMap || !runtimeSceneState || !runtimeScene) {
      return;
    }

    const allIndicesValid = runtimeScene.elements.every((element) =>
      hasValidExcalidrawElementIndex(element.index),
    );

    console.info("[StudyTree] map-entry", {
      build: buildInfo,
      categoryId: activeCategory?.id ?? null,
      mapId: activeMap.id,
      mapKind: activeMap.kind,
      contentInitializedAt: activeMap.contentInitializedAt,
      elementCount: runtimeScene.elements.length,
      invalidElementCount: runtimeSceneState.invalidElementCount,
      allIndicesValid,
    });

    if (runtimeSceneState.changed) {
      console.warn("[StudyTree] normalized invalid Excalidraw scene indices before render", {
        mapId: activeMap.id,
        invalidElementCount: runtimeSceneState.invalidElementCount,
      });
    }
  }, [activeCategory?.id, activeMap?.id, buildInfo, runtimeScene, runtimeSceneState]);

  useEffect(() => {
    if (selectedNode) {
      setIsInspectorOpen(true);
    }
  }, [selectedNode?.nodeId]);

  useEffect(() => {
    const api = excalidrawApiRef.current;

    if (!api || !activeMap) {
      sceneSyncSignatureRef.current = "";
      return;
    }

    if (!runtimeScene) {
      return;
    }

    const canvasScene = serializeCanvasScene(api);
    const canvasSignature = JSON.stringify(canvasScene);

    if (canvasSignature === JSON.stringify(runtimeScene)) {
      sceneSyncSignatureRef.current = activeMapSceneSignature;
      sceneAppliedRef.current = true;
      hasCanvasAcceptedInitialSceneRef.current = true;
      lastAcceptedSceneSignatureRef.current = canvasSignature;
      setCanvasStatus((current) => (current === "ready" ? current : "ready"));
      return;
    }

    if (sceneSyncSignatureRef.current === activeMapSceneSignature) {
      return;
    }

    sceneSyncSignatureRef.current = activeMapSceneSignature;

    const sceneFiles = Object.values(runtimeScene.files);

    if (sceneFiles.length > 0) {
      api.addFiles(sceneFiles as never);
    }

    try {
      console.info("[StudyTree] updateScene", {
        mapId: activeMap.id,
        elementCount: runtimeScene.elements.length,
      });
      isApplyingSceneRef.current = true;
      api.updateScene({
        elements: runtimeScene.elements as never,
        appState: runtimeScene.appState as never,
      });
      sceneAppliedRef.current = true;
      hasCanvasAcceptedInitialSceneRef.current = true;
      lastAcceptedSceneSignatureRef.current = activeMapSceneSignature;
      console.info("[StudyTree] scene-applied", {
        mapId: activeMap.id,
        elementCount: runtimeScene.elements.length,
      });
      setCanvasStatus((current) => (current === "ready" ? current : "ready"));
      setMapEntryError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo montar el mapa en Excalidraw.";
      console.error("[StudyTree] updateScene failed", {
        mapId: activeMap.id,
        error,
      });
      setCanvasStatus("error");
      const nextMessage = `No se pudo abrir el mapa "${activeMap.title}": ${message}`;
      setMapEntryError(nextMessage);
      setCanvasFailure({
        mapId: activeMap.id,
        title: activeMap.title,
        message: nextMessage,
        stack: error instanceof Error ? error.stack ?? null : null,
        timestamp: new Date().toISOString(),
        persistedElementCount: runtimeScene.elements.filter((element) => !element.isDeleted).length,
      });
    } finally {
      queueMicrotask(() => {
        isApplyingSceneRef.current = false;
      });
    }
  }, [activeMap?.id, activeMapSceneSignature, runtimeScene]);

  useEffect(() => {
    const api = excalidrawApiRef.current;

    if (!api || !activeMap) {
      return;
    }

    return api.onPointerUp((_, pointerDownState, event) => {
      handleCardPointerUp(event, pointerDownState.hit.element?.id, pointerDownState.drag.hasOccurred);
    });
  }, [activeMap?.id]);

  const pickProjectDirectory = async () => {
    setIsPickingDirectory(true);
    setBootError(null);

    try {
      const handle = await selectProjectDirectory();
      const permission = await requestDirectoryPermission(handle, "readwrite");

      if (permission !== "granted") {
        throw new Error("No se concedio permiso sobre la carpeta.");
      }

      let snapshot;

      try {
        snapshot = await readSnapshotFromHandle(handle);
      } catch (error) {
        if (error instanceof MissingProjectFileError) {
          snapshot = getProjectSnapshot();
          await writeProjectSnapshot(handle, snapshot, []);
        } else {
          throw error;
        }
      }

      loadProjectSnapshot(snapshot);
      setDirectoryHandle(handle);
      setBootState("ready");
      lastPersistedProjectSignatureRef.current = JSON.stringify(useTreeStore.getState().getProjectSnapshot());
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "No se pudo abrir la carpeta.");
    } finally {
      setIsPickingDirectory(false);
    }
  };

  const closePureMap = () => {
    if (pureMapSaveTimeoutRef.current !== null) {
      window.clearTimeout(pureMapSaveTimeoutRef.current);
      pureMapSaveTimeoutRef.current = null;
    }

    setPureMapSession(null);
    setPureMapLoadedScene(null);
    setPureMapSaveStatus("idle");
    setPureMapError(null);
    pureMapLastSavedSignatureRef.current = "";
    pureMapLastQueuedSignatureRef.current = "";
    pureMapApiRef.current = null;
  };

  const openPureExcalidrawMap = async (args: {
    categoryId: string;
    mapId: string;
    title: string;
    breadcrumbLabel: string;
  }) => {
    if (!directoryHandle) {
      setPureMapError("Selecciona una carpeta del proyecto para guardar archivos Excalidraw locales.");
      return;
    }

    if (pureMapSaveTimeoutRef.current !== null) {
      window.clearTimeout(pureMapSaveTimeoutRef.current);
      pureMapSaveTimeoutRef.current = null;
    }

    closeActiveMap();
    setPureMapError(null);
    setPureMapSaveStatus("loading");
    setPureMapLoadedScene(null);
    pureMapApiRef.current = null;
    setPureMapSession({
      ...args,
      loadKey: Date.now(),
    });

    try {
      const scene = await readPureExcalidrawScene(directoryHandle, args.mapId);
      const signature = JSON.stringify(scene);
      await writePureExcalidrawScene(directoryHandle, args.mapId, scene);
      pureMapLastSavedSignatureRef.current = signature;
      pureMapLastQueuedSignatureRef.current = signature;
      setPureMapLoadedScene(scene);
      setPureMapSaveStatus("saved");
    } catch (error) {
      setPureMapSaveStatus("error");
      setPureMapError(error instanceof Error ? error.message : "No se pudo abrir el archivo Excalidraw local.");
    }
  };

  const schedulePureMapSave = useCallback(
    (session: PureMapSession, scene: ExcalidrawSceneState) => {
      const handle = directoryHandle;
      const signature = JSON.stringify(scene);

      if (
        !handle ||
        signature === pureMapLastSavedSignatureRef.current ||
        signature === pureMapLastQueuedSignatureRef.current
      ) {
        return;
      }

      pureMapLastQueuedSignatureRef.current = signature;
      setPureMapSaveStatus("saving");
      setPureMapError(null);

      if (pureMapSaveTimeoutRef.current !== null) {
        window.clearTimeout(pureMapSaveTimeoutRef.current);
      }

      pureMapSaveTimeoutRef.current = window.setTimeout(() => {
        pureMapSaveTimeoutRef.current = null;
        void writePureExcalidrawScene(handle, session.mapId, scene)
          .then(() => {
            pureMapLastSavedSignatureRef.current = signature;
            setPureMapSaveStatus("saved");
            setPureMapError(null);
          })
          .catch((error) => {
            setPureMapSaveStatus("error");
            setPureMapError(error instanceof Error ? error.message : "No se pudo guardar el archivo Excalidraw.");
          });
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [directoryHandle],
  );

  useEffect(() => {
    return () => {
      if (pureMapSaveTimeoutRef.current !== null) {
        window.clearTimeout(pureMapSaveTimeoutRef.current);
        pureMapSaveTimeoutRef.current = null;
      }
    };
  }, []);

  const createNodeAtViewportCenter = () => {
    const api = excalidrawApiRef.current;

    if (!api) {
      void createMapNode("Nueva tarjeta");
      return;
    }

    const appState = api.getAppState();
    const zoomValue = appState.zoom.value || 1;
    const x = Math.round((appState.width / 2 - appState.scrollX) / zoomValue - 160);
    const y = Math.round((appState.height / 2 - appState.scrollY) / zoomValue - 80);

    const nodeId = createMapNode("Nueva tarjeta", { x, y });

    if (nodeId) {
      selectNode(nodeId);
      setIsInspectorOpen(true);
    }
  };

  const retryCanvasMount = () => {
    setMapEntryError(null);
    setCanvasFailure(null);
    setCanvasStatus("loading");
    excalidrawApiRef.current = null;
    sceneSyncSignatureRef.current = "";
    sceneAppliedRef.current = false;
    ignoredEmptyMountChangeRef.current = false;
    isApplyingSceneRef.current = false;
    hasCanvasAcceptedInitialSceneRef.current = false;
    lastAcceptedSceneSignatureRef.current = "";
    hasLoggedCanvasApiReadyRef.current = false;
    setCanvasRetryKey((current) => current + 1);
  };

  const clearCanvasFailure = () => {
    setMapEntryError(null);
    setCanvasFailure(null);
    setCanvasStatus((current) => (current === "error" ? "ready" : current));
  };

  const leaveMapShell = () => {
    setIsPresentationOpen(false);
    setMapEntryError(null);
    setCanvasFailure(null);
    closeActiveMap();
  };

  const handleRenameCategory = useCallback(
    (categoryId: string, name: string) => {
      renameCategory(categoryId, name);
      queueMicrotask(() => {
        void flushProjectNow();
      });
    },
    [flushProjectNow, renameCategory],
  );

  useEffect(() => {
    const handleMapEscape = (event: KeyboardEvent) => {
      const target = event.target;
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isTextInput) {
        return;
      }

      if (isPresentationOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closePresentation();
          return;
        }

        if (event.key === "ArrowRight" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          goToNextPresentationFrame();
          return;
        }

        if (event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          goToPreviousPresentationFrame();
          return;
        }
      }

      if (event.key !== "Escape") {
        return;
      }

      if (pureMapSession) {
        const api = pureMapApiRef.current;

        if (!isExcalidrawSelectionToolActive(api) || hasSelectedExcalidrawElements(api)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        closePureMap();
        return;
      }

      if (activeCategory && activeMap) {
        const api = excalidrawApiRef.current;

        if (!isExcalidrawSelectionToolActive(api) || hasSelectedExcalidrawElements(api)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        leaveMapShell();
      }
    };

    window.addEventListener("keydown", handleMapEscape, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleMapEscape, { capture: true });
    };
  }, [
    activeCategory,
    activeMap,
    closePresentation,
    goToNextPresentationFrame,
    goToPreviousPresentationFrame,
    isPresentationOpen,
    pureMapSession,
  ]);

  const handleCanvasApi = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawApiRef.current = api;

    queueMicrotask(() => {
      if (!hasLoggedCanvasApiReadyRef.current) {
        hasLoggedCanvasApiReadyRef.current = true;
        console.info("[StudyTree] canvas-api-ready", {
          build: buildInfoRef.current,
          categoryId: activeCategoryRef.current?.id ?? null,
          mapId: activeMapRef.current?.id ?? null,
        });
      }
      setCanvasStatus((current) => (current === "error" ? current : "ready"));
    });
  }, []);

  const handleSceneChange = useCallback((scene: ExcalidrawSceneState) => {
    if (isApplyingSceneRef.current) {
      return;
    }

    const persistedElementCount =
      runtimeSceneRef.current?.elements.filter((element) => !element.isDeleted).length ?? 0;
    const nextElementCount = scene.elements.filter((element) => !element.isDeleted).length;
    const nextSceneSignature = JSON.stringify(scene);

    if (!hasCanvasAcceptedInitialSceneRef.current) {
      if (persistedElementCount === 0) {
        hasCanvasAcceptedInitialSceneRef.current = true;
      } else if (nextElementCount === 0) {
        if (!ignoredEmptyMountChangeRef.current) {
          ignoredEmptyMountChangeRef.current = true;
          console.warn("[StudyTree] ignored-empty-mount-change", {
            build: buildInfoRef.current,
            categoryId: activeCategoryRef.current?.id ?? null,
            mapId: activeMapRef.current?.id ?? null,
            persistedElementCount,
          });
        }
        return;
      } else {
        hasCanvasAcceptedInitialSceneRef.current = true;
      }
    }

    if (lastAcceptedSceneSignatureRef.current === nextSceneSignature) {
      return;
    }

    if (!sceneAppliedRef.current && persistedElementCount > 0 && nextElementCount === 0) {
      if (!ignoredEmptyMountChangeRef.current) {
        ignoredEmptyMountChangeRef.current = true;
        console.warn("[StudyTree] ignored-empty-mount-change", {
          build: buildInfoRef.current,
          categoryId: activeCategoryRef.current?.id ?? null,
          mapId: activeMapRef.current?.id ?? null,
          persistedElementCount,
        });
      }
      return;
    }

    lastAcceptedSceneSignatureRef.current = nextSceneSignature;
    setMapScene(scene);
  }, [setMapScene]);

  const handleCardPointerUp = useEffectEvent((event: PointerEvent, elementId: string | null | undefined, dragged: boolean) => {
    if (dragged || event.detail < 2) {
      return;
    }

    const node = getNodeFromElementId(activeMap, elementId);

    if (node) {
      openNodeChildMap(node.nodeId);
    }
  });

  useEffect(() => {
    console.info("[StudyTree] view-state", {
      build: buildInfo,
      categoryId: activeCategoryId,
      mapId: activeMapId,
      viewState,
    });
  }, [activeCategoryId, activeMapId, buildInfo, viewState]);

  if (bootState !== "ready") {
    return (
      <main className="minimal-shell">
        <section className="directory-gate">
          <div className="question-stage-backdrop" />
          {bootState === "needs-directory" ? (
            <div className="directory-gate-panel">
              <span className="directory-gate-eyebrow">Study Maps</span>
              <h1>Selecciona la carpeta del proyecto</h1>
              <p>La app usa `study-tree.json` y `study-assets/` dentro de una carpeta elegida por ti.</p>
              {bootError ? <p className="directory-gate-error">{bootError}</p> : null}
              <button
                type="button"
                className="directory-gate-button"
                onClick={() => {
                  void pickProjectDirectory();
                }}
                disabled={!hasResolvedDirectorySupport || !canUseProjectDirectory || isPickingDirectory}
              >
                {!hasResolvedDirectorySupport
                  ? "Verificando navegador..."
                  : isPickingDirectory
                    ? "Abriendo selector..."
                    : canUseProjectDirectory
                      ? "Seleccionar carpeta"
                      : "No disponible en este navegador"}
              </button>
            </div>
          ) : (
            <div className="directory-gate-panel">
              <span className="directory-gate-eyebrow">Study Maps</span>
              <h1>Cargando proyecto</h1>
              {bootError ? <p className="directory-gate-error">{bootError}</p> : null}
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="minimal-shell">
      {pureMapSession ? (
        <section className="immersive-map-shell">
          <div className="pure-map-save-status" aria-live="polite">
            {pureMapSaveStatus === "loading"
              ? "Cargando archivo"
              : pureMapSaveStatus === "saving"
                ? "Guardando"
                : pureMapSaveStatus === "saved"
                  ? "Guardado"
                  : pureMapSaveStatus === "error"
                    ? "Error al guardar"
                    : ""}
          </div>

          <div className="immersive-map-canvas">
            {pureMapLoadedScene ? (
              <ExcalidrawMapCanvas
                key={`${pureMapSession.mapId}:${pureMapSession.loadKey}`}
                initialData={
                  {
                    elements: pureMapLoadedScene.elements,
                    appState: pureMapLoadedScene.appState,
                    files: pureMapLoadedScene.files,
                    scrollToContent: true,
                  } as never
                }
                viewModeEnabled={false}
                excalidrawAPI={(api) => {
                  pureMapApiRef.current = api;
                }}
                UIOptions={{
                  canvasActions: {
                    clearCanvas: true,
                    export: false,
                    loadScene: false,
                    saveToActiveFile: false,
                    toggleTheme: true,
                    changeViewBackgroundColor: true,
                    saveAsImage: true,
                  },
                  tools: {
                    image: true,
                  },
                }}
                onChange={(elements, appState, files) => {
                  schedulePureMapSave(pureMapSession, {
                    elements: [...elements],
                    appState: {
                      scrollX: appState.scrollX,
                      scrollY: appState.scrollY,
                      zoom: appState.zoom,
                      viewBackgroundColor: appState.viewBackgroundColor,
                      theme: appState.theme,
                      gridSize: appState.gridSize,
                    },
                    files: { ...files },
                  });
                }}
              />
            ) : (
              <div className="map-canvas-state" aria-live="polite">
                Cargando mapa...
              </div>
            )}

            {pureMapError ? (
              <div className="map-canvas-state map-canvas-state--error" aria-live="polite">
                <strong>No se pudo usar el archivo Excalidraw</strong>
                <span>{pureMapError}</span>
                <div className="map-canvas-state-actions">
                  <button
                    type="button"
                    className="map-floating-button is-accent"
                    onClick={() => {
                      void openPureExcalidrawMap(pureMapSession);
                    }}
                  >
                    Reintentar
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : activeMapRouteError ? (
        <section className="directory-gate" aria-live="polite">
          <div className="question-stage-backdrop" />
          <div className="directory-gate-panel">
            <span className="directory-gate-eyebrow">Study Maps</span>
            <h1>No se pudo abrir el mapa</h1>
            <p className="directory-gate-error">{activeMapRouteError}</p>
            <button type="button" className="directory-gate-button" onClick={closeActiveMap}>
              Volver al inicio
            </button>
          </div>
        </section>
      ) : !activeCategory || !activeMap || !excalidrawInitialData ? (
        <HomeScreen
          categories={categoriesList}
          selectedCategoryId={selectedCategory?.id ?? null}
          onSelectCategory={selectCategory}
          onOpenMain={(categoryId) => {
            const category = categories[categoryId];
            if (category) {
              void openPureExcalidrawMap({
                categoryId,
                mapId: category.mainMapId,
                title: category.name,
                breadcrumbLabel: `${category.name} / Mapa principal`,
              });
            }
          }}
          onOpenSection={(categoryId, sectionId) => {
            const category = categories[categoryId];
            const mapId = category?.sectionMapIds[sectionId];
            if (category && mapId) {
              void openPureExcalidrawMap({
                categoryId,
                mapId,
                title: getSectionLabel(sectionId),
                breadcrumbLabel: `${category.name} / ${getSectionLabel(sectionId)}`,
              });
            }
          }}
          onCreateCategory={(name) => {
            const categoryId = createCategory(name);

            if (categoryId) {
              selectCategory(categoryId);
              queueMicrotask(() => {
                void flushProjectNow();
              });
            }
          }}
          onRenameCategory={handleRenameCategory}
        />
      ) : (
        <section className="immersive-map-shell">
          <div className="map-hud map-hud--search">
            <label className="map-search map-search--floating" htmlFor="map-search">
              <span>Buscar</span>
              <input
                id="map-search"
                name="map_search"
                value={searchText}
                placeholder="Buscar tarjetas por nombre o nota"
                onChange={(event) => setSearchText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (searchHits.length > 0) {
                      setSearchIndex((current) => (current + 1) % searchHits.length);
                    }
                  }
                }}
              />
            </label>
          </div>

          <div className="immersive-map-canvas">
            <ExcalidrawMapCanvas
              key={`${activeCategory.id}:${activeMap.id}:${activeMap.contentInitializedAt ?? "pending"}:${canvasRetryKey}`}
              errorKey={`${activeCategory.id}:${activeMap.id}:${activeMap.contentInitializedAt ?? "pending"}:${canvasRetryKey}`}
              initialData={excalidrawInitialData}
              excalidrawAPI={(api) => {
                handleCanvasApi(api);
              }}
              onRenderError={(error) => {
                queueMicrotask(() => {
                  console.error("[StudyTree] canvas-error", {
                    build: buildInfoRef.current,
                    categoryId: activeCategoryRef.current?.id ?? null,
                    mapId: activeMapRef.current?.id ?? null,
                    error,
                  });
                  const failedMap = activeMapRef.current;
                  const message = `No se pudo abrir el mapa "${failedMap?.title ?? "Mapa"}": ${error.message}`;
                  setCanvasStatus("error");
                  setMapEntryError(message);
                  setCanvasFailure({
                    mapId: failedMap?.id ?? "unknown",
                    title: failedMap?.title ?? "Mapa",
                    message,
                    stack: error.stack ?? null,
                    timestamp: new Date().toISOString(),
                    persistedElementCount:
                      runtimeSceneRef.current?.elements.filter((element) => !element.isDeleted).length ?? 0,
                  });
                });
              }}
              fallback={null}
              viewModeEnabled={false}
              renderTopRightUI={() => (
                <div className="map-top-right-ui">
                  <button
                    type="button"
                    className="map-floating-button is-accent"
                    onClick={createNodeAtViewportCenter}
                  >
                    Nueva tarjeta
                  </button>
                  {selectedNode ? (
                    <button
                      type="button"
                      className="map-floating-button"
                      onClick={() => openNodeChildMap(selectedNode.nodeId)}
                    >
                      Entrar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="map-floating-button"
                    onClick={() => setIsInspectorOpen((current) => !current)}
                  >
                    {isInspectorOpen ? "Ocultar panel" : "Panel"}
                  </button>
                </div>
              )}
              UIOptions={{
                canvasActions: {
                  clearCanvas: true,
                  export: false,
                  loadScene: false,
                  saveToActiveFile: false,
                  toggleTheme: true,
                  changeViewBackgroundColor: true,
                  saveAsImage: false,
                },
                tools: {
                  image: true,
                },
              }}
              onChange={(elements, appState, files) => {
                const nextScene = {
                  elements: [...elements],
                  appState: {
                    scrollX: appState.scrollX,
                    scrollY: appState.scrollY,
                    zoom: appState.zoom,
                    viewBackgroundColor: appState.viewBackgroundColor,
                    theme: appState.theme,
                    gridSize: appState.gridSize,
                  },
                  files: { ...files },
                };
                const selectedElementIds = { ...appState.selectedElementIds };

                queueMicrotask(() => {
                  handleSceneChange(nextScene);
                  selectNode(getNodeFromSelection(activeMapRef.current, selectedElementIds) ?? null);
                });
              }}
            >
              <ExcalidrawPresentationMenu onStartPresentation={startPresentation} />
            </ExcalidrawMapCanvas>

            {canvasStatus === "loading" ? (
              <div className="map-canvas-state" aria-live="polite">
                Cargando mapa...
              </div>
            ) : null}

            {canvasStatus === "ready" && (runtimeScene?.elements.filter((element) => !element.isDeleted).length ?? 0) === 0 ? (
              <div className="map-canvas-state map-canvas-state--empty" aria-live="polite">
                <strong>Mapa vacio</strong>
                <span>Usa Nueva tarjeta o las herramientas de Excalidraw para empezar.</span>
              </div>
            ) : null}

            {canvasFailure ? (
              <div className="map-canvas-state map-canvas-state--error" aria-live="polite">
                <strong>No se pudo abrir el mapa</strong>
                <span>{canvasFailure.message}</span>
                <dl className="map-canvas-diagnostics">
                  <div>
                    <dt>Mapa</dt>
                    <dd>{canvasFailure.title}</dd>
                  </div>
                  <div>
                    <dt>mapId</dt>
                    <dd>{canvasFailure.mapId}</dd>
                  </div>
                  <div>
                    <dt>Elementos persistidos</dt>
                    <dd>{canvasFailure.persistedElementCount}</dd>
                  </div>
                  <div>
                    <dt>Timestamp</dt>
                    <dd>{canvasFailure.timestamp}</dd>
                  </div>
                </dl>
                {canvasFailure.stack ? <pre className="map-canvas-stack">{canvasFailure.stack}</pre> : null}
                <div className="map-canvas-state-actions">
                  <button type="button" className="map-floating-button is-accent" onClick={retryCanvasMount}>
                    Reintentar
                  </button>
                  <button type="button" className="map-floating-button" onClick={clearCanvasFailure}>
                    Cerrar error
                  </button>
                </div>
              </div>
            ) : null}

            {selectedNode ? (
              <div className="map-hud map-hud--selection">
                <span className="map-selection-pill">
                  Tarjeta activa: <strong>{selectedNode.label}</strong>
                </span>
              </div>
            ) : null}

            {searchText && searchHits.length === 0 ? (
              <div className="search-feedback" aria-live="polite">
                No se encontraron tarjetas.
              </div>
            ) : null}

            {isPresentationOpen && presentationInitialData && activePresentationFrame ? (
              <div className="presentation-overlay" aria-modal="true" role="dialog" aria-label="Modo presentacion">
                <div className="presentation-canvas">
                  <ExcalidrawMapCanvas
                    key={`${activeMap.id}:presentation:${activePresentationFrame.id}`}
                    initialData={presentationInitialData}
                    excalidrawAPI={(api) => {
                      presentationApiRef.current = api;
                      focusPresentationFrame(api, activePresentationFrame);
                    }}
                    viewModeEnabled
                    renderTopRightUI={() => null}
                    UIOptions={{
                      canvasActions: {
                        clearCanvas: false,
                        export: false,
                        loadScene: false,
                        saveToActiveFile: false,
                        toggleTheme: false,
                        changeViewBackgroundColor: false,
                        saveAsImage: false,
                      },
                      tools: {
                        image: false,
                      },
                    }}
                  />
                </div>

                <div className="presentation-controls">
                  <button
                    type="button"
                    className="map-floating-button"
                    onClick={goToPreviousPresentationFrame}
                    disabled={presentationIndex === 0}
                  >
                    Anterior
                  </button>
                  <span className="presentation-counter">
                    {presentationIndex + 1} / {presentationFrames.length}
                  </span>
                  <button
                    type="button"
                    className="map-floating-button"
                    onClick={goToNextPresentationFrame}
                    disabled={presentationIndex >= presentationFrames.length - 1}
                  >
                    Siguiente
                  </button>
                  <button type="button" className="map-floating-button is-accent" onClick={closePresentation}>
                    Cerrar
                  </button>
                </div>
              </div>
            ) : null}
            {persistenceError ? (
              <div className="map-sync-status is-error" aria-live="polite">
                {persistenceError}
              </div>
            ) : null}
            {mapEntryError && !canvasFailure ? (
              <div className="map-sync-status is-error" aria-live="polite">
                {mapEntryError}
              </div>
            ) : null}
          </div>

          <aside className={`map-inspector ${isInspectorOpen ? "is-open" : ""}`}>
            {selectedNode ? (
              <>
                <div className="map-inspector-header">
                  <div>
                    <span className="node-side-eyebrow">Tarjeta</span>
                    <h2>{selectedNode.label}</h2>
                  </div>
                  <button
                    type="button"
                    className="map-floating-button"
                    onClick={() => setIsInspectorOpen(false)}
                  >
                    Cerrar
                  </button>
                </div>

                <div className="node-side-empty">
                  <p>Haz doble click en la tarjeta para entrar a su submapa o usa el boton de acceso rapido.</p>
                </div>

                <div className="node-side-actions">
                  <button
                    type="button"
                    className="map-toolbar-button is-accent"
                    onClick={() => openNodeChildMap(selectedNode.nodeId)}
                  >
                    Entrar al submapa
                  </button>
                  <button
                    type="button"
                    className="map-toolbar-button is-danger"
                    onClick={() => deleteNode(selectedNode.nodeId)}
                  >
                    Eliminar tarjeta
                  </button>
                </div>

                {selectedNode.note ? (
                  <div className="legacy-details-card">
                    <span className="node-side-eyebrow">Nota heredada</span>
                    <p>{selectedNode.note}</p>
                  </div>
                ) : null}

                {selectedNode.image?.previewUrl ? (
                  <div className="legacy-details-card">
                    <span className="node-side-eyebrow">Imagen heredada</span>
                    <img
                      className="map-inspector-image"
                      src={selectedNode.image.previewUrl}
                      alt={selectedNode.image.name}
                    />
                  </div>
                ) : null}

                {selectedNode.legacyDetails ? (
                  <div className="legacy-details-card">
                    <span className="node-side-eyebrow">Contenido legado</span>
                    <p>Se preservo del proyecto anterior y se mantiene solo como referencia.</p>
                    <ul className="legacy-details-list">
                      <li>Tabla: {selectedNode.legacyDetails.detailsTable ? "si" : "no"}</li>
                      <li>Imagenes: {selectedNode.legacyDetails.detailsImages?.length ?? 0}</li>
                      <li>Cajas de texto: {selectedNode.legacyDetails.detailsTextBoxes?.length ?? 0}</li>
                      <li>Referencias: {selectedNode.legacyDetails.exerciseReferences?.length ?? 0}</li>
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="map-inspector-header">
                  <div>
                    <span className="node-side-eyebrow">Mapa</span>
                    <h2>{activeMap.title}</h2>
                  </div>
                  <button
                    type="button"
                    className="map-floating-button"
                    onClick={() => setIsInspectorOpen(false)}
                  >
                    Cerrar
                  </button>
                </div>
                <div className="node-side-empty">
                  <p>
                    Excalidraw es ahora la superficie principal. Crea una tarjeta para generar un submapa y usa el
                    resto del lienzo para texto, dibujo, imagenes y conexiones.
                  </p>
                </div>
              </>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
