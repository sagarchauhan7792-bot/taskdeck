// WhatsApp (official Cloud API): send or forward a message or voice note to
// your own bot number and it becomes a task. Only the linked owner can use it.
import { env } from "cloudflare:workers";
import { capture } from "./capture";
import {
  ACTION_LABEL,
  captureReply,
  helpText,
  hmacSha256Hex,
  parseWordCommand,
  randomCode,
  runAction,
  runCommand,
  sameText,
  sha256Hex,
} from "./commands";
import { firstDelivery, getSetting, setSetting } from "./settings";
import { transcribe } from "./transcribe";

const VERSION = "v27.0";
const OWNER_KEY = "whatsapp.owner";
const TARGET_KEY = "whatsapp.owner_target";
const LINK_KEY = "whatsapp.link_code";
const NUMBER_KEY = "whatsapp.number";

// ── Cloud API types (only the fields used here) ─────────────────────────────

type Media = { id: string; mime_type?: string; voice?: boolean; caption?: string };
export type WhatsAppMessage = {
  from?: string;
  from_user_id?: string;
  id: string;
  type: string;
  text?: { body: string };
  audio?: Media;
  image?: Media;
  video?: Media;
  document?: Media;
  context?: { forwarded?: boolean; frequently_forwarded?: boolean; id?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string } };
};
type Contact = { wa_id?: string; user_id?: string; profile?: { name?: string } };
export type ChangeValue = { metadata?: { phone_number_id?: string }; contacts?: Contact[]; messages?: WhatsAppMessage[] };
export type WebhookBody = { object?: string; entry?: { changes?: { field?: string; value?: ChangeValue }[] }[] };
type Target = { to?: string; recipient?: string };

// ── API ──────────────────────────────────────────────────────────────────────

const graph = () => `${env.WHATSAPP_API_BASE || "https://graph.facebook.com"}/${VERSION}`;

export function whatsappEnabled(): boolean {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_APP_SECRET);
}

async function graphCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${graph()}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok || !body) throw new Error(`WhatsApp ${path} failed: ${body?.error?.message ?? response.status}`);
  return body;
}

async function sendMessage(target: Target, payload: Record<string, unknown>, replyTo?: string) {
  try {
    await graphCall(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...target,
        ...(replyTo ? { context: { message_id: replyTo } } : {}),
        ...payload,
      }),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
}

const sendText = (target: Target, text: string, replyTo?: string) =>
  sendMessage(target, { type: "text", text: { body: text.slice(0, 4000) } }, replyTo);

function sendButtons(target: Target, text: string, buttons: { id: string; title: string }[], replyTo?: string) {
  return sendMessage(
    target,
    {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: text.slice(0, 1024) },
        action: { buttons: buttons.slice(0, 3).map((reply) => ({ type: "reply", reply: { id: reply.id, title: reply.title.slice(0, 20) } })) },
      },
    },
    replyTo,
  );
}

/** Token you paste into Meta's webhook settings, derived from the app secret. */
export async function verifyToken(): Promise<string> {
  return (await sha256Hex(`taskdeck-wa-verify:${env.WHATSAPP_APP_SECRET}`)).slice(0, 32);
}

/** Checks Meta's X-Hub-Signature-256 header against the raw request body. */
export async function validSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!env.WHATSAPP_APP_SECRET || !header?.startsWith("sha256=")) return false;
  return sameText(header.slice(7), await hmacSha256Hex(env.WHATSAPP_APP_SECRET, rawBody));
}

async function readAudio(media: Media) {
  const info = await graphCall<{ url: string; mime_type?: string }>(
    `${encodeURIComponent(media.id)}?phone_number_id=${env.WHATSAPP_PHONE_NUMBER_ID}`,
  );
  const response = await fetch(info.url, {
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`WhatsApp media download failed: ${response.status}`);
  const audio = await response.arrayBuffer();
  const mime = (media.mime_type ?? info.mime_type ?? "audio/ogg").split(";")[0].trim();
  const extension = mime.includes("mpeg") ? "mp3" : mime.includes("mp4") || mime.includes("aac") ? "m4a" : "ogg";
  const audioKey = `audio/whatsapp/${media.id.replace(/[^\w-]/g, "")}.${extension}`;
  if (env.BUCKET) await env.BUCKET.put(audioKey, audio, { httpMetadata: { contentType: mime } });
  const transcript = await transcribe(audio, `voice.${extension}`, mime);
  return { audioKey: env.BUCKET ? audioKey : null, transcript };
}

// ── Message handling ─────────────────────────────────────────────────────────

export async function handleMessage(value: ChangeValue, message: WhatsAppMessage) {
  // Only messages to our own number.
  if (value.metadata?.phone_number_id && value.metadata.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID) return;
  if (!(await firstDelivery(`whatsapp:${message.id}`))) return;

  const sender = message.from_user_id ?? message.from;
  if (!sender) return;
  const target: Target = message.from ? { to: message.from } : { recipient: message.from_user_id };
  const owner = await getSetting(OWNER_KEY);
  const typed = (message.text?.body ?? message.image?.caption ?? message.video?.caption ?? message.document?.caption ?? "").trim();

  const start = typed.match(/^\/?start\s+([a-f0-9]{8,64})$/i);
  if (start) {
    if (owner === sender) return sendText(target, helpText(""));
    const code = await getSetting(LINK_KEY);
    if (code && sameText(start[1].toLowerCase(), code)) {
      await setSetting(OWNER_KEY, sender);
      await setSetting(TARGET_KEY, JSON.stringify(target));
      await setSetting(LINK_KEY, null);
      const name = value.contacts?.[0]?.profile?.name?.split(" ")[0];
      return sendText(target, `Connected${name ? `, ${name}` : ""}! 🎉\n\n${helpText("")}`);
    }
    return sendText(target, "This is a private task bot. To connect it, open Taskdeck → Setup → Connect WhatsApp.");
  }
  // Everyone else is ignored quietly; replies to strangers would cost money and help no one.
  if (owner !== sender) return;

  if (message.type === "interactive" && message.interactive?.button_reply) {
    const [action, rawId] = message.interactive.button_reply.id.split(":");
    const note = await runAction(action, Number(rawId));
    return sendText(target, note ?? "That task no longer exists.", message.id);
  }

  const command = typed ? parseWordCommand(typed) : null;
  if (command) return sendText(target, (await runCommand(command.name, command.arg, "")) ?? helpText(""), message.id);

  const voice = message.type === "audio" ? message.audio : undefined;
  if (!voice && !typed) {
    return sendText(target, "Send text or a voice note and I'll turn it into a task.", message.id);
  }
  let text = typed || null;
  let audioKey: string | null = null;
  if (voice) {
    const heard = await readAudio(voice);
    audioKey = heard.audioKey;
    text = heard.transcript?.text ?? null;
  }
  const forwarded = message.context?.forwarded || message.context?.frequently_forwarded;
  const result = await capture({
    source: "whatsapp",
    kind: voice ? "voice" : "text",
    text,
    chat: forwarded ? "Forwarded message" : null,
    audioKey,
    explicit: true,
  });
  if (!result) return;
  const reply = await captureReply(result);
  await sendButtons(
    target,
    reply.text,
    reply.actions.map((action) => ({ id: `${action}:${result.task.id}`, title: ACTION_LABEL[action] })),
    message.id,
  );
}

export function messagesIn(body: WebhookBody): { value: ChangeValue; message: WhatsAppMessage }[] {
  if (body.object !== "whatsapp_business_account") return [];
  return (body.entry ?? []).flatMap((entry) =>
    (entry.changes ?? [])
      .filter((change) => change.field === "messages" && change.value?.messages)
      .flatMap((change) => change.value!.messages!.map((message) => ({ value: change.value!, message }))),
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

export async function connect() {
  const phone = await graphCall<{ display_phone_number?: string }>(
    `${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number`,
  );
  const digits = (phone.display_phone_number ?? "").replace(/\D/g, "");
  const code = randomCode(6);
  await setSetting(NUMBER_KEY, digits || null);
  await setSetting(LINK_KEY, code);
  return { number: digits, link: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(`start ${code}`)}` : null, code };
}

export async function disconnect() {
  await setSetting(OWNER_KEY, null);
  await setSetting(TARGET_KEY, null);
  await setSetting(LINK_KEY, null);
}

export async function status(origin: string) {
  const configured = whatsappEnabled();
  const [owner, number, code] = await Promise.all([getSetting(OWNER_KEY), getSetting(NUMBER_KEY), getSetting(LINK_KEY)]);
  return {
    configured,
    connected: Boolean(owner),
    number,
    code: !owner ? code : null,
    link: !owner && number && code ? `https://wa.me/${number}?text=${encodeURIComponent(`start ${code}`)}` : null,
    // Pasted into Meta's App Dashboard → WhatsApp → Configuration.
    webhookUrl: `${origin}/hooks/whatsapp`,
    verifyToken: configured ? await verifyToken() : null,
  };
}
