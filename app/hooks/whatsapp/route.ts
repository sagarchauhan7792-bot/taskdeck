import { waitUntil } from "cloudflare:workers";
import { sameText } from "@/lib/channels/commands";
import { handleMessage, messagesIn, validSignature, verifyToken, whatsappEnabled, type WebhookBody } from "@/lib/channels/whatsapp";

const notConfigured = () => Response.json({ error: "WhatsApp is not configured." }, { status: 404 });

// Meta calls this once when the webhook is set up in the App Dashboard.
export async function GET(request: Request) {
  if (!whatsappEnabled()) return notConfigured();
  const params = new URL(request.url).searchParams;
  const supplied = params.get("hub.verify_token") ?? "";
  if (params.get("hub.mode") !== "subscribe" || !sameText(supplied, await verifyToken())) {
    return new Response("Verification failed.", { status: 403 });
  }
  return new Response(params.get("hub.challenge") ?? "", { headers: { "content-type": "text/plain" } });
}

// Every incoming WhatsApp message. Answer at once; the work continues in the background.
export async function POST(request: Request) {
  if (!whatsappEnabled()) return notConfigured();
  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get("x-hub-signature-256")))) {
    return Response.json({ error: "Not authorized." }, { status: 401 });
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }
  for (const { value, message } of messagesIn(body)) {
    waitUntil(
      handleMessage(value, message).catch((error) =>
        console.error("WhatsApp message failed", error instanceof Error ? error.stack : error),
      ),
    );
  }
  return Response.json({ ok: true });
}
