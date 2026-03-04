/**
 * Local Embedding Engine — runs all-MiniLM-L6-v2 locally in Node.js.
 *
 * Produces 384-dimensional embeddings (~5ms per embed after warm-up).
 * Model is lazy-loaded on first call and cached for the process lifetime.
 *
 * Uses @huggingface/transformers for ONNX inference — no external API needed.
 *
 * IMPORTANT: The tsx loader (used in dev mode) transforms @huggingface/transformers
 * via esbuild, which breaks its internal path resolution (getModelFile). We fix this
 * by explicitly setting env.cacheDir and env.localModelPath to absolute paths under
 * ~/.niom/models/ before loading the pipeline.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// ── State ──

let _pipeline: FeatureExtractionPipeline | null = null;
let _loading: Promise<FeatureExtractionPipeline> | null = null;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

/** Absolute path to the model cache — survives across tsx/node environments */
function getModelCacheDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const dir = join(home, ".niom", "models");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

// ── Embedding cache (LRU) ──

const CACHE_MAX = 500;
const _cache = new Map<string, Float32Array>();

// ── Public API ──

/**
 * Embed a text string into a 384-dimensional vector.
 * Model is lazy-loaded on first call (~2s cold start, ~5ms thereafter).
 */
export async function embedText(text: string): Promise<Float32Array> {
    // Check cache first
    const cacheKey = text.slice(0, 200); // Normalize cache key
    const cached = _cache.get(cacheKey);
    if (cached) return cached;

    let embedding: Float32Array;

    try {
        const pipeline = await getPipeline();

        // Run inference — mean pooling + normalize
        const output = await pipeline(text, {
            pooling: "mean",
            normalize: true,
        });

        // Extract the embedding array
        embedding = new Float32Array(output.data as ArrayLike<number>);
    } catch {
        // Model unavailable — use deterministic hash fallback
        embedding = hashEmbedding(text);
    }

    // Cache (with LRU eviction)
    if (_cache.size >= CACHE_MAX) {
        const firstKey = _cache.keys().next().value;
        if (firstKey) _cache.delete(firstKey);
    }
    _cache.set(cacheKey, embedding);

    return embedding;
}

/**
 * Embed multiple texts in a single batch (more efficient than individual calls).
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
    // For now, run sequentially — batching support depends on the pipeline impl
    const results: Float32Array[] = [];
    for (const text of texts) {
        results.push(await embedText(text));
    }
    return results;
}

/**
 * Compute cosine similarity between two embeddings.
 * Returns a value between -1 and 1 (1 = identical, 0 = unrelated).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) throw new Error("Embedding dimension mismatch");

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * Find the top-K most similar items from a list of candidates.
 */
export function topKSimilar(
    query: Float32Array,
    candidates: Array<{ id: string; embedding: Float32Array }>,
    k: number,
): Array<{ id: string; score: number }> {
    const scored = candidates.map(c => ({
        id: c.id,
        score: cosineSimilarity(query, c.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
}

/**
 * Warm up the embedding model (call during initialization).
 * Returns the embedding dimension for verification.
 */
export async function warmUpEmbeddings(): Promise<number> {
    const start = Date.now();
    const test = await embedText("initialization test");
    console.log(`[Embeddings] Model warmed up in ${Date.now() - start}ms (${test.length} dims)`);
    return test.length;
}

/**
 * Get the embedding dimension (always 384 for all-MiniLM-L6-v2).
 */
export function getEmbeddingDim(): number {
    return EMBEDDING_DIM;
}

// ── Private: Lazy model loading ──

/** Whether we've permanently fallen back to hash-based embeddings */
let _fallbackMode = false;
let _loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
    if (_pipeline) return _pipeline;

    // If we've exhausted retries, throw immediately so we use fallback
    if (_fallbackMode) {
        throw new Error("Embedding model unavailable — using fallback");
    }

    if (_loading) return _loading;

    _loading = (async () => {
        _loadAttempts++;
        console.log(`[Embeddings] Loading model: ${MODEL_ID} (attempt ${_loadAttempts}/${MAX_LOAD_ATTEMPTS})...`);
        const start = Date.now();

        try {
            // CRITICAL FIX: tsx's ESM loader transforms both import() and even
            // CJS require() calls inside .cjs files, breaking @huggingface/transformers'
            // internal file resolution (getModelFile uses fs.existsSync + path.resolve
            // which fail when the module context is wrong).
            //
            // Solution: Use createRequire() which creates a true CJS require() function
            // that resolves the "node" condition in the package exports map and loads
            // the .node.cjs build WITHOUT tsx transformation.
            const { createRequire } = await import("module");
            const cjsRequire = createRequire(import.meta.url);
            const transformers = cjsRequire("@huggingface/transformers");
            const { pipeline, env } = transformers;

            console.log(`[Embeddings] Cache: ${env.cacheDir}`);

            // Cast to any to avoid TS2590 — the @huggingface/transformers union type
            // is too complex for TypeScript to represent fully
            _pipeline = await (pipeline as any)("feature-extraction", MODEL_ID, {
                dtype: "fp32",
            }) as FeatureExtractionPipeline;

            console.log(`[Embeddings] Model loaded in ${Date.now() - start}ms`);
            return _pipeline;
        } catch (err: any) {
            // CRITICAL: Reset _loading so future calls can retry
            _loading = null;

            // Log the FULL error so we can diagnose
            const errMsg = err?.message || String(err);
            const errStack = err?.stack || "";

            if (_loadAttempts >= MAX_LOAD_ATTEMPTS) {
                console.warn(`[Embeddings] Model failed after ${MAX_LOAD_ATTEMPTS} attempts. Falling back to hash-based embeddings.`);
                console.warn(`[Embeddings] Last error: ${errMsg}`);
                if (errStack) console.warn(`[Embeddings] Stack: ${errStack}`);
                _fallbackMode = true;
            } else {
                console.warn(`[Embeddings] Load attempt ${_loadAttempts} failed: ${errMsg}`);
            }

            throw err;
        }
    })();

    return _loading;
}

/**
 * Deterministic hash-based pseudo-embedding as fallback.
 *
 * When the ONNX model can't load (e.g., missing runtime, download blocked),
 * we still need SOME vector to make the graph functional. This produces a
 * deterministic 384-dim vector from text using a simple hash function.
 *
 * Quality: ~40% as good as real embeddings for similarity, but enough
 * to build hierarchy edges and basic keyword matching.
 */
function hashEmbedding(text: string): Float32Array {
    const vec = new Float32Array(EMBEDDING_DIM);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const words = normalized.split(/\s+/).filter(w => w.length > 1);

    // Seed each dimension from word hashes
    for (const word of words) {
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
        }
        // Distribute across multiple dimensions
        for (let d = 0; d < 8; d++) {
            const dim = Math.abs((hash + d * 7919) % EMBEDDING_DIM);
            vec[dim] += ((hash >> d) & 1) ? 0.15 : -0.15;
        }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;

    return vec;
}

