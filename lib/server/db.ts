import { Pool } from "pg";
import type { PresenceState, ProjectEvent, RemoteProject, SyncResponse } from "@/lib/collaboration-types";
import { normalizeProjectSnapshot } from "@/lib/server/project-normalize";
import type { ProjectSnapshot } from "@/lib/types";

const DEFAULT_PROJECT_ID = "default";
const PRESENCE_TTL_SECONDS = 15;

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
      active_map_kind text,
      active_section_id text,
      opened_card_id text,
      updated_at timestamptz not null default now(),
      primary key (project_id, client_id)
    );

    alter table presence add column if not exists surface text not null default 'map';
    alter table presence add column if not exists opened_card_id text;
  `);
}

function createEmptySnapshot(): ProjectSnapshot {
  return normalizeProjectSnapshot({
    version: 6,
    categories: {},
    selectedCategoryId: null,
    categoryDraftText: "",
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
        active_map_kind,
        active_section_id,
        opened_card_id,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      on conflict (project_id, client_id) do update set
        name = excluded.name,
        color = excluded.color,
        cursor = excluded.cursor,
        surface = excluded.surface,
        active_category_id = excluded.active_category_id,
        active_map_kind = excluded.active_map_kind,
        active_section_id = excluded.active_section_id,
        opened_card_id = excluded.opened_card_id,
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
      presence.activeMapKind,
      presence.activeSectionId,
      presence.openedCardId,
    ],
  );
}

export async function listPresence(projectId = DEFAULT_PROJECT_ID): Promise<PresenceState[]> {
  await ensureSchema();

  const result = await getPool().query(
    `
      select client_id, name, color, cursor, surface, active_category_id, active_map_kind, active_section_id, opened_card_id, updated_at
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
    activeMapKind: row.active_map_kind,
    activeSectionId: row.active_section_id,
    openedCardId: row.opened_card_id,
    updatedAt: row.updated_at.toISOString(),
  }));
}
