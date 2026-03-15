/**
 * Embedding Service — Local Semantic Embeddings
 *
 * Provides embedding computation using HuggingFace Transformers.js
 * with the all-MiniLM-L6-v2 model (384 dimensions, ~22MB).
 *
 * Per the research paper §3.2:
 * - Embeddings are computed from SHORT exemplar phrases, not long descriptions
 * - Short-to-short similarity yields 10-12× higher scores than short-to-long
 * - LRU cache prevents redundant computation
 * - Hash-based fallback if ONNX runtime fails
 *
 * Three-phase integration:
 * - Phase A (install-time): embed all exemplars + tools → build graph
 * - Phase B (type-time):    embed user query → traverse graph (~2ms)
 * - Phase C (send-time):    no embedding — use cached SkillPath
 */

// ─── LRU Cache ──────────────────────────────────────────────────────

class LRUCache<K, V> {
  private cache = new Map<K, V>();

  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ─── Embedding Pipeline ─────────────────────────────────────────────

/** Embedding dimension for all-MiniLM-L6-v2 */
export const EMBEDDING_DIM = 384;

/** Singleton embedding pipeline — lazy-loaded on first use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstance: any = null;
let pipelineLoading: Promise<void> | null = null;
let pipelineReady = false;
let pipelineFailed = false;

/** LRU cache: text → embedding vector. 500 entries covers most skill packs. */
const embeddingCache = new LRUCache<string, number[]>(500);

/**
 * Initialize the embedding pipeline.
 * Lazy-loads the model on first call. Subsequent calls are no-ops.
 * Uses dynamic import to avoid issues with webpack bundling.
 */
async function ensurePipeline(): Promise<void> {
  if (pipelineReady) return;
  if (pipelineFailed) return;
  if (pipelineLoading) {
    await pipelineLoading;
    return;
  }

  pipelineLoading = (async () => {
    try {
      console.log("[Embeddings] Loading all-MiniLM-L6-v2 model...");
      const startTime = performance.now();

      // Dynamic import to avoid webpack bundling issues with ONNX
      const { pipeline } = await import("@huggingface/transformers");

      pipelineInstance = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        {
          // Use local cache, don't re-download
          revision: "main",
        },
      );

      pipelineReady = true;
      const elapsed = Math.round(performance.now() - startTime);
      console.log(`[Embeddings] Model loaded in ${elapsed}ms`);
    } catch (error) {
      console.error("[Embeddings] Failed to load model:", error);
      pipelineFailed = true;
      pipelineInstance = null;
    }
  })();

  await pipelineLoading;
}

// ─── Core Embedding Functions ────────────────────────────────────────

/**
 * Embed a single text string. Returns a 384-dim L2-normalized vector.
 * Uses cache to avoid redundant computation.
 *
 * Falls back to hash-based embedding if the model fails to load.
 */
export async function embed(text: string): Promise<number[]> {
  // Check cache first
  const cached = embeddingCache.get(text);
  if (cached) return cached;

  await ensurePipeline();

  let embedding: number[];

  if (pipelineReady && pipelineInstance) {
    try {
      const output = await pipelineInstance(text, {
        pooling: "mean",
        normalize: true,
      });

      // output.data is a Float32Array — convert to number[]
      embedding = Array.from(output.data as Float32Array);
    } catch (error) {
      console.warn("[Embeddings] Inference failed, using hash fallback:", error);
      embedding = hashEmbedding(text);
    }
  } else {
    // Model didn't load — use hash fallback
    embedding = hashEmbedding(text);
  }

  embeddingCache.set(text, embedding);
  return embedding;
}

/**
 * Embed multiple texts in batch. More efficient than individual calls
 * when available, falls back to sequential embedding.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  // Check which texts need computation
  const results: number[][] = new Array(texts.length);
  const toCompute: { index: number; text: string }[] = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = embeddingCache.get(texts[i]);
    if (cached) {
      results[i] = cached;
    } else {
      toCompute.push({ index: i, text: texts[i] });
    }
  }

  if (toCompute.length === 0) return results;

  await ensurePipeline();

  // Compute embeddings for uncached texts
  for (const { index, text } of toCompute) {
    let embedding: number[];

    if (pipelineReady && pipelineInstance) {
      try {
        const output = await pipelineInstance(text, {
          pooling: "mean",
          normalize: true,
        });
        embedding = Array.from(output.data as Float32Array);
      } catch {
        embedding = hashEmbedding(text);
      }
    } else {
      embedding = hashEmbedding(text);
    }

    embeddingCache.set(text, embedding);
    results[index] = embedding;
  }

  return results;
}

/**
 * Compute the average of multiple embeddings.
 * Used to create a single representative embedding from exemplars.
 * Result is L2-normalized.
 */
export function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    return new Array(EMBEDDING_DIM).fill(0);
  }

  if (embeddings.length === 1) {
    return [...embeddings[0]];
  }

  const avg = new Array(EMBEDDING_DIM).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      avg[i] += emb[i];
    }
  }

  for (let i = 0; i < EMBEDDING_DIM; i++) {
    avg[i] /= embeddings.length;
  }

  return l2Normalize(avg);
}

// ─── Similarity Functions ────────────────────────────────────────────

/**
 * Cosine similarity between two embeddings.
 * Both vectors should be L2-normalized (dot product = cosine sim).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Max-similarity scoring: find the maximum cosine similarity between
 * a query embedding and a set of exemplar embeddings.
 *
 * This is the paper's key insight (§3.3): max-sim over short exemplars
 * outperforms avg-sim or single-embedding approaches because it allows
 * ANY exemplar to match, not requiring similarity to ALL.
 */
export function maxSimilarity(queryEmb: number[], exemplarEmbs: number[][]): number {
  if (exemplarEmbs.length === 0) return 0;

  let maxSim = -1;
  for (const exEmb of exemplarEmbs) {
    const sim = cosineSimilarity(queryEmb, exEmb);
    if (sim > maxSim) maxSim = sim;
  }
  return maxSim;
}

// ─── Hash-Based Fallback ─────────────────────────────────────────────
// If ONNX model fails to load (e.g., architecture mismatch, missing runtime),
// use a deterministic hash-based embedding as fallback. Quality is much lower
// but ensures the system doesn't crash.

/**
 * Generate a deterministic pseudo-embedding from text using hashing.
 * NOT semantically meaningful — purely a fallback for structural integrity.
 */
function hashEmbedding(text: string): number[] {
  const embedding = new Array(EMBEDDING_DIM).fill(0);
  const normalized = text.toLowerCase().trim();

  // Use simple hash to distribute values
  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const index = (charCode * 31 + i * 7) % EMBEDDING_DIM;
    embedding[index] += (charCode - 96) / 26;
  }

  return l2Normalize(embedding);
}

// ─── Utility Functions ───────────────────────────────────────────────

/** L2-normalize a vector in-place and return it. */
function l2Normalize(vec: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);

  if (norm === 0) return vec;

  for (let i = 0; i < vec.length; i++) {
    vec[i] /= norm;
  }
  return vec;
}

// ─── Lifecycle ───────────────────────────────────────────────────────

/** Check if the embedding model is ready (loaded successfully). */
export function isModelReady(): boolean {
  return pipelineReady;
}

/** Check if the embedding model failed to load. */
export function isModelFailed(): boolean {
  return pipelineFailed;
}

/** Get cache statistics. */
export function getCacheStats(): { size: number; maxSize: number } {
  return { size: embeddingCache.size, maxSize: 500 };
}

/** Clear the embedding cache (e.g., on pack reload). */
export function clearCache(): void {
  embeddingCache.clear();
}

/** Pre-warm the pipeline (call during app startup). */
export async function warmup(): Promise<void> {
  await ensurePipeline();
}
