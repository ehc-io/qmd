import { createHash } from "crypto";
import {
  getDocumentByPath,
  insertDocument,
  updateDocument,
  deleteDocument,
  deleteChunksByDocId,
  insertChunk,
  getAllDocuments,
  transaction,
} from "./db.js";
import { embed, isEmbeddingsEnabled } from "./embeddings.js";

// Configuration
const KB_PATH = process.env.QMD_KB_PATH || "/app/kb";
const CHUNK_SIZE = parseInt(process.env.QMD_CHUNK_SIZE || "500", 10);
const CHUNK_OVERLAP = parseInt(process.env.QMD_CHUNK_OVERLAP || "50", 10);

/**
 * Compute MD5 hash of file content
 */
function hashContent(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

/**
 * Split text into overlapping chunks
 * Simple character-based chunking (approximately tokens)
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  // Rough approximation: 1 token ≈ 4 characters
  const charSize = chunkSize * 4;
  const charOverlap = overlap * 4;

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + charSize;

    // Try to break at paragraph or sentence boundary
    if (end < text.length) {
      // Look for paragraph break
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + charSize / 2) {
        end = paragraphBreak + 2;
      } else {
        // Look for sentence break
        const sentenceBreak = text.lastIndexOf(". ", end);
        if (sentenceBreak > start + charSize / 2) {
          end = sentenceBreak + 2;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Move start forward, accounting for overlap
    start = end - charOverlap;
    if (start <= chunks.length > 0 ? start : 0) {
      start = end; // Prevent infinite loop
    }
  }

  return chunks;
}

/**
 * Scan knowledge base folder for markdown files
 */
async function scanMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("**/*.md");

  for await (const path of glob.scan({ cwd: dir, absolute: true })) {
    files.push(path);
  }

  return files;
}

/**
 * Process a single document: chunk and embed
 */
async function processDocument(
  filePath: string,
  content: string,
  docId: number,
  generateEmbeddings: boolean
): Promise<number> {
  const chunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);

  if (generateEmbeddings && isEmbeddingsEnabled() && chunks.length > 0) {
    // Generate embeddings in batches
    const embeddings = await embed(chunks);

    // Insert chunks with embeddings
    for (let i = 0; i < chunks.length; i++) {
      insertChunk(docId, i, chunks[i], embeddings[i]);
    }
  } else {
    // Insert chunks without embeddings
    for (let i = 0; i < chunks.length; i++) {
      insertChunk(docId, i, chunks[i], null);
    }
  }

  return chunks.length;
}

export interface IngestResult {
  added: number;
  updated: number;
  deleted: number;
  totalChunks: number;
  errors: string[];
}

/**
 * Run the ingestion pipeline
 * @param force Force re-indexing of all files
 */
export async function runIngestion(force: boolean = false): Promise<IngestResult> {
  const result: IngestResult = {
    added: 0,
    updated: 0,
    deleted: 0,
    totalChunks: 0,
    errors: [],
  };

  console.error(`Scanning ${KB_PATH} for markdown files...`);
  const files = await scanMarkdownFiles(KB_PATH);
  console.error(`Found ${files.length} markdown files`);

  // Get existing documents from DB
  const existingDocs = getAllDocuments();
  const existingPaths = new Set(existingDocs.map((d) => d.path));
  const processedPaths = new Set<string>();

  // Process each file
  for (const filePath of files) {
    const relativePath = filePath.replace(KB_PATH + "/", "");
    processedPaths.add(relativePath);

    try {
      const content = await Bun.file(filePath).text();
      const hash = hashContent(content);

      const existingDoc = getDocumentByPath(relativePath);

      if (existingDoc) {
        // Check if content changed
        if (force || existingDoc.hash !== hash) {
          // Update document
          transaction(() => {
            deleteChunksByDocId(existingDoc.id);
            updateDocument(existingDoc.id, hash);
          });

          const chunkCount = await processDocument(
            relativePath,
            content,
            existingDoc.id,
            true
          );
          result.updated++;
          result.totalChunks += chunkCount;
          console.error(`Updated: ${relativePath} (${chunkCount} chunks)`);
        }
      } else {
        // New document
        const docId = insertDocument(relativePath, hash);
        const chunkCount = await processDocument(
          relativePath,
          content,
          docId,
          true
        );
        result.added++;
        result.totalChunks += chunkCount;
        console.error(`Added: ${relativePath} (${chunkCount} chunks)`);
      }
    } catch (error) {
      const errorMsg = `Error processing ${relativePath}: ${error}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }
  }

  // Delete documents that no longer exist
  for (const doc of existingDocs) {
    if (!processedPaths.has(doc.path)) {
      deleteDocument(doc.id);
      result.deleted++;
      console.error(`Deleted: ${doc.path}`);
    }
  }

  console.error(
    `Ingestion complete: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted`
  );

  return result;
}

/**
 * Get ingestion statistics
 */
export function getIngestStats() {
  return {
    kbPath: KB_PATH,
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    embeddingsEnabled: isEmbeddingsEnabled(),
  };
}
