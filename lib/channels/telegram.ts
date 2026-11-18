// Telegram bot: forward a message or voice note to the bot (or use /todo in a
// group) and it becomes a task. Only the linked owner can use it.
import { env } from "cloudflare:workers";
import { capture } from "./capture";
import { ACTION_LABEL, captureReply, helpText, randomCode, runAction, runCommand, sha256Hex } from "./commands";
import { firstDelivery, getSetting, setSetting } from "./settings";
import { transcribe } from "./transcribe";

export const OWNER_KEY = "telegram.owner";
export const LINK_KEY = "telegram.link_code";
export const USERNAME_KEY = "telegram.username";

// ── Telegram types (only the fields used here) ──────────────────────────────

type User = { id: number; is_bot?: boolean; first_name: string; last_name?: string; username?: string };
type Chat = { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string };
type Voice = { file_id: string; file_unique_id: string; duration: number; mime_type?: string; file_size?: number };
type ForwardOrigin =
  | { type: "user"; sender_user: User }
  | { type: "hidden_user"; sender_user_name: string }
  | { type: "chat"; sender_chat: Chat }
  | { type: "channel"; chat: Chat };
type Message = {
  message_id: number;
  from?: User;
  chat: Chat;
  text?: string;
  caption?: string;
  voice?: Voice;
  audio?: Voice;
  forward_origin?: ForwardOrigin;
  reply_to_message?: Message;
};
type CallbackQuery = { id: string; from: User; message?: Message; data?: string };
export type Update = { update_id: number; message?: Message; callback_query?: CallbackQuery };

// ── Bot API ──────────────────────────────────────────────────────────────────

const apiBase = () => env.TELEGRAM_API_BASE || "https://api.telegram.org";

export function telegramEnabled(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

export async function botApi<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${apiBase()}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
  if (!result?.ok) throw new Error(`Telegram ${method} failed: ${result?.description ?? response.status}`);
  return result.result as T;
}

/** Secret Telegram sends with every webhook call, derived from the bot token. */
export function webhookSecret(): Promise<string> {
  return sha256Hex(`taskdeck-webhook:${env.TELEGRAM_BOT_TOKEN}`);
}

async function send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  try {
    await botApi("sendMessage", { chat_id: chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true }, ...extra });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
}

const replyTo = (message: Message) => ({ reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } });

// ── Helpers ──────────────────────────────────────────────────────────────────

const fullName = (user: User) => [user.first_name, user.last_name].filter(Boolean).join(" ");

function forwardedFrom(message: Message): string | null {
  const origin = message.forward_origin;
  if (!origin) return null;
  if (origin.type === "user") return fullName(origin.sender_user);
  if (origin.type === "hidden_user") return origin.sender_user_name;
  if (origin.type === "chat") return origin.sender_chat.title ?? null;
  return origin.chat.title ?? null;
}

/** Downloads a voice note, keeps a copy in storage and transcribes it. */
async function readVoice(voice: Voice) {
  const file = await botApi<{ file_path?: string }>("getFile", { file_id: voice.file_id });
  if (!file.file_path) return { audioKey: null, transcript: null };
  const response = await fetch(`${apiBase()}/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Voice download failed: ${response.status}`);
  const audio = await response.arrayBuffer();
  const mime = voice.mime_type ?? "audio/ogg";
  const extension = file.file_path.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "ogg";
  const safeId = voice.file_unique_id.replace(/[^\w-]/g, "");
  const audioKey = `audio/telegram/${safeId}.${extension}`;
  if (env.BUCKET) await env.BUCKET.put(audioKey, audio, { httpMetadata: { contentType: mime } });
  const transcript = await transcribe(audio, `voice.${extension}`, mime);
  return { audioKey: env.BUCKET ? audioKey : null, transcript };
}

async function captureMessage(chatId: number, source: Message, reply: Message, ownerId: number) {
  const voice = source.voice ?? source.audio;
  const typed = (source.text ?? source.caption ?? "").trim();
  const forwarded = forwardedFrom(source);
  const author = forwarded ?? (source.from && source.from.id !== ownerId ? fullName(source.from) : null);
  // The source (Telegram) is stored separately, so this is just where it came from.
  const chat =
    source.chat.type === "private"
      ? forwarded
        ? `Forwarded from ${forwarded}`
        : null
      : (source.chat.title ?? "Group chat");

  if (!voice && !typed) {
    await send(chatId, "Send text or a voice note and I'll turn it into a task.", replyTo(reply));
    return;
  }
  let text = typed || null;
  let audioKey: string | null = null;
  if (voice) {
    const heard = await readVoice(voice);
    audioKey = heard.audioKey;
    text = [heard.transcript?.text, typed].filter(Boolean).join("\n") || null;
  }
  const result = await capture({
    source: "telegram",
    kind: voice ? "voice" : "text",
    text,
    author,
    chat,
    audioKey,
    durationSeconds: voice?.duration ?? null,
    explicit: true,
  });
  if (!result) return;
  const { text: confirmation, actions } = await captureReply(result);
  await send(chatId, confirmation, {
    ...replyTo(reply),
    reply_markup: {
      inline_keyboard: [actions.map((action) => ({ text: ACTION_LABEL[action], callback_data: `${action}:${result.task.id}` }))],
    },
  });
}

// ── Update handling ──────────────────────────────────────────────────────────

async function handleCallback(query: CallbackQuery, ownerId: number | null) {
  const answer = (text: string) => botApi("answerCallbackQuery", { callback_query_id: query.id, text }).catch(() => {});
  if (query.from.id !== ownerId) return answer("Only the owner can do that.");
  const [action, rawId] = (query.data ?? "").split(":");
  const note = await runAction(action, Number(rawId));
  if (!note) return answer("That task no longer exists.");
  await answer(note);
  if (query.message) {
    await botApi("editMessageText", {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text: `${query.message.text ?? ""}\n\n${note}`.trim().slice(0, 4000),
    }).catch(() => {});
  }
}

export async function handleUpdate(update: Update) {
  if (!(await firstDelivery(`telegram:${update.update_id}`))) return;
  const owner = await getSetting(OWNER_KEY);
  const ownerId = owner ? Number(owner) : null;

  if (update.callback_query) return handleCallback(update.callback_query, ownerId);
  const message = update.message;
  if (!message?.from || message.from.is_bot) return;

  const chatId = message.chat.id;
  const isPrivate = message.chat.type === "private";
  const text = (message.text ?? message.caption ?? "").trim();
  const command = text.match(/^\/([a-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i);
  const botName = (await getSetting(USERNAME_KEY))?.toLowerCase();
  // In groups, ignore commands meant for other bots.
  if (command?.[2] && botName && command[2].toLowerCase() !== botName) return;
  const name = command?.[1].toLowerCase();
  const arg = command?.[3]?.trim() ?? "";

  if (name === "start" && isPrivate) {
    if (ownerId === message.from.id) return send(chatId, helpText("/"));
    const code = await getSetting(LINK_KEY);
    if (code && arg === code) {
      await setSetting(OWNER_KEY, String(message.from.id));
      await setSetting(LINK_KEY, null);
      return send(chatId, `Connected, ${message.from.first_name}! 🎉\n\n${helpText("/")}\n/todo text – add a task (in groups, reply to a message with /todo)`);
    }
    return send(chatId, "This is a private task bot. To connect it, open Taskdeck → Setup → Connect Telegram.");
  }

  if (ownerId !== message.from.id) {
    if (isPrivate) await send(chatId, "This is a private task bot.");
    return;
  }

  if (!isPrivate) {
    // In groups, only /todo is captured: "/todo text", or a reply to someone's message.
    if (name !== "todo") return;
    if (arg) return captureMessage(chatId, { ...message, text: arg, caption: undefined }, message, ownerId);
    if (message.reply_to_message) return captureMessage(chatId, message.reply_to_message, message, ownerId);
    return send(chatId, "Reply to a message with /todo, or write /todo followed by the task.", replyTo(message));
  }

  if (name === undefined) return captureMessage(chatId, message, message, ownerId);
  if (name === "todo") {
    return arg
      ? captureMessage(chatId, { ...message, text: arg, caption: undefined }, message, ownerId)
      : send(chatId, "Write the task after /todo, for example: /todo @Rahul GST report kal");
  }
  return send(chatId, (await runCommand(name, arg, "/")) ?? helpText("/"));
}

/** Points Telegram at this app and returns a one-time link that connects the owner's account. */
export async function connect(origin: string) {
  const me = await botApi<{ username: string }>("getMe");
  await botApi("setWebhook", {
    url: `${origin}/hooks/telegram`,
    secret_token: await webhookSecret(),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await botApi("setMyCommands", {
    commands: [
      { command: "today", description: "Overdue and due today" },
      { command: "pending", description: "Open tasks by person" },
      { command: "inbox", description: "Tasks waiting for review" },
      { command: "done", description: "Mark a task done, e.g. /done 12" },
      { command: "todo", description: "Add a task" },
    ],
  });
  const code = randomCode();
  await setSetting(USERNAME_KEY, me.username);
  await setSetting(LINK_KEY, code);
  return { username: me.username, link: `https://t.me/${me.username}?start=${code}` };
}

export async function disconnect() {
  if (telegramEnabled()) await botApi("deleteWebhook").catch(() => {});
  await setSetting(OWNER_KEY, null);
  await setSetting(LINK_KEY, null);
}

export async function status() {
  const [owner, username, code] = await Promise.all([getSetting(OWNER_KEY), getSetting(USERNAME_KEY), getSetting(LINK_KEY)]);
  return {
    tokenSet: telegramEnabled(),
    connected: Boolean(owner),
    username,
    link: !owner && username && code ? `https://t.me/${username}?start=${code}` : null,
  };
}
