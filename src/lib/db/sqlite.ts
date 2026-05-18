import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

let database: DatabaseSync | null = null;
let migrationsApplied = false;

export function getDatabasePath() {
  return process.env.MISSIONDESK_DB_PATH ?? path.join(process.cwd(), "data", "missiondesk.sqlite");
}

export function getDb() {
  if (!database) {
    const dbPath = getDatabasePath();
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    database = new DatabaseSync(dbPath);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
  }

  return database;
}

export function closeDb() {
  if (!database) return;
  database.close();
  database = null;
  migrationsApplied = false;
}

export function runMigrations(db = getDb()) {
  if (migrationsApplied) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const migrationsDir = path.join(process.cwd(), "src", "lib", "db", "migrations");
  if (!existsSync(migrationsDir)) {
    migrationsApplied = true;
    return;
  }

  const appliedRows = db
    .prepare("SELECT id FROM schema_migrations")
    .all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));

  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    if (applied.has(file)) continue;

    const sql = readFileSync(path.join(migrationsDir, file), "utf8");

    try {
      db.exec("BEGIN");
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  migrationsApplied = true;
}

export function getMigratedDb() {
  const db = getDb();
  runMigrations(db);
  return db;
}
