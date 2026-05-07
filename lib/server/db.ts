import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type {
  CollaborationPresence,
  CollaborationRoom,
  CollaborationRoomResponse,
  PresenceState,
  ProjectEvent,
  RemoteProject,
  SyncResponse,
} from "@/lib/collaboration-types";
import { normalizeProjectSnapshot } from "@/lib/server/project-normalize";
import type { ExcalidrawSceneState, ProjectSnapshot } from "@/lib/types";

const DEFAULT_PROJECT_ID = "default";
const PRESENCE_TTL_SECONDS = 15;
const COLLABORATION_PRESENCE_TTL_SECONDS = 15;

let pool: Pool | null = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no esta configurada.");
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("sslmode=disable")
      ? false
      : {
          rejectUnauthorized: false,
        },
  });

  return pool;
}

export async function ensureSchema() {
  await getPool().query(`
    create table if not exists projects (
      id text primary key,
      snapshot jsonb not null,
      snapshot_version integer not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists project_events (
      id bigserial primary key,
      project_id text not null references projects(id) on delete cascade,
      client_id text,
      type text not null,
      snapshot_version integer not null,
      created_at timestamptz not null default now()
    );

    create table if not exists presence (
      project_id text not null references projects(id) on delete cascade,
      client_id text not null,
      name text not null,
      color text not null,
      cursor jsonb,
      surface text not null default 'map',
      active_category_id text,
      active_map_id text,
      selected_node_id text,
      updated_at timestamptz not null default now(),
      primary key (project_id, client_id)
    );

    alter table presence add column if not exists surface text not null default 'map';
    alter table presence add column if not exists active_map_id text;
    alter table presence add column if not exists selected_node_id text;

    create table if not exists collaboration_rooms (
      id text primary key,
      scene jsonb not null,
      scene_version integer not null default 1,
      source_category_id text,
      source_map_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists collaboration_presence (
      room_id text not null references collaboration_rooms(id) on delete cascade,
      client_id text not null,
      name text not null,
      color text not null,
      pointer jsonb,
      button text not null default 'up',
      selected_element_ids jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (room_id, client_id)
    );
  `);
}

function createEmptySnapshot(): ProjectSnapshot {
  return normalizeProjectSnapshot({
    version: 7,
    categories: {},
    selectedCategoryId: null,
    categoryDraftText: "",
    activeCategoryId: null,
    activeMapId: null,
    savedAt: new Date().toISOString(),
  });
}

export async function getOrCreateProject(projectId = DEFAULT_PROJECT_ID): Promise<RemoteProject> {
  await ensureSchema();

  const existing = await getPool().query(
    `select id, snapshot, snapshot_version from projects where id = $1`,
    [projectId],
  );

  if (existing.rowCount === 0) {
    const snapshot = createEmptySnapshot();
    await getPool().query(
      `insert into projects (id, snapshot, snapshot_version) values ($1, $2, 1)`,
      [projectId, JSON.stringify(snapshot)],
    );
  }

  const result = await getPool().query(
    `
      select
        p.id,
        p.snapshot,
        p.snapshot_version,
        coalesce((select max(id) from project_events where project_id = p.id), 0) as latest_event_id
      from projects p
      where p.id = $1
    `,
    [projectId],
  );
  const row = result.rows[0];

  return {
    projectId: row.id,
    snapshot: normalizeProjectSnapshot(row.snapshot),
    snapshotVersion: row.snapshot_version,
    latestEventId: Number(row.latest_event_id),
  };
}

export async function saveProjectSnapshot({
  projectId = DEFAULT_PROJECT_ID,
  snapshot,
  expectedVersion,
  clientId,
}: {
  projectId?: string;
  snapshot: ProjectSnapshot;
  expectedVersion: number;
  clientId: string | null;
}) {
  await ensureSchema();

  const normalized = normalizeProjectSnapshot({
    ...snapshot,
    savedAt: new Date().toISOString(),
  });
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const update = await client.query(
      `
        update projects
        set snapshot = $1, snapshot_version = snapshot_version + 1, updated_at = now()
        where id = $2 and snapshot_version = $3
        returning snapshot_version
      `,
      [JSON.stringify(normalized), projectId, expectedVersion],
    );

    if (update.rowCount === 0) {
      await client.query("rollback");
      return {
        ok: false as const,
        conflict: true,
        project: await getOrCreateProject(projectId),
      };
    }

    const snapshotVersion = update.rows[0].snapshot_version as number;
    const event = await client.query(
      `
        insert into project_events (project_id, client_id, type, snapshot_version)
        values ($1, $2, 'snapshot', $3)
        returning id, project_id, client_id, type, snapshot_version, created_at
      `,
      [projectId, clientId, snapshotVersion],
    );
    await client.query("commit");

    return {
      ok: true as const,
      project: {
        projectId,
        snapshot: normalized,
        snapshotVersion,
        latestEventId: Number(event.rows[0].id),
      } satisfies RemoteProject,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrateProjectIfMissing(snapshot: ProjectSnapshot, projectId = DEFAULT_PROJECT_ID) {
  await ensureSchema();

  const normalized = normalizeProjectSnapshot(snapshot);
  const result = await getPool().query(
    `
      insert into projects (id, snapshot, snapshot_version)
      values ($1, $2, 1)
      on conflict (id) do nothing
      returning id
    `,
    [projectId, JSON.stringify(normalized)],
  );

  return {
    inserted: (result.rowCount ?? 0) > 0,
    project: await getOrCreateProject(projectId),
  };
}

export async function listProjectEvents(projectId = DEFAULT_PROJECT_ID, since = 0): Promise<ProjectEvent[]> {
  await ensureSchema();

  const result = await getPool().query(
    `
      select id, project_id, client_id, type, snapshot_version, created_at
      from project_events
      where project_id = $1 and id > $2
      order by id asc
      limit 100
    `,
    [projectId, since],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    projectId: row.project_id,
    clientId: row.client_id,
    type: "snapshot",
    snapshotVersion: row.snapshot_version,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getProjectSyncState({
  projectId = DEFAULT_PROJECT_ID,
  sinceEventId,
  snapshotVersion,
  clientId,
}: {
  projectId?: string;
  sinceEventId: number;
  snapshotVersion: number;
  clientId: string | null;
}): Promise<SyncResponse> {
  await ensureSchema();
  await getOrCreateProject(projectId);

  const result = await getPool().query(
    `
      select
        p.id,
        p.snapshot,
        p.snapshot_version,
        coalesce((select max(id) from project_events where project_id = p.id), 0) as latest_event_id
      from projects p
      where p.id = $1
    `,
    [projectId],
  );
  const row = result.rows[0];
  const latestEventId = Number(row.latest_event_id);
  const currentSnapshotVersion = row.snapshot_version as number;
  const hasRemoteChanges = currentSnapshotVersion > snapshotVersion;

  if (!hasRemoteChanges) {
    return {
      latestEventId,
      snapshotVersion: currentSnapshotVersion,
      hasRemoteChanges: false,
    };
  }

  return {
    latestEventId,
    snapshotVersion: currentSnapshotVersion,
    hasRemoteChanges: true,
    project: {
      projectId: row.id,
      snapshot: normalizeProjectSnapshot(row.snapshot),
      snapshotVersion: currentSnapshotVersion,
      latestEventId,
    },
  };
}

export async function upsertPresence(
  presence: Omit<PresenceState, "updatedAt">,
  projectId = DEFAULT_PROJECT_ID,
) {
  await ensureSchema();
  await getOrCreateProject(projectId);

  await getPool().query(
    `
      insert into presence (
        project_id,
        client_id,
        name,
        color,
        cursor,
        surface,
        active_category_id,
        active_map_id,
        selected_node_id,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      on conflict (project_id, client_id) do update set
        name = excluded.name,
        color = excluded.color,
        cursor = excluded.cursor,
        surface = excluded.surface,
        active_category_id = excluded.active_category_id,
        active_map_id = excluded.active_map_id,
        selected_node_id = excluded.selected_node_id,
        updated_at = now()
    `,
    [
      projectId,
      presence.clientId,
      presence.name,
      presence.color,
      presence.cursor ? JSON.stringify(presence.cursor) : null,
      presence.surface,
      presence.activeCategoryId,
      presence.activeMapId,
      presence.selectedNodeId,
    ],
  );
}

export async function listPresence(projectId = DEFAULT_PROJECT_ID): Promise<PresenceState[]> {
  await ensureSchema();

  const result = await getPool().query(
    `
      select client_id, name, color, cursor, surface, active_category_id, active_map_id, selected_node_id, updated_at
      from presence
      where project_id = $1 and updated_at > now() - ($2 || ' seconds')::interval
      order by updated_at desc
    `,
    [projectId, PRESENCE_TTL_SECONDS],
  );

  return result.rows.map((row) => ({
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    cursor: row.cursor,
    surface: row.surface === "card-modal" ? "card-modal" : "map",
    activeCategoryId: row.active_category_id,
    activeMapId: row.active_map_id,
    selectedNodeId: row.selected_node_id,
    updatedAt: row.updated_at.toISOString(),
  }));
}

function mapCollaborationRoom(row: {
  id: string;
  scene: ExcalidrawSceneState;
  scene_version: number;
  source_category_id: string | null;
  source_map_id: string | null;
  created_at: Date;
  updated_at: Date;
}): CollaborationRoom {
  return {
    roomId: row.id,
    scene: row.scene,
    sceneVersion: row.scene_version,
    source: {
      categoryId: row.source_category_id,
      mapId: row.source_map_id,
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapCollaborationPresence(row: {
  client_id: string;
  name: string;
  color: string;
  pointer: CollaborationPresence["pointer"];
  button: string;
  selected_element_ids: Record<string, boolean> | null;
  updated_at: Date;
}): CollaborationPresence {
  return {
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    pointer: row.pointer,
    button: row.button === "down" ? "down" : "up",
    selectedElementIds: row.selected_element_ids ?? {},
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createCollaborationRoom({
  scene,
  source,
}: {
  scene: ExcalidrawSceneState;
  source?: {
    categoryId?: string | null;
    mapId?: string | null;
  };
}) {
  await ensureSchema();

  const roomId = randomUUID();
  const result = await getPool().query(
    `
      insert into collaboration_rooms (id, scene, source_category_id, source_map_id)
      values ($1, $2, $3, $4)
      returning id, scene, scene_version, source_category_id, source_map_id, created_at, updated_at
    `,
    [roomId, JSON.stringify(scene), source?.categoryId ?? null, source?.mapId ?? null],
  );

  return mapCollaborationRoom(result.rows[0]);
}

export async function getCollaborationRoom(roomId: string): Promise<CollaborationRoomResponse | null> {
  await ensureSchema();

  const roomResult = await getPool().query(
    `
      select id, scene, scene_version, source_category_id, source_map_id, created_at, updated_at
      from collaboration_rooms
      where id = $1
    `,
    [roomId],
  );

  if (roomResult.rowCount === 0) {
    return null;
  }

  const presenceResult = await getPool().query(
    `
      select client_id, name, color, pointer, button, selected_element_ids, updated_at
      from collaboration_presence
      where room_id = $1 and updated_at > now() - ($2 || ' seconds')::interval
      order by updated_at desc
    `,
    [roomId, COLLABORATION_PRESENCE_TTL_SECONDS],
  );

  return {
    room: mapCollaborationRoom(roomResult.rows[0]),
    presence: presenceResult.rows.map(mapCollaborationPresence),
  };
}

export async function saveCollaborationRoomScene({
  roomId,
  scene,
}: {
  roomId: string;
  scene: ExcalidrawSceneState;
}) {
  await ensureSchema();

  const result = await getPool().query(
    `
      update collaboration_rooms
      set scene = $1, scene_version = scene_version + 1, updated_at = now()
      where id = $2
      returning id, scene, scene_version, source_category_id, source_map_id, created_at, updated_at
    `,
    [JSON.stringify(scene), roomId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapCollaborationRoom(result.rows[0]);
}

export async function upsertCollaborationPresence({
  roomId,
  presence,
}: {
  roomId: string;
  presence: Omit<CollaborationPresence, "updatedAt">;
}) {
  await ensureSchema();

  await getPool().query(
    `
      insert into collaboration_presence (
        room_id,
        client_id,
        name,
        color,
        pointer,
        button,
        selected_element_ids,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, now())
      on conflict (room_id, client_id) do update set
        name = excluded.name,
        color = excluded.color,
        pointer = excluded.pointer,
        button = excluded.button,
        selected_element_ids = excluded.selected_element_ids,
        updated_at = now()
    `,
    [
      roomId,
      presence.clientId,
      presence.name,
      presence.color,
      presence.pointer ? JSON.stringify(presence.pointer) : null,
      presence.button,
      JSON.stringify(presence.selectedElementIds),
    ],
  );
}
