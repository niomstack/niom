/**
 * MemoryStore — unified persistence layer for all NIOM data.
 *
 * Replaces the fragmented thread/task/run persistence with a single
 * class that manages all encrypted file I/O through a central index.
 *
 * Directory structure:
 *   ~/.niom/memory/
 *   ├── index.json            # Master index (lightweight metadata)
 *   ├── conversations/{id}.enc
 *   ├── tasks/{id}.enc
 *   ├── runs/{taskId}/{n}.enc
 *   └── brain/knowledge.enc   # Long-term memory
 *
 * The index is the single source of truth for listings.
 * Full data is encrypted per-item and loaded on demand.
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { getDataDir } from "../config.js";
import { encryptToFile, decryptFromFile } from "../crypto.js";

// ── Index Types ──

export interface ConversationEntry {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    status: string;
    messageCount: number;
    lastMessage?: string;
}

export interface TaskEntry {
    id: string;
    goal: string;
    taskType: string;
    status: string;
    threadId?: string;
    nextRunAt?: number;
    lastRunAt?: number;
    totalRuns: number;
    createdAt: number;
    updatedAt: number;
}

export interface BrainData {
    /** Key facts about the user ("Prefers TypeScript", "Works on NIOM") */
    facts: string[];
    /** Key-value preferences ("code_style": "functional") */
    preferences: Record<string, string>;
    /** Behavioral patterns ("Usually works late evenings IST") */
    patterns: string[];
    /** Last updated timestamp */
    updatedAt: number;
}

export interface MemoryIndex {
    conversations: ConversationEntry[];
    tasks: TaskEntry[];
    brain: BrainData;
    /** Schema version for future migrations */
    version: number;
}

// ── Default Index ──

function emptyIndex(): MemoryIndex {
    return {
        conversations: [],
        tasks: [],
        brain: {
            facts: [],
            preferences: {},
            patterns: [],
            updatedAt: Date.now(),
        },
        version: 1,
    };
}

// ── Collection types ──

export type Collection = "conversations" | "tasks";

// ── MemoryStore ──

export class MemoryStore {
    private static instance: MemoryStore | null = null;

    private index: MemoryIndex;
    private indexDirty = false;
    private indexTimer: ReturnType<typeof setTimeout> | null = null;
    private root: string;
    private initialized = false;

    private constructor() {
        this.root = join(getDataDir(), "memory");
        this.index = emptyIndex();
    }

    static getInstance(): MemoryStore {
        if (!MemoryStore.instance) {
            MemoryStore.instance = new MemoryStore();
        }
        return MemoryStore.instance;
    }

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Initialize the memory store — create directories, load index.
     * Called once at sidecar boot.
     */
    init(): void {
        if (this.initialized) return;

        // Create directory structure
        const dirs = [
            this.root,
            this.collectionDir("conversations"),
            this.collectionDir("tasks"),
            join(this.root, "runs"),
            join(this.root, "brain"),
        ];
        for (const dir of dirs) {
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        }

        // Load or create index
        this.loadIndex();
        this.initialized = true;
        console.log(`[memory] Initialized — ${this.index.conversations.length} conversations, ${this.index.tasks.length} tasks, ${this.index.brain.facts.length} brain facts`);
    }

    /** Ensure init has been called */
    private ensureInit(): void {
        if (!this.initialized) this.init();
    }

    /** Shutdown — flush pending index writes */
    shutdown(): void {
        this.flushIndex();
        console.log("[memory] Shutdown — index flushed");
    }

    // ═══════════════════════════════════════════════════════════════
    // INDEX MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    private indexPath(): string {
        return join(this.root, "index.json");
    }

    private loadIndex(): void {
        const path = this.indexPath();
        if (!existsSync(path)) {
            this.index = emptyIndex();
            this.saveIndexSync();
            return;
        }
        try {
            // Index is stored as encrypted JSON
            this.index = decryptFromFile<MemoryIndex>(path);
            // Ensure brain exists (migration from older index)
            if (!this.index.brain) {
                this.index.brain = emptyIndex().brain;
                this.scheduleIndexSave();
            }
        } catch (err) {
            console.warn("[memory] Failed to load index, starting fresh:", err);
            this.index = emptyIndex();
            this.saveIndexSync();
        }
    }

    /** Synchronous index save (used during init/shutdown) */
    private saveIndexSync(): void {
        encryptToFile(this.indexPath(), this.index);
        this.indexDirty = false;
    }

    /** Schedule a debounced index save (max 1 write per 2s) */
    private scheduleIndexSave(): void {
        this.indexDirty = true;
        if (!this.indexTimer) {
            this.indexTimer = setTimeout(() => this.flushIndex(), 2000);
        }
    }

    /** Flush the index to disk now */
    flushIndex(): void {
        if (this.indexTimer) {
            clearTimeout(this.indexTimer);
            this.indexTimer = null;
        }
        if (this.indexDirty) {
            this.saveIndexSync();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GENERIC CRUD — Conversations & Tasks
    // ═══════════════════════════════════════════════════════════════

    private collectionDir(collection: Collection): string {
        return join(this.root, collection);
    }

    private itemPath(collection: Collection, id: string): string {
        const safe = id.replace(/[^a-zA-Z0-9-]/g, "");
        return join(this.collectionDir(collection), `${safe}.enc`);
    }

    /**
     * Save an item to a collection (encrypted on disk).
     * Also updates the index entry.
     */
    save<T>(collection: Collection, id: string, data: T, indexEntry: ConversationEntry | TaskEntry): void {
        this.ensureInit();
        const path = this.itemPath(collection, id);
        encryptToFile(path, data);

        // Update index
        const list = this.index[collection] as (ConversationEntry | TaskEntry)[];
        const idx = list.findIndex(e => e.id === id);
        if (idx >= 0) {
            list[idx] = indexEntry;
        } else {
            list.push(indexEntry);
        }
        this.scheduleIndexSave();
    }

    /**
     * Load a single item from a collection (decrypts from disk).
     */
    load<T>(collection: Collection, id: string): T | null {
        this.ensureInit();
        const path = this.itemPath(collection, id);
        if (!existsSync(path)) return null;
        try {
            return decryptFromFile<T>(path);
        } catch (err) {
            console.warn(`[memory] Failed to load ${collection}/${id}:`, err);
            return null;
        }
    }

    /**
     * Delete an item from a collection.
     */
    delete(collection: Collection, id: string): boolean {
        this.ensureInit();
        const path = this.itemPath(collection, id);
        if (!existsSync(path)) return false;
        try {
            unlinkSync(path);
        } catch { /* ignore */ }

        // Remove from index
        const list = this.index[collection] as (ConversationEntry | TaskEntry)[];
        const idx = list.findIndex(e => e.id === id);
        if (idx >= 0) list.splice(idx, 1);
        this.scheduleIndexSave();
        return true;
    }

    /**
     * List items from a collection (from index — no decryption needed).
     */
    list(collection: "conversations"): ConversationEntry[];
    list(collection: "tasks"): TaskEntry[];
    list(collection: Collection): (ConversationEntry | TaskEntry)[] {
        this.ensureInit();
        return this.index[collection];
    }

    /**
     * Clear all items in a collection.
     */
    clearCollection(collection: Collection): number {
        this.ensureInit();
        const dir = this.collectionDir(collection);
        let count = 0;
        try {
            const files = readdirSync(dir).filter(f => f.endsWith(".enc"));
            for (const file of files) {
                try { unlinkSync(join(dir, file)); count++; } catch { /* skip */ }
            }
        } catch { /* dir doesn't exist */ }

        (this.index[collection] as any[]).length = 0;
        this.scheduleIndexSave();
        return count;
    }

    // ═══════════════════════════════════════════════════════════════
    // TASK RUNS
    // ═══════════════════════════════════════════════════════════════

    private runsDir(taskId: string): string {
        const dir = join(this.root, "runs", taskId.replace(/[^a-zA-Z0-9-]/g, ""));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        return dir;
    }

    /**
     * Save a task run (encrypted).
     */
    saveRun<T>(taskId: string, runNumber: number, data: T): void {
        this.ensureInit();
        const dir = this.runsDir(taskId);
        const filename = `run_${String(runNumber).padStart(4, "0")}.enc`;
        encryptToFile(join(dir, filename), data);
    }

    /**
     * Load runs for a task.
     */
    loadRuns<T>(taskId: string, limit = 20): T[] {
        this.ensureInit();
        const dir = this.runsDir(taskId);
        try {
            const files = readdirSync(dir)
                .filter(f => f.startsWith("run_") && f.endsWith(".enc"))
                .sort()
                .slice(-limit);

            return files.map(f => decryptFromFile<T>(join(dir, f)));
        } catch {
            return [];
        }
    }

    /**
     * Delete a specific run.
     */
    deleteRun(taskId: string, runNumber: number): void {
        const dir = this.runsDir(taskId);
        const filename = `run_${String(runNumber).padStart(4, "0")}.enc`;
        try { unlinkSync(join(dir, filename)); } catch { /* ignore */ }
    }

    // ═══════════════════════════════════════════════════════════════
    // BRAIN — Long-term Memory
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get the current brain data.
     */
    getBrain(): BrainData {
        this.ensureInit();
        return { ...this.index.brain };
    }

    /**
     * Learn a new fact about the user.
     * Deduplicates against existing facts.
     */
    learnFact(fact: string): void {
        this.ensureInit();
        const normalized = fact.trim();
        if (!normalized) return;

        // Simple dedup — check if essentially the same fact exists
        const lower = normalized.toLowerCase();
        if (this.index.brain.facts.some(f => f.toLowerCase() === lower)) return;

        this.index.brain.facts.push(normalized);
        // Cap at 100 facts
        if (this.index.brain.facts.length > 100) {
            this.index.brain.facts = this.index.brain.facts.slice(-100);
        }
        this.index.brain.updatedAt = Date.now();
        this.scheduleIndexSave();
        console.log(`[memory] Learned fact: "${normalized.slice(0, 60)}"`);
    }

    /**
     * Remove a fact by index or exact match.
     */
    removeFact(factOrIndex: string | number): boolean {
        this.ensureInit();
        if (typeof factOrIndex === "number") {
            if (factOrIndex >= 0 && factOrIndex < this.index.brain.facts.length) {
                this.index.brain.facts.splice(factOrIndex, 1);
                this.index.brain.updatedAt = Date.now();
                this.scheduleIndexSave();
                return true;
            }
            return false;
        }
        const idx = this.index.brain.facts.indexOf(factOrIndex);
        if (idx >= 0) {
            this.index.brain.facts.splice(idx, 1);
            this.index.brain.updatedAt = Date.now();
            this.scheduleIndexSave();
            return true;
        }
        return false;
    }

    /**
     * Set a user preference.
     */
    setPreference(key: string, value: string): void {
        this.ensureInit();
        this.index.brain.preferences[key] = value;
        this.index.brain.updatedAt = Date.now();
        this.scheduleIndexSave();
        console.log(`[memory] Set preference: ${key} = "${value.slice(0, 40)}"`);
    }

    /**
     * Learn a behavioral pattern.
     */
    learnPattern(pattern: string): void {
        this.ensureInit();
        const normalized = pattern.trim();
        if (!normalized) return;
        const lower = normalized.toLowerCase();
        if (this.index.brain.patterns.some(p => p.toLowerCase() === lower)) return;

        this.index.brain.patterns.push(normalized);
        if (this.index.brain.patterns.length > 50) {
            this.index.brain.patterns = this.index.brain.patterns.slice(-50);
        }
        this.index.brain.updatedAt = Date.now();
        this.scheduleIndexSave();
    }

    /**
     * Clear all brain data.
     */
    clearBrain(): void {
        this.ensureInit();
        this.index.brain = emptyIndex().brain;
        this.scheduleIndexSave();
        console.log("[memory] Brain cleared");
    }

    /**
     * Build a context string from brain data for system prompt injection.
     * Returns empty string if brain is empty.
     */
    getBrainContext(): string {
        this.ensureInit();
        const { facts, preferences, patterns } = this.index.brain;

        if (facts.length === 0 && Object.keys(preferences).length === 0 && patterns.length === 0) {
            return "";
        }

        const parts: string[] = ["## About the User"];

        if (facts.length > 0) {
            parts.push(`### Known Facts\n${facts.map(f => `- ${f}`).join("\n")}`);
        }
        if (Object.keys(preferences).length > 0) {
            parts.push(`### Preferences\n${Object.entries(preferences).map(([k, v]) => `- **${k}**: ${v}`).join("\n")}`);
        }
        if (patterns.length > 0) {
            parts.push(`### Behavioral Patterns\n${patterns.map(p => `- ${p}`).join("\n")}`);
        }

        return parts.join("\n\n");
    }

    // ═══════════════════════════════════════════════════════════════
    // MIGRATION — Import from old format
    // ═══════════════════════════════════════════════════════════════

    /**
     * Check if old-format data exists and hasn't been migrated yet.
     */
    hasOldData(): boolean {
        const dataDir = getDataDir();
        return existsSync(join(dataDir, "threads")) || existsSync(join(dataDir, "tasks"));
    }

    /**
     * Update an index entry without touching the encrypted file.
     * Used by TaskManager to update status/metadata efficiently.
     */
    updateIndexEntry(collection: "tasks", id: string, updates: Partial<TaskEntry>): void;
    updateIndexEntry(collection: "conversations", id: string, updates: Partial<ConversationEntry>): void;
    updateIndexEntry(collection: Collection, id: string, updates: Partial<ConversationEntry | TaskEntry>): void {
        this.ensureInit();
        const list = this.index[collection] as (ConversationEntry | TaskEntry)[];
        const entry = list.find(e => e.id === id);
        if (entry) {
            Object.assign(entry, updates);
            this.scheduleIndexSave();
        }
    }
}
