import {
  searchBm25,
  getAllChunksWithEmbeddings,
  getChunkById,
  getDocumentByPath,
  blobToFloat32,
  getAllDocuments,
} from "./db.js";
import { embedSingle, cosineSimilarity, isEmbeddingsEnabled } from "./embeddings.js";

export interface SearchResult {
  chunkId: number;
  docPath: string;
  content: string;
  score: number;
  matchType: "hybrid" | "bm25" | "vector";
}

/**
 * Vector-only search using cosine similarity
 */
export async function vectorSearch(
  query: string,
  limit: number
): Promise<SearchResult[]> {
  if (!isEmbeddingsEnabled()) {
    throw new Error("Embeddings not enabled - set OPENROUTER_API_KEY");
  }

  // Get query embedding
  const queryEmbedding = await embedSingle(query);

  // Get all chunks with embeddings
  const chunks = getAllChunksWithEmbeddings();

  if (chunks.length === 0) {
    return [];
  }

  // Calculate similarity scores
  const scored = chunks.map((chunk) => {
    const embedding = blobToFloat32(chunk.embedding);
    const score = cosineSimilarity(queryEmbedding, embedding);
    return {
      chunkId: chunk.id,
      docId: chunk.doc_id,
      content: chunk.content,
      score,
    };
  });

  // Sort by score and take top results
  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, limit);

  // Get document paths
  const docs = getAllDocuments();
  const docMap = new Map(docs.map((d) => [d.id, d.path]));

  return topResults.map((r) => ({
    chunkId: r.chunkId,
    docPath: docMap.get(r.docId) || "unknown",
    content: r.content,
    score: r.score,
    matchType: "vector" as const,
  }));
}

/**
 * BM25 keyword search using FTS5
 */
export function bm25Search(query: string, limit: number): SearchResult[] {
  const results = searchBm25(query, limit);

  if (results.length === 0) {
    return [];
  }

  // Get document paths
  const docs = getAllDocuments();
  const docMap = new Map(docs.map((d) => [d.id, d.path]));

  return results.map((r) => {
    const chunk = getChunkById(r.rowid);
    if (!chunk) {
      return null;
    }
    return {
      chunkId: r.rowid,
      docPath: docMap.get(chunk.doc_id) || "unknown",
      content: chunk.content,
      score: -r.rank, // FTS5 rank is negative, lower is better
      matchType: "bm25" as const,
    };
  }).filter((r): r is SearchResult => r !== null);
}

/**
 * Reciprocal Rank Fusion (RRF) to combine BM25 and vector results
 * RRF score = Σ 1/(k + rank_i) for each result list
 */
function rrfFusion(
  bm25Results: SearchResult[],
  vectorResults: SearchResult[],
  k: number = 60
): Map<number, { score: number; result: SearchResult }> {
  const scores = new Map<number, { score: number; result: SearchResult }>();

  // Add BM25 scores
  bm25Results.forEach((result, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    const existing = scores.get(result.chunkId);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(result.chunkId, { score: rrfScore, result });
    }
  });

  // Add vector scores
  vectorResults.forEach((result, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    const existing = scores.get(result.chunkId);
    if (existing) {
      existing.score += rrfScore;
      existing.result.matchType = "hybrid";
    } else {
      scores.set(result.chunkId, { score: rrfScore, result });
    }
  });

  return scores;
}

/**
 * Hybrid search combining BM25 and vector search with RRF
 */
export async function hybridSearch(
  query: string,
  limit: number
): Promise<SearchResult[]> {
  // Get more results from each method for better fusion
  const fetchLimit = limit * 3;

  // Run BM25 search
  const bm25Results = bm25Search(query, fetchLimit);

  // Run vector search if embeddings are enabled
  let vectorResults: SearchResult[] = [];
  if (isEmbeddingsEnabled()) {
    try {
      vectorResults = await vectorSearch(query, fetchLimit);
    } catch (error) {
      console.error("Vector search failed, using BM25 only:", error);
    }
  }

  // If only BM25 results, return those
  if (vectorResults.length === 0) {
    return bm25Results.slice(0, limit);
  }

  // If only vector results, return those
  if (bm25Results.length === 0) {
    return vectorResults.slice(0, limit);
  }

  // Fuse results with RRF
  const fused = rrfFusion(bm25Results, vectorResults);

  // Sort by fused score and return top results
  const sorted = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return sorted.map((s) => ({
    ...s.result,
    score: s.score,
  }));
}

/**
 * Format search results for display
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No results found.";
  }

  return results
    .map((r, i) => {
      const snippet =
        r.content.length > 300
          ? r.content.slice(0, 300) + "..."
          : r.content;
      return `${i + 1}. **${r.docPath}** (${r.matchType}, score: ${r.score.toFixed(4)})\n   ${snippet.replace(/\n/g, " ")}`;
    })
    .join("\n\n");
}
