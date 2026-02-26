import Database from "better-sqlite3";
import path from "path";

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.VERCEL) return path.join("/tmp", "data.sqlite");
  return path.join(process.cwd(), "data.sqlite");
}

function createDatabase() {
  const dbPath = resolveDbPath();
  try {
    const fileDb = new Database(dbPath);
    if (!process.env.VERCEL) fileDb.pragma("journal_mode = WAL");
    return fileDb;
  } catch (_err) {
    const memoryDb = new Database(":memory:");
    return memoryDb;
  }
}

const db = createDatabase();

db.exec(`
  CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    candidate_name TEXT NOT NULL,
    candidate_email TEXT NOT NULL,
    role_title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'invited',
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    checks_json TEXT,
    conversation_json TEXT,
    transcript TEXT,
    ai_feedback_json TEXT
  );
`);

function ensureColumnExists(tableName, columnName, columnType) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = cols.some((c) => c.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

ensureColumnExists("interviews", "conversation_json", "TEXT");

export default db;
