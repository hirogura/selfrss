import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'selfrss.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT UNIQUE NOT NULL, site_url TEXT, folder_id INTEGER, last_fetched_at TEXT, fetch_error TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL);
  CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, feed_id INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, author TEXT, content TEXT, summary TEXT, published_at TEXT, is_read INTEGER DEFAULT 0, is_starred INTEGER DEFAULT 0, fetched_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE, UNIQUE(feed_id, url));
  CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
  CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);
`);

export default db;
