import type { ProjectSnapshot } from "@/lib/types";

export type CollaboratorIdentity = {
  clientId: string;
  name: string;
  color: string;
};

export type PresenceCursor = {
  x: number;
  y: number;
};

export type PresenceState = CollaboratorIdentity & {
  cursor: PresenceCursor | null;
  surface: "map" | "card-modal";
  activeCategoryId: string | null;
  activeMapKind: "main" | "section" | null;
  activeSectionId: string | null;
  openedCardId: string | null;
  updatedAt: string;
};

export type ProjectEvent = {
  id: number;
  projectId: string;
  clientId: string | null;
  type: "snapshot";
  snapshotVersion: number;
  createdAt: string;
};

export type RemoteProject = {
  projectId: string;
  snapshot: ProjectSnapshot;
  snapshotVersion: number;
  latestEventId: number;
};
