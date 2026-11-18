// Chat commands and reply text shared by every channel (Telegram, WhatsApp, Slack).
import { format } from "date-fns";
import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { people, tasks } from "@/db/schema";
import { PRIORITY_LABEL, addDays, fromDateString, toDateString } from "@/lib/todo";
import { deleteTask, updateTask } from "@/lib/todo-server";
import type { Captured } from "./capture";
import { ownerToday } from "./settings";

type TaskRow = typeof tasks.$inferSelect;

export function randomCode(bytes = 12): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function dueText(dueDate: string | null, today: string): string | null {
  if (!dueDate) return null;
  if (dueDate === today) return "today";
  if (dueDate === toDateString(addDays(fromDateString(today), 1))) return "tomorrow";
  return format(fromDateString(dueDate), "EEE d MMM");
}

async function personName(id: number | null): Promise<string | null> {
  if (id === null) return null;
  const [row] = await getDb().select({ name: people.name }).from(people).where(eq(people.id, id)).limit(1);
  return row?.name ?? null;
}

/** "👤 Rahul · 📅 tomorrow · ⚑ Urgent" */
export async function describe(task: TaskRow): Promise<string> {
  const today = ownerToday();
  return [
    `👤 ${(await personName(task.assigneeId)) ?? "Unassigned"}`,
    task.dueDate ? `📅 ${dueText(task.dueDate, today)}` : null,
    task.priority !== "normal" ? `⚑ ${PRIORITY_LABEL[task.priority]}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The confirmation sent back after a capture, plus which buttons fit it. */
export async function captureReply(result: Captured): Promise<{ text: string; actions: ["done", "undo"] | ["approve", "discard"] }> {
  const { task, extracted, reviewing } = result;
  const heard = task.sourceKind === "voice" && task.sourceText ? `\n🎤 “${task.sourceText.slice(0, 300)}”` : "";
  if (!reviewing) {
    return { text: `✅ Added #${task.id}: ${task.title}\n${await describe(task)}${heard}`, actions: ["done", "undo"] };
  }
  const why = !extracted
    ? "I couldn't turn the voice note into text."
    : !extracted.isTask
      ? "This doesn't look like a task, so it's waiting for your review."
      : "I'm not fully sure about the details, so it's waiting for your review.";
  return {
    text: `📥 In your Review Inbox #${task.id}: ${task.title}\n${await describe(task)}${heard}\n${why}`,
    actions: ["approve", "discard"],
  };
}

export const ACTION_LABEL = { done: "✓ Done", undo: "↩ Undo", approve: "✓ Approve", discard: "✕ Discard" } as const;
export type Action = keyof typeof ACTION_LABEL;

/** Runs a button press. Returns the note to show, or null when the task is gone. */
export async function runAction(action: string, id: number): Promise<string | null> {
  const [task] = await getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return null;
  if (action === "done") {
    await updateTask(id, { status: "done" });
    return "✓ Marked done";
  }
  if (action === "approve") {
    await updateTask(id, { status: "open" });
    return "✓ Approved";
  }
  if (action === "undo" || action === "discard") {
    await deleteTask(id);
    return action === "undo" ? "↩ Removed" : "✕ Discarded";
  }
  return "Unknown action.";
}

// ── Commands ─────────────────────────────────────────────────────────────────

export function helpText(prefix: "/" | "") {
  return [
    "Send or forward me any message or voice note and I'll add it as a task.",
    "",
    `${prefix}today – overdue and due today`,
    `${prefix}pending – open tasks by person (${prefix}pending Rahul for one person)`,
    `${prefix}inbox – tasks waiting for your review`,
    `${prefix}done 12 – mark task #12 done`,
    `${prefix}undo 12 – delete task #12`,
  ].join("\n");
}

function line(task: TaskRow, names: Map<number, string>, today: string) {
  const who = task.assigneeId ? names.get(task.assigneeId) : null;
  const late =
    task.dueDate && task.dueDate < today
      ? ` (${Math.round((fromDateString(today).getTime() - fromDateString(task.dueDate).getTime()) / 86_400_000)}d late)`
      : "";
  return `#${task.id} ${task.title}${who ? ` → ${who}` : ""}${late}`;
}

async function peopleNames() {
  const rows = await getDb().select({ id: people.id, name: people.name }).from(people);
  return new Map(rows.map((row) => [row.id, row.name]));
}

const active = and(ne(tasks.status, "done"), ne(tasks.status, "inbox"));

async function todayCommand(): Promise<string> {
  const today = ownerToday();
  const [rows, names] = await Promise.all([
    getDb().select().from(tasks).where(and(active, lte(tasks.dueDate, today))).orderBy(asc(tasks.dueDate)),
    peopleNames(),
  ]);
  const overdue = rows.filter((task) => task.dueDate! < today);
  const due = rows.filter((task) => task.dueDate === today);
  if (!rows.length) return "Nothing overdue or due today. 🎉";
  return [
    overdue.length ? `🔴 Overdue (${overdue.length})\n${overdue.map((t) => line(t, names, today)).join("\n")}` : null,
    due.length ? `📅 Due today (${due.length})\n${due.map((t) => line(t, names, today)).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function pendingCommand(filter: string): Promise<string> {
  const today = ownerToday();
  const [rows, names] = await Promise.all([
    getDb().select().from(tasks).where(active).orderBy(sql`${tasks.dueDate} IS NULL`, asc(tasks.dueDate)),
    peopleNames(),
  ]);
  const wanted = filter.trim().toLowerCase();
  const groups = new Map<string, TaskRow[]>();
  for (const task of rows) {
    const who = task.assigneeId ? (names.get(task.assigneeId) ?? "Unassigned") : "Unassigned";
    if (wanted && !who.toLowerCase().startsWith(wanted)) continue;
    groups.set(who, [...(groups.get(who) ?? []), task]);
  }
  if (!groups.size) return wanted ? `No open tasks for "${filter.trim()}".` : "No open tasks.";
  return [...groups]
    .map(([who, list]) => `👤 ${who} (${list.length})\n${list.slice(0, 15).map((t) => line(t, new Map(), today)).join("\n")}`)
    .join("\n\n");
}

async function inboxCommand(): Promise<string> {
  const rows = await getDb().select().from(tasks).where(eq(tasks.status, "inbox")).orderBy(asc(tasks.createdAt)).limit(20);
  if (!rows.length) return "Review Inbox is empty.";
  return `📥 Waiting for review (${rows.length})\n${rows.map((t) => `#${t.id} ${t.title}`).join("\n")}\n\nApprove or discard them in Taskdeck.`;
}

async function bulkCommand(arg: string, action: "done" | "undo"): Promise<string> {
  const ids = [...arg.matchAll(/\d+/g)].map((match) => Number(match[0])).slice(0, 20);
  if (!ids.length) return `Which task? For example: ${action} 12`;
  const rows = await getDb().select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, ids));
  for (const row of rows) {
    if (action === "done") await updateTask(row.id, { status: "done" });
    else await deleteTask(row.id);
  }
  const missing = ids.filter((id) => !rows.some((row) => row.id === id));
  return [
    ...rows.map((row) => `${action === "done" ? "✓ Done" : "↩ Removed"} #${row.id}: ${row.title}`),
    ...missing.map((id) => `No task #${id}.`),
  ].join("\n");
}

/** Runs a chat command. Returns null when the word is not a command. */
export async function runCommand(name: string, arg: string, prefix: "/" | ""): Promise<string | null> {
  switch (name.toLowerCase()) {
    case "today":
    case "aaj":
      return todayCommand();
    case "pending":
      return pendingCommand(arg);
    case "inbox":
      return inboxCommand();
    case "done":
      return bulkCommand(arg, "done");
    case "undo":
      return bulkCommand(arg, "undo");
    case "help":
      return helpText(prefix);
    default:
      return null;
  }
}

/**
 * For channels without slash commands (WhatsApp, Slack DMs): a short message
 * that is exactly a command word ("today", "pending rahul", "done 12") is a command.
 */
export function parseWordCommand(text: string): { name: string; arg: string } | null {
  const match = text.trim().match(/^\/?(today|aaj|pending|inbox|done|undo|help)\b\s*(.{0,60})$/i);
  if (!match) return null;
  const [, name, arg] = match;
  // "done 12" needs a number; "done" alone or with words is probably a real message.
  if (/^(done|undo)$/i.test(name) && !/^\d[\d\s,#]*$/.test(arg.replace(/#/g, "").trim())) return null;
  if (/^(today|aaj|inbox|help)$/i.test(name) && arg.trim()) return null;
  return { name, arg };
}
