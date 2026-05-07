"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ExcalidrawMapCanvas } from "@/components/excalidraw-map-canvas";
import {
  EmptyProjectFileError,
  hydrateProjectSnapshotAssets,
  InvalidProjectFileError,
  IncompatibleProjectVersionError,
  MissingProjectFileError,
  queryDirectoryPermission,
  readProjectSnapshot,
  recoverStoredDirectoryHandle,
  requestDirectoryPermission,
  selectProjectDirectory,
  supportsProjectDirectory,
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

type AppBootState = "loading" | "needs-directory" | "ready";

type SearchHit = {
  nodeId: string;
  score: number;
};

type BuildInfo = {
  commitSha: string | null;
  deploymentId: string | null;
  environment: string | null;
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
  const [draft, setDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null;

  useEffect(() => {
    setRenameDraft(selectedCategory?.name ?? "");
    setIsRenaming(false);
  }, [selectedCategory?.id, selectedCategory?.name]);

  return (
    <div className="category-home" aria-label="Materias">
      <div className="question-stage-backdrop" />
      <div className="category-home-shell">
        <div className="category-rail">
          <div className="category-rail-list">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`category-chip ${selectedCategory?.id === category.id ? "is-active" : ""}`}
                onClick={() => onSelectCategory(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
          <form
            className="category-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateCategory(draft);
              setDraft("");
            }}
          >
            <input
              id="category-create-name"
              name="category_create_name"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder="Nueva materia"
            />
            <button type="submit">Crear</button>
          </form>
        </div>

        <div className="category-map-home">
          {FIXED_SECTION_IDS.map((sectionId) => (
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

          <button
            type="button"
            className="category-main-orb is-selected"
            disabled={!selectedCategory}
            onClick={() => {
              if (selectedCategory && !isRenaming) {
                onOpenMain(selectedCategory.id);
              }
            }}
          >
            {selectedCategory && isRenaming ? (
              <form
                className="category-rename-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onRenameCategory(selectedCategory.id, renameDraft);
                  setIsRenaming(false);
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
                />
                <span className="category-rename-hint">Enter para guardar</span>
              </form>
            ) : (
              <span>{selectedCategory?.name ?? "Crea una materia"}</span>
            )}
          </button>

          {selectedCategory ? (
            <button
              type="button"
              className="category-rename-button"
              onClick={() => {
                setRenameDraft(selectedCategory.name);
                setIsRenaming(true);
              }}
            >
              Renombrar
            </button>
          ) : null}
        </div>
      </div>
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
    openMainCategoryMap,
    openCategorySection,
    openMap,
    openNodeChildMap,
    goToParentMap,
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
  const autosaveTimeoutRef = useRef<number | null>(null);
  const lastPersistedProjectSignatureRef = useRef("");
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const sceneSyncSignatureRef = useRef("");

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
  const excalidrawInitialData = useMemo(
    () =>
      activeMap
        ? ({
            elements: runtimeScene?.elements ?? activeMap.scene.elements ?? [],
            appState: runtimeScene?.appState ?? activeMap.scene.appState,
            files: runtimeScene?.files ?? activeMap.scene.files ?? {},
            scrollToContent: false,
          } as never)
        : null,
    [activeMap, runtimeScene],
  );

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
      return;
    }

    void initializeMapContent(activeMapId);
  }, [activeMapId, initializeMapContent]);

  useEffect(() => {
    setMapEntryError(null);
  }, [activeMap?.id]);

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
      api.updateScene({
        elements: runtimeScene.elements as never,
        appState: runtimeScene.appState as never,
      });
      setMapEntryError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo montar el mapa en Excalidraw.";
      console.error("[StudyTree] updateScene failed", {
        mapId: activeMap.id,
        error,
      });
      setMapEntryError(`No se pudo abrir el mapa "${activeMap.title}": ${message}`);
    }
  }, [activeMap, activeMapSceneSignature, runtimeScene]);

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

  const handleSceneChange = useEffectEvent((scene: ExcalidrawSceneState) => {
    setMapScene(scene);
  });

  const handleCardPointerUp = useEffectEvent((event: PointerEvent, elementId: string | null | undefined, dragged: boolean) => {
    if (dragged || event.detail < 2) {
      return;
    }

    const node = getNodeFromElementId(activeMap, elementId);

    if (node) {
      openNodeChildMap(node.nodeId);
    }
  });

  const breadcrumbs = useMemo(() => {
    if (!activeCategory || !activeMap) {
      return [];
    }

    const items = [{ id: activeCategory.id, label: activeCategory.name, mapId: null as string | null }];
    const lineage: StudyMap[] = [];
    let current: StudyMap | null = activeMap;

    while (current) {
      lineage.unshift(current);
      current = current.parentMapId ? activeCategory.maps[current.parentMapId] ?? null : null;
    }

    for (const map of lineage) {
      if (map.kind === "main" && map.title === activeCategory.name) {
        items.push({ id: map.id, label: "Mapa principal", mapId: map.id });
      } else {
        items.push({ id: map.id, label: map.title, mapId: map.id });
      }
    }

    return items;
  }, [activeCategory, activeMap]);

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
      {activeMapRouteError ? (
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
          onOpenMain={openMainCategoryMap}
          onOpenSection={openCategorySection}
          onCreateCategory={(name) => {
            const categoryId = createCategory(name);

            if (categoryId) {
              selectCategory(categoryId);
            }
          }}
          onRenameCategory={renameCategory}
        />
      ) : (
        <section className="immersive-map-shell">
          <div className="map-hud map-hud--breadcrumbs">
            <button type="button" className="map-floating-button" onClick={closeActiveMap}>
              Materias
            </button>
            {activeMap.parentMapId ? (
              <button type="button" className="map-floating-button" onClick={goToParentMap}>
                Subir
              </button>
            ) : null}
            <div className="map-breadcrumbs">
              {breadcrumbs.map((item, index) => {
                const isLast = index === breadcrumbs.length - 1;

                return (
                  <span key={item.id} className="map-breadcrumb">
                    {index > 0 ? <span className="map-breadcrumb-sep">/</span> : null}
                    {item.mapId && !isLast ? (
                      <button
                        type="button"
                        className="map-breadcrumb-button"
                        onClick={() => openMap(activeCategory.id, item.mapId!)}
                      >
                        {item.label}
                      </button>
                    ) : (
                      <span>{item.label}</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

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
              key={`${activeCategory.id}:${activeMap.id}:${activeMap.contentInitializedAt ?? "pending"}`}
              errorKey={`${activeCategory.id}:${activeMap.id}:${activeMap.contentInitializedAt ?? "pending"}`}
              initialData={excalidrawInitialData}
              excalidrawAPI={(api) => {
                excalidrawApiRef.current = api;
              }}
              onRenderError={(error) => {
                console.error("[StudyTree] Excalidraw render failed", {
                  build: buildInfo,
                  categoryId: activeCategory.id,
                  mapId: activeMap.id,
                  error,
                });
                setMapEntryError(`No se pudo abrir el mapa "${activeMap.title}": ${error.message}`);
              }}
              fallback={
                <div className="map-sync-status is-error" aria-live="polite">
                  {mapEntryError ?? "No se pudo abrir el mapa en Excalidraw."}
                </div>
              }
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
                handleSceneChange({
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
                selectNode(getNodeFromSelection(activeMap, appState.selectedElementIds) ?? null);
              }}
            />

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
            {persistenceError ? (
              <div className="map-sync-status is-error" aria-live="polite">
                {persistenceError}
              </div>
            ) : null}
            {mapEntryError ? (
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
