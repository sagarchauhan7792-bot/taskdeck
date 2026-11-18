import { handleUpdate, telegramEnabled, webhookSecret, type Update } from "@/lib/channels/telegram";

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Telegram calls this for every message the bot receives.
export async function POST(request: Request) {
  if (!telegramEnabled()) return Response.json({ error: "Telegram is not configured." }, { status: 404 });
  const supplied = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!sameSecret(supplied, await webhookSecret())) return Response.json({ error: "Not authorized." }, { status: 401 });

  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return Response.json({ error: "Invalid update." }, { status: 400 });
  }
  try {
    await handleUpdate(update);
  } catch (error) {
    // Answer 200 anyway: Telegram would otherwise resend the same update forever.
    console.error("Telegram update failed", error instanceof Error ? error.stack : error);
  }
  return Response.json({ ok: true });
}
