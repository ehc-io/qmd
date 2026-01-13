import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";

// Database path - stored in cache directory (volume-mounted)
const CACHE_PATH = process.env.QMD_CACHE_PATH || "/root/.cache/qmd";
const DB_PATH = `${CACHE_PATH}/qmd.db`;

// Ensure cache directory exists
if (!existsSync(CACHE_PATH)) {
  mkdirSync(CACHE_PATH, { recursive: true });
}

// Initialize database using Bun's native SQLite
const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");

// Initialize schema
db.exec(`
  -- Documents table: file metadata
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Chunks table: text chunks with embeddings
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    UNIQUE(doc_id, chunk_index)
  );

  -- FTS5 virtual table for BM25 keyword search
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    content='chunks',
    content_rowid='id'
  );

  -- Triggers to keep FTS5 in sync with chunks table
  CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
  END;

  -- Index for faster lookups
  CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);
  CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
`);

// Helper: Convert float32 array to BLOB (Uint8Array)
export function float32ToBlob(arr: number[]): Uint8Array {
  const buffer = new ArrayBuffer(arr.length * 4);
  const view = new Float32Array(buffer);
  for (let i = 0; i < arr.length; i++) {
    view[i] = arr[i];
  }
  return new Uint8Array(buffer);
}

// Helper: Convert BLOB (Uint8Array) to float32 array
export function blobToFloat32(blob: Uint8Array): number[] {
  const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  const view = new Float32Array(buffer);
  return Array.from(view);
}

// Prepared statements
const statements = {
  // Documents
  getDocByPath: db.prepare("SELECT * FROM documents WHERE path = ?"),
  insertDoc: db.prepare(
    "INSERT INTO documents (path, hash, updated_at) VALUES (?, ?, ?) RETURNING id"
  ),
  updateDoc: db.prepare(
    "UPDATE documents SET hash = ?, updated_at = ? WHERE id = ?"
  ),
  deleteDoc: db.prepare("DELETE FROM documents WHERE id = ?"),
  getAllDocs: db.prepare("SELECT * FROM documents"),

  // Chunks
  insertChunk: db.prepare(
    "INSERT INTO chunks (doc_id, chunk_index, content, embedding) VALUES (?, ?, ?, ?)"
  ),
  deleteChunksByDocId: db.prepare("DELETE FROM chunks WHERE doc_id = ?"),
  getChunksByDocId: db.prepare("SELECT * FROM chunks WHERE doc_id = ?"),
  getAllChunksWithEmbeddings: db.prepare(
    "SELECT id, doc_id, chunk_index, content, embedding FROM chunks WHERE embedding IS NOT NULL"
  ),
  getChunkById: db.prepare("SELECT * FROM chunks WHERE id = ?"),

  // FTS5 search
  searchFts: db.prepare(`
    SELECT rowid, rank
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `),

  // Stats
  countDocs: db.prepare("SELECT COUNT(*) as count FROM documents"),
  countChunks: db.prepare("SELECT COUNT(*) as count FROM chunks"),
};

// Document operations
export function getDocumentByPath(path: string) {
  return statements.getDocByPath.get(path) as
    | { id: number; path: string; hash: string; updated_at: number }
    | undefined;
}

export function insertDocument(path: string, hash: string): number {
  const result = statements.insertDoc.get(path, hash, Date.now()) as { id: number };
  return result.id;
}

export function updateDocument(id: number, hash: string) {
  statements.updateDoc.run(hash, Date.now(), id);
}

export function deleteDocument(id: number) {
  // Chunks are deleted via CASCADE
  statements.deleteDoc.run(id);
}

export function getAllDocuments() {
  return statements.getAllDocs.all() as Array<{
    id: number;
    path: string;
    hash: string;
    updated_at: number;
  }>;
}

// Chunk operations
export function insertChunk(
  docId: number,
  chunkIndex: number,
  content: string,
  embedding: number[] | null
) {
  const embeddingBlob = embedding ? float32ToBlob(embedding) : null;
  statements.insertChunk.run(docId, chunkIndex, content, embeddingBlob);
}

export function deleteChunksByDocId(docId: number) {
  statements.deleteChunksByDocId.run(docId);
}

export function getChunksByDocId(docId: number) {
  return statements.getChunksByDocId.all(docId) as Array<{
    id: number;
    doc_id: number;
    chunk_index: number;
    content: string;
    embedding: Uint8Array | null;
  }>;
}

export function getAllChunksWithEmbeddings() {
  return statements.getAllChunksWithEmbeddings.all() as Array<{
    id: number;
    doc_id: number;
    chunk_index: number;
    content: string;
    embedding: Uint8Array;
  }>;
}

export function getChunkById(id: number) {
  return statements.getChunkById.get(id) as
    | {
        id: number;
        doc_id: number;
        chunk_index: number;
        content: string;
        embedding: Uint8Array | null;
      }
    | undefined;
}

// FTS5 search (BM25)
export function searchBm25(query: string, limit: number) {
  // Escape special FTS5 characters
  const escapedQuery = query.replace(/["\-*()]/g, " ").trim();
  if (!escapedQuery) return [];

  try {
    return statements.searchFts.all(escapedQuery, limit) as Array<{
      rowid: number;
      rank: number;
    }>;
  } catch {
    // If FTS query fails, return empty
    return [];
  }
}

// Stats
export function getStats() {
  const docs = statements.countDocs.get() as { count: number };
  const chunks = statements.countChunks.get() as { count: number };
  return {
    documents: docs.count,
    chunks: chunks.count,
    dbPath: DB_PATH,
  };
}

// Transaction helper
export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export { db, DB_PATH };
