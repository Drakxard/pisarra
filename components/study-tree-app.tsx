"use client";

import {
  type CSSProperties,
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
  ExerciseReferenceItem,
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
const DRAG_START_DISTANCE = 12;
const MAP_EDGE_PAN_MARGIN = 96;
const MAP_EDGE_PAN_MAX_STEP = 22;
const MODAL_EDGE_PAN_MARGIN = 16;
const MODAL_EDGE_PAN_MAX_STEP = 3;
const DETAILS_INSERT_VIEWPORT_PADDING = 32;
const CLOSE_HOLD_DELETE_MS = 800;
const EDGE_VISIBILITY_MARGIN = 0;
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

type ScrollPanState = {
  pointerId: number;
  startX: number;
  startY: number;
  originScrollLeft: number;
  originScrollTop: number;
};

type DetailsTableInteraction =
  | {
      type: "move";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      hasMoved: boolean;
    }
  | {
      type: "resize-column";
      pointerId: number;
      index: number;
      startClientX: number;
      startSize: number;
    }
  | {
      type: "resize-row";
      pointerId: number;
      index: number;
      startClientY: number;
      startSize: number;
    };

type DetailsImageInteraction =
  | {
      type: "move";
      pointerId: number;
      imageId: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      originScrollLeft: number;
      originScrollTop: number;
      captureTarget: HTMLDivElement | null;
      hasMoved: boolean;
    }
  | {
      type: "resize";
      pointerId: number;
      imageId: string;
      startX: number;
      startY: number;
      originWidth: number;
      originHeight: number;
      originScrollLeft: number;
      originScrollTop: number;
      captureTarget: HTMLElement | null;
    }
  | {
      type: "rotate";
      pointerId: number;
      imageId: string;
      centerX: number;
      centerY: number;
      captureTarget: HTMLElement | null;
    };

type DetailsTextBoxInteraction =
  | {
      type: "move";
      pointerId: number;
      textBoxId: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      originScrollLeft: number;
      originScrollTop: number;
      captureTarget: HTMLDivElement | null;
      hasMoved: boolean;
    }
  | {
      type: "resize";
      pointerId: number;
      textBoxId: string;
      startX: number;
      startY: number;
      originWidth: number;
      originHeight: number;
      originScrollLeft: number;
      originScrollTop: number;
      captureTarget: HTMLButtonElement | null;
    };

type ExerciseReferenceInteraction =
  | {
      type: "move";
      referenceId: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      hasMoved: boolean;
    }
  | null;

type ViewportAutoPanResult = {
  deltaX: number;
  deltaY: number;
  scrollLeft: number;
  scrollTop: number;
};

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

type ExerciseCandidate = Pick<ExerciseReferenceItem, "sourceSectionId" | "sourceCardId"> & {
  card: QuestionCard;
};

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
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
          score += title === token ? 5 : 3;
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

function buildExerciseQuery(card: QuestionCard) {
  const parts = [
    card.text,
    card.detailsText,
    ...(card.detailsTextBoxes ?? []).map((textBox) => textBox.text),
    ...(card.detailsTable?.cells.flatMap((row) => row) ?? []),
  ];

  return parts
    .map((value) => String(value ?? "").replace(/\r\n?/g, "\n").trim())
    .filter(Boolean)
    .join(" ");
}

function createRect(x: number, y: number, width: number, height: number): Rect {
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

function rectsOverlap(a: Rect, b: Rect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function getElementRectWithinBody(element: Element, body: HTMLElement): Rect | null {
  const elementRect = element.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();

  if (elementRect.width <= 0 || elementRect.height <= 0) {
    return null;
  }

  return createRect(
    elementRect.left - bodyRect.left,
    elementRect.top - bodyRect.top,
    elementRect.width,
    elementRect.height,
  );
}

function findAvailableRect(candidate: Rect, occupied: Rect[], stepX: number, stepY: number) {
  const width = candidate.right - candidate.left;
  const height = candidate.bottom - candidate.top;
  const buildRect = (offsetX: number, offsetY: number) =>
    createRect(
      Math.max(0, candidate.left + offsetX * stepX),
      Math.max(0, candidate.top + offsetY * stepY),
      width,
      height,
    );
  const hasCollision = (rect: Rect) => occupied.some((occupiedRect) => rectsOverlap(rect, occupiedRect));
  const originRect = buildRect(0, 0);

  if (!hasCollision(originRect)) {
    return originRect;
  }

  for (let radius = 1; radius <= 24; radius += 1) {
    const candidates: Rect[] = [];

    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) {
          continue;
        }

        candidates.push(buildRect(offsetX, offsetY));
      }
    }

    candidates.sort((left, right) => {
      const leftDx = left.left - candidate.left;
      const leftDy = left.top - candidate.top;
      const rightDx = right.left - candidate.left;
      const rightDy = right.top - candidate.top;
      const leftDistance = Math.hypot(leftDx, leftDy);
      const rightDistance = Math.hypot(rightDx, rightDy);

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      if (Math.abs(leftDy) !== Math.abs(rightDy)) {
        return Math.abs(leftDy) - Math.abs(rightDy);
      }

      return Math.abs(leftDx) - Math.abs(rightDx);
    });

    const freeRect = candidates.find((rect) => !hasCollision(rect));

    if (freeRect) {
      return freeRect;
    }
  }

  return originRect;
}

function getRectVisibilityDelta(rect: Rect, viewport: Rect, margin = 24) {
  let deltaX = 0;
  let deltaY = 0;

  if (rect.left < viewport.left + margin) {
    deltaX = rect.left - (viewport.left + margin);
  } else if (rect.right > viewport.right - margin) {
    deltaX = rect.right - (viewport.right - margin);
  }

  if (rect.top < viewport.top + margin) {
    deltaY = rect.top - (viewport.top + margin);
  } else if (rect.bottom > viewport.bottom - margin) {
    deltaY = rect.bottom - (viewport.bottom - margin);
  }

  return { deltaX, deltaY };
}

function getEdgePanOffset(distanceFromStart: number, distanceFromEnd: number, margin: number, maxStep: number) {
  if (distanceFromStart < margin) {
    return -maxStep * (1 - clamp(distanceFromStart, 0, margin) / margin);
  }

  if (distanceFromEnd < margin) {
    return maxStep * (1 - clamp(distanceFromEnd, 0, margin) / margin);
  }

  return 0;
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

type AssetUploadTicket = {
  path: string;
  contentType: string;
  uploadUrl: string;
};

async function uploadPendingAssets(assets: PendingImageAsset[]) {
  if (assets.length === 0) {
    return;
  }

  const response = await fetch("/api/assets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assets: assets.map((asset) => ({
        path: asset.path,
        contentType: asset.blob.type || undefined,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error("No se pudieron subir las imagenes pendientes.");
  }

  const result = (await response.json()) as {
    uploads?: AssetUploadTicket[];
  };

  if (!Array.isArray(result.uploads) || result.uploads.length !== assets.length) {
    throw new Error("No se pudieron preparar las imagenes pendientes.");
  }

  const uploadsByPath = new Map(result.uploads.map((upload) => [upload.path, upload]));

  await Promise.all(
    assets.map(async (asset) => {
      const upload = uploadsByPath.get(asset.path);

      if (!upload) {
        throw new Error("Falta la firma de un asset pendiente.");
      }

      const uploadResponse = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": upload.contentType,
        },
        body: asset.blob,
      });

      if (!uploadResponse.ok) {
        throw new Error("No se pudieron subir las imagenes pendientes.");
      }
    }),
  );
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

const MODAL_PAN_BLOCKER_SELECTOR =
  ".details-image-object, .details-text-box, .exercise-reference-object, .details-table-object, .details-table-controls, button, a";

function isEditableElementOrAncestor(target: EventTarget | null) {
  let element = target as HTMLElement | null;

  while (element) {
    if (isEditableTarget(element)) {
      return true;
    }

    element = element.parentElement;
  }

  return false;
}

function shouldStartModalPan(target: EventTarget | null) {
  const element = target as HTMLElement | null;

  if (!element || isEditableElementOrAncestor(element)) {
    return false;
  }

  return !element.closest(MODAL_PAN_BLOCKER_SELECTOR);
}

function blurActiveEditableElement() {
  if (typeof document === "undefined") {
    return false;
  }

  const activeElement = document.activeElement as HTMLElement | null;

  if (!activeElement || !isEditableTarget(activeElement)) {
    return false;
  }

  activeElement.blur();
  return true;
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainTextToRichText(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function normalizeMultilineText(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeRichTextHtml(value: string) {
  const template = document.createElement("template");
  template.innerHTML = value;

  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    if (element.tagName !== "A" && element.tagName !== "BR") {
      const parent = element.parentNode;

      if (parent) {
        while (element.firstChild) {
          parent.insertBefore(element.firstChild, element);
        }
        parent.removeChild(element);
      }
      continue;
    }

    if (element.tagName === "A") {
      const anchor = element as HTMLAnchorElement;
      const href = anchor.getAttribute("href")?.trim();

      if (!href) {
        const parent = anchor.parentNode;
        if (parent) {
          while (anchor.firstChild) {
            parent.insertBefore(anchor.firstChild, anchor);
          }
          parent.removeChild(anchor);
        }
        continue;
      }

      anchor.setAttribute("href", href);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    }
  }

  return template.innerHTML;
}

function applyLinkToFocusedEditor() {
  const activeElement = document.activeElement;

  if (!(activeElement instanceof HTMLDivElement) || !activeElement.classList.contains("details-text-box-editor")) {
    return false;
  }

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !activeElement.contains(selection.anchorNode)) {
    return false;
  }

  const url = window.prompt("URL del enlace")?.trim();

  if (!url) {
    return false;
  }

  activeElement.focus({ preventScroll: true });
  document.execCommand("createLink", false, url);
  activeElement.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLink" }));
  return true;
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
  isSelected,
  isEditing,
  onSelect,
  onDelete,
  onBeginEditing,
  onMove,
  onUpdateCell,
  onResizeColumn,
  onResizeRow,
  onPasteTable,
  onStartTyping,
}: {
  cardId: string;
  table: DetailsTable;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onDelete: (cardId: string) => void;
  onBeginEditing: () => void;
  onMove: (cardId: string, position: { x: number; y: number }) => void;
  onUpdateCell: (cardId: string, rowIndex: number, columnIndex: number, value: string) => void;
  onResizeColumn: (cardId: string, columnIndex: number, width: number) => void;
  onResizeRow: (cardId: string, rowIndex: number, height: number) => void;
  onPasteTable: (cells: string[][]) => void;
  onStartTyping: () => void;
}) {
  const interactionRef = useRef<DetailsTableInteraction | null>(null);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction) {
        return;
      }

      event.preventDefault();

      if (interaction.type === "move") {
        if (
          !interaction.hasMoved &&
          Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) >= DRAG_START_DISTANCE
        ) {
          interaction.hasMoved = true;
        }

        if (!interaction.hasMoved) {
          return;
        }

        onMove(cardId, {
          x: interaction.originX + event.clientX - interaction.startX,
          y: interaction.originY + event.clientY - interaction.startY,
        });
        return;
      }

      if (interaction.type === "resize-column") {
        onResizeColumn(
          cardId,
          interaction.index,
          Math.max(
            MIN_TABLE_COLUMN_WIDTH,
            interaction.startSize + event.clientX - interaction.startClientX,
          ),
        );
        return;
      }

      onResizeRow(
        cardId,
        interaction.index,
        Math.max(
          MIN_TABLE_ROW_HEIGHT,
          interaction.startSize + event.clientY - interaction.startClientY,
        ),
      );
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
  }, [cardId, onMove, onResizeColumn, onResizeRow]);

  return (
    <div
      className={`details-table-object ${isSelected ? "is-selected" : ""} ${isEditing ? "is-editing" : ""}`}
      style={{
        left: `${table.x}px`,
        top: `${table.y}px`,
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement | null;
        const onResizer = Boolean(
          target?.closest(".details-table-column-resizer") || target?.closest(".details-table-row-resizer"),
        );

        if (event.button === 1) {
          if (isEditing) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onDelete(cardId);
          return;
        }

        if (event.button !== 0 && event.pointerType !== "touch") {
          return;
        }

        onSelect();

        if (onResizer || isEditing) {
          return;
        }

        if (event.detail >= 2) {
          interactionRef.current = null;
          return;
        }

        event.stopPropagation();

        interactionRef.current = {
          type: "move",
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: table.x,
          originY: table.y,
          hasMoved: false,
        };
      }}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement | null;

        if (target?.closest(".details-table-column-resizer") || target?.closest(".details-table-row-resizer")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onSelect();
        onBeginEditing();
      }}
    >
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
                readOnly={!isEditing}
                tabIndex={isEditing ? 0 : -1}
                onFocus={isEditing ? onStartTyping : undefined}
                onInput={isEditing ? onStartTyping : undefined}
                onChange={(event) => {
                  if (!isEditing) {
                    return;
                  }
                  onUpdateCell(cardId, rowIndex, columnIndex, event.currentTarget.value);
                }}
                onPaste={(event) => {
                  if (!isEditing) {
                    return;
                  }

                  const tableCells = parseClipboardTable(event.clipboardData.getData("text/plain"));

                  if (!tableCells) {
                    return;
                  }

                  event.preventDefault();
                  onPasteTable(tableCells);
                }}
                aria-label={`Celda ${rowIndex + 1}, ${columnIndex + 1}`}
              />
              {isSelected && columnIndex < table.columnWidths.length - 1 ? (
                <span
                  className="details-table-column-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect();
                    interactionRef.current = {
                      type: "resize-column",
                      pointerId: event.pointerId,
                      index: columnIndex,
                      startClientX: event.clientX,
                      startSize: table.columnWidths[columnIndex],
                    };
                  }}
                />
              ) : null}
              {isSelected && rowIndex < table.cells.length - 1 ? (
                <span
                  className="details-table-row-resizer"
                  role="separator"
                  aria-orientation="horizontal"
                  onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect();
                    interactionRef.current = {
                      type: "resize-row",
                      pointerId: event.pointerId,
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
    </div>
  );
});

const DetailsImageLayer = memo(function DetailsImageLayer({
  cardId,
  images,
  selectedImageId,
  onSelect,
  onDelete,
  onMove,
  onResize,
  onRotate,
  onAutoPan,
  getViewportScroll,
}: {
  cardId: string;
  images: DetailsImage[];
  selectedImageId: string | null;
  onSelect: (imageId: string | null) => void;
  onDelete: (cardId: string, imageId: string) => void;
  onMove: (cardId: string, imageId: string, position: { x: number; y: number }) => void;
  onResize: (cardId: string, imageId: string, size: { width: number; height: number }) => void;
  onRotate: (cardId: string, imageId: string, rotation: number) => void;
  onAutoPan: (clientX: number, clientY: number) => ViewportAutoPanResult;
  getViewportScroll: () => { scrollLeft: number; scrollTop: number };
}) {
  const interactionRef = useRef<DetailsImageInteraction | null>(null);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction || interaction.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();

      if (interaction.type === "move") {
        const deltaX = event.clientX - interaction.startX;
        const deltaY = event.clientY - interaction.startY;

        if (!interaction.hasMoved && Math.hypot(deltaX, deltaY) >= DRAG_START_DISTANCE) {
          interaction.hasMoved = true;
        }

        if (!interaction.hasMoved) {
          return;
        }

        const autoPan = onAutoPan(event.clientX, event.clientY);
        onMove(cardId, interaction.imageId, {
          x: interaction.originX + deltaX + (autoPan.scrollLeft - interaction.originScrollLeft),
          y: interaction.originY + deltaY + (autoPan.scrollTop - interaction.originScrollTop),
        });
        return;
      }

      const autoPan = onAutoPan(event.clientX, event.clientY);
      if (interaction.type === "resize") {
        onResize(cardId, interaction.imageId, {
          width:
            interaction.originWidth +
            (event.clientX - interaction.startX) +
            (autoPan.scrollLeft - interaction.originScrollLeft),
          height:
            interaction.originHeight +
            (event.clientY - interaction.startY) +
            (autoPan.scrollTop - interaction.originScrollTop),
        });
        return;
      }

      const angle =
        (Math.atan2(event.clientY - interaction.centerY, event.clientX - interaction.centerX) *
          180) /
        Math.PI;
      onRotate(cardId, interaction.imageId, angle + 90);
    };

    const onPointerUp = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction || interaction.pointerId !== event.pointerId) {
        return;
      }

      interaction.captureTarget?.releasePointerCapture?.(event.pointerId);
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
  }, [cardId, onAutoPan, onMove, onResize, onRotate]);

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
              if (event.button === 1) {
                event.preventDefault();
                event.stopPropagation();
                onDelete(cardId, image.id);
                onSelect(null);
                return;
              }

              if (event.button !== 0 && event.pointerType !== "touch") {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              onSelect(image.id);
              interactionRef.current = {
                type: "move",
                pointerId: event.pointerId,
                imageId: image.id,
                startX: event.clientX,
                startY: event.clientY,
                originX: image.x,
                originY: image.y,
                originScrollLeft: getViewportScroll().scrollLeft,
                originScrollTop: getViewportScroll().scrollTop,
                captureTarget: event.currentTarget,
                hasMoved: false,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onDoubleClick={(event) => {
              const target = event.target as HTMLElement | null;

              if (!image.previewUrl || target?.closest("button")) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              interactionRef.current = null;
              window.open(image.previewUrl, "_blank", "noopener,noreferrer");
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
                      pointerId: event.pointerId,
                      imageId: image.id,
                      centerX: rect.left + rect.width / 2,
                      centerY: rect.top + rect.height / 2,
                      captureTarget: event.currentTarget,
                    };
                    event.currentTarget.setPointerCapture?.(event.pointerId);
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
                      pointerId: event.pointerId,
                      imageId: image.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      originWidth: image.width,
                      originHeight: image.height,
                      originScrollLeft: getViewportScroll().scrollLeft,
                      originScrollTop: getViewportScroll().scrollTop,
                      captureTarget: event.currentTarget,
                    };
                    event.currentTarget.setPointerCapture?.(event.pointerId);
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
  onUpdateContent,
  onDelete,
  onFinishEditing,
  onStyle,
  onMove,
  onResize,
  onAutoPan,
  getViewportScroll,
}: {
  cardId: string;
  textBoxes: DetailsTextBox[];
  selectedTextBoxId: string | null;
  onSelect: (textBoxId: string | null) => void;
  onUpdateContent: (cardId: string, textBoxId: string, text: string, richText: string | null) => void;
  onDelete: (cardId: string, textBoxId: string) => void;
  onFinishEditing?: () => void;
  onStyle: (
    cardId: string,
    textBoxId: string,
    patch: Partial<Pick<DetailsTextBox, "fontSize" | "color" | "bold" | "strike" | "bulleted" | "align" | "linkUrl">>,
  ) => void;
  onMove: (cardId: string, textBoxId: string, position: { x: number; y: number }) => void;
  onResize: (cardId: string, textBoxId: string, size: { width: number; height: number }) => void;
  onAutoPan: (clientX: number, clientY: number) => ViewportAutoPanResult;
  getViewportScroll: () => { scrollLeft: number; scrollTop: number };
}) {
  const interactionRef = useRef<DetailsTextBoxInteraction | null>(null);
  const editingEditorRef = useRef<HTMLDivElement | null>(null);
  const editingPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastFocusedEditingTextBoxIdRef = useRef<string | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [openMenu, setOpenMenu] = useState<"color" | "size" | "align" | null>(null);

  const syncTextBoxContent = useEffectEvent((textBoxId: string, editor: HTMLDivElement) => {
    const nextText = normalizeMultilineText(editor.innerText ?? "");
    const nextRichText = normalizeRichTextHtml(editor.innerHTML ?? "");
    setEditingDraft(nextText);
    onUpdateContent(cardId, textBoxId, nextText, nextRichText || null);
  });

  const beginTextBoxEditing = useEffectEvent((textBox: DetailsTextBox, point?: { x: number; y: number } | null) => {
    interactionRef.current = null;
    editingPointRef.current = point ?? null;
    onSelect(textBox.id);
    setEditingTextBoxId(textBox.id);
    setEditingDraft(textBox.text);
  });

  const finishTextBoxEditing = useEffectEvent((textBoxId: string, editor: HTMLDivElement) => {
    const nextText = normalizeMultilineText(editor.innerText ?? "");
    const nextRichText = normalizeRichTextHtml(editor.innerHTML ?? "");

    if (nextText.trim().length === 0) {
      onDelete(cardId, textBoxId);
      onSelect(null);
      setEditingDraft("");
      return;
    }

    setEditingDraft(nextText);
    onUpdateContent(cardId, textBoxId, nextText, nextRichText || null);
    onFinishEditing?.();
  });

  const applyLinkToSelection = useEffectEvent((textBox: DetailsTextBox) => {
    const editor = editingEditorRef.current;

    if (!editor || editingTextBoxId !== textBox.id) {
      return;
    }

    editor.focus({ preventScroll: true });
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !editor.contains(selection.anchorNode)) {
      return;
    }

    const url = window.prompt("URL del enlace")?.trim();

    if (!url) {
      return;
    }

    document.execCommand("createLink", false, url);
    syncTextBoxContent(textBox.id, editor);
  });

  useEffect(() => {
    if (selectedTextBoxId && editingTextBoxId && selectedTextBoxId !== editingTextBoxId) {
      setEditingTextBoxId(null);
      editingPointRef.current = null;
    }
  }, [editingTextBoxId, selectedTextBoxId]);

  useEffect(() => {
    if (editingTextBoxId || !selectedTextBoxId) {
      return;
    }

    const selectedTextBox = textBoxes.find((textBox) => textBox.id === selectedTextBoxId);

    if (!selectedTextBox || selectedTextBox.text.trim().length > 0) {
      return;
    }

    setEditingDraft("");
    editingPointRef.current = null;
    setEditingTextBoxId(selectedTextBox.id);
  }, [editingTextBoxId, selectedTextBoxId, textBoxes]);

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

    const activeTextBox = textBoxes.find((textBox) => textBox.id === editingTextBoxId);

    if (!activeTextBox) {
      return;
    }

    const nextRichText = activeTextBox.richText ?? plainTextToRichText(activeTextBox.text);

    const isNewEditingTarget = lastFocusedEditingTextBoxIdRef.current !== editingTextBoxId;

    if (!isNewEditingTarget && normalizeMultilineText(editor.innerText) !== editingDraft && document.activeElement !== editor) {
      editor.innerHTML = nextRichText;
    }

    if (isNewEditingTarget) {
      if (normalizeMultilineText(editor.innerText) !== editingDraft) {
        editor.innerHTML = nextRichText;
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
  }, [editingDraft, editingTextBoxId, textBoxes]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction || interaction.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();

        if (interaction.type === "move") {
        const deltaX = event.clientX - interaction.startX;
        const deltaY = event.clientY - interaction.startY;

        if (!interaction.hasMoved && Math.hypot(deltaX, deltaY) >= DRAG_START_DISTANCE) {
          interaction.hasMoved = true;
        }

        if (!interaction.hasMoved) {
          return;
        }

        const autoPan = onAutoPan(event.clientX, event.clientY);
        onMove(cardId, interaction.textBoxId, {
          x: interaction.originX + deltaX + (autoPan.scrollLeft - interaction.originScrollLeft),
          y: interaction.originY + deltaY + (autoPan.scrollTop - interaction.originScrollTop),
        });
        return;
      }

      const autoPan = onAutoPan(event.clientX, event.clientY);
      onResize(cardId, interaction.textBoxId, {
        width:
          interaction.originWidth +
          (event.clientX - interaction.startX) +
          (autoPan.scrollLeft - interaction.originScrollLeft),
        height:
          interaction.originHeight +
          (event.clientY - interaction.startY) +
          (autoPan.scrollTop - interaction.originScrollTop),
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction || interaction.pointerId !== event.pointerId) {
        return;
      }

      interaction.captureTarget?.releasePointerCapture?.(event.pointerId);
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
  }, [cardId, onAutoPan, onMove, onResize]);

  if (textBoxes.length === 0) {
    return null;
  }

  return (
    <div className="details-text-box-layer" aria-label="Textos libres del detalle">
      {textBoxes.map((textBox) => {
        const isSelected = selectedTextBoxId === textBox.id;
        const textBoxClassName = `${TEXT_BOX_FONT_SIZES[textBox.fontSize].className} ${
          textBox.bulleted ? "is-bulleted" : ""
        }`;
        const textBoxContentStyle = {
          fontWeight: textBox.bold ? 700 : 400,
          textDecoration: textBox.strike ? "line-through" : undefined,
        } satisfies CSSProperties;
        const displayHtml = textBox.richText ?? plainTextToRichText(textBox.text);

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
              const onDisplay = Boolean(target?.closest(".details-text-box-display"));

              if (event.button === 1) {
                if (target?.closest(".details-text-box-editor")) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                onDelete(cardId, textBox.id);
                onSelect(null);
                return;
              }

              if (event.button !== 0 && event.pointerType !== "touch") {
                return;
              }

              if (target?.closest(".details-text-box-editor")) {
                return;
              }

              onSelect(textBox.id);

              if (target?.closest("a")) {
                event.stopPropagation();
                return;
              }

              if (event.detail >= 2 && onDisplay) {
                interactionRef.current = null;
                event.stopPropagation();
                return;
              }

              event.stopPropagation();
              interactionRef.current = {
                type: "move",
                pointerId: event.pointerId,
                textBoxId: textBox.id,
                startX: event.clientX,
                startY: event.clientY,
                originX: textBox.x,
                originY: textBox.y,
                originScrollLeft: getViewportScroll().scrollLeft,
                originScrollTop: getViewportScroll().scrollTop,
                captureTarget: null,
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
                  className="details-text-toolbar-button"
                  title="Crear enlace Ctrl+Shift+U"
                  onClick={() => applyLinkToSelection(textBox)}
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
                className={`details-text-box-editor ${textBoxClassName}`}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                data-placeholder="Agregar texto"
                style={textBoxContentStyle}
                onInput={(event) => {
                  syncTextBoxContent(textBox.id, event.currentTarget);
                }}
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget as Node | null;
                  const wrapper = event.currentTarget.closest(".details-text-box");

                  if (nextTarget && wrapper instanceof HTMLElement && wrapper.contains(nextTarget)) {
                    return;
                  }

                  setEditingTextBoxId((currentId) => (currentId === textBox.id ? null : currentId));
                  editingPointRef.current = null;
                  finishTextBoxEditing(textBox.id, event.currentTarget);
                }}
              />
            ) : (
              <div
                className={`details-text-box-display ${textBoxClassName}`}
                role="textbox"
                aria-multiline="true"
                data-placeholder="Agregar texto"
                style={textBoxContentStyle}
                onClick={(event) => {
                  const anchor = (event.target as HTMLElement | null)?.closest("a");

                  if (!anchor) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  window.open((anchor as HTMLAnchorElement).href, "_blank", "noopener,noreferrer");
                }}
                onDoubleClick={(event) => {
                  const anchor = (event.target as HTMLElement | null)?.closest("a");

                  if (anchor) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  beginTextBoxEditing(textBox, { x: event.clientX, y: event.clientY });
                }}
                dangerouslySetInnerHTML={{ __html: displayHtml }}
              />
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
                    pointerId: event.pointerId,
                    textBoxId: textBox.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originWidth: textBox.width,
                    originHeight: textBox.height,
                    originScrollLeft: getViewportScroll().scrollLeft,
                    originScrollTop: getViewportScroll().scrollTop,
                    captureTarget: event.currentTarget,
                  };
                  event.currentTarget.setPointerCapture?.(event.pointerId);
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
  references,
  selectedReferenceId,
  category,
  onSelect,
  onDelete,
  onOpenReference,
  onMove,
}: {
  cardId: string;
  references: ExerciseReferenceItem[];
  selectedReferenceId: string | null;
  category: StudyCategory | null;
  onSelect: (referenceId: string | null) => void;
  onDelete: (cardId: string, referenceId: string) => void;
  onOpenReference: (sourceSectionId: "definitions" | "theorems", sourceCardId: string) => void;
  onMove: (cardId: string, referenceId: string, position: { x: number; y: number }) => void;
}) {
  const interactionRef = useRef<ExerciseReferenceInteraction>(null);

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

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;

      if (!interaction) {
        return;
      }

      event.preventDefault();

      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;

      if (!interaction.hasMoved && Math.hypot(deltaX, deltaY) >= DRAG_START_DISTANCE) {
        interaction.hasMoved = true;
      }

      if (!interaction.hasMoved) {
        return;
      }

      onMove(cardId, interaction.referenceId, {
        x: interaction.originX + deltaX,
        y: interaction.originY + deltaY,
      });
    };

    const onPointerUp = () => {
      const interaction = interactionRef.current;

      if (interaction && !interaction.hasMoved) {
        const source = references.find((reference) => reference.id === interaction.referenceId);

        if (source) {
          onOpenReference(source.sourceSectionId, source.sourceCardId);
        }
      }

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
  }, [cardId, onMove, onOpenReference, references]);

  if (references.length === 0) {
    return null;
  }

  return (
    <div className="exercise-set-layer" aria-label="Referencias de ejercicios">
      {references.map((reference) => {
        const source = sourceMap.get(reference.sourceCardId);
        const isSelected = selectedReferenceId === reference.id;

        return (
          <div
            key={reference.id}
            className={`question-card exercise-reference-object ${isSelected ? "is-selected" : ""} ${source ? "" : "is-missing"}`}
            style={{
              left: `${reference.x}px`,
              top: `${reference.y}px`,
              width: `${reference.width}px`,
              minHeight: `${reference.height}px`,
            }}
            role={source ? "button" : undefined}
            tabIndex={source ? 0 : -1}
            onPointerDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                event.stopPropagation();
                onDelete(cardId, reference.id);
                onSelect(null);
                return;
              }

              if (event.button !== 0 && event.pointerType !== "touch") {
                return;
              }

              onSelect(reference.id);
              interactionRef.current = {
                type: "move",
                referenceId: reference.id,
                startX: event.clientX,
                startY: event.clientY,
                originX: reference.x,
                originY: reference.y,
                hasMoved: false,
              };
            }}
            onKeyDown={(event) => {
              if (source && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onOpenReference(source.sourceSectionId, source.card.id);
              }
            }}
          >
            {source ? (
              <>
                <div className="exercise-reference-preview">
                  <CardContent card={source.card} mode="preview" />
                </div>
                <span className="exercise-reference-title">{source.card.text || "Sin título"}</span>
              </>
            ) : (
              <span className="exercise-reference-title">Tarjeta eliminada</span>
            )}
          </div>
        );
      })}
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
    moveDetailsTable,
    deleteDetailsTable,
    addDetailsImage,
    moveDetailsImage,
    resizeDetailsImage,
    rotateDetailsImage,
    deleteDetailsImage,
    addDetailsTextBox,
    updateDetailsTextBox,
    updateDetailsTextBoxContent,
    updateDetailsTextBoxStyle,
    moveDetailsTextBox,
    resizeDetailsTextBox,
    deleteDetailsTextBox,
    replaceExerciseReferences,
    moveExerciseReference,
    deleteExerciseReference,
    selectCard,
    openCard,
    openCardFromExerciseReference,
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
  const openedExerciseReferences = openedCard?.exerciseReferences ?? [];
  const isModalOpen = Boolean(openedCard);
  const openedDetailsTable = openedCard?.detailsTable ?? null;
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
  const exerciseFeedbackTimeoutRef = useRef<number | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const modalPanStateRef = useRef<ScrollPanState | null>(null);
  const modalInitialFocusSessionRef = useRef<string | null>(null);
  const cameraRef = useRef({ x: 0, y: 0 });
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
  const [isDetailsTableSelected, setIsDetailsTableSelected] = useState(false);
  const [isDetailsTableEditing, setIsDetailsTableEditing] = useState(false);
  const [selectedDetailsImageId, setSelectedDetailsImageId] = useState<string | null>(null);
  const [selectedDetailsTextBoxId, setSelectedDetailsTextBoxId] = useState<string | null>(null);
  const [selectedExerciseReferenceId, setSelectedExerciseReferenceId] = useState<string | null>(null);
  const [exerciseFeedback, setExerciseFeedback] = useState<string | null>(null);
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [categoryRenameDraft, setCategoryRenameDraft] = useState("");
  const [mapSearchText, setMapSearchText] = useState("");
  const worldHeight = Math.max(
    stageSize.height,
    ...cardsList.map((card) => card.position.y + (card.size?.height ?? CARD_FALLBACK_HEIGHT) + 260),
  );
  const modalWorldWidth = openedCard
    ? Math.max(1120, ...[
        960,
        ...(openedCard.detailsImages ?? []).map((image) => image.x + image.width + 280),
        ...(openedCard.detailsTextBoxes ?? []).map((textBox) => textBox.x + textBox.width + 280),
        ...openedExerciseReferences.map((reference) => reference.x + reference.width + 280),
        ...(openedDetailsTable
          ? [openedDetailsTable.x + openedDetailsTable.columnWidths.reduce((total, width) => total + width, 0) + 280]
          : []),
      ])
    : 1120;
  const modalWorldHeight = openedCard
    ? Math.max(
        stageSize.height,
        720,
        ...(openedCard.detailsImages ?? []).map((image) => image.y + image.height + 280),
        ...(openedCard.detailsTextBoxes ?? []).map((textBox) => textBox.y + textBox.height + 280),
        ...openedExerciseReferences.map((reference) => reference.y + reference.height + 280),
        ...(openedDetailsTable
          ? [openedDetailsTable.y + openedDetailsTable.rowHeights.reduce((total, height) => total + height, 0) + 280]
          : []),
      )
    : stageSize.height;

  const setCamera = (nextCamera: { x: number; y: number }) => {
    cameraRef.current = nextCamera;
    setCameraState(nextCamera);
  };

  const getModalOverlay = () => {
    const overlay = stageRef.current?.querySelector(".card-modal-overlay");
    return overlay instanceof HTMLElement ? overlay : null;
  };

  const getModalBody = () => {
    const modalBody = stageRef.current?.querySelector(".card-modal-body");
    return modalBody instanceof HTMLElement ? modalBody : null;
  };

  const getModalViewportScroll = useEffectEvent(() => {
    const overlay = getModalOverlay();
    return {
      scrollLeft: overlay?.scrollLeft ?? 0,
      scrollTop: overlay?.scrollTop ?? 0,
    };
  });

  const autoPanModalViewport = useEffectEvent((clientX: number, clientY: number): ViewportAutoPanResult => {
    const overlay = getModalOverlay();

    if (!overlay) {
      return {
        deltaX: 0,
        deltaY: 0,
        scrollLeft: 0,
        scrollTop: 0,
      };
    }

    const rect = overlay.getBoundingClientRect();
    let panX = 0;
    let panY = 0;
    const leftDistance = clientX - rect.left;
    const rightDistance = rect.right - clientX;
    const topDistance = clientY - rect.top;
    const bottomDistance = rect.bottom - clientY;
    panX = getEdgePanOffset(leftDistance, rightDistance, MODAL_EDGE_PAN_MARGIN, MODAL_EDGE_PAN_MAX_STEP);
    panY = getEdgePanOffset(topDistance, bottomDistance, MODAL_EDGE_PAN_MARGIN, MODAL_EDGE_PAN_MAX_STEP);

    const previousScrollLeft = overlay.scrollLeft;
    const previousScrollTop = overlay.scrollTop;

    if (panX !== 0 || panY !== 0) {
      overlay.scrollLeft = Math.max(0, overlay.scrollLeft + panX);
      overlay.scrollTop = Math.max(0, overlay.scrollTop + panY);
    }

    return {
      deltaX: overlay.scrollLeft - previousScrollLeft,
      deltaY: overlay.scrollTop - previousScrollTop,
      scrollLeft: overlay.scrollLeft,
      scrollTop: overlay.scrollTop,
    };
  });

  const resetModalViewportToContent = useEffectEvent(() => {
    const overlay = getModalOverlay();
    const body = getModalBody();

    if (!overlay || !body) {
      return;
    }

    const viewportWidth = overlay.clientWidth;
    const bodyRect = body.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const bodyOffsetLeft = bodyRect.left - overlayRect.left + overlay.scrollLeft;
    const centeredLeft = Math.max(0, bodyOffsetLeft - Math.max(0, (viewportWidth - bodyRect.width) / 2));

    overlay.scrollTo({
      left: Math.round(centeredLeft),
      top: 0,
      behavior: "auto",
    });
  });

  const collectModalOccupiedRects = useEffectEvent((card: QuestionCard) => {
    const bodyElement = getModalBody();
    const occupiedRects: Rect[] = [];

    if (bodyElement) {
      for (const selector of [".question-card-image-shell.is-full", ".question-card-copy.is-full", ".details-table"]) {
        for (const element of Array.from(bodyElement.querySelectorAll(selector))) {
          const rect = getElementRectWithinBody(element, bodyElement);

          if (rect) {
            occupiedRects.push(rect);
          }
        }
      }
    }

    const table = card.detailsTable;

    if (table) {
      const width = table.columnWidths.reduce((total, columnWidth) => total + columnWidth, 0);
      const height = table.rowHeights.reduce((total, rowHeight) => total + rowHeight, 0);
      occupiedRects.push(createRect(table.x, table.y, width, height));
    }

    for (const image of card.detailsImages ?? []) {
      occupiedRects.push(createRect(image.x, image.y, image.width, image.height));
    }

    for (const textBox of card.detailsTextBoxes ?? []) {
      occupiedRects.push(createRect(textBox.x, textBox.y, textBox.width, textBox.height));
    }

    for (const reference of card.exerciseReferences ?? []) {
      occupiedRects.push(createRect(reference.x, reference.y, reference.width, reference.height));
    }

    return occupiedRects;
  });

  const findAvailableModalRect = useEffectEvent((card: QuestionCard, candidate: Rect) => {
    const occupiedRects = collectModalOccupiedRects(card);
    return findAvailableRect(candidate, occupiedRects, candidate.right - candidate.left + 24, 24);
  });

  const ensureMapRectVisible = useEffectEvent((rect: Rect) => {
    const viewport = createRect(-cameraRef.current.x, -cameraRef.current.y, stageSize.width, stageSize.height);
    const { deltaX, deltaY } = getRectVisibilityDelta(rect, viewport, EDGE_VISIBILITY_MARGIN);

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    setCamera({
      x: cameraRef.current.x - deltaX,
      y: cameraRef.current.y - deltaY,
    });
  });

  const ensureModalRectVisible = useEffectEvent((rect: Rect) => {
    const overlay = getModalOverlay();
    const bodyElement = getModalBody();

    if (!overlay || !bodyElement) {
      return;
    }

    const viewport = createRect(overlay.scrollLeft, overlay.scrollTop, overlay.clientWidth, overlay.clientHeight);
    const { deltaX, deltaY } = getRectVisibilityDelta(rect, viewport, EDGE_VISIBILITY_MARGIN);

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    overlay.scrollTo({
      left: Math.max(0, overlay.scrollLeft + deltaX),
      top: Math.max(0, overlay.scrollTop + deltaY),
      behavior: "smooth",
    });
  });

  const getDetailsInsertionPoint = useEffectEvent(() => {
    const pointerPoint = lastDetailsPointerRef.current;

    if (pointerPoint) {
      return pointerPoint;
    }

    const overlay = getModalOverlay();

    if (!overlay) {
      return { x: 24, y: 24 };
    }

    return {
      x: overlay.scrollLeft + overlay.clientWidth / 2,
      y: overlay.scrollTop + overlay.clientHeight / 2,
    };
  });

  const getVisibleModalViewport = useEffectEvent(() => {
    const overlay = getModalOverlay();

    if (!overlay) {
      return null;
    }

    return createRect(overlay.scrollLeft, overlay.scrollTop, overlay.clientWidth, overlay.clientHeight);
  });

  const getVisibleDetailsInsertionRect = useEffectEvent((width: number, height: number) => {
    const viewport = getVisibleModalViewport();

    if (!viewport) {
      return createRect(24, 24, width, height);
    }

    const minLeft = viewport.left + DETAILS_INSERT_VIEWPORT_PADDING;
    const minTop = viewport.top + DETAILS_INSERT_VIEWPORT_PADDING;
    const maxLeft = Math.max(minLeft, viewport.right - width - DETAILS_INSERT_VIEWPORT_PADDING);
    const maxTop = Math.max(minTop, viewport.bottom - height - DETAILS_INSERT_VIEWPORT_PADDING);
    let centerX = viewport.left + (viewport.right - viewport.left) / 2;
    let centerY = viewport.top + (viewport.bottom - viewport.top) / 2;
    const pointerPoint = lastDetailsPointerRef.current;

    if (
      pointerPoint &&
      pointerPoint.x >= minLeft &&
      pointerPoint.x <= viewport.right - DETAILS_INSERT_VIEWPORT_PADDING &&
      pointerPoint.y >= minTop &&
      pointerPoint.y <= viewport.bottom - DETAILS_INSERT_VIEWPORT_PADDING
    ) {
      centerX = pointerPoint.x;
      centerY = pointerPoint.y;
    }

    return createRect(
      Math.round(clamp(centerX - width / 2, minLeft, maxLeft)),
      Math.round(clamp(centerY - height / 2, minTop, maxTop)),
      width,
      height,
    );
  });

  const shouldEnsureModalRectVisible = useEffectEvent((rect: Rect, margin = EDGE_VISIBILITY_MARGIN) => {
    const viewport = getVisibleModalViewport();

    if (!viewport) {
      return false;
    }

    const { deltaX, deltaY } = getRectVisibilityDelta(rect, viewport, margin);
    return deltaX !== 0 || deltaY !== 0;
  });

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

  const flushRemoteProjectNow = useEffectEvent(() => {
    if (!identity || bootState !== "ready" || isApplyingRemoteSnapshotRef.current) {
      return;
    }

    const signature = JSON.stringify(useTreeStore.getState().getProjectSnapshot());

    if (signature === lastPersistedProjectSignatureRef.current) {
      return;
    }

    void saveRemoteProject();
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
      const maxWidth = Math.min(image.width ?? 320, 420);
      const aspectRatio = image.width && image.height ? image.height / image.width : 0.65;
      const width = Math.max(120, maxWidth);
      const height = Math.max(90, width * aspectRatio);
      const insertionPoint = getDetailsInsertionPoint();
      const nextRect = createRect(
        Math.max(16, insertionPoint.x - width / 2),
        Math.max(24, insertionPoint.y - height / 2),
        width,
        height,
      );
      const imageId = addDetailsImage(cardId, image, {
        x: Math.round(nextRect.left),
        y: Math.round(nextRect.top),
        width: Math.round(nextRect.right - nextRect.left),
        height: Math.round(nextRect.bottom - nextRect.top),
      });

      setSelectedDetailsImageId(imageId);
      setShowTableMenu(false);
      if (imageId) {
        void flushRemoteProjectNow();
        window.requestAnimationFrame(() => {
          ensureModalRectVisible(nextRect);
        });
      }
    } catch {
      setPasteFeedback("image-error");
    }
  });

  const createDetailsTextBox = useEffectEvent((cardId: string) => {
    const width = 280;
    const height = 80;
    const card = cards[cardId];

    if (!card) {
      return null;
    }

    const baseRect = getVisibleDetailsInsertionRect(width, height);
    const nextRect = findAvailableModalRect(card, baseRect);
    const textBoxId = addDetailsTextBox(cardId, {
      x: Math.round(nextRect.left),
      y: Math.round(nextRect.top),
      width: Math.round(nextRect.right - nextRect.left),
      height: Math.round(nextRect.bottom - nextRect.top),
    });

    setSelectedDetailsImageId(null);
    setSelectedDetailsTextBoxId(textBoxId);
    if (textBoxId && shouldEnsureModalRectVisible(nextRect)) {
      window.requestAnimationFrame(() => {
        ensureModalRectVisible(nextRect);
      });
    }

    return textBoxId;
  });

  const createExerciseReferences = useEffectEvent((cardId: string) => {
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

    const query = buildExerciseQuery(sourceCard);
    const matches = collectExerciseMatches(query, sectionCandidates);

    const bodyElement = getModalBody();
    const overlay = getModalOverlay();
    const availableWidth = Math.max(
      CARD_FALLBACK_WIDTH,
      (bodyElement?.clientWidth ?? CARD_FALLBACK_WIDTH * 2) - 48,
    );
    const columns = Math.max(
      1,
      Math.min(2, Math.floor(availableWidth / (CARD_FALLBACK_WIDTH + EXERCISE_RESULT_GAP)) || 1),
    );
    const originX = 24;
    const originY = (overlay?.scrollTop ?? 0) + (overlay?.clientHeight ?? 0) + 32;
    const timestamp = new Date().toISOString();
    const occupiedRects: Rect[] = collectModalOccupiedRects(sourceCard);

    const references = matches.map((match, index) => {
      const matchCard = match.card;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const width = Math.max(220, Math.round(matchCard.size?.width ?? CARD_FALLBACK_WIDTH));
      const height = Math.max(EXERCISE_RESULT_MIN_HEIGHT, Math.round(matchCard.size?.height ?? CARD_FALLBACK_HEIGHT));
      const candidateRect = createRect(
        originX + column * (width + EXERCISE_RESULT_GAP),
        Math.max(24, Math.round(originY + row * (height + EXERCISE_RESULT_GAP))),
        width,
        height,
      );
      const nextRect = findAvailableRect(candidateRect, occupiedRects, width + EXERCISE_RESULT_GAP, EXERCISE_RESULT_GAP);
      occupiedRects.push(nextRect);

      return {
        id: makeClientId(),
        sourceSectionId: match.sourceSectionId,
        sourceCardId: match.sourceCardId,
        x: Math.round(nextRect.left),
        y: Math.round(nextRect.top),
        width: Math.round(nextRect.right - nextRect.left),
        height: Math.round(nextRect.bottom - nextRect.top),
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies ExerciseReferenceItem;
    });

    replaceExerciseReferences(cardId, references);
    setSelectedDetailsImageId(null);
    setSelectedDetailsTextBoxId(null);
    setSelectedExerciseReferenceId(references[0]?.id ?? null);

    if (exerciseFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(exerciseFeedbackTimeoutRef.current);
      exerciseFeedbackTimeoutRef.current = null;
    }

    if (references.length === 0) {
      setExerciseFeedback("No se encontraron resultados en Definiciones y Teoremas.");
      exerciseFeedbackTimeoutRef.current = window.setTimeout(() => {
        setExerciseFeedback(null);
        exerciseFeedbackTimeoutRef.current = null;
      }, 2600);
      return null;
    }

    setExerciseFeedback(null);

    if (bodyElement) {
      window.requestAnimationFrame(() => {
        ensureModalRectVisible(
          createRect(
            references[0]?.x ?? originX,
            references[0]?.y ?? originY,
            references[0]?.width ?? EXERCISE_RESULT_CARD_WIDTH,
            references[0]?.height ?? EXERCISE_RESULT_MIN_HEIGHT,
          ),
        );
      });
    }

    return references[0]?.id ?? null;
  });

  const ensureDetailsTablePlaced = useEffectEvent((cardId: string, cells?: string[][]) => {
    const overlay = getModalOverlay();
    const beforeCard = cards[cardId];

    if (!beforeCard) {
      return;
    }

    if (cells && cells.length > 0) {
      setDetailsTableFromCells(cardId, cells);
    } else if (!beforeCard.detailsTable) {
      ensureDetailsTable(cardId);
    }

    const nextCard = useTreeStore.getState().cards[cardId];
    const nextTable = nextCard?.detailsTable;

    if (!nextCard || !nextTable) {
      return;
    }

    const width = nextTable.columnWidths.reduce((total, columnWidth) => total + columnWidth, 0);
    const height = nextTable.rowHeights.reduce((total, rowHeight) => total + rowHeight, 0);
    const candidate = createRect(
      nextTable.x,
      nextTable.y,
      width,
      height,
    );
    const shouldReposition = !beforeCard.detailsTable || Boolean(cells?.length);
    const baseRect = shouldReposition
      ? createRect(
          (overlay?.scrollLeft ?? 0) + 24,
          (overlay?.scrollTop ?? 0) + Math.max(180, (overlay?.clientHeight ?? 0) - height - 48),
          width,
          height,
        )
      : candidate;
    const occupiedRects = collectModalOccupiedRects({
      ...nextCard,
      detailsTable: shouldReposition ? null : nextTable,
    });
    const nextRect = findAvailableRect(baseRect, occupiedRects, width + 24, 24);

    if (nextRect.left !== nextTable.x || nextRect.top !== nextTable.y) {
      moveDetailsTable(cardId, {
        x: Math.round(nextRect.left),
        y: Math.round(nextRect.top),
      });
    }

    window.requestAnimationFrame(() => {
      ensureModalRectVisible(nextRect);
    });
  });

  const openExerciseReference = useEffectEvent((sourceSectionId: "definitions" | "theorems", sourceCardId: string) => {
    if (!activeCategoryId) {
      return;
    }

    const originMapKind = activeMapKind;
    if (!originMapKind) {
      return;
    }

    if (activeMapKind !== "section" || activeSectionId !== sourceSectionId) {
      openCategorySection(activeCategoryId, sourceSectionId);
    }

    selectCard(sourceCardId);
    openCardFromExerciseReference(sourceCardId, {
      categoryId: activeCategoryId,
      mapKind: originMapKind,
      sectionId: activeSectionId,
      selectedCardId,
      openedCardId,
    });
  });

  const clearUndoTimer = useEffectEvent(() => {
    if (undoTimeoutRef.current !== null) {
      window.clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
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

      if (blurActiveEditableElement()) {
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
          applyLinkToFocusedEditor();
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
      isDetailsTableSelected &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !isEditableTarget(event.target) &&
      (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault();
      deleteDetailsTable(openedCardId);
      setIsDetailsTableSelected(false);
      setIsDetailsTableEditing(false);
      return;
    }

    if (
      openedCardId &&
      selectedExerciseReferenceId &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !isEditableTarget(event.target) &&
      (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault();
      deleteExerciseReference(openedCardId, selectedExerciseReferenceId);
      setSelectedExerciseReferenceId(null);
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
        applyLinkToFocusedEditor();
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
      const previousCardCount = Object.keys(useTreeStore.getState().cards).length;
      confirmDraft(stageSize, {
        x: -cameraRef.current.x,
        y: -cameraRef.current.y,
      });
      const nextState = useTreeStore.getState();

      if (Object.keys(nextState.cards).length > previousCardCount && nextState.selectedCardId) {
        const nextCard = nextState.cards[nextState.selectedCardId];

        if (nextCard) {
          ensureMapRectVisible(
            createRect(
              nextCard.position.x,
              nextCard.position.y,
              nextCard.size?.width ?? CARD_FALLBACK_WIDTH,
              nextCard.size?.height ?? CARD_FALLBACK_HEIGHT,
            ),
          );
        }
      }
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
        ensureDetailsTablePlaced(openedCardId, tableCells);
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
    blurActiveEditableElement();
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
    const card = cards[cardId];

    if (!card) {
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      deleteCard(cardId);
      return;
    }

    if (event.button !== 0 && event.pointerType !== "touch") {
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

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (!dragState.hasMoved && Math.hypot(deltaX, deltaY) >= DRAG_START_DISTANCE) {
      dragState.hasMoved = true;
    }

    if (!dragState.hasMoved) {
      return;
    }

    const rect = stageRef.current?.getBoundingClientRect();
    let nextCamera = cameraRef.current;

    if (rect) {
      const leftDistance = event.clientX - rect.left;
      const rightDistance = rect.right - event.clientX;
      const topDistance = event.clientY - rect.top;
      const bottomDistance = rect.bottom - event.clientY;
      const panX = -getEdgePanOffset(leftDistance, rightDistance, MAP_EDGE_PAN_MARGIN, MAP_EDGE_PAN_MAX_STEP);
      const panY = -getEdgePanOffset(topDistance, bottomDistance, MAP_EDGE_PAN_MARGIN, MAP_EDGE_PAN_MAX_STEP);

      if (panX !== 0 || panY !== 0) {
        nextCamera = {
          x: cameraRef.current.x + panX,
          y: cameraRef.current.y + panY,
        };
        setCamera(nextCamera);
      }
    }

    const cameraDeltaX = nextCamera.x - dragState.cameraOriginX;
    const cameraDeltaY = nextCamera.y - dragState.cameraOriginY;

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
    if (exerciseFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(exerciseFeedbackTimeoutRef.current);
      exerciseFeedbackTimeoutRef.current = null;
    }
    setSelectedDetailsImageId(null);
    setSelectedDetailsTextBoxId(null);
    setSelectedExerciseReferenceId(null);
    setExerciseFeedback(null);
  }, [openedCardId]);

  useLayoutEffect(() => {
    if (!openedCardId) {
      modalInitialFocusSessionRef.current = null;
      return;
    }

    if (modalInitialFocusSessionRef.current === openedCardId) {
      return;
    }

    modalInitialFocusSessionRef.current = openedCardId;

    window.requestAnimationFrame(() => {
      resetModalViewportToContent();
    });
  }, [openedCardId, resetModalViewportToContent]);

  useEffect(() => {
    return () => {
      if (exerciseFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(exerciseFeedbackTimeoutRef.current);
      }
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
      setIsDetailsTableSelected(false);
      setIsDetailsTableEditing(false);
      setSelectedDetailsImageId(null);
      setSelectedDetailsTextBoxId(null);
      setSelectedExerciseReferenceId(null);
      lastDetailsPointerRef.current = null;
      modalPanStateRef.current = null;
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
    };
  }, [clearUndoTimer]);

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
            onPointerDown={(event) => {
              if (event.button !== 0 && event.pointerType !== "touch") {
                return;
              }

              if (!shouldStartModalPan(event.target)) {
                return;
              }

              event.preventDefault();
              modalPanStateRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originScrollLeft: event.currentTarget.scrollLeft,
                originScrollTop: event.currentTarget.scrollTop,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              const modalBody = event.currentTarget.querySelector(".card-modal-body");
              const bodyRect = modalBody instanceof HTMLElement ? modalBody.getBoundingClientRect() : null;
              const panState = modalPanStateRef.current;

              if (panState && panState.pointerId === event.pointerId) {
                event.preventDefault();
                event.currentTarget.scrollLeft = Math.max(
                  0,
                  panState.originScrollLeft - (event.clientX - panState.startX),
                );
                event.currentTarget.scrollTop = Math.max(
                  0,
                  panState.originScrollTop - (event.clientY - panState.startY),
                );
              }

              if (bodyRect) {
                lastDetailsPointerRef.current = {
                  x: event.clientX - bodyRect.left,
                  y: event.clientY - bodyRect.top,
                };
              }

              sendPresence(
                bodyRect
                  ? {
                      x: event.clientX - bodyRect.left,
                      y: event.clientY - bodyRect.top,
                    }
                  : null,
                {
                  surface: "card-modal",
                  openedCardId: openedCard.id,
                },
              );
            }}
            onPointerUp={(event) => {
              if (modalPanStateRef.current?.pointerId === event.pointerId) {
                modalPanStateRef.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (modalPanStateRef.current?.pointerId === event.pointerId) {
                modalPanStateRef.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
              }
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
                title="Cerrar detalle"
                onClick={closeCard}
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
                      createExerciseReferences(openedCard.id);
                    }
                  }}
                >
                  Ejercicios
                </button>
              ) : null}
              {exerciseFeedback ? <div className="exercise-set-feedback">{exerciseFeedback}</div> : null}
              <div
                className="card-modal-body"
                style={{
                  minWidth: `${modalWorldWidth}px`,
                  minHeight: `${modalWorldHeight}px`,
                }}
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
                  if (!target?.closest(".exercise-reference-object")) {
                    setSelectedExerciseReferenceId(null);
                  }
                  if (!target?.closest(".details-table-object")) {
                    setIsDetailsTableSelected(false);
                    setIsDetailsTableEditing(false);
                  }

                  if (
                    !target?.closest(".details-image-object") &&
                    !target?.closest(".details-text-box") &&
                    !target?.closest(".exercise-reference-object") &&
                    !target?.closest(".details-table-object") &&
                    !target?.closest(".details-table-controls")
                  ) {
                    blurActiveEditableElement();
                  }
                }}
              >
                <CardContent card={openedCard} mode="full" />
                {openedCard.detailsTable ? (
                  <DetailsTableEditor
                    cardId={openedCard.id}
                    table={openedCard.detailsTable}
                    isSelected={isDetailsTableSelected}
                    isEditing={isDetailsTableEditing}
                    onSelect={() => {
                      setShowTableMenu(false);
                      setIsDetailsTableSelected(true);
                      setSelectedDetailsImageId(null);
                      setSelectedDetailsTextBoxId(null);
                      setSelectedExerciseReferenceId(null);
                    }}
                    onBeginEditing={() => {
                      setShowTableMenu(false);
                      setIsDetailsTableSelected(true);
                      setIsDetailsTableEditing(true);
                      setSelectedDetailsImageId(null);
                      setSelectedDetailsTextBoxId(null);
                      setSelectedExerciseReferenceId(null);
                    }}
                    onDelete={deleteDetailsTable}
                    onMove={moveDetailsTable}
                    onUpdateCell={updateDetailsTableCell}
                    onResizeColumn={resizeDetailsTableColumn}
                    onResizeRow={resizeDetailsTableRow}
                    onPasteTable={(cells) => {
                      ensureDetailsTablePlaced(openedCard.id, cells);
                      setShowTableMenu(false);
                      setIsDetailsTableSelected(true);
                      setIsDetailsTableEditing(true);
                      setSelectedDetailsImageId(null);
                      setSelectedDetailsTextBoxId(null);
                      setSelectedExerciseReferenceId(null);
                    }}
                    onStartTyping={() => {
                      setShowTableMenu(false);
                      setIsDetailsTableSelected(true);
                      setSelectedDetailsImageId(null);
                      setSelectedDetailsTextBoxId(null);
                      setSelectedExerciseReferenceId(null);
                    }}
                  />
                ) : null}
                <DetailsImageLayer
                  cardId={openedCard.id}
                  images={openedCard.detailsImages ?? []}
                  selectedImageId={selectedDetailsImageId}
                  onSelect={(imageId) => {
                    setIsDetailsTableSelected(false);
                    setIsDetailsTableEditing(false);
                    setSelectedExerciseReferenceId(null);
                    setSelectedDetailsTextBoxId(null);
                    setSelectedDetailsImageId(imageId);
                  }}
                  onDelete={(cardId, imageId) => {
                    deleteDetailsImage(cardId, imageId);
                    setSelectedDetailsImageId(null);
                  }}
                  onMove={moveDetailsImage}
                  onResize={resizeDetailsImage}
                  onRotate={rotateDetailsImage}
                  onAutoPan={autoPanModalViewport}
                  getViewportScroll={getModalViewportScroll}
                />
                <DetailsTextBoxLayer
                  cardId={openedCard.id}
                  textBoxes={openedCard.detailsTextBoxes ?? []}
                  selectedTextBoxId={selectedDetailsTextBoxId}
                  onSelect={(textBoxId) => {
                    setIsDetailsTableSelected(false);
                    setIsDetailsTableEditing(false);
                    setSelectedExerciseReferenceId(null);
                    setSelectedDetailsImageId(null);
                    setSelectedDetailsTextBoxId(textBoxId);
                  }}
                  onUpdateContent={updateDetailsTextBoxContent}
                  onDelete={deleteDetailsTextBox}
                  onFinishEditing={flushRemoteProjectNow}
                  onStyle={updateDetailsTextBoxStyle}
                  onMove={moveDetailsTextBox}
                  onResize={resizeDetailsTextBox}
                  onAutoPan={autoPanModalViewport}
                  getViewportScroll={getModalViewportScroll}
                />
                <ExerciseReferencesLayer
                  cardId={openedCard.id}
                  references={openedExerciseReferences}
                  selectedReferenceId={selectedExerciseReferenceId}
                  category={activeCategory}
                  onSelect={(referenceId) => {
                    setIsDetailsTableSelected(false);
                    setIsDetailsTableEditing(false);
                    setSelectedDetailsImageId(null);
                    setSelectedDetailsTextBoxId(null);
                    setSelectedExerciseReferenceId(referenceId);
                  }}
                  onDelete={(cardId, referenceId) => {
                    deleteExerciseReference(cardId, referenceId);
                    setSelectedExerciseReferenceId(null);
                  }}
                  onOpenReference={openExerciseReference}
                  onMove={moveExerciseReference}
                />
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
                    ensureDetailsTablePlaced(openedCard.id);
                    setIsDetailsTableSelected(true);
                    setIsDetailsTableEditing(false);
                    setSelectedDetailsImageId(null);
                    setSelectedDetailsTextBoxId(null);
                    setSelectedExerciseReferenceId(null);
                    setShowTableMenu((currentValue) => !currentValue);
                  }}
                >
                  +
                </button>
              </div>
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
