// Voice note to text with Sarvam AI (good with Hindi and Hinglish).
// Sarvam's quick endpoint is meant for clips under about 30 seconds.
import { env } from "cloudflare:workers";

const SARVAM_URL = "https://api.sarvam.ai/speech-to-text";

export function transcriptionEnabled(): boolean {
  return Boolean(env.SARVAM_API_KEY);
}

export type Transcript = { text: string; language: string | null };

export async function transcribe(audio: ArrayBuffer, filename: string, mimeType: string): Promise<Transcript | null> {
  if (!env.SARVAM_API_KEY) return null;
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimeType }), filename);
  form.append("language_code", "unknown");
  try {
    const response = await fetch(SARVAM_URL, {
      method: "POST",
      headers: { "api-subscription-key": env.SARVAM_API_KEY },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error("Transcription failed", response.status, (await response.text()).slice(0, 300));
      return null;
    }
    const body = (await response.json()) as { transcript?: string; language_code?: string | null };
    const text = body.transcript?.trim();
    return text ? { text, language: body.language_code ?? null } : null;
  } catch (error) {
    console.error("Transcription failed", error instanceof Error ? error.message : error);
    return null;
  }
}
