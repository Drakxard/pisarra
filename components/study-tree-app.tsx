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
import { getSectionLabel } from "@/lib/project-snapshot";
import { useTreeStore } from "@/lib/tree-store";

const AUTOSAVE_DEBOUNCE_MS = 450;

type AppBootState = "loading" | "needs-directory" | "ready";

type SearchHit = {
  nodeId: string;
  score: number;
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

function fileToNodeImage(file: File) {
  const previewUrl = URL.createObjectURL(file);

  return new Promise<{
    blob: Blob;
    previewUrl: string;
    mimeType: string;
    name: string;
    width?: number;
    height?: number;
  }>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        blob: file,
        previewUrl,
        mimeType: file.type || "image/png",
        name: file.name || "image.png",
        width: image.naturalWidth || undefined,
        height: image.naturalHeight || undefined,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error("No se pudo leer la imagen."));
    };

    image.src = previewUrl;
  });
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

export function StudyTreeApp() {
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
    openNodeChildMap,
    goToParentMap,
    closeActiveMap,
    selectNode,
    createMapNode,
    updateNodeLabel,
    updateNodeNote,
    setNodeImage,
    clearNodeImage,
    deleteNode,
    setMapScene,
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
  const autosaveTimeoutRef = useRef<number | null>(null);
  const lastPersistedProjectSignatureRef = useRef("");
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const categoriesList = useMemo(() => Object.values(categories), [categories]);
  const selectedCategory =
    selectedCategoryId && categories[selectedCategoryId]
      ? categories[selectedCategoryId]
      : categoriesList[0] ?? null;
  const activeCategory = activeCategoryId ? categories[activeCategoryId] ?? null : null;
  const activeMap = activeCategory && activeMapId ? activeCategory.maps[activeMapId] ?? null : null;
  const selectedNode = activeMap && selectedNodeId ? activeMap.nodes[selectedNodeId] ?? null : null;
  const projectSignature = JSON.stringify(getProjectSnapshot());
  const searchHits = useMemo(() => collectSearchHits(activeMap, searchText), [activeMap, searchText]);
  const activeSearchHit = searchHits.length > 0 ? searchHits[searchIndex % searchHits.length] : null;

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
      void createMapNode("Nuevo nodo");
      return;
    }

    const appState = api.getAppState();
    const zoomValue = appState.zoom.value || 1;
    const x = Math.round((appState.width / 2 - appState.scrollX) / zoomValue - 160);
    const y = Math.round((appState.height / 2 - appState.scrollY) / zoomValue - 80);

    const nodeId = createMapNode("Nuevo nodo", { x, y });

    if (nodeId) {
      selectNode(nodeId);
    }
  };

  const handleSceneChange = useEffectEvent((scene: ExcalidrawSceneState) => {
    setMapScene(scene);
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
      {!activeCategory || !activeMap ? (
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
        <section className="map-editor">
          <div className="map-topbar">
            <div className="map-breadcrumbs">
              <button type="button" className="map-toolbar-button" onClick={closeActiveMap}>
                Materias
              </button>
              {activeMap.parentMapId ? (
                <button type="button" className="map-toolbar-button" onClick={goToParentMap}>
                  Subir
                </button>
              ) : null}
              {breadcrumbs.map((item, index) => (
                <span key={item.id} className="map-breadcrumb">
                  {index > 0 ? <span className="map-breadcrumb-sep">/</span> : null}
                  {item.label}
                </span>
              ))}
            </div>
            <div className="map-topbar-actions">
              <label className="map-search">
                <span>Buscar</span>
                <input
                  value={searchText}
                  placeholder="Buscar nodos"
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
              <button type="button" className="map-toolbar-button is-accent" onClick={createNodeAtViewportCenter}>
                Nuevo nodo
              </button>
            </div>
          </div>

          <div className="map-editor-body">
            <div className="map-canvas-panel">
              <ExcalidrawMapCanvas
                key={`${activeCategory.id}:${activeMap.id}`}
                initialData={
                  {
                    elements: activeMap.scene.elements,
                    appState: activeMap.scene.appState,
                    files: activeMap.scene.files,
                    scrollToContent: false,
                  } as never
                }
                excalidrawAPI={(api) => {
                  excalidrawApiRef.current = api;
                }}
                zenModeEnabled
                viewModeEnabled={false}
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
              {searchText && searchHits.length === 0 ? (
                <div className="search-feedback" aria-live="polite">
                  No se encontraron nodos.
                </div>
              ) : null}
              {persistenceError ? (
                <div className="map-sync-status is-error" aria-live="polite">
                  {persistenceError}
                </div>
              ) : null}
            </div>

            <aside className="node-side-panel">
              {selectedNode ? (
                <>
                  <div className="node-side-header">
                    <div>
                      <span className="node-side-eyebrow">Nodo</span>
                      <h2>{selectedNode.label}</h2>
                    </div>
                    <div className="node-side-actions">
                      <button
                        type="button"
                        className="map-toolbar-button is-accent"
                        onClick={() => openNodeChildMap(selectedNode.nodeId)}
                      >
                        Entrar
                      </button>
                      <button
                        type="button"
                        className="map-toolbar-button is-danger"
                        onClick={() => deleteNode(selectedNode.nodeId)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>

                  <label className="node-form-field">
                    <span>Titulo</span>
                    <input
                      value={selectedNode.label}
                      onChange={(event) => updateNodeLabel(selectedNode.nodeId, event.currentTarget.value)}
                    />
                  </label>

                  <label className="node-form-field">
                    <span>Nota</span>
                    <textarea
                      value={selectedNode.note}
                      rows={9}
                      onChange={(event) => updateNodeNote(selectedNode.nodeId, event.currentTarget.value)}
                    />
                  </label>

                  <div className="node-form-field">
                    <span>Imagen principal</span>
                    {selectedNode.image?.previewUrl ? (
                      <div className="node-image-card">
                        <img src={selectedNode.image.previewUrl} alt={selectedNode.image.name} />
                        <button
                          type="button"
                          className="map-toolbar-button"
                          onClick={() => clearNodeImage(selectedNode.nodeId)}
                        >
                          Quitar imagen
                        </button>
                      </div>
                    ) : null}
                    <label className="node-image-upload">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];

                          if (!file) {
                            return;
                          }

                          void fileToNodeImage(file).then((image) => {
                            setNodeImage(selectedNode.nodeId, image);
                            event.currentTarget.value = "";
                          });
                        }}
                      />
                      <span>{selectedNode.image ? "Cambiar imagen" : "Subir imagen"}</span>
                    </label>
                  </div>

                  {selectedNode.legacyDetails ? (
                    <div className="legacy-details-card">
                      <span className="node-side-eyebrow">Contenido legado</span>
                      <p>Se preservo del proyecto anterior y queda en modo solo lectura.</p>
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
                <div className="node-side-empty">
                  <span className="node-side-eyebrow">Mapa</span>
                  <h2>{activeMap.title}</h2>
                  <p>Selecciona un nodo del lienzo o crea uno nuevo para navegar a su submapa.</p>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}
    </main>
  );
}
