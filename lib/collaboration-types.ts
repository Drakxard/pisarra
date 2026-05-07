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
  activeMapId: string | null;
  selectedNodeId: string | null;
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

export type SyncResponse = {
  latestEventId: number;
  snapshotVersion: number;
  hasRemoteChanges: boolean;
  project?: RemoteProject;
};
