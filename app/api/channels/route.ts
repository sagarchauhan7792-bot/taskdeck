import { aiEnabled } from "@/lib/channels/extract";
import { status as slackStatus } from "@/lib/channels/slack";
import { status as telegramStatus } from "@/lib/channels/telegram";
import { transcriptionEnabled } from "@/lib/channels/transcribe";
import { status as whatsappStatus } from "@/lib/channels/whatsapp";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const [telegram, whatsapp, slack] = await Promise.all([telegramStatus(), whatsappStatus(origin), slackStatus(origin)]);
  return Response.json({ telegram, whatsapp, slack, ai: aiEnabled(), transcription: transcriptionEnabled() });
}
