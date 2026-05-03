import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const FIXED_SECTIONS = [
  ["definitions", "Definiciones"],
  ["theorems", "Teoremas"],
  ["exams", "Parciales"],
];

async function loadLocalEnv() {
  try {
    const raw = await readFile(".env.local", "utf8");

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {}
}

function normalizeDetailsTable(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.cells) || value.cells.length === 0) {
    return null;
  }

  const columnCount = Math.max(1, ...value.cells.map((row) => (Array.isArray(row) ? row.length : 0)));
  const cells = value.cells.map((row) =>
    Array.from({ length: columnCount }, (_, index) =>
      Array.isArray(row) && typeof row[index] === "string" ? row[index] : "",
    ),
  );

  return {
    cells,
    columnWidths: Array.from({ length: columnCount }, (_, index) =>
      typeof value.columnWidths?.[index] === "number" && value.columnWidths[index] >= 72
        ? value.columnWidths[index]
        : 160,
    ),
    rowHeights: Array.from({ length: cells.length }, (_, index) =>
      typeof value.rowHeights?.[index] === "number" && value.rowHeights[index] >= 36
        ? value.rowHeights[index]
        : 48,
    ),
    insertedAfterText: value.insertedAfterText !== false,
  };
}

function assetWithPreview(asset) {
  if (!asset?.path || asset.previewUrl) {
    return asset;
  }

  return {
    ...asset,
    previewUrl: `/${asset.path.replace(/\\/g, "/").replace(/^\/+/, "")}`,
    pendingBlob: null,
  };
}

function normalizeDetailsImages(value) {
  return Array.isArray(value)
    ? value
        .filter((image) => image?.id && image.path && image.mimeType && image.name)
        .map((image) =>
          assetWithPreview({
            ...image,
            x: Number.isFinite(image.x) ? image.x : 0,
            y: Number.isFinite(image.y) ? image.y : 0,
            width: Number.isFinite(image.width) && image.width > 0 ? image.width : 320,
            height: Number.isFinite(image.height) && image.height > 0 ? image.height : 220,
            rotation: Number.isFinite(image.rotation) ? image.rotation : 0,
          }),
        )
    : [];
}

function normalizeCards(value = {}) {
  return Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {}).map(([cardId, card]) => [
      cardId,
      {
        ...card,
        id: card.id || cardId,
        text: typeof card.text === "string" ? card.text : "",
        detailsText: typeof card.detailsText === "string" ? card.detailsText : "",
        detailsTable: normalizeDetailsTable(card.detailsTable),
        detailsImages: normalizeDetailsImages(card.detailsImages),
        image: card.image ? assetWithPreview(card.image) : null,
      },
    ]),
  );
}

function normalizeSections(value = {}, timestamp) {
  const sourceSections = { ...(value && typeof value === "object" ? value : {}) };

  for (const [sectionId, name] of FIXED_SECTIONS) {
    if (!sourceSections[sectionId]) {
      sourceSections[sectionId] = {
        id: sectionId,
        name,
        cards: {},
        selectedCardId: null,
        draftText: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
  }

  return Object.fromEntries(
    Object.entries(sourceSections).map(([sectionId, section]) => {
      const cards = normalizeCards(section.cards);

      return [
        sectionId,
        {
          ...section,
          id: section.id || sectionId,
          name: typeof section.name === "string" && section.name.trim() ? section.name.trim() : "Sin nombre",
          cards,
          selectedCardId: section.selectedCardId && cards[section.selectedCardId] ? section.selectedCardId : null,
          draftText: typeof section.draftText === "string" ? section.draftText : "",
          createdAt: typeof section.createdAt === "string" ? section.createdAt : timestamp,
          updatedAt: typeof section.updatedAt === "string" ? section.updatedAt : timestamp,
        },
      ];
    }),
  );
}

function normalizeProjectSnapshot(snapshot) {
  const timestamp = new Date().toISOString();
  const sourceCategories =
    snapshot.categories && Object.keys(snapshot.categories).length > 0
      ? snapshot.categories
      : {
          migrated: {
            id: "migrated",
            name: "Sin nombre",
            cards: normalizeCards(snapshot.cards),
            selectedCardId: snapshot.selectedCardId ?? null,
            draftText: snapshot.draftText ?? "",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
  const categories = Object.fromEntries(
    Object.entries(sourceCategories).map(([categoryId, category]) => {
      const cards = normalizeCards(category.cards);
      const sections = normalizeSections(category.sections, timestamp);

      return [
        categoryId,
        {
          ...category,
          id: category.id || categoryId,
          name: typeof category.name === "string" && category.name.trim() ? category.name.trim() : "Sin nombre",
          cards,
          selectedCardId: category.selectedCardId && cards[category.selectedCardId] ? category.selectedCardId : null,
          draftText: typeof category.draftText === "string" ? category.draftText : "",
          sections,
          activeSectionId:
            category.activeSectionId && sections[category.activeSectionId] ? category.activeSectionId : null,
          createdAt: typeof category.createdAt === "string" ? category.createdAt : timestamp,
          updatedAt: typeof category.updatedAt === "string" ? category.updatedAt : timestamp,
        },
      ];
    }),
  );

  return {
    version: 6,
    categories,
    activeCategoryId: null,
    activeMapKind: null,
    activeSectionId: null,
    selectedCategoryId:
      snapshot.selectedCategoryId && categories[snapshot.selectedCategoryId]
        ? snapshot.selectedCategoryId
        : Object.keys(categories)[0] ?? null,
    categoryDraftText: typeof snapshot.categoryDraftText === "string" ? snapshot.categoryDraftText : "",
    savedAt: typeof snapshot.savedAt === "string" && snapshot.savedAt ? snapshot.savedAt : timestamp,
  };
}

async function ensureSchema(pool) {
  await pool.query(`
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
      active_category_id text,
      active_map_kind text,
      active_section_id text,
      updated_at timestamptz not null default now(),
      primary key (project_id, client_id)
    );
  `);
}

await loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL no esta configurada.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
});

try {
  await ensureSchema(pool);
  const raw = await readFile("study-tree.json", "utf8");
  const snapshot = normalizeProjectSnapshot(JSON.parse(raw));
  const result = await pool.query(
    `
      insert into projects (id, snapshot, snapshot_version)
      values ('default', $1, 1)
      on conflict (id) do nothing
      returning id
    `,
    [JSON.stringify(snapshot)],
  );

  console.log(result.rowCount > 0 ? "Proyecto default migrado." : "Proyecto default ya existe; no se piso.");
} finally {
  await pool.end();
}
