/*
 * Voice notes in a request, as text.
 *
 * A client can record a voice note in the preview feedback widget. The note is
 * attached to the ticket as audio, and also run through Workers AI's Whisper so
 * the thread — and every agent that works the ticket — can read it. When the
 * model is unavailable the audio is still attached; nothing here fails the
 * request.
 */
import type { Env } from './shared.ts';

/** Longer notes are attached but not transcribed: the model call would be enormous. */
const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 4000;
const TIMEOUT_MS = 25_000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function isAudioType(type: string): boolean {
  return type.startsWith('audio/');
}

/**
 * The spoken words in an audio file, or null. Null is the normal answer when
 * the AI binding is absent, the model errors, or it takes too long.
 */
export async function transcribe(env: Env, data: ArrayBuffer, type: string): Promise<string | null> {
  if (!env.AI || !isAudioType(type) || data.byteLength === 0 || data.byteLength > MAX_TRANSCRIBE_BYTES) return null;
  try {
    const audio = toBase64(new Uint8Array(data));
    const result = await Promise.race([
      env.AI.run('@cf/openai/whisper' as never, { audio } as never) as Promise<{ text?: unknown }>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    const text = result && typeof (result as { text?: unknown }).text === 'string' ? ((result as { text: string }).text.trim()) : '';
    return text ? text.slice(0, MAX_TRANSCRIPT_CHARS) : null;
  } catch {
    return null;
  }
}
