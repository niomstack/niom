/**
 * useVoiceInput — Browser-based voice recording with silence detection.
 *
 * Uses the MediaRecorder API to capture audio from the microphone,
 * monitors audio levels via Web Audio AnalyserNode, and auto-stops
 * when the user stops speaking (Siri-like behavior).
 *
 * Then sends the audio buffer to the main process via IPC for
 * transcription using OpenAI's Whisper API.
 *
 * States:
 *   idle → recording → transcribing → idle
 *
 * Silence detection:
 *   Monitors RMS audio level every 200ms. After SILENCE_DURATION_MS
 *   of continuous silence (below SILENCE_THRESHOLD), recording
 *   auto-stops and transcription begins. A brief initial grace period
 *   prevents premature stopping before the user starts speaking.
 */

import { useState, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────

type VoiceState = "idle" | "recording" | "transcribing";

interface UseVoiceInputOptions {
  /** Called with transcribed text when Whisper completes */
  onTranscription: (text: string) => void;
  /** Called on error */
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  /** Whether the mic is actively capturing */
  isRecording: boolean;
  /** Whether audio is being transcribed */
  isTranscribing: boolean;
  /** Start recording from microphone */
  startRecording: () => Promise<void>;
  /** Stop recording and trigger transcription */
  stopRecording: () => void;
  /** Toggle recording on/off */
  toggleRecording: () => void;
  /** Current error message */
  error: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────

/** Maximum recording duration (seconds) — safety cap */
const MAX_RECORDING_DURATION = 120;

/** Preferred MIME type — webm/opus is well-supported in Chromium + Whisper */
const PREFERRED_MIME = "audio/webm;codecs=opus";

/** RMS threshold below which we consider silence (0–1 scale, ~0.01 = quiet room) */
const SILENCE_THRESHOLD = 0.015;

/** How long silence must persist before auto-stopping (ms) */
const SILENCE_DURATION_MS = 3000;

/** Grace period after recording starts — don't detect silence yet (ms) */
const INITIAL_GRACE_MS = 1500;

/** How often to check audio levels (ms) */
const LEVEL_CHECK_INTERVAL = 200;

// ─── Hook ────────────────────────────────────────────────────────────

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputReturn {
  const { onTranscription, onError } = options;
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const maxTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number>(0);
  const recordingStartRef = useRef<number>(0);

  /** Clean up all resources */
  const cleanup = useCallback(() => {
    if (maxTimeoutRef.current) {
      clearTimeout(maxTimeoutRef.current);
      maxTimeoutRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  /** Get current RMS audio level (0–1) */
  const getRMSLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;

    const dataArray = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(dataArray);

    // Calculate RMS
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128; // Center around 0
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / dataArray.length);
  }, []);

  /** Process recorded audio — convert to ArrayBuffer and send for transcription */
  const processAudio = useCallback(async (mimeType: string) => {
    setState("transcribing");

    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });

      // Convert blob to ArrayBuffer for IPC transfer (no Buffer in renderer)
      const arrayBuffer = await blob.arrayBuffer();

      // Send to main process for transcription
      const result = await window.niom.voice.transcribe(
        new Uint8Array(arrayBuffer) as unknown as Buffer,
        mimeType,
      );

      if (result.error) {
        setError(result.error);
        onError?.(result.error);
      } else if (result.text) {
        setError(null);
        onTranscription(result.text);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Transcription failed";
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      cleanup();
      setState("idle");
    }
  }, [onTranscription, onError, cleanup]);

  /** Start recording from the microphone */
  const startRecording = useCallback(async () => {
    if (state !== "idle") return;

    setError(null);

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000, // Whisper prefers 16kHz
        },
      });

      streamRef.current = stream;

      // Set up Web Audio API for silence detection
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Choose best available MIME type
      const mimeType = MediaRecorder.isTypeSupported(PREFERRED_MIME)
        ? PREFERRED_MIME
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        processAudio(mimeType);
      };

      recorder.onerror = () => {
        const errorMsg = "Recording failed — check microphone permissions";
        setError(errorMsg);
        onError?.(errorMsg);
        cleanup();
        setState("idle");
      };

      // Start recording (collect data every 250ms for smoother chunks)
      recorder.start(250);
      setState("recording");
      recordingStartRef.current = Date.now();
      silenceStartRef.current = 0;

      // ── Silence Detection ─────────────────────────────────────
      // Monitor audio levels and auto-stop when silent for SILENCE_DURATION_MS
      silenceTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - recordingStartRef.current;

        // Grace period — don't detect silence in the first INITIAL_GRACE_MS
        if (elapsed < INITIAL_GRACE_MS) return;

        const level = getRMSLevel();

        if (level < SILENCE_THRESHOLD) {
          // Silence detected
          if (silenceStartRef.current === 0) {
            silenceStartRef.current = Date.now();
          }

          const silenceDuration = Date.now() - silenceStartRef.current;
          if (silenceDuration >= SILENCE_DURATION_MS) {
            // Auto-stop — user has been silent long enough
            console.log(`[voice] Auto-stopping: ${(silenceDuration / 1000).toFixed(1)}s of silence`);
            if (mediaRecorderRef.current?.state === "recording") {
              mediaRecorderRef.current.stop();
            }
            if (silenceTimerRef.current) {
              clearInterval(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }
        } else {
          // Speech detected — reset silence timer
          silenceStartRef.current = 0;
        }
      }, LEVEL_CHECK_INTERVAL);

      // Safety timeout — stop after MAX_RECORDING_DURATION seconds
      maxTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORDING_DURATION * 1000);

    } catch (err) {
      let errorMsg = "Could not access microphone";
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          errorMsg = "Microphone access denied. Grant permission in System Preferences → Privacy → Microphone";
        } else if (err.name === "NotFoundError") {
          errorMsg = "No microphone detected";
        }
      }
      setError(errorMsg);
      onError?.(errorMsg);
      cleanup();
      setState("idle");
    }
  }, [state, onError, cleanup, getRMSLevel, processAudio]);

  /** Stop recording and trigger transcription */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      // onstop handler will process audio
    }
  }, []);

  /** Toggle recording on/off */
  const toggleRecording = useCallback(() => {
    if (state === "recording") {
      stopRecording();
    } else if (state === "idle") {
      startRecording();
    }
    // Ignore if transcribing
  }, [state, startRecording, stopRecording]);

  return {
    isRecording: state === "recording",
    isTranscribing: state === "transcribing",
    startRecording,
    stopRecording,
    toggleRecording,
    error,
  };
}
