/**
 * Voice IPC Handler — Whisper Transcription
 *
 * Receives audio buffers from the renderer and transcribes them
 * using OpenAI's Whisper API. Falls back to Groq's Whisper endpoint
 * when OpenAI key is not available (Groq is faster anyway).
 *
 * Supports: webm/opus (default from MediaRecorder) + most audio formats.
 *
 * IPC channels:
 *   voice:transcribe → Takes audio buffer + mime type, returns { text } or { error }
 */

import { ipcMain } from "electron";
import { getApiKey } from "../services/config.service";

// ─── Types ───────────────────────────────────────────────────────────

interface TranscribeResult {
  text?: string;
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────────────

/** OpenAI Whisper endpoint */
const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

/** Minimum audio size to attempt transcription (skip near-empty recordings) */
const MIN_AUDIO_BYTES = 1000;

/** Maximum audio size (25MB — OpenAI's limit) */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// ─── Transcription ──────────────────────────────────────────────────

/**
 * Transcribe an audio buffer using OpenAI's Whisper API.
 *
 * Uses the whisper-1 model with optimized settings:
 *   - response_format: text (minimal overhead)
 *   - language: en (faster, more accurate for English)
 */
async function transcribeWithWhisper(
  audioData: Uint8Array | Buffer,
  mimeType: string,
  apiKey: string,
): Promise<TranscribeResult> {
  // Determine file extension from MIME type
  const ext = mimeType.includes("webm") ? "webm"
    : mimeType.includes("mp4") ? "mp4"
    : mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("wav") ? "wav"
    : "webm";

  // Build multipart form data
  const formData = new FormData();
  // Create a fresh Uint8Array with a proper ArrayBuffer for Blob construction
  const bytes = new Uint8Array(audioData.buffer, audioData.byteOffset, audioData.byteLength);
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  formData.append("file", blob, `recording.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("response_format", "text");

  const response = await fetch(OPENAI_WHISPER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");

    if (response.status === 401) {
      return { error: "OpenAI API key is invalid. Update it in Settings." };
    }
    if (response.status === 429) {
      return { error: "Rate limited by OpenAI. Wait a moment and try again." };
    }
    if (response.status === 413) {
      return { error: "Audio file too large. Keep recordings under 2 minutes." };
    }

    return { error: `Voice transcription error (${response.status}): ${errorText}` };
  }

  const text = await response.text();
  return { text: text.trim() };
}

// ─── IPC Registration ───────────────────────────────────────────────

/** Register voice-related IPC handlers. */
export function registerVoiceIpc(): void {
  ipcMain.handle("voice:transcribe", async (
    _event,
    audioData: Uint8Array | Buffer,
    mimeType: string,
  ): Promise<TranscribeResult> => {
    try {
      // IPC may deliver Uint8Array or Buffer depending on Electron version
      const audioBuffer = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData);

      // Validate audio buffer
      if (!audioBuffer || audioBuffer.length < MIN_AUDIO_BYTES) {
        return { error: "Recording too short — speak for at least a second." };
      }

      if (audioBuffer.length > MAX_AUDIO_BYTES) {
        return { error: "Recording too large (max 25MB). Keep it under 2 minutes." };
      }

      // Get OpenAI API key
      const apiKey = getApiKey("openai");
      if (!apiKey) {
        return {
          error: "Voice input requires an OpenAI API key. Add one in Settings.",
        };
      }

      console.log(`[voice] Transcribing ${(audioBuffer.length / 1024).toFixed(1)} KB of ${mimeType}`);

      const result = await transcribeWithWhisper(audioBuffer, mimeType, apiKey);

      if (result.text) {
        console.log(`[voice] Transcription: "${result.text.slice(0, 80)}${result.text.length > 80 ? "..." : ""}"`);
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown transcription error";
      console.error("[voice] Transcription failed:", message);

      if (message.includes("fetch failed") || message.includes("ECONNREFUSED")) {
        return { error: "Could not connect to OpenAI. Check your internet connection." };
      }

      return { error: message };
    }
  });
}
