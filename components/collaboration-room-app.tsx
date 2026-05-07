"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import { ExcalidrawMapCanvas } from "@/components/excalidraw-map-canvas";
import type { CollaborationPresence, CollaborationRoomResponse } from "@/lib/collaboration-types";
import type { ExcalidrawSceneState } from "@/lib/types";

const AUTOSAVE_DEBOUNCE_MS = 650;
const POLL_INTERVAL_MS = 1_500;
const PRESENCE_DEBOUNCE_MS = 350;
const COLLABORATOR_COLORS = ["#6c5ce7", "#00a8a8", "#d97706", "#db2777", "#2563eb", "#16a34a"];

type RoomStatus = "loading" | "ready" | "saving" | "error";

type CollaboratorIdentity = {
  clientId: string;
  name: string;
  color: string;
};

function createIdentity(): CollaboratorIdentity {
  const clientId = crypto.randomUUID();
  const color = COLLABORATOR_COLORS[Math.floor(Math.random() * COLLABORATOR_COLORS.length)];

  return {
    clientId,
    color,
    name: `Invitado ${clientId.slice(0, 4)}`,
  };
}

function getIdentity(): CollaboratorIdentity {
  const storageKey = "study-tree-collaboration-identity";
  const stored = window.localStorage.getItem(storageKey);

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<CollaboratorIdentity>;

      if (parsed.clientId && parsed.name && parsed.color) {
        return {
          clientId: parsed.clientId,
          name: parsed.name,
          color: parsed.color,
        };
      }
    } catch {}
  }

  const identity = createIdentity();
  window.localStorage.setItem(storageKey, JSON.stringify(identity));
  return identity;
}

function getSceneSignature(scene: ExcalidrawSceneState) {
  return JSON.stringify(scene);
}

function buildCollaborators(presence: CollaborationPresence[], selfClientId: string) {
  const collaborators = new Map<SocketId, Collaborator>();

  for (const participant of presence) {
    if (participant.clientId === selfClientId) {
      continue;
    }

    const selectedElementIds = Object.fromEntries(
      Object.entries(participant.selectedElementIds)
        .filter(([, selected]) => selected)
        .map(([elementId]) => [elementId, true]),
    ) as Record<string, true>;

    collaborators.set(participant.clientId as SocketId, {
      id: participant.clientId,
      socketId: participant.clientId as SocketId,
      username: participant.name,
      pointer: participant.pointer
        ? {
            ...participant.pointer,
            renderCursor: true,
          }
        : undefined,
      button: participant.button,
      selectedElementIds,
      color: {
        background: participant.color,
        stroke: participant.color,
      },
    });
  }

  return collaborators;
}

export function CollaborationRoomApp({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<CollaborationRoomResponse["room"] | null>(null);
  const [presence, setPresence] = useState<CollaborationPresence[]>([]);
  const [status, setStatus] = useState<RoomStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<CollaboratorIdentity | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const presenceTimeoutRef = useRef<number | null>(null);
  const isApplyingRemoteSceneRef = useRef(false);
  const lastSavedSignatureRef = useRef("");
  const lastQueuedSignatureRef = useRef("");
  const latestSceneVersionRef = useRef(0);
  const selectedElementIdsRef = useRef<Record<string, boolean>>({});
  const pointerRef = useRef<CollaborationPresence["pointer"]>(null);
  const buttonRef = useRef<"up" | "down">("up");

  useEffect(() => {
    setIdentity(getIdentity());
  }, []);

  const collaborators = useMemo(() => {
    if (!identity) {
      return new Map<SocketId, Collaborator>();
    }

    return buildCollaborators(presence, identity.clientId);
  }, [identity, presence]);

  const loadRoom = useCallback(async ({ applyRemoteScene }: { applyRemoteScene: boolean }) => {
    const response = await fetch(`/api/collaboration/rooms/${roomId}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("No se pudo cargar la sala.");
    }

    const payload = (await response.json()) as CollaborationRoomResponse;
    setRoom(payload.room);
    setPresence(payload.presence);
    latestSceneVersionRef.current = payload.room.sceneVersion;

    const remoteSignature = getSceneSignature(payload.room.scene);

    if (!lastSavedSignatureRef.current) {
      lastSavedSignatureRef.current = remoteSignature;
      lastQueuedSignatureRef.current = remoteSignature;
    }

    const api = apiRef.current;

    if (applyRemoteScene && api && remoteSignature !== lastSavedSignatureRef.current) {
      isApplyingRemoteSceneRef.current = true;
      api.updateScene({
        elements: payload.room.scene.elements as never,
        appState: payload.room.scene.appState as never,
        collaborators,
      });
      api.addFiles(Object.values(payload.room.scene.files));
      lastSavedSignatureRef.current = remoteSignature;
      lastQueuedSignatureRef.current = remoteSignature;
      queueMicrotask(() => {
        isApplyingRemoteSceneRef.current = false;
      });
    }
  }, [collaborators, roomId]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        await loadRoom({ applyRemoteScene: false });

        if (!cancelled) {
          setStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setError(error instanceof Error ? error.message : "No se pudo cargar la sala.");
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [loadRoom]);

  useEffect(() => {
    if (status === "error") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadRoom({ applyRemoteScene: true }).catch((error) => {
        setError(error instanceof Error ? error.message : "No se pudo sincronizar la sala.");
      });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadRoom, status]);

  const postPresence = useCallback(() => {
    if (!identity) {
      return;
    }

    void fetch(`/api/collaboration/rooms/${roomId}/presence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: identity.clientId,
        name: identity.name,
        color: identity.color,
        pointer: pointerRef.current,
        button: buttonRef.current,
        selectedElementIds: selectedElementIdsRef.current,
      }),
    }).catch(() => {});
  }, [identity, roomId]);

  const schedulePresencePost = useCallback(() => {
    if (presenceTimeoutRef.current !== null) {
      window.clearTimeout(presenceTimeoutRef.current);
    }

    presenceTimeoutRef.current = window.setTimeout(() => {
      presenceTimeoutRef.current = null;
      postPresence();
    }, PRESENCE_DEBOUNCE_MS);
  }, [postPresence]);

  const saveScene = useCallback(async (scene: ExcalidrawSceneState, signature: string) => {
    setStatus("saving");

    const response = await fetch(`/api/collaboration/rooms/${roomId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scene }),
    });

    if (!response.ok) {
      throw new Error("No se pudo guardar la sala.");
    }

    const payload = (await response.json()) as { room: CollaborationRoomResponse["room"] };
    latestSceneVersionRef.current = payload.room.sceneVersion;
    lastSavedSignatureRef.current = signature;
    lastQueuedSignatureRef.current = signature;
    setStatus("ready");
    setError(null);
  }, [roomId]);

  const scheduleSave = useCallback((scene: ExcalidrawSceneState) => {
    const signature = getSceneSignature(scene);

    if (signature === lastSavedSignatureRef.current || signature === lastQueuedSignatureRef.current) {
      return;
    }

    lastQueuedSignatureRef.current = signature;

    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void saveScene(scene, signature).catch((error) => {
        setStatus("error");
        setError(error instanceof Error ? error.message : "No se pudo guardar la sala.");
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [saveScene]);

  useEffect(() => {
    const api = apiRef.current;

    if (!api) {
      return;
    }

    api.updateScene({
      collaborators,
    });
  }, [collaborators]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
      }

      if (presenceTimeoutRef.current !== null) {
        window.clearTimeout(presenceTimeoutRef.current);
      }
    };
  }, []);

  if (status === "loading" || !room || !identity) {
    return (
      <main className="collaboration-shell">
        <div className="map-canvas-state">Cargando colaboracion...</div>
      </main>
    );
  }

  if (status === "error" && !room) {
    return (
      <main className="collaboration-shell">
        <div className="map-canvas-state map-canvas-state--error">
          <strong>No se pudo abrir la sala</strong>
          <span>{error}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="collaboration-shell">
      <ExcalidrawMapCanvas
        initialData={{
          elements: room.scene.elements,
          appState: room.scene.appState,
          files: room.scene.files,
          scrollToContent: true,
        } as never}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          api.updateScene({ collaborators });
        }}
        isCollaborating
        viewModeEnabled={false}
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
        renderTopRightUI={() => (
          <div className="collaboration-status">
            <span>{presence.filter((participant) => participant.clientId !== identity.clientId).length + 1} conectados</span>
            <span className="collaboration-status-dot" style={{ background: identity.color }} />
          </div>
        )}
        onPointerUpdate={({ pointer, button }) => {
          pointerRef.current = pointer;
          buttonRef.current = button;
          schedulePresencePost();
        }}
        onChange={(elements, appState, files) => {
          selectedElementIdsRef.current = { ...appState.selectedElementIds };
          schedulePresencePost();

          if (isApplyingRemoteSceneRef.current) {
            return;
          }

          scheduleSave({
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

      <div className="collaboration-floating-status" aria-live="polite">
        {status === "saving" ? "Guardando" : error ? error : "Sincronizado"}
      </div>
    </main>
  );
}
