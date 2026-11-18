import { waitUntil } from "cloudflare:workers";
import { handleEvent, slackEnabled, validSignature, type SlackBody } from "@/lib/channels/slack";

// Slack Events API. Slack wants an answer within 3 seconds, so the work continues in the background.
export async function POST(request: Request) {
  if (!slackEnabled()) return Response.json({ error: "Slack is not configured." }, { status: 404 });
  const raw = await request.text();
  const signed = await validSignature(
    raw,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
  );
  if (!signed) return Response.json({ error: "Not authorized." }, { status: 401 });
  let body: SlackBody;
  try {
    body = JSON.parse(raw) as SlackBody;
  } catch {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }
  if (body.type === "url_verification") return Response.json({ challenge: body.challenge });
  if (body.type === "event_callback") {
    waitUntil(handleEvent(body).catch((error) => console.error("Slack event failed", error instanceof Error ? error.stack : error)));
  }
  return Response.json({ ok: true });
}
