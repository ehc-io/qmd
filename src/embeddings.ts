import OpenAI from "openai";

// Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const EMBEDDING_MODEL =
  process.env.QMD_EMBEDDING_MODEL || "openai/text-embedding-3-small";

// Validate API key
if (!OPENROUTER_API_KEY) {
  console.error(
    "Warning: OPENROUTER_API_KEY not set. Embeddings will not be generated."
  );
}

// OpenRouter client (OpenAI-compatible API)
const client = OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/qmd",
        "X-Title": "QMD Knowledge Base",
      },
    })
  : null;

// Embedding dimensions by model
const MODEL_DIMENSIONS: Record<string, number> = {
  "openai/text-embedding-3-small": 1536,
  "openai/text-embedding-3-large": 3072,
  "cohere/embed-english-v3.0": 1024,
  "cohere/embed-multilingual-v3.0": 1024,
};

export function getEmbeddingDimensions(): number {
  return MODEL_DIMENSIONS[EMBEDDING_MODEL] || 1536;
}

export function isEmbeddingsEnabled(): boolean {
  return !!client;
}

/**
 * Generate embeddings for one or more texts
 * @param texts Array of text strings to embed
 * @returns Array of embedding vectors (number arrays)
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!client) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  if (texts.length === 0) {
    return [];
  }

  // OpenRouter/OpenAI has a limit on batch size
  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
      });

      // Sort by index to maintain order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      results.push(...sorted.map((d) => d.embedding));
    } catch (error) {
      console.error(`Error generating embeddings for batch ${i}:`, error);
      throw error;
    }
  }

  return results;
}

/**
 * Generate embedding for a single text
 * @param text Text string to embed
 * @returns Embedding vector
 */
export async function embedSingle(text: string): Promise<number[]> {
  const [embedding] = await embed([text]);
  return embedding;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Get current embedding model name
 */
export function getModelName(): string {
  return EMBEDDING_MODEL;
}
