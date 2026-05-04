"use client";

import {
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  memo,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import { useTreeStore } from "@/lib/tree-store";
import type {
  CollaboratorIdentity,
  PresenceState,
  RemoteProject,
  SyncResponse,
} from "@/lib/collaboration-types";
import type {
  CardSize,
  DetailsImage,
  DetailsTable,
  DetailsTextBox,
  DraftImage,
  PendingImageAsset,
  QuestionCard,
  SearchResult,
  StudyCategory,
} from "@/lib/types";

const DEFAULT_STAGE_WIDTH = 1400;
const DEFAULT_STAGE_HEIGHT = 900;
const AUTOSAVE_DEBOUNCE_MS = 150;
const REMOTE_POLL_MS = 350;
const REMOTE_BACKGROUND_POLL_MS = 1500;
const PRESENCE_POLL_MS = 900;
const PRESENCE_SEND_MS = 120;
const UNDO_TIMEOUT_MS = 3000;
const PASTE_FEEDBACK_TIMEOUT_MS = 2600;
const CARD_FALLBACK_WIDTH = 320;
const CARD_FALLBACK_HEIGHT = 220;
const KEYBOARD_MOVE_STEP = 24;
const START_DETAILS_EDIT_EVENT = "study-tree:start-details-edit";
const EDGE_PAN_MARGIN = 72;
const EDGE_PAN_MAX_STEP = 18;
const CLOSE_HOLD_DELETE_MS = 800;
const MIN_TABLE_COLUMN_WIDTH = 72;
const MIN_TABLE_ROW_HEIGHT = 36;
const HOME_SECTIONS = [
  { id: "definitions", name: "Definiciones", className: "is-definitions" },
  { id: "theorems", name: "Teoremas", className: "is-theorems" },
  { id: "exams", name: "Parciales", className: "is-exams" },
  { id: "exercises", name: "Ejercicios", className: "is-exercises" },
] as const;

type StageSize = {
  width: number;
  height: number;
};

type AppBootState = "loading" | "needs-name" | "ready";

type RemoteSaveResponse =
  | {
      ok: true;
      project: RemoteProject;
    }
  | {
      ok: false;
      conflict: true;
      project: RemoteProject;
    };

type DragState = {
  cardId: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  cameraOriginX: number;
  cameraOriginY: number;
  hasMoved: boolean;
};

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type TableResizeState =
  | {
      type: "column";
      index: number;
      startClientX: number;
      startSize: number;
    }
  | {
      type: "row";
      index: number;
      startClientY: number;
      startSize: number;
    };

type DetailsImageInteraction =
  | {
      type: "move";
      imageId: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      type: "resize";
      imageId: string;
      startX: number;
      startY: number;
      originWidth: number;
      originHeight: number;
    }
  | {
      type: "rotate";
      imageId: string;
      centerX: number;
      centerY: number;
    };

type DetailsTextBoxInteraction =
  | {
      type: "move";
      textBoxId: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      hasMoved: boolean;
    }
  | {
      type: "resize";
      textBoxId: string;
      startX: number;
      startY: number;
      originWidth: number;
      originHeight: number;
    };

type ExerciseSetInteraction =
  | {
      type: "move";
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      hasMoved: boolean;
    }
  | null;

const TEXT_BOX_FONT_SIZES: Record<DetailsTextBox["fontSize"], { label: string; className: string }> = {
  small: { label: "Pequeno", className: "is-small" },
  medium: { label: "Medio", className: "is-medium" },
  large: { label: "Grande", className: "is-large" },
  xlarge: { label: "Extragrande", className: "is-xlarge" },
  huge: { label: "Enorme", className: "is-huge" },
};
const TEXT_BOX_COLORS = [
  "#111111",
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ffffff",
  "#f3f4f6",
  "#fecaca",
  "#fed7aa",
  "#fef3c7",
  "#bbf7d0",
  "#cffafe",
  "#dbeafe",
  "#ede9fe",
  "#fce7f3",
] as const;

const EXERCISE_RESULT_CARD_WIDTH = 192;
const EXERCISE_RESULT_MIN_HEIGHT = 132;
const EXERCISE_RESULT_GAP = 12;

type ExerciseReferenceView = {
  sourceSectionId: "definitions" | "theorems";
  sourceCardId: string;
};

type ExerciseSetView = {
  id: string;
  query: string;
  x: number;
  y: number;
  width: number;
  references: ExerciseReferenceView[];
};

type ExerciseCandidate = ExerciseReferenceView & {
  card: QuestionCard;
};

function normalizeExerciseSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function collectExerciseMatches(query: string, candidates: ExerciseCandidate[]) {
  const normalizedQuery = normalizeExerciseSearchText(query);
  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 3);

  if (!normalizedQuery && queryTokens.length === 0) {
    return [];
  }

  return candidates
    .map((candidate) => {
      const { card } = candidate;
      const title = normalizeExerciseSearchText(card.text);
      const titleTokens = title.split(/\s+/);

      let score = 0;

      if (normalizedQuery && title.includes(normalizedQuery)) {
        score += 4;
      }

      for (const token of queryTokens) {
        if (title.includes(token)) {
          score += 2;
        }
      }

      for (const token of titleTokens) {
        if (queryTokens.includes(token)) {
          score += 1;
        }
      }

      return {
        candidate,
        score,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.candidate.card.text.localeCompare(right.candidate.card.text);
    })
    .map(({ candidate }) => candidate);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function makeClientId() {
  return crypto.randomUUID();
}

function getCollaboratorColor(clientId: string) {
  const colors = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#c2410c", "#0f766e", "#be123c"];
  let hash = 0;

  for (const character of clientId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return colors[hash % colors.length];
}

function getStoredIdentity(): CollaboratorIdentity | null {
  try {
    const raw = window.localStorage.getItem("study-tree-collaborator");

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CollaboratorIdentity>;

    if (!parsed.clientId || !parsed.name || !parsed.color) {
      return null;
    }

    return {
      clientId: parsed.clientId,
      name: parsed.name,
      color: parsed.color,
    };
  } catch {
    return null;
  }
}

function storeIdentity(identity: CollaboratorIdentity) {
  window.localStorage.setItem("study-tree-collaborator", JSON.stringify(identity));
}

async function fetchRemoteProject() {
  const response = await fetch("/api/project", { cache: "no-store" });

  if (!response.ok) {
    throw new Error("No se pudo cargar el proyecto remoto.");
  }

  return (await response.json()) as RemoteProject;
}

async function uploadPendingAssets(assets: PendingImageAsset[]) {
  if (assets.length === 0) {
    return;
  }

  const formData = new FormData();

  for (const asset of assets) {
    formData.append("path", asset.path);
    formData.append("file", asset.blob);
  }

  const response = await fetch("/api/assets", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("No se pudieron subir las imagenes pendientes.");
  }
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;

  if (!element) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function parseClipboardTable(text: string) {
  const normalizedText = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");

  if (!normalizedText.includes("\t")) {
    return null;
  }

  const rows = normalizedText.split("\n").map((row) => row.split("\t"));

  if (rows.length === 0 || rows.every((row) => row.every((cell) => cell.trim().length === 0))) {
    return null;
  }

  return rows;
}

const NodeLabel = memo(function NodeLabel({ text }: { text: string }) {
  return <div className="node-content is-rich">{text}</div>;
});

function insertPlainTextAtCursor(text: string) {
  if (typeof document === "undefined") {
    return;
  }

  if (document.queryCommandSupported?.("insertText")) {
    document.execCommand("insertText", false, text);
    return;
  }

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCursorAtEnd(element: HTMLElement) {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCursorAtPoint(element: HTMLElement, x: number, y: number) {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => {
      offsetNode: Node;
      offset: number;
    } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const selection = window.getSelection();

  if (!selection) {
    return false;
  }

  if (documentWithCaret.caretPositionFromPoint) {
    const position = documentWithCaret.caretPositionFromPoint(x, y);

    if (position) {
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
  }

  if (documentWithCaret.caretRangeFromPoint) {
    const range = documentWithCaret.caretRangeFromPoint(x, y);

    if (range) {
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
  }

  return false;
}

function getCaretClientPoint() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
  const rect = range.getBoundingClientRect();

  if (rect.width > 0 || rect.height > 0) {
    return {
      x: rect.left,
      y: rect.top,
    };
  }

  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  range.insertNode(marker);
  const markerRect = marker.getBoundingClientRect();
  marker.remove();

  return {
    x: markerRect.left,
    y: markerRect.top,
  };
}

const CardDetailsEditor = memo(function CardDetailsEditor({
  cardId,
  text,
  onSave,
  onStartTyping,
  onPasteTable,
  onPasteImage,
}: {
  cardId: string;
  text: string;
  onSave: (cardId: string, text: string) => void;
  onStartTyping?: () => void;
  onPasteTable?: (cells: string[][]) => void;
  onPasteImage?: (file: File) => void;
}) {
  const [draft, setDraft] = useState(text);
  const editableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(text);
    if (editableRef.current && editableRef.current.innerText !== text) {
      editableRef.current.innerText = text;
    }
  }, [text]);

  useLayoutEffect(() => {
    if (!editableRef.current) {
      return;
    }

    const editor = editableRef.current;

    if (editor.innerText !== draft) {
      editor.innerText = draft;
    }
  }, [cardId, draft]);

  useEffect(() => {
    const onStartEditing = (event: Event) => {
      const customEvent = event as CustomEvent<{ text?: string }>;
      const textToInsert = customEvent.detail?.text ?? "";

      editableRef.current?.focus({ preventScroll: true });

      if (textToInsert) {
        insertPlainTextAtCursor(textToInsert);
        const nextDraft = editableRef.current?.innerText ?? "";
        setDraft(nextDraft);
        onSave(cardId, nextDraft);
      }
    };

    window.addEventListener(START_DETAILS_EDIT_EVENT, onStartEditing as EventListener);

    return () => {
      window.removeEventListener(START_DETAILS_EDIT_EVENT, onStartEditing as EventListener);
    };
  }, []);

  const persistDraft = (nextDraft: string) => {
    setDraft(nextDraft);
    onSave(cardId, nextDraft);
  };

  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;

    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }

    const nextDraft = event.currentTarget.innerText ?? "";
    persistDraft(nextDraft);
  };

  return (
    <section className="card-details-section" aria-label="Notas de la tarjeta">
      <div
        ref={editableRef}
        className="card-details-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={(event) => {
          onStartTyping?.();
          persistDraft(event.currentTarget.innerText ?? "");
        }}
        onBlur={onBlur}
        onPaste={(event: ReactClipboardEvent<HTMLDivElement>) => {
          const imageItem = Array.from(event.clipboardData.items).find(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
          );

          if (imageItem) {
            const imageFile = imageItem.getAsFile();

            if (imageFile) {
              event.preventDefault();
              onPasteImage?.(imageFile);
              return;
            }
          }

          const tableCells = parseClipboardTable(event.clipboardData.getData("text/plain"));

          if (tableCells) {
            event.preventDefault();
            onPasteTable?.(tableCells);
            return;
          }

          event.preventDefault();
          onStartTyping?.();
          insertPlainTextAtCursor(event.clipboardData.getData("text/plain"));
          persistDraft(event.currentTarget.innerText ?? "");
        }}
      />
    </section>
  );
});

const DetailsTableEditor = memo(function DetailsTableEditor({
  cardId,
  table,
  onUpdateCell,
  onResizeColumn,
  onResizeRow,
  onPasteTable,
  onStartTyping,
}: {
  cardId: string;
  table: DetailsTable;
  onUpdateCell: (cardId: string, rowIndex: number, columnIndex: number, value: string) => void;
  onResizeColumn: (cardId: string, columnIndex: number, width: number) => void;
  onResizeRow: (cardId: string, rowIndex: number, height: number) => void;
  onPasteTable: (cells: string[][]) => void;
  onStartTyping: () => void;
}) {
  const resizeStateRef = useRef<TableResizeState | null>(null);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;

      if (!resizeState) {
        return;
      }

      event.preventDefault();

      if (resizeState.type === "column") {
        onResizeColumn(
          cardId,
          resizeState.index,
          Math.max(
            MIN_TABLE_COLUMN_WIDTH,
            resizeState.startSize + event.clientX - resizeState.startClientX,
          ),
        );
        return;
      }

      onResizeRow(
        cardId,
        resizeState.index,
        Math.max(
          MIN_TABLE_ROW_HEIGHT,
          resizeState.startSize + event.clientY - resizeState.startClientY,
        ),
      );
    };

    const onPointerUp = () => {
      resizeStateRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [cardId, onResizeColumn, onResizeRow]);

  return (
    <div
      className="details-table"
      style={{
        gridTemplateColumns: table.columnWidths.map((width) => `${width}px`).join(" "),
      }}
    >
      {table.cells.map((row, rowIndex) =>
        row.map((cell, columnIndex) => (
          <div
            key={`${rowIndex}-${columnIndex}`}
            className="details-table-cell"
            style={{
              minHeight: `${table.rowHeights[rowIndex] ?? MIN_TABLE_ROW_HEIGHT}px`,
            }}
          >
            <textarea
              className="details-table-input"
              value={cell}
              onFocus={onStartTyping}
              onInput={onStartTyping}
              onChange={(event) => {
                onUpdateCell(cardId, rowIndex, columnIndex, event.currentTarget.value);
              }}
              onPaste={(event) => {
                const tableCells = parseClipboardTable(event.clipboardData.getData("text/plain"));

                if (!tableCells) {
                  return;
                }

                event.preventDefault();
                onPasteTable(tableCells);
              }}
              aria-label={`Celda ${rowIndex + 1}, ${columnIndex + 1}`}
            />
            {columnIndex < table.columnWidths.length - 1 ? (
              <span
                className="details-table-column-resizer"
                role="separator"
                aria-orientation="vertical"
                onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  resizeStateRef.current = {
                    type: "column",
                    index: columnIndex,
                    startClientX: event.clientX,
                    startSize: table.columnWidths[columnIndex],
                  };
                }}
              />
            ) : null}
            {rowIndex < table.cells.length - 1 ? (
              <span
                className="details-table-row-resizer"
                role="separator"
                aria-orientation="horizontal"
                onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  resizeStateRef.current = {
                    type: "row",
                    index: rowIndex,
                    startClientY: event.clientY,
                    startSize: table.rowHeights[rowIndex],
                  };
                }}
              />
            ) : null}
          </div>
        )),
      )}
    </div>
  );
});

const DetailsImageLayer = memo(function DetailsImageLayer({
  cardId,
  images,
  selectedImageId,
  onSelect,
  onMove,
  onResize,
  onRotate,
}: {
  cardId: string;
  images: DetailsImage[];
  selectedImageId: string | null;
  onSelect: (imageId: string | null) => void;
  onMove: (cardId: string, imageId: string, position: { x: number; y: number }) => void;
  onResize: (cardId: string, imageId: string, size: { width: number; height: number }) => void;
  onRotate: (cardId: string, imageId: string, rotation: number) => void;
}) {
  const interactionRef = useRef<DetailsImageInteraction | null>(null);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction) {
        return;
      }

      event.preventDefault();

      if (interaction.type === "move") {
        onMove(cardId, interaction.imageId, {
          x: interaction.originX + event.clientX - interaction.startX,
          y: interaction.originY + event.clientY - interaction.startY,
        });
        return;
      }

      if (interaction.type === "resize") {
        onResize(cardId, interaction.imageId, {
          width: interaction.originWidth + event.clientX - interaction.startX,
          height: interaction.originHeight + event.clientY - interaction.startY,
        });
        return;
      }

      const angle =
        (Math.atan2(event.clientY - interaction.centerY, event.clientX - interaction.centerX) *
          180) /
        Math.PI;
      onRotate(cardId, interaction.imageId, angle + 90);
    };

    const onPointerUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [cardId, onMove, onResize, onRotate]);

  if (images.length === 0) {
    return null;
  }

  return (
    <div className="details-image-layer" aria-label="Imagenes del detalle">
      {images.map((image) => {
        const isSelected = selectedImageId === image.id;

        return (
          <div
            key={image.id}
            className={`details-image-object ${isSelected ? "is-selected" : ""}`}
            style={{
              left: `${image.x}px`,
              top: `${image.y}px`,
              width: `${image.width}px`,
              height: `${image.height}px`,
              transform: `rotate(${image.rotation}deg)`,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(image.id);
              interactionRef.current = {
                type: "move",
                imageId: image.id,
                startX: event.clientX,
                startY: event.clientY,
                originX: image.x,
                originY: image.y,
              };
            }}
          >
            {image.previewUrl ? (
              <img className="details-image-object-img" src={image.previewUrl} alt={image.name} />
            ) : null}
            {isSelected ? (
              <>
                <button
                  type="button"
                  className="details-image-rotate"
                  aria-label="Rotar imagen"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.parentElement?.getBoundingClientRect();

                    if (!rect) {
                      return;
                    }

                    interactionRef.current = {
                      type: "rotate",
                      imageId: image.id,
                      centerX: rect.left + rect.width / 2,
                      centerY: rect.top + rect.height / 2,
                    };
                  }}
                />
                <button
                  type="button"
                  className="details-image-resize"
                  aria-label="Redimensionar imagen"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    interactionRef.current = {
                      type: "resize",
                      imageId: image.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      originWidth: image.width,
                      originHeight: image.height,
                    };
                  }}
                />
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

const DetailsTextBoxLayer = memo(function DetailsTextBoxLayer({
  cardId,
  textBoxes,
  selectedTextBoxId,
  onSelect,
  onUpdate,
  onStyle,
  onMove,
  onResize,
}: {
  cardId: string;
  textBoxes: DetailsTextBox[];
  selectedTextBoxId: string | null;
  onSelect: (textBoxId: string | null) => void;
  onUpdate: (cardId: string, textBoxId: string, text: string) => void;
  onStyle: (
    cardId: string,
    textBoxId: string,
    patch: Partial<Pick<DetailsTextBox, "fontSize" | "color" | "bold" | "strike" | "bulleted" | "align" | "linkUrl">>,
  ) => void;
  onMove: (cardId: string, textBoxId: string, position: { x: number; y: number }) => void;
  onResize: (cardId: string, textBoxId: string, size: { width: number; height: number }) => void;
}) {
  const interactionRef = useRef<DetailsTextBoxInteraction | null>(null);
  const editingEditorRef = useRef<HTMLDivElement | null>(null);
  const editingPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastFocusedEditingTextBoxIdRef = useRef<string | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [openMenu, setOpenMenu] = useState<"color" | "size" | "align" | null>(null);

  useEffect(() => {
    if (selectedTextBoxId && editingTextBoxId && selectedTextBoxId !== editingTextBoxId) {
      setEditingTextBoxId(null);
      editingPointRef.current = null;
    }
  }, [editingTextBoxId, selectedTextBoxId]);

  useEffect(() => {
    if (!editingTextBoxId) {
      return;
    }

    const nextEditingTextBox = textBoxes.find((textBox) => textBox.id === editingTextBoxId);

    if (!nextEditingTextBox) {
      setEditingTextBoxId(null);
      editingPointRef.current = null;
      return;
    }

    setEditingDraft((currentDraft) => (currentDraft === nextEditingTextBox.text ? currentDraft : nextEditingTextBox.text));
  }, [editingTextBoxId, textBoxes]);

  useLayoutEffect(() => {
    if (!editingTextBoxId) {
      lastFocusedEditingTextBoxIdRef.current = null;
      return;
    }

    const editor = editingEditorRef.current;

    if (!editor) {
      return;
    }

    const isNewEditingTarget = lastFocusedEditingTextBoxIdRef.current !== editingTextBoxId;

    if (!isNewEditingTarget && editor.innerText !== editingDraft && document.activeElement !== editor) {
      editor.innerText = editingDraft;
    }

    if (isNewEditingTarget) {
      if (editor.innerText !== editingDraft) {
        editor.innerText = editingDraft;
      }

      editor.focus({ preventScroll: true });

      const point = editingPointRef.current;

      if (point && !placeCursorAtPoint(editor, point.x, point.y)) {
        placeCursorAtEnd(editor);
      } else if (!point) {
        placeCursorAtEnd(editor);
      }

      lastFocusedEditingTextBoxIdRef.current = editingTextBoxId;
    }
  }, [editingDraft, editingTextBoxId]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction) {
        return;
      }

      event.preventDefault();

      if (interaction.type === "move") {
        const deltaX = event.clientX - interaction.startX;
        const deltaY = event.clientY - interaction.startY;

        if (!interaction.hasMoved && Math.hypot(deltaX, deltaY) >= 4) {
          interaction.hasMoved = true;
        }

        if (!interaction.hasMoved) {
          return;
        }

        onMove(cardId, interaction.textBoxId, {
          x: interaction.originX + deltaX,
          y: interaction.originY + deltaY,
        });
        return;
      }

      onResize(cardId, interaction.textBoxId, {
        width: interaction.originWidth + event.clientX - interaction.startX,
        height: interaction.originHeight + event.clientY - interaction.startY,
      });
    };

    const onPointerUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [cardId, onMove, onResize]);

  if (textBoxes.length === 0) {
    return null;
  }

  return (
    <div className="details-text-box-layer" aria-label="Textos libres del detalle">
      {textBoxes.map((textBox) => {
        const isSelected = selectedTextBoxId === textBox.id;

        return (
          <div
            key={textBox.id}
            data-text-box-id={textBox.id}
            className={`details-text-box ${isSelected ? "is-selected" : ""} ${textBox.text ? "" : "is-empty"}`}
            style={{
              left: `${textBox.x}px`,
              top: `${textBox.y}px`,
              width: `${textBox.width}px`,
              minHeight: `${textBox.height}px`,
              color: textBox.color,
              textAlign: textBox.align,
            }}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement | null;
              onSelect(textBox.id);

              if (target?.closest(".details-text-box-editor")) {
                return;
              }

              if (event.detail >= 2 && target?.closest(".details-text-box-display")) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              interactionRef.current = {
                type: "move",
                textBoxId: textBox.id,
                startX: event.clientX,
                startY: event.clientY,
                originX: textBox.x,
                originY: textBox.y,
                hasMoved: false,
              };
            }}
          >
            {isSelected ? (
              <div className="details-text-toolbar" onPointerDown={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="details-text-toolbar-color"
                  aria-label="Color de texto"
                  style={{ color: textBox.color }}
                  onClick={() => setOpenMenu(openMenu === "color" ? null : "color")}
                />
                <button
                  type="button"
                  className="details-text-toolbar-button"
                  onClick={() => setOpenMenu(openMenu === "size" ? null : "size")}
                >
                  Aa
                </button>
                <button
                  type="button"
                  className="details-text-toolbar-select"
                  onClick={() => setOpenMenu(openMenu === "size" ? null : "size")}
                >
                  {TEXT_BOX_FONT_SIZES[textBox.fontSize].label}
                </button>
                <span className="details-text-toolbar-separator" />
                <button
                  type="button"
                  className={`details-text-toolbar-button ${textBox.bold ? "is-active" : ""}`}
                  title="Negrita Ctrl+B"
                  onClick={() => onStyle(cardId, textBox.id, { bold: !textBox.bold })}
                >
                  B
                </button>
                <button
                  type="button"
                  className={`details-text-toolbar-button ${textBox.strike ? "is-active" : ""}`}
                  title="Tachado"
                  onClick={() => onStyle(cardId, textBox.id, { strike: !textBox.strike })}
                >
                  S
                </button>
                <button
                  type="button"
                  className={`details-text-toolbar-button ${textBox.linkUrl ? "is-active" : ""}`}
                  title="Crear enlace Ctrl+Shift+U"
                  onClick={() => {
                    const nextUrl = textBox.linkUrl ? null : window.prompt("URL del enlace")?.trim() || null;
                    onStyle(cardId, textBox.id, { linkUrl: nextUrl });
                  }}
                >
                  Link
                </button>
                <button
                  type="button"
                  className={`details-text-toolbar-button ${textBox.bulleted ? "is-active" : ""}`}
                  title="Lista con vinetas Ctrl+Shift+8"
                  onClick={() => onStyle(cardId, textBox.id, { bulleted: !textBox.bulleted })}
                >
                  •
                </button>
                <button
                  type="button"
                  className="details-text-toolbar-button"
                  onClick={() => setOpenMenu(openMenu === "align" ? null : "align")}
                >
                  {textBox.align === "left" ? "≡" : textBox.align === "center" ? "≣" : "☰"}
                </button>
                {openMenu === "color" ? (
                  <div className="details-text-menu is-color">
                    {TEXT_BOX_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="details-text-color-swatch"
                        style={{ background: color }}
                        aria-label={`Color ${color}`}
                        onClick={() => {
                          onStyle(cardId, textBox.id, { color });
                          setOpenMenu(null);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
                {openMenu === "size" ? (
                  <div className="details-text-menu is-size">
                    {(Object.keys(TEXT_BOX_FONT_SIZES) as DetailsTextBox["fontSize"][]).map((fontSize) => (
                      <button
                        key={fontSize}
                        type="button"
                        className={textBox.fontSize === fontSize ? "is-active" : ""}
                        onClick={() => {
                          onStyle(cardId, textBox.id, { fontSize });
                          setOpenMenu(null);
                        }}
                      >
                        {TEXT_BOX_FONT_SIZES[fontSize].label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {openMenu === "align" ? (
                  <div className="details-text-menu is-align">
                    {(["left", "center", "right"] as DetailsTextBox["align"][]).map((align) => (
                      <button
                        key={align}
                        type="button"
                        className={textBox.align === align ? "is-active" : ""}
                        onClick={() => {
                          onStyle(cardId, textBox.id, { align });
                          setOpenMenu(null);
                        }}
                      >
                        {align === "left" ? "Izquierda" : align === "center" ? "Centro" : "Derecha"}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {editingTextBoxId === textBox.id ? (
              <div
                ref={editingEditorRef}
                className={`details-text-box-editor ${TEXT_BOX_FONT_SIZES[textBox.fontSize].className} ${
                  textBox.bulleted ? "is-bulleted" : ""
                }`}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                data-placeholder="Agregar texto"
                style={{
                  fontWeight: textBox.bold ? 700 : 400,
                  textDecoration: `${textBox.strike ? "line-through" : ""} ${textBox.linkUrl ? "underline" : ""}`.trim() || undefined,
                }}
                onInput={(event) => {
                  const nextText = event.currentTarget.innerText ?? "";
                  setEditingDraft(nextText);
                  onUpdate(cardId, textBox.id, nextText);
                }}
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget as Node | null;
                  const wrapper = event.currentTarget.closest(".details-text-box");

                  if (nextTarget && wrapper instanceof HTMLElement && wrapper.contains(nextTarget)) {
                    return;
                  }

                  setEditingTextBoxId((currentId) => (currentId === textBox.id ? null : currentId));
                  editingPointRef.current = null;
                  onUpdate(cardId, textBox.id, event.currentTarget.innerText ?? "");
                }}
              />
            ) : (
              <div
                className={`details-text-box-display ${TEXT_BOX_FONT_SIZES[textBox.fontSize].className} ${
                  textBox.bulleted ? "is-bulleted" : ""
                }`}
                role="textbox"
                aria-multiline="true"
                data-placeholder="Agregar texto"
                style={{
                  fontWeight: textBox.bold ? 700 : 400,
                  textDecoration: `${textBox.strike ? "line-through" : ""} ${textBox.linkUrl ? "underline" : ""}`.trim() || undefined,
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  interactionRef.current = null;
                  editingPointRef.current = { x: event.clientX, y: event.clientY };
                  onSelect(textBox.id);
                  setEditingTextBoxId(textBox.id);
                  setEditingDraft(textBox.text);
                }}
              >
                {textBox.text}
              </div>
            )}
            {isSelected ? (
              <button
                type="button"
                className="details-text-box-resize"
                aria-label="Redimensionar texto"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  interactionRef.current = {
                    type: "resize",
                    textBoxId: textBox.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originWidth: textBox.width,
                    originHeight: textBox.height,
                  };
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

const ExerciseReferencesLayer = memo(function ExerciseReferencesLayer({
  cardId,
  exerciseSet,
  category,
  onOpenReference,
  onMove,
}: {
  cardId: string;
  exerciseSet: ExerciseSetView | null;
  category: StudyCategory | null;
  onOpenReference: (sourceSectionId: "definitions" | "theorems", sourceCardId: string) => void;
  onMove: (cardId: string, position: { x: number; y: number }) => void;
}) {
  const interactionRef = useRef<ExerciseSetInteraction>(null);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction || interaction.type !== "move") {
        return;
      }

      event.preventDefault();

      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;

      if (!interaction.hasMoved && Math.hypot(deltaX, deltaY) >= 4) {
        interaction.hasMoved = true;
      }

      if (!interaction.hasMoved) {
        return;
      }

      onMove(cardId, {
        x: interaction.originX + deltaX,
        y: interaction.originY + deltaY,
      });
    };

    const onPointerUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [cardId, onMove]);

  if (!exerciseSet) {
    return null;
  }

  const sourceMap = new Map<string, { card: QuestionCard; sourceSectionId: "definitions" | "theorems" }>();

  if (category) {
    for (const [sectionId, section] of Object.entries(category.sections ?? {})) {
      if (sectionId !== "definitions" && sectionId !== "theorems") {
        continue;
      }

      for (const sourceCard of Object.values(section.cards)) {
        sourceMap.set(sourceCard.id, { card: sourceCard, sourceSectionId: sectionId as "definitions" | "theorems" });
      }
    }
  }

  const columns = Math.max(
    1,
    Math.min(2, Math.floor(exerciseSet.width / (EXERCISE_RESULT_CARD_WIDTH + EXERCISE_RESULT_GAP * 2)) || 1),
  );

  return (
    <div className="exercise-set-layer" aria-label="Conjunto de ejercicios">
      <div
        className="exercise-set-board"
        style={{
          left: `${exerciseSet.x}px`,
          top: `${exerciseSet.y}px`,
          width: `${exerciseSet.width}px`,
        }}
      >
        <button
          type="button"
          className="exercise-set-board-header"
          aria-label="Mover conjunto de ejercicios"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            interactionRef.current = {
              type: "move",
              startX: event.clientX,
              startY: event.clientY,
              originX: exerciseSet.x,
              originY: exerciseSet.y,
              hasMoved: false,
            };
          }}
        >
          <span>Ejercicios</span>
          <span className="exercise-set-board-count">{exerciseSet.references.length}</span>
        </button>

        <div
          className="exercise-set-board-grid"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {exerciseSet.references.length === 0 ? (
            <div className="exercise-set-empty">
              No se encontraron resultados en Definiciones y Teoremas.
            </div>
          ) : (
            exerciseSet.references.map((reference) => {
            const source = sourceMap.get(reference.sourceCardId);

            if (!source) {
              return (
                <div key={`${reference.sourceSectionId}:${reference.sourceCardId}`} className="exercise-set-item is-missing">
                  <span className="exercise-set-item-title">Tarjeta eliminada</span>
                </div>
              );
            }

            return (
              <button
                key={`${reference.sourceSectionId}:${reference.sourceCardId}`}
                type="button"
                className="exercise-set-item"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onOpenReference(source.sourceSectionId, source.card.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenReference(source.sourceSectionId, source.card.id);
                  }
                }}
              >
                <div className="exercise-set-item-preview">
                  <CardContent card={source.card} mode="preview" />
                </div>
                <span className="exercise-set-item-title">{source.card.text || "Sin título"}</span>
              </button>
            );
            })
          )}
        </div>
      </div>
    </div>
  );
});

const CategoryHome = memo(function CategoryHome({
  categories,
  selectedCategoryId,
  categoryDraftText,
  renamingCategoryId,
  renameDraft,
  onSelect,
  onOpenMain,
  onOpenSection,
  onStartRename,
  onRenameDraft,
  onConfirmRename,
  onCancelRename,
}: {
  categories: StudyCategory[];
  selectedCategoryId: string | null;
  categoryDraftText: string;
  renamingCategoryId: string | null;
  renameDraft: string;
  onSelect: (categoryId: string | null) => void;
  onOpenMain: (categoryId: string) => void;
  onOpenSection: (categoryId: string, sectionId: string) => void;
  onStartRename: (category: StudyCategory) => void;
  onRenameDraft: (value: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
}) {
  const holdTimeoutRef = useRef<number | null>(null);
  const didHoldRef = useRef(false);

  const clearHoldTimer = () => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  };

  useEffect(() => clearHoldTimer, []);
  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null;
  const isRenaming = selectedCategory ? renamingCategoryId === selectedCategory.id : false;

  return (
    <div className="category-home" aria-label="Categorias">
      <div className="question-stage-backdrop" />
      <div className="category-map-home">
        {HOME_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`category-section-card ${section.className}`}
            disabled={!selectedCategory}
            onClick={() => {
              if (selectedCategory) {
                onOpenSection(selectedCategory.id, section.id);
              }
            }}
          >
            {section.name}
          </button>
        ))}

        <button
          type="button"
          className="category-main-orb is-selected"
          disabled={!selectedCategory}
          onClick={() => {
            if (didHoldRef.current) {
              didHoldRef.current = false;
              return;
            }

            if (selectedCategory && !isRenaming) {
              onOpenMain(selectedCategory.id);
            }
          }}
          onPointerDown={() => {
            if (!selectedCategory) {
              return;
            }

            onSelect(selectedCategory.id);
            didHoldRef.current = false;
            clearHoldTimer();
            holdTimeoutRef.current = window.setTimeout(() => {
              holdTimeoutRef.current = null;
              didHoldRef.current = true;
              onStartRename(selectedCategory);
            }, CLOSE_HOLD_DELETE_MS);
          }}
          onPointerUp={clearHoldTimer}
          onPointerCancel={clearHoldTimer}
          onPointerLeave={clearHoldTimer}
        >
          {selectedCategory && isRenaming ? (
            <input
              className="category-rename-input"
              value={renameDraft}
              autoFocus
              onChange={(event) => onRenameDraft(event.currentTarget.value)}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onConfirmRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
            />
          ) : (
            <span>{selectedCategory?.name ?? "Escribe una categoria"}</span>
          )}
        </button>
      </div>

      {categoryDraftText ? (
        <div className="draft-composer-shell" aria-live="polite">
          <div className="draft-composer">
            <div className="draft-copy">
              <NodeLabel text={categoryDraftText} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

const CardContent = memo(function CardContent({
  card,
  mode,
}: {
  card: QuestionCard;
  mode: "preview" | "full";
}) {
  return (
    <>
      {card.image?.previewUrl ? (
        <div
          className={
            mode === "full" ? "question-card-image-shell is-full" : "question-card-image-shell"
          }
        >
          <img
            className={mode === "full" ? "question-card-image is-full" : "question-card-image"}
            src={card.image.previewUrl}
            alt={card.image.name || "Imagen pegada"}
          />
        </div>
      ) : null}

      {card.text ? (
        <div className={mode === "full" ? "question-card-copy is-full" : "question-card-copy"}>
          <NodeLabel text={card.text} />
        </div>
      ) : null}
    </>
  );
});

const QuestionCardSurface = memo(function QuestionCardSurface({
  card,
  isSelected,
  isSearchMatch,
  isActiveSearchMatch,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onMeasure,
}: {
  card: QuestionCard;
  isSelected: boolean;
  isSearchMatch: boolean;
  isActiveSearchMatch: boolean;
  onPointerDown: (cardId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMeasure: (cardId: string, size: CardSize) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const size = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      if (size.width > 0 && size.height > 0) {
        onMeasure(card.id, size);
      }
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [card.id, card.image?.previewUrl, card.text, onMeasure]);

  return (
    <div
      ref={ref}
      className={`question-card ${isSelected ? "is-selected" : ""} ${
        isSearchMatch ? "is-search-match" : ""
      } ${isActiveSearchMatch ? "is-active-search-match" : ""}`}
      style={{
        left: `${card.position.x}px`,
        top: `${card.position.y}px`,
        zIndex: card.zIndex,
      }}
      onPointerDown={(event) => onPointerDown(card.id, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label="Duda"
    >
      <CardContent card={card} mode="preview" />
    </div>
  );
});

async function getImageDimensions(previewUrl: string) {
  return new Promise<{ width?: number; height?: number }>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth || undefined,
        height: image.naturalHeight || undefined,
      });
    };

    image.onerror = () => {
      reject(new Error("No se pudo leer la imagen pegada."));
    };

    image.src = previewUrl;
  });
}

async function createDraftImageFromFile(file: File): Promise<DraftImage> {
  const previewUrl = URL.createObjectURL(file);

  try {
    const dimensions = await getImageDimensions(previewUrl);

    return {
      blob: file,
      previewUrl,
      mimeType: file.type || "image/png",
      name: file.name || "imagen-pegada",
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

function getDraftCommandHint(draftText: string, hasImage: boolean) {
  const normalized = draftText.trim();

  if (hasImage || !normalized) {
    return null;
  }

  if (normalized === "<-") {
    return "Enter: resultado anterior";
  }

  if (normalized === "->") {
    return "Enter: resultado siguiente";
  }

  if (normalized.startsWith(">")) {
    return "Enter: buscar en las dudas";
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T) {
  return new Promise<T>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      resolve(fallbackValue);
    }, timeoutMs);

    void promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timeoutId);
        resolve(fallbackValue);
      });
  });
}

async function hasDirectoryReadWriteAccess(handle: FileSystemDirectoryHandle) {
  const readwritePermission = await queryDirectoryPermission(handle, "readwrite");

  if (readwritePermission === "granted") {
    return true;
  }

  try {
    const requestedReadwritePermission = await requestDirectoryPermission(handle, "readwrite");

    if (requestedReadwritePermission === "granted") {
      return true;
    }
  } catch {}

  return false;
}

export function StudyTreeApp() {
  const {
    categories,
    activeCategoryId,
    activeMapKind,
    activeSectionId,
    selectedCategoryId,
    categoryDraftText,
    cards,
    selectedCardId,
    openedCardId,
    draftText,
    draftImage,
    canUndoDeletion,
    searchResults,
    activeSearchResultIndex,
    searchFeedback,
    pasteFeedback,
    pasteFeedbackVersion,
    createCategory,
    renameCategory,
    selectCategory,
    openMainCategoryMap,
    openCategorySection,
    closeActiveMap,
    selectNextCategory,
    selectPreviousCategory,
    appendCategoryDraftCharacter,
    backspaceCategoryDraft,
    clearCategoryDraft,
    confirmCategoryDraft,
    appendDraftCharacter,
    appendDraftText,
    attachDraftImage,
    backspaceDraft,
    clearDraft,
    clearDraftImage,
    confirmDraft,
    updateCardDetails,
    ensureDetailsTable,
    addDetailsTableRow,
    addDetailsTableColumn,
    setDetailsTableFromCells,
    updateDetailsTableCell,
    resizeDetailsTableColumn,
    resizeDetailsTableRow,
    addDetailsImage,
    moveDetailsImage,
    resizeDetailsImage,
    rotateDetailsImage,
    deleteDetailsImage,
    addDetailsTextBox,
    updateDetailsTextBox,
    updateDetailsTextBoxStyle,
    moveDetailsTextBox,
    resizeDetailsTextBox,
    deleteDetailsTextBox,
    setExerciseSet,
    moveExerciseSet,
    selectCard,
    openCard,
    closeCard,
    moveCard,
    setCardSize,
    deleteCard,
    deleteSelectedCard,
    undoLastDeletion,
    clearDeletionUndo,
    clearPasteFeedback,
    setPasteFeedback,
    getProjectSnapshot,
    getPendingImageAssets,
    markCardImagesPersisted,
    loadProjectSnapshot,
    mergeRemoteProjectSnapshot,
    resetProject,
    runSearch,
    goToNextSearchResult,
    goToPreviousSearchResult,
    clearSearchState,
  } = useTreeStore();
  const pendingImageAssets = getPendingImageAssets();
  const projectSignature = JSON.stringify(getProjectSnapshot());
  const pendingAssetSignature = pendingImageAssets.map((asset) => asset.path).join("\u0000");
  const categoriesList = Object.values(categories).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const activeCategory = activeCategoryId ? categories[activeCategoryId] ?? null : null;
  const activeMapTitle =
    activeMapKind === "section" && activeCategory && activeSectionId
      ? activeCategory.sections[activeSectionId]?.name ?? activeCategory.name
      : activeCategory?.name ?? "";
  const cardsList = Object.values(cards).sort((left, right) => left.zIndex - right.zIndex);
  const activeSearchResult: SearchResult | null =
    activeSearchResultIndex >= 0 ? searchResults[activeSearchResultIndex] ?? null : null;
  const matchedCardIds = new Set(searchResults.map((result) => result.cardId));
  const openedCard = openedCardId ? cards[openedCardId] ?? null : null;
  const openedExerciseSet = openedCard?.exerciseSet ? openedCard.exerciseSet : null;
  const isModalOpen = Boolean(openedCard);
  const draftCommandHint = getDraftCommandHint(draftText, Boolean(draftImage));
  const stageRef = useRef<HTMLElement | null>(null);
  const hasAttemptedRemoteBootRef = useRef(false);
  const lastPersistedProjectSignatureRef = useRef<string | null>(null);
  const remoteVersionRef = useRef<number>(0);
  const latestEventIdRef = useRef<number>(0);
  const isApplyingRemoteSnapshotRef = useRef(false);
  const isSavingProjectRef = useRef(false);
  const needsSaveAfterCurrentRef = useRef(false);
  const lastPresenceSentAtRef = useRef(0);
  const lastPresenceRef = useRef<PresenceState["cursor"]>(null);
  const lastDetailsPointerRef = useRef<{ x: number; y: number } | null>(null);
  const undoTimeoutRef = useRef<number | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const cameraRef = useRef({ x: 0, y: 0 });
  const closeHoldTimeoutRef = useRef<number | null>(null);
  const closeHoldDidDeleteRef = useRef(false);
  const [stageSize, setStageSize] = useState<StageSize>({
    width: DEFAULT_STAGE_WIDTH,
    height: DEFAULT_STAGE_HEIGHT,
  });
  const [camera, setCameraState] = useState({ x: 0, y: 0 });
  const [bootState, setBootState] = useState<AppBootState>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<CollaboratorIdentity | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [presence, setPresence] = useState<PresenceState[]>([]);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const [showSearchFeedback, setShowSearchFeedback] = useState(false);
  const [showPasteFeedback, setShowPasteFeedback] = useState(false);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [selectedDetailsImageId, setSelectedDetailsImageId] = useState<string | null>(null);
  const [selectedDetailsTextBoxId, setSelectedDetailsTextBoxId] = useState<string | null>(null);
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [categoryRenameDraft, setCategoryRenameDraft] = useState("");
  const [mapSearchText, setMapSearchText] = useState("");
  const worldHeight = Math.max(
    stageSize.height,
    ...cardsList.map((card) => card.position.y + (card.size?.height ?? CARD_FALLBACK_HEIGHT) + 260),
  );

  const setCamera = (nextCamera: { x: number; y: number }) => {
    cameraRef.current = nextCamera;
    setCameraState(nextCamera);
  };

  const applyRemoteProjectSnapshot = useEffectEvent((project: RemoteProject) => {
    const previousCamera = cameraRef.current;

    isApplyingRemoteSnapshotRef.current = true;
    mergeRemoteProjectSnapshot(project.snapshot);
    remoteVersionRef.current = project.snapshotVersion;
    latestEventIdRef.current = project.latestEventId;
    lastPersistedProjectSignatureRef.current = JSON.stringify(
      useTreeStore.getState().getProjectSnapshot(),
    );
    setCamera(previousCamera);
    window.setTimeout(() => {
      isApplyingRemoteSnapshotRef.current = false;
    }, 0);
  });

  const syncRemoteProject = useEffectEvent(async () => {
    if (!identity || bootState !== "ready") {
      return;
    }

    try {
      const params = new URLSearchParams({
        sinceEventId: String(latestEventIdRef.current),
        snapshotVersion: String(remoteVersionRef.current),
        clientId: identity.clientId,
      });
      const response = await fetch(`/api/sync?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const sync = (await response.json()) as SyncResponse;
      latestEventIdRef.current = Math.max(latestEventIdRef.current, sync.latestEventId);

      if (sync.hasRemoteChanges && sync.project) {
        applyRemoteProjectSnapshot(sync.project);
        return;
      }

      remoteVersionRef.current = Math.max(remoteVersionRef.current, sync.snapshotVersion);
    } catch (error) {
      console.error("No se pudo sincronizar el proyecto.", error);
    }
  });

  const saveRemoteProject = useEffectEvent(async () => {
    if (!identity || bootState !== "ready" || isApplyingRemoteSnapshotRef.current) {
      return;
    }

    if (isSavingProjectRef.current) {
      needsSaveAfterCurrentRef.current = true;
      return;
    }

    const snapshot = useTreeStore.getState().getProjectSnapshot();
    const signature = JSON.stringify(snapshot);

    if (signature === lastPersistedProjectSignatureRef.current) {
      return;
    }

    isSavingProjectRef.current = true;

    try {
      await uploadPendingAssets(useTreeStore.getState().getPendingImageAssets());
      const response = await fetch("/api/project", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snapshot,
          expectedVersion: remoteVersionRef.current,
          clientId: identity.clientId,
        }),
      });
      const result = (await response.json()) as RemoteSaveResponse;

      if (response.status === 409 || !result.ok) {
        console.info("Snapshot remoto mas nuevo; se sincroniza sin cambiar de vista.");
        applyRemoteProjectSnapshot(result.project);
        return;
      }

      remoteVersionRef.current = result.project.snapshotVersion;
      latestEventIdRef.current = result.project.latestEventId;
      lastPersistedProjectSignatureRef.current = signature;
      markCardImagesPersisted(useTreeStore.getState().getPendingImageAssets().map((asset) => asset.cardId));
      void syncRemoteProject();
    } catch (error) {
      console.error("No se pudo guardar el proyecto remoto.", error);
    } finally {
      isSavingProjectRef.current = false;

      if (needsSaveAfterCurrentRef.current) {
        needsSaveAfterCurrentRef.current = false;
        void saveRemoteProject();
      }
    }
  });

  const sendPresence = useEffectEvent(
    (
      cursor: PresenceState["cursor"],
      options?: {
        surface?: PresenceState["surface"];
        openedCardId?: string | null;
      },
    ) => {
    if (!identity || bootState !== "ready") {
      return;
    }

    const now = Date.now();
    lastPresenceRef.current = cursor;

    if (now - lastPresenceSentAtRef.current < PRESENCE_SEND_MS) {
      return;
    }

    lastPresenceSentAtRef.current = now;

    void fetch("/api/presence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...identity,
        cursor,
        surface: options?.surface ?? (openedCardId ? "card-modal" : "map"),
        activeCategoryId,
        activeMapKind,
        activeSectionId,
        openedCardId: options?.openedCardId ?? openedCardId ?? null,
      }),
    }).catch((error) => {
      console.error("No se pudo actualizar presencia.", error);
    });
  });

  const pasteDetailsImage = useEffectEvent(async (cardId: string, file: File) => {
    try {
      const image = await createDraftImageFromFile(file);
      const overlay = stageRef.current?.querySelector(".card-modal-overlay");
      const modalBody = stageRef.current?.querySelector(".card-modal-body");
      const caretPoint = getCaretClientPoint();
      const bodyRect = modalBody instanceof HTMLElement ? modalBody.getBoundingClientRect() : null;
      const overlayRect =
        overlay instanceof HTMLElement ? overlay.getBoundingClientRect() : stageRef.current?.getBoundingClientRect();
      const maxWidth = Math.min(image.width ?? 320, 420);
      const aspectRatio = image.width && image.height ? image.height / image.width : 0.65;
      const width = Math.max(120, maxWidth);
      const height = Math.max(90, width * aspectRatio);
      const baseX = caretPoint && bodyRect ? caretPoint.x - bodyRect.left : (overlayRect?.width ?? width) / 2 - width / 2;
      const baseY = caretPoint && bodyRect ? caretPoint.y - bodyRect.top + 28 : (overlayRect?.height ?? height) / 2 - height / 2;
      const imageId = addDetailsImage(cardId, image, {
        x: Math.max(0, baseX),
        y: Math.max(0, baseY),
        width,
        height,
      });

      setSelectedDetailsImageId(imageId);
      setShowTableMenu(false);
    } catch {
      setPasteFeedback("image-error");
    }
  });

  const createDetailsTextBox = useEffectEvent((cardId: string) => {
    const width = 280;
    const height = 80;
    const pointerPoint = lastDetailsPointerRef.current;
    const x = pointerPoint ? Math.max(16, pointerPoint.x - width / 2) : 24;
    const y = pointerPoint ? Math.max(16, pointerPoint.y - height / 2) : 160;
    const textBoxId = addDetailsTextBox(cardId, {
      x,
      y,
      width,
      height,
    });

    setSelectedDetailsImageId(null);
    setSelectedDetailsTextBoxId(textBoxId);

    return textBoxId;
  });

  const createExerciseSet = useEffectEvent((cardId: string) => {
    const activeCategory = activeCategoryId ? categories[activeCategoryId] ?? null : null;
    const sourceCard = cards[cardId];

    if (!activeCategory || !sourceCard) {
      return null;
    }

    const sectionCandidates: ExerciseCandidate[] = [
      ...Object.values(activeCategory.sections?.definitions?.cards ?? {}).map((card) => ({
        card,
        sourceSectionId: "definitions" as const,
        sourceCardId: card.id,
      })),
      ...Object.values(activeCategory.sections?.theorems?.cards ?? {}).map((card) => ({
        card,
        sourceSectionId: "theorems" as const,
        sourceCardId: card.id,
      })),
    ];

    const query = `${sourceCard.text} ${sourceCard.detailsText ?? ""}`.trim();
    const matches = collectExerciseMatches(query, sectionCandidates);
    const references = matches.map((match) => ({
      sourceSectionId: match.sourceSectionId,
      sourceCardId: match.sourceCardId,
    }));

    const modalBody = stageRef.current?.querySelector(".card-modal-body");
    const bodyElement = modalBody instanceof HTMLElement ? modalBody : null;
    const existingSet = sourceCard.exerciseSet ?? null;
    const width = existingSet?.width ?? Math.min(760, Math.max(320, (bodyElement?.clientWidth ?? 760) - 48));
    const y = existingSet ? existingSet.y : (bodyElement?.scrollTop ?? 0) + (bodyElement?.clientHeight ?? 0) + 32;
    const exerciseSet: ExerciseSetView = {
      id: existingSet?.id ?? makeClientId(),
      query,
      x: existingSet?.x ?? 24,
      y: Math.max(24, Math.round(y)),
      width: Math.max(320, Math.round(width)),
      references,
    };

    setExerciseSet(cardId, {
      id: exerciseSet.id,
      query: exerciseSet.query,
      x: exerciseSet.x,
      y: exerciseSet.y,
      width: exerciseSet.width,
      references: exerciseSet.references.map((reference) => ({ ...reference })),
      createdAt: existingSet?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    if (bodyElement) {
      window.requestAnimationFrame(() => {
        bodyElement.scrollTo({
          top: Math.max(0, exerciseSet.y - 96),
          behavior: "smooth",
        });
      });
    }

    return exerciseSet.id;
  });

  const openExerciseReference = useEffectEvent((sourceSectionId: "definitions" | "theorems", sourceCardId: string) => {
    if (!activeCategoryId) {
      return;
    }

    if (activeMapKind !== "section" || activeSectionId !== sourceSectionId) {
      openCategorySection(activeCategoryId, sourceSectionId);
    }

    selectCard(sourceCardId);
    openCard(sourceCardId);
  });

  const clearUndoTimer = useEffectEvent(() => {
    if (undoTimeoutRef.current !== null) {
      window.clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
  });

  const clearCloseHoldTimer = useEffectEvent(() => {
    if (closeHoldTimeoutRef.current !== null) {
      window.clearTimeout(closeHoldTimeoutRef.current);
      closeHoldTimeoutRef.current = null;
    }
  });

  const onGlobalKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (bootState !== "ready") {
      return;
    }

    if (event.defaultPrevented || event.isComposing) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();

      const activeElement = document.activeElement as HTMLElement | null;

      if (!activeCategoryId) {
        if (renamingCategoryId) {
          setRenamingCategoryId(null);
          setCategoryRenameDraft("");
          return;
        }

        clearCategoryDraft();
        selectCategory(null);
        return;
      }

      if (activeElement?.isContentEditable) {
        activeElement.blur();
        return;
      }

      if (openedCardId) {
        closeCard();
        return;
      }

      if (selectedCardId || searchResults.length > 0) {
        selectCard(null);
        clearSearchState();
        return;
      }

      closeActiveMap();
      return;
    }

    if (isEditableTarget(event.target)) {
      if (openedCardId && selectedDetailsTextBoxId && event.ctrlKey && !event.altKey) {
        if (event.key.toLocaleLowerCase() === "b") {
          event.preventDefault();
          const textBox = cards[openedCardId]?.detailsTextBoxes?.find((item) => item.id === selectedDetailsTextBoxId);
          updateDetailsTextBoxStyle(openedCardId, selectedDetailsTextBoxId, { bold: !textBox?.bold });
          return;
        }

        if (event.shiftKey && event.key === "8") {
          event.preventDefault();
          const textBox = cards[openedCardId]?.detailsTextBoxes?.find((item) => item.id === selectedDetailsTextBoxId);
          updateDetailsTextBoxStyle(openedCardId, selectedDetailsTextBoxId, { bulleted: !textBox?.bulleted });
          return;
        }

        if (event.shiftKey && event.key.toLocaleLowerCase() === "u") {
          event.preventDefault();
          const textBox = cards[openedCardId]?.detailsTextBoxes?.find((item) => item.id === selectedDetailsTextBoxId);
          const nextUrl = textBox?.linkUrl ? null : window.prompt("URL del enlace")?.trim() || null;
          updateDetailsTextBoxStyle(openedCardId, selectedDetailsTextBoxId, { linkUrl: nextUrl });
          return;
        }
      }
      return;
    }

    if (!activeCategoryId) {
      if (renamingCategoryId) {
        return;
      }

      if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();

        if (categoriesList.length === 0) {
          return;
        }

        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          selectPreviousCategory();
        } else {
          selectNextCategory();
        }
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        backspaceCategoryDraft();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();

        if (categoryDraftText.trim()) {
          confirmCategoryDraft();
          return;
        }

        if (selectedCategoryId) {
          openMainCategoryMap(selectedCategoryId);
        }

        return;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        appendCategoryDraftCharacter(event.key);
      }

      return;
    }

    if (
      openedCardId &&
      selectedDetailsTextBoxId &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !isEditableTarget(event.target) &&
      (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault();
      deleteDetailsTextBox(openedCardId, selectedDetailsTextBoxId);
      setSelectedDetailsTextBoxId(null);
      return;
    }

    if (openedCardId && selectedDetailsTextBoxId && event.ctrlKey && !event.altKey) {
      if (event.key.toLocaleLowerCase() === "b") {
        event.preventDefault();
        const textBox = cards[openedCardId]?.detailsTextBoxes?.find((item) => item.id === selectedDetailsTextBoxId);
        updateDetailsTextBoxStyle(openedCardId, selectedDetailsTextBoxId, { bold: !textBox?.bold });
        return;
      }

      if (event.shiftKey && event.key === "8") {
        event.preventDefault();
        const textBox = cards[openedCardId]?.detailsTextBoxes?.find((item) => item.id === selectedDetailsTextBoxId);
        updateDetailsTextBoxStyle(openedCardId, selectedDetailsTextBoxId, { bulleted: !textBox?.bulleted });
        return;
      }

      if (event.shiftKey && event.key.toLocaleLowerCase() === "u") {
        event.preventDefault();
        const textBox = cards[openedCardId]?.detailsTextBoxes?.find((item) => item.id === selectedDetailsTextBoxId);
        const nextUrl = textBox?.linkUrl ? null : window.prompt("URL del enlace")?.trim() || null;
        updateDetailsTextBoxStyle(openedCardId, selectedDetailsTextBoxId, { linkUrl: nextUrl });
        return;
      }
    }

    if (
      openedCardId &&
      selectedDetailsImageId &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault();
      deleteDetailsImage(openedCardId, selectedDetailsImageId);
      setSelectedDetailsImageId(null);
      return;
    }

    if (
      openedCardId &&
      event.key.toLocaleLowerCase() === "t" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !isEditableTarget(event.target)
    ) {
      event.preventDefault();
      createDetailsTextBox(openedCardId);
      return;
    }

    if (openedCardId && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
      event.preventDefault();
      return;
    }

    if (
      selectedCardId &&
      (event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown")
    ) {
      const selectedCard = cards[selectedCardId];

      if (!selectedCard) {
        return;
      }

      event.preventDefault();

      const step = event.shiftKey ? KEYBOARD_MOVE_STEP * 2 : KEYBOARD_MOVE_STEP;
      let nextX = selectedCard.position.x;
      let nextY = selectedCard.position.y;

      if (event.key === "ArrowLeft") {
        nextX -= step;
      } else if (event.key === "ArrowRight") {
        nextX += step;
      } else if (event.key === "ArrowUp") {
        nextY -= step;
      } else if (event.key === "ArrowDown") {
        nextY += step;
      }

      moveCard(
        selectedCardId,
        {
          x: nextX,
          y: nextY,
        },
      );
      return;
    }

    if (event.key === "ArrowLeft" && searchResults.length > 0) {
      event.preventDefault();
      goToPreviousSearchResult();
      return;
    }

    if (event.key === "ArrowRight" && searchResults.length > 0) {
      event.preventDefault();
      goToNextSearchResult();
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      backspaceDraft();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      confirmDraft(stageSize, {
        x: -cameraRef.current.x,
        y: -cameraRef.current.y,
      });
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();

      if (selectedCardId) {
        deleteSelectedCard();
        return;
      }

      clearDraft();
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      appendDraftCharacter(event.key);
    }
  });

  const onGlobalPaste = useEffectEvent(async (event: ClipboardEvent) => {
    if (bootState !== "ready") {
      return;
    }

    if (event.defaultPrevented) {
      return;
    }

    const clipboardData = event.clipboardData;

    if (!clipboardData) {
      return;
    }

    const pastedText = clipboardData.getData("text");

    if (!activeCategoryId) {
      if (pastedText) {
        event.preventDefault();
        for (const character of pastedText) {
          appendCategoryDraftCharacter(character);
        }
      }

      return;
    }

    if (openedCardId && pastedText) {
      const tableCells = parseClipboardTable(pastedText);

      if (tableCells) {
        event.preventDefault();
        setDetailsTableFromCells(openedCardId, tableCells);
        setShowTableMenu(false);
        return;
      }

      if (!isEditableTarget(event.target)) {
        event.preventDefault();
        const textBoxId = createDetailsTextBox(openedCardId);

        if (textBoxId) {
          updateDetailsTextBox(openedCardId, textBoxId, pastedText);
        }

        return;
      }
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    const imageItem = Array.from(clipboardData.items).find(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );

    if (openedCardId && imageItem) {
      const imageFile = imageItem.getAsFile();

      if (!imageFile) {
        setPasteFeedback("image-error");
        return;
      }

      event.preventDefault();
      void pasteDetailsImage(openedCardId, imageFile);
      return;
    }

    if (!pastedText && !imageItem) {
      return;
    }

    event.preventDefault();

    if (pastedText) {
      appendDraftText(pastedText);
    }

    if (!imageItem) {
      return;
    }

    const imageFile = imageItem.getAsFile();

    if (!imageFile) {
      setPasteFeedback("image-error");
      return;
    }

    try {
      const image = await createDraftImageFromFile(imageFile);
      attachDraftImage(image);
    } catch {
      setPasteFeedback("image-error");
    }
  });

  const onStagePointerDown = useEffectEvent((event: ReactPointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.button !== 0 && event.pointerType !== "touch") {
      return;
    }

    event.preventDefault();
    selectCard(null);
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: cameraRef.current.x,
      originY: cameraRef.current.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  });

  const onStagePointerMove = useEffectEvent((event: ReactPointerEvent<HTMLElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();

    if (rect && activeCategoryId && !isModalOpen) {
      sendPresence({
        x: event.clientX - rect.left - cameraRef.current.x,
        y: event.clientY - rect.top - cameraRef.current.y,
      }, {
        surface: "map",
        openedCardId: null,
      });
    }

    const panState = panStateRef.current;

    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    setCamera({
      x: panState.originX + event.clientX - panState.startX,
      y: panState.originY + event.clientY - panState.startY,
    });
  });

  const endStagePan = useEffectEvent((event: ReactPointerEvent<HTMLElement>) => {
    const panState = panStateRef.current;

    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    panStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  });

  const onCardPointerDown = useEffectEvent((cardId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType !== "touch") {
      return;
    }

    const card = cards[cardId];

    if (!card) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectCard(cardId, { bringToFront: true });
    dragStateRef.current = {
      cardId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: card.position.x,
      originY: card.position.y,
      cameraOriginX: cameraRef.current.x,
      cameraOriginY: cameraRef.current.y,
      hasMoved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  });

  const onCardPointerMove = useEffectEvent((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const card = cards[dragState.cardId];

    if (!card) {
      return;
    }

    const rect = stageRef.current?.getBoundingClientRect();
    let nextCamera = cameraRef.current;

    if (rect) {
      let panX = 0;
      let panY = 0;
      const leftDistance = event.clientX - rect.left;
      const rightDistance = rect.right - event.clientX;
      const topDistance = event.clientY - rect.top;
      const bottomDistance = rect.bottom - event.clientY;

      if (leftDistance < EDGE_PAN_MARGIN) {
        panX = EDGE_PAN_MAX_STEP * (1 - clamp(leftDistance, 0, EDGE_PAN_MARGIN) / EDGE_PAN_MARGIN);
      } else if (rightDistance < EDGE_PAN_MARGIN) {
        panX = -EDGE_PAN_MAX_STEP * (1 - clamp(rightDistance, 0, EDGE_PAN_MARGIN) / EDGE_PAN_MARGIN);
      }

      if (topDistance < EDGE_PAN_MARGIN) {
        panY = EDGE_PAN_MAX_STEP * (1 - clamp(topDistance, 0, EDGE_PAN_MARGIN) / EDGE_PAN_MARGIN);
      } else if (bottomDistance < EDGE_PAN_MARGIN) {
        panY = -EDGE_PAN_MAX_STEP * (1 - clamp(bottomDistance, 0, EDGE_PAN_MARGIN) / EDGE_PAN_MARGIN);
      }

      if (panX !== 0 || panY !== 0) {
        nextCamera = {
          x: cameraRef.current.x + panX,
          y: cameraRef.current.y + panY,
        };
        setCamera(nextCamera);
      }
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const cameraDeltaX = nextCamera.x - dragState.cameraOriginX;
    const cameraDeltaY = nextCamera.y - dragState.cameraOriginY;

    if (!dragState.hasMoved && Math.hypot(deltaX, deltaY) >= 4) {
      dragState.hasMoved = true;
    }

    moveCard(
      dragState.cardId,
      {
        x: dragState.originX + deltaX - cameraDeltaX,
        y: dragState.originY + deltaY - cameraDeltaY,
      },
    );
  });

  const onCardPointerUp = useEffectEvent((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const shouldOpen = !dragState.hasMoved;
    const targetCardId = dragState.cardId;
    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (shouldOpen) {
      openCard(targetCardId);
    }
  });

  const onCardPointerCancel = useEffectEvent((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  });

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect();
      const width = rect.width || DEFAULT_STAGE_WIDTH;
      const height = rect.height || DEFAULT_STAGE_HEIGHT;

      setStageSize((currentSize) =>
        currentSize.width === width && currentSize.height === height
          ? currentSize
          : { width, height },
      );
    };

    updateStageSize();

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    clearUndoTimer();

    if (!canUndoDeletion) {
      setShowUndoToast(false);
      return;
    }

    setShowUndoToast(true);
    undoTimeoutRef.current = window.setTimeout(() => {
      clearDeletionUndo();
      setShowUndoToast(false);
      undoTimeoutRef.current = null;
    }, UNDO_TIMEOUT_MS);

    return () => {
      clearUndoTimer();
    };
  }, [canUndoDeletion, clearDeletionUndo, clearUndoTimer]);

  useEffect(() => {
    if (searchFeedback !== "no-results") {
      setShowSearchFeedback(false);
      return;
    }

    setShowSearchFeedback(true);
    const timeoutId = window.setTimeout(() => {
      setShowSearchFeedback(false);
    }, 2600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchFeedback]);

  useEffect(() => {
    if (pasteFeedback !== "image-error") {
      setShowPasteFeedback(false);
      return;
    }

    setShowPasteFeedback(true);
    const timeoutId = window.setTimeout(() => {
      setShowPasteFeedback(false);
      clearPasteFeedback();
    }, PASTE_FEEDBACK_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [clearPasteFeedback, pasteFeedback, pasteFeedbackVersion]);

  useEffect(() => {
    if (!isModalOpen) {
      setShowTableMenu(false);
      setSelectedDetailsImageId(null);
      setSelectedDetailsTextBoxId(null);
      lastDetailsPointerRef.current = null;
    }
  }, [isModalOpen]);

  useEffect(() => {
    setMapSearchText("");
  }, [activeCategoryId, activeMapKind, activeSectionId]);

  useEffect(() => {
    if (!showTableMenu) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;

      if (target?.closest(".details-table-controls")) {
        return;
      }

      setShowTableMenu(false);
    };

    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showTableMenu]);

  useEffect(() => {
    sendPresence(lastPresenceRef.current);
  }, [activeCategoryId, activeMapKind, activeSectionId, openedCardId, sendPresence]);

  useEffect(() => {
    void syncRemoteProject();
  }, [activeCategoryId, activeMapKind, activeSectionId, openedCardId, syncRemoteProject]);

  useEffect(() => {
    if (!activeSearchResult) {
      return;
    }

    const card = cards[activeSearchResult.cardId];

    if (!card) {
      return;
    }

    const width = card.size?.width ?? CARD_FALLBACK_WIDTH;
    const height = card.size?.height ?? CARD_FALLBACK_HEIGHT;

    setCamera({
      x: stageSize.width / 2 - card.position.x - width / 2,
      y: stageSize.height / 2 - card.position.y - height / 2,
    });
  }, [activeSearchResult, cards, stageSize.height, stageSize.width]);

  useEffect(() => {
    if (hasAttemptedRemoteBootRef.current) {
      return;
    }

    hasAttemptedRemoteBootRef.current = true;
    const storedIdentity = getStoredIdentity();

    if (!storedIdentity) {
      setBootState("needs-name");
      return;
    }

    setIdentity(storedIdentity);
  }, []);

  useEffect(() => {
    if (!identity) {
      return;
    }

    let cancelled = false;

    const bootRemoteProject = async () => {
      setBootState("loading");
      setBootError(null);

      try {
        const project = await fetchRemoteProject();

        if (cancelled) {
          return;
        }

        isApplyingRemoteSnapshotRef.current = true;
        loadProjectSnapshot(project.snapshot);
        remoteVersionRef.current = project.snapshotVersion;
        latestEventIdRef.current = project.latestEventId;
        lastPersistedProjectSignatureRef.current = JSON.stringify(
          useTreeStore.getState().getProjectSnapshot(),
        );
        setBootState("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("No se pudo cargar el proyecto remoto.", error);
        setBootError(error instanceof Error ? error.message : "No se pudo cargar el proyecto remoto.");
        setBootState("needs-name");
      } finally {
        isApplyingRemoteSnapshotRef.current = false;
      }
    };

    void bootRemoteProject();

    return () => {
      cancelled = true;
    };
  }, [identity, loadProjectSnapshot]);

  useEffect(() => {
    if (bootState !== "ready" || !identity || isApplyingRemoteSnapshotRef.current) {
      return;
    }

    if (projectSignature === lastPersistedProjectSignatureRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveRemoteProject();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    bootState,
    identity,
    pendingAssetSignature,
    projectSignature,
    saveRemoteProject,
  ]);

  useEffect(() => {
    if (bootState !== "ready" || !identity) {
      return;
    }

    let timeoutId: number | null = null;
    let cancelled = false;

    const schedulePoll = () => {
      if (cancelled) {
        return;
      }

      const delay = document.hidden ? REMOTE_BACKGROUND_POLL_MS : REMOTE_POLL_MS;
      timeoutId = window.setTimeout(() => {
        void syncRemoteProject().finally(schedulePoll);
      }, delay);
    };

    const syncNow = () => {
      if (!document.hidden) {
        void syncRemoteProject();
      }
    };

    schedulePoll();
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", syncNow);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, [bootState, identity, syncRemoteProject]);

  useEffect(() => {
    if (bootState !== "ready" || !identity) {
      return;
    }

    let cancelled = false;

    const pollPresence = async () => {
      try {
        const response = await fetch("/api/presence", { cache: "no-store" });

        if (!response.ok || cancelled) {
          return;
        }

        const body = (await response.json()) as { presence: PresenceState[] };
        setPresence(body.presence.filter((item) => item.clientId !== identity.clientId));
      } catch (error) {
        console.error("No se pudo cargar presencia.", error);
      }
    };

    void pollPresence();
    const intervalId = window.setInterval(() => {
      void pollPresence();
    }, PRESENCE_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [bootState, identity]);

  useEffect(() => {
    window.addEventListener("keydown", onGlobalKeyDown);
    window.addEventListener("paste", onGlobalPaste);

    return () => {
      window.removeEventListener("keydown", onGlobalKeyDown);
      window.removeEventListener("paste", onGlobalPaste);
    };
  }, [onGlobalKeyDown, onGlobalPaste]);

  useEffect(() => {
    return () => {
      clearUndoTimer();
      clearCloseHoldTimer();
    };
  }, [clearCloseHoldTimer, clearUndoTimer]);

  if (bootState !== "ready") {
    return (
      <main className="minimal-shell">
        <section className="directory-gate" aria-label="Entrar al proyecto">
          <div className="question-stage-backdrop" />
          {bootState === "needs-name" ? (
            <div className="directory-gate-panel">
              <span className="directory-gate-eyebrow">Study Tree</span>
              <h1>Escribe tu nombre para entrar</h1>
              <p>Se guarda en este navegador para identificar tu cursor y tus cambios.</p>
              {bootError ? <p className="directory-gate-error">{bootError}</p> : null}
              <form
                className="name-gate-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = nameDraft.trim();

                  if (!name) {
                    return;
                  }

                  const clientId = makeClientId();
                  const nextIdentity = {
                    clientId,
                    name,
                    color: getCollaboratorColor(clientId),
                  };

                  storeIdentity(nextIdentity);
                  setIdentity(nextIdentity);
                }}
              >
                <input
                  className="name-gate-input"
                  value={nameDraft}
                  onChange={(event) => {
                    setNameDraft(event.currentTarget.value);
                  }}
                  autoFocus
                  maxLength={40}
                  placeholder="Tu nombre"
                />
                <button type="submit" className="directory-gate-button">
                  Entrar
                </button>
              </form>
            </div>
          ) : (
            <div className="directory-gate-panel">
              <span className="directory-gate-eyebrow">Study Tree</span>
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
      <section
        ref={stageRef}
        className={`question-stage ${activeCategoryId ? "is-map-open" : ""}`}
        aria-label="Espacio de dudas"
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={endStagePan}
        onPointerCancel={endStagePan}
      >
        <div className="question-stage-backdrop" />

        {!activeCategoryId ? (
          <CategoryHome
            categories={categoriesList}
            selectedCategoryId={selectedCategoryId}
            categoryDraftText={categoryDraftText}
            renamingCategoryId={renamingCategoryId}
            renameDraft={categoryRenameDraft}
            onSelect={selectCategory}
            onOpenMain={openMainCategoryMap}
            onOpenSection={openCategorySection}
            onStartRename={(category) => {
              setRenamingCategoryId(category.id);
              setCategoryRenameDraft(category.name);
            }}
            onRenameDraft={setCategoryRenameDraft}
            onConfirmRename={() => {
              if (renamingCategoryId) {
                renameCategory(renamingCategoryId, categoryRenameDraft);
              }

              setRenamingCategoryId(null);
              setCategoryRenameDraft("");
            }}
            onCancelRename={() => {
              setRenamingCategoryId(null);
              setCategoryRenameDraft("");
            }}
          />
        ) : null}

        {activeCategoryId && !isModalOpen ? (
          <header className="map-topbar">
            <h1 className="map-title">{activeMapTitle}</h1>
            <label className="map-search">
              <span>Buscar</span>
              <input
                value={mapSearchText}
                placeholder="Buscar elementos"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setMapSearchText(value);

                  if (value.trim()) {
                    runSearch(value);
                  } else {
                    clearSearchState();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (event.shiftKey) {
                      goToPreviousSearchResult();
                    } else {
                      goToNextSearchResult();
                    }
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setMapSearchText("");
                    clearSearchState();
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          </header>
        ) : null}

        {activeCategoryId && !isModalOpen && cardsList.length === 0 && !draftText && !draftImage ? (
          <div className="empty-state" aria-live="polite">
            <p>Escribe una duda, pega una imagen o combina ambas y presiona Enter.</p>
          </div>
        ) : null}

        {activeCategoryId && !isModalOpen ? (
          <div className="map-scroll-space" style={{ height: `${worldHeight}px` }} />
        ) : null}

        {activeCategoryId && !isModalOpen ? (
          <div
            className="question-world"
            style={{
              transform: `translate(${camera.x}px, ${camera.y}px)`,
            }}
          >
            {cardsList.map((card) => (
                <QuestionCardSurface
                  key={card.id}
                  card={card}
                  isSelected={selectedCardId === card.id}
                  isSearchMatch={matchedCardIds.has(card.id)}
                  isActiveSearchMatch={activeSearchResult?.cardId === card.id}
                  onPointerDown={onCardPointerDown}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={onCardPointerUp}
                  onPointerCancel={onCardPointerCancel}
                  onMeasure={setCardSize}
                />
              ))}
            {presence
              .filter(
                (item) =>
                  item.cursor &&
                  item.surface === "map" &&
                  item.activeCategoryId === activeCategoryId &&
                  item.activeMapKind === activeMapKind &&
                  item.activeSectionId === activeSectionId,
              )
              .map((item) => (
                <div
                  key={item.clientId}
                  className="collaborator-cursor"
                  style={{
                    left: `${item.cursor!.x}px`,
                    top: `${item.cursor!.y}px`,
                    color: item.color,
                  }}
                >
                  <span className="collaborator-cursor-mark" />
                  <span className="collaborator-cursor-name">{item.name}</span>
                </div>
              ))}
          </div>
        ) : null}

        {activeCategoryId && !isModalOpen && (draftText || draftImage) ? (
          <div className="draft-composer-shell" aria-live="polite">
            <div className="draft-composer">
              {draftCommandHint ? <div className="draft-command-hint">{draftCommandHint}</div> : null}

              {draftImage ? (
                <div className="draft-image-shell">
                  <img
                    className="draft-image"
                    src={draftImage.previewUrl}
                    alt={draftImage.name || "Imagen en borrador"}
                  />
                  <button
                    type="button"
                    className="draft-image-remove"
                    onClick={() => {
                      clearDraftImage();
                    }}
                  >
                    Quitar imagen
                  </button>
                </div>
              ) : null}

              {draftText ? (
                <div className="draft-copy">
                  <NodeLabel text={draftText} />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeCategoryId && openedCard ? (
          <div
            className="card-modal-overlay"
            onPointerMove={(event) => {
              const modalBody = event.currentTarget.querySelector(".card-modal-body");
              const bodyRect = modalBody instanceof HTMLElement ? modalBody.getBoundingClientRect() : null;

              if (bodyRect) {
                lastDetailsPointerRef.current = {
                  x: event.clientX - bodyRect.left,
                  y: event.clientY - bodyRect.top,
                };
              }

              sendPresence(
                {
                  x: event.clientX - event.currentTarget.getBoundingClientRect().left,
                  y: event.clientY - event.currentTarget.getBoundingClientRect().top,
                },
                {
                  surface: "card-modal",
                  openedCardId: openedCard.id,
                },
              );
            }}
          >
            <div
              className="card-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Detalle de duda"
            >
              <button
                type="button"
                className="card-modal-close"
                aria-label="Cerrar detalle"
                title="Click: cerrar. Mantener: borrar."
                onPointerDown={(event) => {
                  event.preventDefault();
                  closeHoldDidDeleteRef.current = false;
                  clearCloseHoldTimer();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  closeHoldTimeoutRef.current = window.setTimeout(() => {
                    closeHoldTimeoutRef.current = null;
                    closeHoldDidDeleteRef.current = true;
                    deleteCard(openedCard.id);
                  }, CLOSE_HOLD_DELETE_MS);
                }}
                onPointerUp={(event) => {
                  event.preventDefault();
                  event.currentTarget.releasePointerCapture?.(event.pointerId);

                  if (closeHoldDidDeleteRef.current) {
                    closeHoldDidDeleteRef.current = false;
                    return;
                  }

                  clearCloseHoldTimer();
                  closeCard();
                }}
                onPointerCancel={(event) => {
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                  clearCloseHoldTimer();
                  closeHoldDidDeleteRef.current = false;
                }}
                onPointerLeave={() => {
                  clearCloseHoldTimer();
                }}
                onClick={(event) => {
                  event.preventDefault();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    closeCard();
                  }
                }}
              >
                X
              </button>
              {activeMapKind === "section" && activeSectionId === "exercises" ? (
                <button
                  type="button"
                  className="exercise-set-fab"
                  aria-label="Generar ejercicios"
                  title="Generar ejercicios"
                  onClick={() => {
                    if (openedCard) {
                      createExerciseSet(openedCard.id);
                    }
                  }}
                >
                  Ejercicios
                </button>
              ) : null}
              <div
                className="card-modal-body"
                onPointerDownCapture={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  lastDetailsPointerRef.current = {
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  };

                  const target = event.target as HTMLElement | null;

                  if (!target?.closest(".details-image-object")) {
                    setSelectedDetailsImageId(null);
                  }
                  if (!target?.closest(".details-text-box")) {
                    setSelectedDetailsTextBoxId(null);
                  }
                }}
              >
                <CardContent card={openedCard} mode="full" />
                {openedCard.detailsTable ? (
                  <DetailsTableEditor
                    cardId={openedCard.id}
                    table={openedCard.detailsTable}
                    onUpdateCell={updateDetailsTableCell}
                    onResizeColumn={resizeDetailsTableColumn}
                    onResizeRow={resizeDetailsTableRow}
                    onPasteTable={(cells) => {
                      setDetailsTableFromCells(openedCard.id, cells);
                      setShowTableMenu(false);
                      setSelectedDetailsImageId(null);
                      setSelectedDetailsTextBoxId(null);
                    }}
                    onStartTyping={() => {
                      setShowTableMenu(false);
                      setSelectedDetailsImageId(null);
                      setSelectedDetailsTextBoxId(null);
                    }}
                  />
                ) : null}
                <DetailsImageLayer
                  cardId={openedCard.id}
                  images={openedCard.detailsImages ?? []}
                  selectedImageId={selectedDetailsImageId}
                  onSelect={(imageId) => {
                    setSelectedDetailsTextBoxId(null);
                    setSelectedDetailsImageId(imageId);
                  }}
                  onMove={moveDetailsImage}
                  onResize={resizeDetailsImage}
                  onRotate={rotateDetailsImage}
                />
                <DetailsTextBoxLayer
                  cardId={openedCard.id}
                  textBoxes={openedCard.detailsTextBoxes ?? []}
                  selectedTextBoxId={selectedDetailsTextBoxId}
                  onSelect={(textBoxId) => {
                    setSelectedDetailsImageId(null);
                    setSelectedDetailsTextBoxId(textBoxId);
                  }}
                  onUpdate={updateDetailsTextBox}
                  onStyle={updateDetailsTextBoxStyle}
                  onMove={moveDetailsTextBox}
                  onResize={resizeDetailsTextBox}
                />
                <ExerciseReferencesLayer
                  cardId={openedCard.id}
                  exerciseSet={openedExerciseSet}
                  category={activeCategory}
                  onOpenReference={openExerciseReference}
                  onMove={moveExerciseSet}
                />
              </div>
              <div className="details-table-controls">
                {showTableMenu ? (
                  <div className="details-table-menu" aria-label="Acciones de tabla">
                    <button
                      type="button"
                      className="details-table-menu-button"
                      onClick={() => {
                        addDetailsTableRow(openedCard.id);
                        setShowTableMenu(false);
                      }}
                    >
                      + fila
                    </button>
                    <button
                      type="button"
                      className="details-table-menu-button"
                      onClick={() => {
                        addDetailsTableColumn(openedCard.id);
                        setShowTableMenu(false);
                      }}
                    >
                      + columna
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="details-table-fab"
                  aria-expanded={showTableMenu}
                  aria-label="Agregar fila o columna"
                  onClick={() => {
                    ensureDetailsTable(openedCard.id);
                    setShowTableMenu((currentValue) => !currentValue);
                  }}
                >
                  +
                </button>
              </div>
              {presence
                .filter(
                  (item) =>
                    item.cursor &&
                    item.surface === "card-modal" &&
                    item.activeCategoryId === activeCategoryId &&
                    item.activeMapKind === activeMapKind &&
                    item.activeSectionId === activeSectionId &&
                    item.openedCardId === openedCard.id,
                )
                .map((item) => (
                  <div
                    key={item.clientId}
                    className="collaborator-cursor is-modal"
                    style={{
                      left: `${item.cursor!.x}px`,
                      top: `${item.cursor!.y}px`,
                      color: item.color,
                    }}
                  >
                    <span className="collaborator-cursor-mark" />
                    <span className="collaborator-cursor-name">{item.name}</span>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        {activeCategoryId && !isModalOpen && showUndoToast && canUndoDeletion ? (
          <div className="undo-toast" aria-live="polite">
            <span>Duda eliminada.</span>
            <button
              type="button"
              className="undo-button"
              onClick={() => {
                clearUndoTimer();
                undoLastDeletion();
                setShowUndoToast(false);
              }}
            >
              Deshacer
            </button>
          </div>
        ) : null}

        {activeCategoryId && !isModalOpen && showSearchFeedback ? (
          <div className="search-feedback" aria-live="polite">
            No se encontraron coincidencias.
          </div>
        ) : null}

        {activeCategoryId && !isModalOpen && showPasteFeedback ? (
          <div className="paste-feedback" aria-live="polite">
            No se pudo leer la imagen pegada.
          </div>
        ) : null}
      </section>
    </main>
  );
}
