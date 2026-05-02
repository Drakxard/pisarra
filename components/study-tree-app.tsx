"use client";

import {
  Children,
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  isValidElement,
  memo,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
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
  CardSize,
  DraftImage,
  QuestionCard,
  SearchResult,
} from "@/lib/types";

const DEFAULT_STAGE_WIDTH = 1400;
const DEFAULT_STAGE_HEIGHT = 900;
const AUTOSAVE_DEBOUNCE_MS = 450;
const UNDO_TIMEOUT_MS = 3000;
const PASTE_FEEDBACK_TIMEOUT_MS = 2600;
const CARD_FALLBACK_WIDTH = 320;
const CARD_FALLBACK_HEIGHT = 220;
const KEYBOARD_MOVE_STEP = 24;
const START_DETAILS_EDIT_EVENT = "study-tree:start-details-edit";
const EDGE_PAN_MARGIN = 72;
const EDGE_PAN_MAX_STEP = 18;
const CLOSE_HOLD_DELETE_MS = 800;

type StageSize = {
  width: number;
  height: number;
};

type AppBootState = "loading" | "needs-directory" | "ready";

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function isKatexElement(node: React.ReactNode) {
  if (!isValidElement(node)) {
    return false;
  }

  const props = node.props as { className?: string };
  const className = typeof props.className === "string" ? props.className : "";

  return className.includes("katex");
}

function moveInlineMathDelimiters(items: React.ReactNode[], firstKatexIndex: number) {
  const textBefore = [...items.slice(0, firstKatexIndex)];
  const formulaAndAfter = [...items.slice(firstKatexIndex)];
  const lastBefore = textBefore.at(-1);

  if (typeof lastBefore === "string") {
    const match = lastBefore.match(/^([\s\S]*?)(\s*)\(\s*$/);

    if (match) {
      const [, beforeText] = match;

      if (beforeText) {
        textBefore[textBefore.length - 1] = beforeText;
      } else {
        textBefore.pop();
      }

      formulaAndAfter.unshift("(");
    }
  }

  const nextAfterFormula = formulaAndAfter[1];

  if (typeof nextAfterFormula === "string") {
    const match = nextAfterFormula.match(/^\s*\)([.,;:!?])?/);

    if (match) {
      const closingToken = match[0].trim();
      const rest = nextAfterFormula.slice(match[0].length);

      formulaAndAfter[1] = `${closingToken}${rest}`;
    }
  }

  return {
    textBefore,
    formulaAndAfter,
  };
}

function renderParagraph(children?: React.ReactNode) {
  const items = Children.toArray(children);
  const firstKatexIndex = items.findIndex((item) => isKatexElement(item));

  if (firstKatexIndex === -1) {
    return <p>{children}</p>;
  }

  const { textBefore, formulaAndAfter } = moveInlineMathDelimiters(items, firstKatexIndex);

  return (
    <p className="math-paragraph">
      {textBefore.length > 0 ? (
        <span className="math-paragraph-text">{textBefore}</span>
      ) : null}
      <span className="math-paragraph-formula">{formulaAndAfter}</span>
    </p>
  );
}

function preserveSingleLineBreaks(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/(?<!\n)\n(?!\n)/g, "  \n");
}

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => renderParagraph(children),
  strong: ({ children }: { children?: React.ReactNode }) => <strong>{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul>{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol>{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
};

const NodeLabel = memo(function NodeLabel({ text }: { text: string }) {
  return (
    <div className="node-content is-rich">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {preserveSingleLineBreaks(text)}
      </ReactMarkdown>
    </div>
  );
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

const CardDetailsEditor = memo(function CardDetailsEditor({
  cardId,
  text,
  onSave,
}: {
  cardId: string;
  text: string;
  onSave: (cardId: string, text: string) => void;
}) {
  const [draft, setDraft] = useState(text);
  const [isEditing, setIsEditing] = useState(text.trim().length === 0);
  const editableRef = useRef<HTMLDivElement | null>(null);
  const pendingInsertionRef = useRef<string | null>(null);
  const pendingCaretPointRef = useRef<{ x: number; y: number } | null>(null);
  const shouldAutoScrollRef = useRef(text.trim().length === 0);

  useEffect(() => {
    setDraft(text);
    if (editableRef.current && isEditing && editableRef.current.innerText !== text) {
      editableRef.current.innerText = text;
    }
  }, [isEditing, text]);

  useEffect(() => {
    if (!isEditing || !editableRef.current) {
      return;
    }

    if (shouldAutoScrollRef.current) {
      const overlay = editableRef.current.closest(".card-modal-overlay");

      if (overlay instanceof HTMLElement) {
        overlay.scrollTo({
          top: overlay.scrollHeight,
          behavior: "smooth",
        });
      } else {
        editableRef.current.scrollIntoView({
          block: "end",
          behavior: "smooth",
        });
      }
    }

    editableRef.current.focus();

    const pendingCaretPoint = pendingCaretPointRef.current;
    pendingCaretPointRef.current = null;

    if (pendingCaretPoint) {
      const placed = placeCursorAtPoint(
        editableRef.current,
        pendingCaretPoint.x,
        pendingCaretPoint.y,
      );

      if (!placed) {
        placeCursorAtEnd(editableRef.current);
      }
    } else {
      placeCursorAtEnd(editableRef.current);
    }

    if (pendingInsertionRef.current) {
      insertPlainTextAtCursor(pendingInsertionRef.current);
      pendingInsertionRef.current = null;
      setDraft(editableRef.current.innerText ?? "");
    }

    shouldAutoScrollRef.current = false;
  }, [cardId, isEditing]);

  useEffect(() => {
    const onStartEditing = (event: Event) => {
      const customEvent = event as CustomEvent<{ text?: string }>;
      pendingInsertionRef.current = customEvent.detail?.text ?? null;
      shouldAutoScrollRef.current = true;
      setIsEditing(true);
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
    event.currentTarget.innerHTML = "";
    setIsEditing(false);
    persistDraft(nextDraft);
  };

  return (
    <section className="card-details-section" aria-label="Notas de la tarjeta">
      {isEditing ? (
        <div
          ref={editableRef}
          className="card-details-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={(event) => {
            setDraft(event.currentTarget.innerText ?? "");
          }}
          onBlur={onBlur}
          onPaste={(event: ReactClipboardEvent<HTMLDivElement>) => {
            event.preventDefault();
            insertPlainTextAtCursor(event.clipboardData.getData("text/plain"));
          }}
        />
      ) : (
        <div
          className={`card-details-rendered ${draft.trim() ? "has-content" : "is-empty"}`}
          role="button"
          tabIndex={0}
          onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
            pendingCaretPointRef.current = {
              x: event.clientX,
              y: event.clientY,
            };
            shouldAutoScrollRef.current = false;
            setIsEditing(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              shouldAutoScrollRef.current = false;
              setIsEditing(true);
            }
          }}
        >
          {draft.trim() ? null : <div className="card-details-empty-space" aria-hidden="true" />}
          {draft.trim() ? <NodeLabel text={draft} /> : null}
        </div>
      )}
    </section>
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
    appendDraftCharacter,
    appendDraftText,
    attachDraftImage,
    backspaceDraft,
    clearDraft,
    clearDraftImage,
    confirmDraft,
    updateCardDetails,
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
    resetProject,
    goToNextSearchResult,
    goToPreviousSearchResult,
    clearSearchState,
  } = useTreeStore();
  const pendingImageAssets = getPendingImageAssets();
  const projectSignature = JSON.stringify(getProjectSnapshot());
  const pendingAssetSignature = pendingImageAssets.map((asset) => asset.path).join("\u0000");
  const cardsList = Object.values(cards).sort((left, right) => left.zIndex - right.zIndex);
  const activeSearchResult: SearchResult | null =
    activeSearchResultIndex >= 0 ? searchResults[activeSearchResultIndex] ?? null : null;
  const matchedCardIds = new Set(searchResults.map((result) => result.cardId));
  const openedCard = openedCardId ? cards[openedCardId] ?? null : null;
  const isModalOpen = Boolean(openedCard);
  const draftCommandHint = getDraftCommandHint(draftText, Boolean(draftImage));
  const stageRef = useRef<HTMLElement | null>(null);
  const hasAttemptedRecoveryRef = useRef(false);
  const lastPersistedProjectSignatureRef = useRef<string | null>(null);
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
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [bootState, setBootState] = useState<AppBootState>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [isPickingDirectory, setIsPickingDirectory] = useState(false);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const [showSearchFeedback, setShowSearchFeedback] = useState(false);
  const [showPasteFeedback, setShowPasteFeedback] = useState(false);
  const [canUseProjectDirectory, setCanUseProjectDirectory] = useState(false);
  const [hasResolvedDirectorySupport, setHasResolvedDirectorySupport] = useState(false);

  const setCamera = (nextCamera: { x: number; y: number }) => {
    cameraRef.current = nextCamera;
    setCameraState(nextCamera);
  };

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

  const readProjectFromHandle = useEffectEvent(async (handle: FileSystemDirectoryHandle) => {
    try {
      const snapshot = await readProjectSnapshot(handle);
      return await hydrateProjectSnapshotAssets(handle, snapshot);
    } catch (error) {
      if (
        error instanceof MissingProjectFileError ||
        error instanceof EmptyProjectFileError ||
        error instanceof InvalidProjectFileError ||
        error instanceof IncompatibleProjectVersionError ||
        error instanceof SyntaxError
      ) {
        console.warn("No se pudo restaurar study-tree.json; se iniciara un proyecto vacio.", error);
        return null;
      }

      throw error;
    }
  });

  const activateDirectoryHandle = useEffectEvent(
    async (handle: FileSystemDirectoryHandle, options?: { resetIfEmpty?: boolean }) => {
      const snapshot = await readProjectFromHandle(handle);

      if (snapshot) {
        loadProjectSnapshot(snapshot);
      } else if (options?.resetIfEmpty !== false) {
        resetProject();
      }

      setDirectoryHandle(handle);
      setBootError(null);
      setBootState("ready");
      lastPersistedProjectSignatureRef.current = JSON.stringify(
        useTreeStore.getState().getProjectSnapshot(),
      );
    },
  );

  const onPickProjectDirectory = useEffectEvent(async () => {
    if (!canUseProjectDirectory || isPickingDirectory) {
      return;
    }

    setIsPickingDirectory(true);
    setBootError(null);

    try {
      const handle = await selectProjectDirectory();
      await activateDirectoryHandle(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message =
        error instanceof Error ? error.message : "No se pudo abrir la carpeta del proyecto.";

      setBootError(message);
    } finally {
      setIsPickingDirectory(false);
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

      if (activeElement?.isContentEditable) {
        activeElement.blur();
        return;
      }

      if (openedCardId) {
        closeCard();
        return;
      }

      selectCard(null);
      clearSearchState();
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (openedCardId && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (event.key.length === 1 || event.key === "Enter") {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(START_DETAILS_EDIT_EVENT, {
            detail: {
              text: event.key === "Enter" ? "\n" : event.key,
            },
          }),
        );
        return;
      }
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

    if (event.defaultPrevented || isEditableTarget(event.target)) {
      return;
    }

    const clipboardData = event.clipboardData;

    if (!clipboardData) {
      return;
    }

    const pastedText = clipboardData.getData("text");
    const imageItem = Array.from(clipboardData.items).find(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );

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
    setCanUseProjectDirectory(supportsProjectDirectory());
    setHasResolvedDirectorySupport(true);
  }, []);

  useEffect(() => {
    if (hasAttemptedRecoveryRef.current) {
      return;
    }

    if (!hasResolvedDirectorySupport) {
      return;
    }

    hasAttemptedRecoveryRef.current = true;

    let cancelled = false;

    const recoverProject = async () => {
      if (!canUseProjectDirectory) {
        setBootState("needs-directory");
        setBootError("Tu navegador no soporta acceso persistente a carpetas.");
        return;
      }

      setBootState("loading");
      setBootError(null);

      try {
        const storedHandle = await withTimeout(recoverStoredDirectoryHandle(), 5000, null);

        if (!storedHandle) {
          if (!cancelled) {
            setBootState("needs-directory");
          }
          return;
        }

        const hasAccess = await hasDirectoryReadWriteAccess(storedHandle);

        if (cancelled) {
          return;
        }

        if (!hasAccess) {
          setDirectoryHandle(null);
          setBootState("needs-directory");
          return;
        }

        await activateDirectoryHandle(storedHandle);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("No se pudo hidratar el proyecto al iniciar.", error);
        setDirectoryHandle(null);
        setBootState("needs-directory");
      }
    };

    void recoverProject();

    return () => {
      cancelled = true;
    };
  }, [activateDirectoryHandle, canUseProjectDirectory, hasResolvedDirectorySupport]);

  useEffect(() => {
    if (!directoryHandle || bootState !== "ready") {
      return;
    }

    if (
      projectSignature === lastPersistedProjectSignatureRef.current &&
      pendingImageAssets.length === 0
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          await writeProjectSnapshot(
            directoryHandle,
            useTreeStore.getState().getProjectSnapshot(),
            pendingImageAssets,
          );
          markCardImagesPersisted(pendingImageAssets.map((asset) => asset.cardId));
          lastPersistedProjectSignatureRef.current = JSON.stringify(
            useTreeStore.getState().getProjectSnapshot(),
          );
        } catch (error) {
          console.error("No se pudo guardar el proyecto en la carpeta seleccionada.", error);
        }
      })();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    bootState,
    directoryHandle,
    markCardImagesPersisted,
    pendingAssetSignature,
    pendingImageAssets,
    projectSignature,
  ]);

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
        <section className="directory-gate" aria-label="Seleccionar carpeta">
          <div className="question-stage-backdrop" />
          {bootState === "needs-directory" ? (
            <div className="directory-gate-panel">
              <span className="directory-gate-eyebrow">Study Tree</span>
              <h1>Selecciona una carpeta para entrar</h1>
              <p>
                La app usa la carpeta local como unica fuente de verdad. Cuando la
                selecciones, se abrira el proyecto guardado ahi.
              </p>
              {bootError ? <p className="directory-gate-error">{bootError}</p> : null}
              <button
                type="button"
                className="directory-gate-button"
                onClick={() => {
                  void onPickProjectDirectory();
                }}
                disabled={
                  !hasResolvedDirectorySupport || !canUseProjectDirectory || isPickingDirectory
                }
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
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="minimal-shell">
      <section
        ref={stageRef}
        className="question-stage"
        aria-label="Espacio de dudas"
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={endStagePan}
        onPointerCancel={endStagePan}
      >
        <div className="question-stage-backdrop" />

        {!isModalOpen && cardsList.length === 0 && !draftText && !draftImage ? (
          <div className="empty-state" aria-live="polite">
            <p>Escribe una duda, pega una imagen o combina ambas y presiona Enter.</p>
          </div>
        ) : null}

        {!isModalOpen ? (
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
          </div>
        ) : null}

        {!isModalOpen && (draftText || draftImage) ? (
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

        {openedCard ? (
          <div
            className="card-modal-overlay"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                closeCard();
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
              <div className="card-modal-body">
                <CardContent card={openedCard} mode="full" />
                <CardDetailsEditor
                  cardId={openedCard.id}
                  text={openedCard.detailsText}
                  onSave={updateCardDetails}
                />
              </div>
            </div>
          </div>
        ) : null}

        {!isModalOpen && showUndoToast && canUndoDeletion ? (
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

        {!isModalOpen && showSearchFeedback ? (
          <div className="search-feedback" aria-live="polite">
            No se encontraron coincidencias.
          </div>
        ) : null}

        {!isModalOpen && showPasteFeedback ? (
          <div className="paste-feedback" aria-live="polite">
            No se pudo leer la imagen pegada.
          </div>
        ) : null}
      </section>
    </main>
  );
}
