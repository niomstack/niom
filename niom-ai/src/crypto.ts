/**
 * Encryption utilities for NIOM data at rest.
 *
 * Uses AES-256-GCM via Node's built-in crypto module.
 * Key is auto-generated on first use and stored at ~/.niom/.key
 *
 * This provides:
 * - Confidentiality: conversations are encrypted on disk
 * - Integrity: GCM auth tag detects tampering
 * - Per-file unique IVs: each encrypt() call uses a random IV
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16;

let _cachedKey: Buffer | null = null;

/**
 * Get or create the encryption key.
 * Stored at ~/.niom/.key (256-bit random key, hex-encoded).
 */
function getKey(): Buffer {
    if (_cachedKey) return _cachedKey;

    const keyPath = join(getDataDir(), ".key");

    if (existsSync(keyPath)) {
        const hex = readFileSync(keyPath, "utf-8").trim();
        _cachedKey = Buffer.from(hex, "hex");
    } else {
        _cachedKey = randomBytes(KEY_LENGTH);
        writeFileSync(keyPath, _cachedKey.toString("hex"), { encoding: "utf-8", mode: 0o600 });
        console.log(`[crypto] Generated encryption key at ${keyPath}`);
    }

    return _cachedKey;
}

/**
 * Encrypt a UTF-8 string. Returns a Buffer containing:
 * [IV (16 bytes)] [Auth Tag (16 bytes)] [Ciphertext (variable)]
 */
export function encrypt(plaintext: string): Buffer {
    const key = getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf-8"),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Pack: IV + AuthTag + Ciphertext
    return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a Buffer (from encrypt()). Returns the original UTF-8 string.
 */
export function decrypt(data: Buffer): string {
    const key = getKey();

    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);

    return decrypted.toString("utf-8");
}

/**
 * Encrypt a JSON-serializable object and write to file.
 */
export function encryptToFile(filePath: string, data: any): void {
    const json = JSON.stringify(data);
    const encrypted = encrypt(json);
    writeFileSync(filePath, encrypted);
}

/**
 * Read and decrypt a JSON file.
 */
export function decryptFromFile<T = any>(filePath: string): T {
    const data = readFileSync(filePath);
    const json = decrypt(data);
    return JSON.parse(json);
}
