// One path from "a message arrived on some channel" to "a task exists".
// Telegram uses it today; Slack and WhatsApp will call it the same way.
import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { people, projects, type tasks } from "@/db/schema";
import { createTask } from "@/lib/todo-server";
import { extractTask, type Extracted } from "./extract";
import { ownerToday } from "./settings";

/** Below this, an AI-read task waits in the Review Inbox instead of going straight onto the boards. */
const CONFIDENT = 0.6;

export type Incoming = {
  source: "telegram" | "whatsapp" | "slack";
  kind: "text" | "voice";
  /** Message text, or the voice note's transcript. Null when a voice note could not be transcribed. */
  text: string | null;
  author?: string | null;
  chat?: string | null;
  url?: string | null;
  audioKey?: string | null;
  /** Voice note length in seconds, used to title untranscribed notes. */
  durationSeconds?: number | null;
  /**
   * True when the owner deliberately sent this for capture (forwarded it to the bot,
   * used /todo). Auto-detected messages always go to the Review Inbox.
   */
  explicit: boolean;
  /** Auto-capture only: drop messages that don't read as a task instead of filing them for review. */
  skipNonTasks?: boolean;
};

export type Captured = { task: typeof tasks.$inferSelect; extracted: Extracted | null; reviewing: boolean };

function duration(seconds: number | null | undefined) {
  if (!seconds) return "";
  return ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`;
}

export async function capture(message: Incoming): Promise<Captured | null> {
  const base = {
    source: message.source,
    sourceKind: message.kind,
    sourceText: message.text?.slice(0, 10000) ?? null,
    sourceChat: message.chat?.slice(0, 200) ?? null,
    sourceUrl: message.url ?? null,
    audioKey: message.audioKey ?? null,
  };

  if (!message.text?.trim()) {
    if (message.skipNonTasks) return null;
    const task = await createTask({
      ...base,
      title: `Voice note${duration(message.durationSeconds)}${message.author ? ` from ${message.author}` : ""}`,
      notes: "Could not turn this voice note into text. Play it from the task to fill in the details.",
      status: "inbox",
    });
    return { task, extracted: null, reviewing: true };
  }

  const db = getDb();
  const [peopleRows, projectRows] = await Promise.all([
    db.select({ name: people.name }).from(people).orderBy(asc(people.name)),
    db.select({ name: projects.name }).from(projects).orderBy(asc(projects.name)),
  ]);
  const extracted = await extractTask({
    text: message.text,
    author: message.author,
    chat: message.chat,
    peopleNames: peopleRows.map((row) => row.name),
    projectNames: projectRows.map((row) => row.name),
    today: ownerToday(),
  });

  if (message.skipNonTasks && !extracted.isTask) return null;
  const unsure = extracted.confidence !== null && extracted.confidence < CONFIDENT;
  const reviewing = !message.explicit || !extracted.isTask || unsure;
  const task = await createTask({
    ...base,
    title: extracted.title,
    status: reviewing ? "inbox" : "open",
    priority: extracted.priority,
    dueDate: extracted.dueDate,
    assigneeName: extracted.assigneeName ?? undefined,
    // Only file under projects that already exist; a misread should not create new ones.
    projectName: projectRows.find((row) => row.name.toLowerCase() === extracted.projectName?.toLowerCase())?.name,
    confidence: extracted.confidence,
  });
  return { task, extracted, reviewing };
}
