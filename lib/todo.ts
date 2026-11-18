// Shared between the server and the browser: names, types, dates and the
// quick-add parser. Keep this file free of server-only imports.

export const APP_NAME = "Taskdeck";

export const STATUSES = ["inbox", "open", "in_progress", "waiting", "done"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const SOURCES = ["manual", "whatsapp", "telegram", "slack"] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Source = (typeof SOURCES)[number];

export type Task = {
  id: number;
  title: string;
  notes: string;
  status: Status;
  priority: Priority;
  assigneeId: number | null;
  projectId: number | null;
  dueDate: string | null;
  source: Source;
  sourceKind: "text" | "voice";
  sourceText: string | null;
  sourceChat: string | null;
  sourceUrl: string | null;
  audioKey: string | null;
  confidence: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type Person = {
  id: number;
  name: string;
  whatsapp: string | null;
  telegram: string | null;
  slack: string | null;
  createdAt: number;
};

export type Project = { id: number; name: string; createdAt: number };

export type AppState = { tasks: Task[]; people: Person[]; projects: Project[] };

export const STATUS_LABEL: Record<Status, string> = {
  inbox: "Inbox",
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const SOURCE_LABEL: Record<Source, string> = {
  manual: "Manual",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  slack: "Slack",
};

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

// ── Dates (date-only, in the viewer's local time zone) ───────────────────────

export function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromDateString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function isOverdue(task: Pick<Task, "dueDate" | "status">, today: string): boolean {
  return task.status !== "done" && task.dueDate !== null && task.dueDate < today;
}

// ── Quick add ────────────────────────────────────────────────────────────────
// "@Rahul GST report #Finance !high friday" becomes a title plus fields.

export type QuickAdd = {
  title: string;
  assigneeName?: string;
  projectName?: string;
  priority?: Priority;
  dueDate?: string;
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dateFromWord(word: string, now: Date): string | undefined {
  const w = word.toLowerCase();
  if (w === "today" || w === "aaj") return toDateString(now);
  if (w === "tomorrow" || w === "tmrw" || w === "kal") return toDateString(addDays(now, 1));
  if (w === "parso") return toDateString(addDays(now, 2));
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const parsed = fromDateString(w);
    return toDateString(parsed) === w ? w : undefined;
  }
  const weekday = WEEKDAYS.findIndex(
    (name) => w === name || (w.startsWith(name) && w.endsWith("day")),
  );
  if (weekday === -1) return undefined;
  const ahead = (weekday - now.getDay() + 7) % 7 || 7;
  return toDateString(addDays(now, ahead));
}

export function parseQuickAdd(input: string, now = new Date()): QuickAdd {
  const result: QuickAdd = { title: "" };
  const kept: string[] = [];
  for (const word of input.trim().split(/\s+/)) {
    if (!word) continue;
    if (word.length > 1 && word.startsWith("@") && !result.assigneeName) {
      result.assigneeName = word.slice(1).replace(/_/g, " ");
      continue;
    }
    if (word.length > 1 && word.startsWith("#") && !result.projectName) {
      result.projectName = word.slice(1).replace(/_/g, " ");
      continue;
    }
    if (word.startsWith("!")) {
      const priority = PRIORITIES.find((p) => p === word.slice(1).toLowerCase());
      if (priority) {
        result.priority = priority;
        continue;
      }
    }
    if (!result.dueDate) {
      const due = dateFromWord(word, now);
      if (due) {
        result.dueDate = due;
        continue;
      }
    }
    kept.push(word);
  }
  result.title = kept.join(" ");
  return result;
}
