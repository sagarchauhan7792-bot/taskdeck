// Slack: react to any message with 📌 or 📝 to capture it, or DM the Taskdeck
// app. With a user token, messages where the owner @mentions someone are also
// picked up automatically and wait in the Review Inbox.
import { env } from "cloudflare:workers";
import { capture } from "./capture";
import { captureReply, helpText, hmacSha256Hex, parseWordCommand, randomCode, runCommand, sameText } from "./commands";
import { firstDelivery, getSetting, setSetting } from "./settings";

const OWNER_KEY = "slack.owner";
const DM_KEY = "slack.app_dm";
const LINK_KEY = "slack.link_code";
/** Reactions that mean "make this a task". */
export const TRIGGER_REACTIONS = new Set(["pushpin", "round_pushpin", "memo"]);

// ── Slack types (only the fields used here) ─────────────────────────────────

type MessageEvent = {
  type: "message";
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  channel: string;
  channel_type?: string;
};
type ReactionEvent = {
  type: "reaction_added";
  user: string;
  reaction: string;
  item_user?: string;
  item: { type: string; channel: string; ts: string };
};
export type SlackBody =
  | { type: "url_verification"; challenge: string }
  | { type: "event_callback"; event_id: string; event: MessageEvent | ReactionEvent | { type: string } };

// ── API ──────────────────────────────────────────────────────────────────────

const apiBase = () => env.SLACK_API_BASE || "https://slack.com";

export function slackEnabled(): boolean {
  return Boolean(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET);
}

async function slackApi<T = Record<string, unknown>>(
  method: string,
  params: Record<string, string>,
  token = env.SLACK_BOT_TOKEN,
): Promise<T> {
  const response = await fetch(`${apiBase()}/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!body?.ok) throw new Error(`Slack ${method} failed: ${body?.error ?? response.status}`);
  return body;
}

/** Checks Slack's request signature (v0, HMAC-SHA256, 5-minute window). */
export async function validSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  if (!env.SLACK_SIGNING_SECRET || !timestamp || !signature?.startsWith("v0=")) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${await hmacSha256Hex(env.SLACK_SIGNING_SECRET, `v0:${timestamp}:${rawBody}`)}`;
  return sameText(signature, expected);
}

async function postToOwner(text: string) {
  const channel = (await getSetting(DM_KEY)) ?? (await getSetting(OWNER_KEY));
  if (!channel) return;
  await slackApi("chat.postMessage", { channel, text: text.slice(0, 3900) }).catch((error) =>
    console.error(error instanceof Error ? error.message : error),
  );
}

/** Turns Slack markup into plain text: <@U1> → @Name, <url|label> → label, entities decoded. */
async function plainText(text: string, names: Map<string, string>) {
  const ids = [...new Set([...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1]))];
  await Promise.all(ids.map(async (id) => names.set(id, (await userName(id, names)) ?? id)));
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${names.get(id) ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

async function userName(id: string, cache: Map<string, string>): Promise<string | null> {
  if (cache.has(id)) return cache.get(id)!;
  try {
    const { user } = await slackApi<{ user: { real_name?: string; profile?: { display_name?: string; real_name?: string } } }>(
      "users.info",
      { user: id },
    );
    const name = user.profile?.display_name || user.real_name || user.profile?.real_name || null;
    if (name) cache.set(id, name);
    return name;
  } catch {
    return null;
  }
}

async function confirm(result: Awaited<ReturnType<typeof capture>>) {
  if (!result) return;
  const reply = await captureReply(result);
  const hint = reply.actions[0] === "done" ? `Reply "done ${result.task.id}" or "undo ${result.task.id}".` : "Approve or discard it in Taskdeck.";
  await postToOwner(`${reply.text}\n${hint}`);
}

// ── Event handling ───────────────────────────────────────────────────────────

async function handleReaction(event: ReactionEvent, owner: string) {
  if (event.user !== owner || event.item.type !== "message" || !TRIGGER_REACTIONS.has(event.reaction)) return;
  // The user token can read wherever the owner can; the bot token only where the app was added.
  const token = env.SLACK_USER_TOKEN || env.SLACK_BOT_TOKEN;
  const { messages } = await slackApi<{ messages: MessageEvent[] }>(
    "conversations.replies",
    { channel: event.item.channel, ts: event.item.ts, limit: "1", inclusive: "true" },
    token,
  );
  const message = messages.find((entry) => entry.ts === event.item.ts) ?? messages[0];
  if (!message?.text) return;
  const names = new Map<string, string>();
  const [text, author, link] = await Promise.all([
    plainText(message.text, names),
    message.user && message.user !== owner ? userName(message.user, names) : Promise.resolve(null),
    slackApi<{ permalink: string }>("chat.getPermalink", { channel: event.item.channel, message_ts: event.item.ts })
      .then((body) => body.permalink)
      .catch(() => null),
  ]);
  await confirm(
    await capture({ source: "slack", kind: "text", text, author, chat: "Slack message", url: link, explicit: true }),
  );
}

async function handleMessage(event: MessageEvent, owner: string | null) {
  if (event.subtype || event.bot_id || !event.user || !event.text) return;
  const text = event.text.trim();
  const appDm = await getSetting(DM_KEY);

  const start = event.channel_type === "im" ? text.match(/^start\s+([a-f0-9]{8,64})$/i) : null;
  if (start) {
    const code = await getSetting(LINK_KEY);
    if (code && sameText(start[1].toLowerCase(), code)) {
      await setSetting(OWNER_KEY, event.user);
      await setSetting(DM_KEY, event.channel);
      await setSetting(LINK_KEY, null);
      await slackApi("chat.postMessage", { channel: event.channel, text: `Connected! 🎉\n\n${helpText("")}` });
    }
    return;
  }
  if (!owner || event.user !== owner) return;

  if (event.channel === appDm) {
    const command = parseWordCommand(text);
    if (command) return postToOwner((await runCommand(command.name, command.arg, "")) ?? helpText(""));
    const names = new Map<string, string>();
    return confirm(await capture({ source: "slack", kind: "text", text: await plainText(text, names), explicit: true }));
  }

  // Automatic capture: the owner's own messages that @mention someone else.
  if (!env.SLACK_USER_TOKEN) return;
  const mentions = [...text.matchAll(/<@([UW][A-Z0-9]+)/g)].map((match) => match[1]).filter((id) => id !== owner);
  if (!mentions.length) return;
  const names = new Map<string, string>();
  const [plain, link] = await Promise.all([
    plainText(text, names),
    slackApi<{ permalink: string }>("chat.getPermalink", { channel: event.channel, message_ts: event.ts })
      .then((body) => body.permalink)
      .catch(() => null),
  ]);
  const result = await capture({
    source: "slack",
    kind: "text",
    text: plain,
    chat: "Slack message",
    url: link,
    explicit: false,
    skipNonTasks: true,
  });
  if (result) {
    await postToOwner(`👀 Spotted a task you handed out: #${result.task.id} ${result.task.title}\nIt's waiting in your Review Inbox.`);
  }
}

export async function handleEvent(body: Extract<SlackBody, { type: "event_callback" }>) {
  if (!(await firstDelivery(`slack:${body.event_id}`))) return;
  const owner = await getSetting(OWNER_KEY);
  const event = body.event;
  if (event.type === "reaction_added" && owner) return handleReaction(event as ReactionEvent, owner);
  if (event.type === "message") return handleMessage(event as MessageEvent, owner);
}

// ── Setup ────────────────────────────────────────────────────────────────────

export async function connect() {
  await slackApi("auth.test", {}); // fails early on a wrong bot token
  const code = randomCode(6);
  await setSetting(LINK_KEY, code);
  return { code };
}

export async function disconnect() {
  await setSetting(OWNER_KEY, null);
  await setSetting(DM_KEY, null);
  await setSetting(LINK_KEY, null);
}

export async function status(origin: string) {
  const [owner, code] = await Promise.all([getSetting(OWNER_KEY), getSetting(LINK_KEY)]);
  return {
    configured: slackEnabled(),
    connected: Boolean(owner),
    autoCapture: Boolean(env.SLACK_USER_TOKEN),
    code: !owner ? code : null,
    // Pasted into the Slack app's Event Subscriptions → Request URL.
    requestUrl: `${origin}/hooks/slack`,
  };
}
