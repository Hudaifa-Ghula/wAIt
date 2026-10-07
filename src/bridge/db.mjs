import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'learning_memory.db'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY, sessionKey TEXT NOT NULL, runId TEXT NOT NULL,
      contextRevision TEXT NOT NULL, topic TEXT NOT NULL, summary TEXT NOT NULL,
      depth INTEGER NOT NULL, model TEXT NOT NULL, createdAt INTEGER NOT NULL,
      displayedAt INTEGER, understoodAt INTEGER, position REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS lesson_feedback (
      id INTEGER PRIMARY KEY, lessonId TEXT NOT NULL, action TEXT NOT NULL, timestamp INTEGER NOT NULL);
  `);
  return {
    getConfig(key, fallback = null) { const row = db.prepare('SELECT value FROM config WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; },
    setConfig(key, value) { db.prepare('INSERT OR REPLACE INTO config VALUES (?,?)').run(key, JSON.stringify(value)); },
    saveLesson(l) {
      db.prepare('INSERT INTO lessons (id,sessionKey,runId,contextRevision,topic,summary,depth,model,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(l.id,l.sessionKey,l.runId,l.contextRevision,l.topic,l.summary,l.depth,l.model,l.createdAt);
      return this.getLesson(l.id);
    },
    getLesson(id) { return db.prepare('SELECT * FROM lessons WHERE id=?').get(id); },
    history(sessionKey, limit = 30) { return db.prepare('SELECT * FROM lessons WHERE sessionKey=? ORDER BY createdAt DESC LIMIT ?').all(sessionKey, limit); },
    memory(sessionKey) { return db.prepare('SELECT topic,summary,depth,understoodAt FROM lessons WHERE sessionKey=? AND displayedAt IS NOT NULL ORDER BY createdAt DESC LIMIT 3').all(sessionKey); },
    feedback(id, action, position = 0) {
      if (!this.getLesson(id)) throw new RangeError('Unknown lesson');
      if (action === 'displayed') db.prepare('UPDATE lessons SET displayedAt=COALESCE(displayedAt,?) WHERE id=?').run(Date.now(),id);
      if (action === 'understood') db.prepare('UPDATE lessons SET understoodAt=? WHERE id=?').run(Date.now(),id);
      if (action === 'position') db.prepare('UPDATE lessons SET position=? WHERE id=?').run(Math.max(0,Math.min(100000,Number(position)||0)),id);
      db.prepare('INSERT INTO lesson_feedback (lessonId,action,timestamp) VALUES (?,?,?)').run(id,action,Date.now());
    },
    edit(id, summary) { db.prepare('UPDATE lessons SET summary=? WHERE id=?').run(summary,id); },
    forget(id) { db.prepare('DELETE FROM lesson_feedback WHERE lessonId=?').run(id); db.prepare('DELETE FROM lessons WHERE id=?').run(id); },
    reset(sessionKey) { for (const l of this.history(sessionKey, 100000)) this.forget(l.id); },
    close() { db.close(); }
  };
}
