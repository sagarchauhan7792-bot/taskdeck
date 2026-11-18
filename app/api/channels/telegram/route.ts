import { env } from "cloudflare:workers";
import { connect, disconnect, telegramEnabled } from "@/lib/channels/telegram";

export async function POST(request: Request) {
  if (!telegramEnabled()) {
    return Response.json({ error: "Add TELEGRAM_BOT_TOKEN to the app's secrets first." }, { status: 400 });
  }
  const origin = new URL(request.url).origin;
  // Telegram only delivers to public https addresses (a fake local server is allowed for testing).
  if (!origin.startsWith("https://") && !env.TELEGRAM_API_BASE) {
    return Response.json(
      { error: "Telegram can only reach a public https address. Connect it from the deployed app, not from this computer." },
      { status: 400 },
    );
  }
  try {
    return Response.json(await connect(origin));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach Telegram.";
    return Response.json({ error: message.replace(/bot\d+:[\w-]+/g, "bot…") }, { status: 502 });
  }
}

export async function DELETE() {
  await disconnect();
  return Response.json({ disconnected: true });
}
