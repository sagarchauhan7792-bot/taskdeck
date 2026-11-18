// Turns a chat message into task fields. Uses Claude when ANTHROPIC_API_KEY is
// set, otherwise a simple rule-based reader, so capture works either way.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { PRIORITIES, type Priority, fromDateString, parseQuickAdd } from "@/lib/todo";

export const EXTRACT_MODEL = "claude-opus-5-5";

export type MessageContext = {
  text: string;
  /** Who wrote the message, when it is not the owner (e.g. a forwarded message). */
  author?: string | null;
  /** Group or chat title, when there is one. */
  chat?: string | null;
  peopleNames: string[];
  projectNames: string[];
  today: string;
};

export type Extracted = {
  isTask: boolean;
  title: string;
  assigneeName: string | null;
  projectName: string | null;
  dueDate: string | null;
  priority: Priority;
  confidence: number | null;
  method: "ai" | "rules";
};

const TaskFields = z.object({
  is_task: z.boolean(),
  title: z.string(),
  assignee: z.string().nullable(),
  project: z.string().nullable(),
  due_date: z.string().nullable(),
  priority: z.enum(PRIORITIES),
  confidence: z.number(),
});

const SYSTEM = `You read chat messages for a busy manager in India and turn the ones that hand out work into to-do items. Messages are in Hindi, English or Hinglish (Hindi in Latin script), sometimes transcribed from voice notes, so expect informal spelling.

The manager uses this to track tasks they give to other people. For each message, decide:
- is_task: true when someone is being asked to do something (or the manager notes something to get done). Greetings, thanks, status updates and questions with no action are not tasks.
- title: the work itself as a short imperative line, at most 12 words, in the message's own language and script. Drop greetings, names and dates that are captured in other fields. Example: "Rahul bhai kal tak GST report bhej dena" becomes "GST report bhejna".
- assignee: who should do the work. If it matches someone in the known people list, return that exact name. Otherwise return the name as written, or null when nobody is named. A forwarded message's author is usually the person talking, not the assignee, unless the author is clearly promising to do it themselves.
- project: an exact name from the known projects list when the message clearly belongs to it, else null.
- due_date: the deadline as YYYY-MM-DD, resolved against today's date (aaj = today, kal = tomorrow unless clearly past tense, parso = in two days, weekday names = the next such day). null when no deadline is given.
- priority: "urgent" for urgent/turant/asap/abhi, "high" for important/jaldi, "low" when explicitly not urgent, else "normal".
- confidence: 0 to 1, how sure you are that this is a task and the fields are right.`;

function clean(value: string | null | undefined, max = 80): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function validDate(value: string | null, today: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = fromDateString(value);
  if (Number.isNaN(parsed.getTime())) return null;
  // Ignore dates more than a year in the past; they are almost always misreads.
  return value >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}` ? value : null;
}

/** Rule-based reading: @person #project !priority and day words, plus known names. */
export function extractWithRules(context: MessageContext): Extracted {
  const parsed = parseQuickAdd(context.text, fromDateString(context.today));
  let assignee = parsed.assigneeName ?? null;
  if (!assignee) {
    const words = new Set(context.text.toLowerCase().split(/[^\p{L}\p{N}]+/u));
    assignee = context.peopleNames.find((name) => words.has(name.toLowerCase().split(/\s+/)[0])) ?? null;
  }
  if (!assignee && context.author) {
    // A team member's own message ("kar lunga") is usually their task.
    const author = context.author.toLowerCase().split(/\s+/)[0];
    assignee = context.peopleNames.find((name) => name.toLowerCase().split(/\s+/)[0] === author) ?? null;
  }
  // Keep the sentence whole (day words stay readable); drop only @/#/! quick-add tokens.
  const title = context.text
    .split(/\s+/)
    .filter((word) => !/^[@#]\S/.test(word) && !/^!(low|normal|high|urgent)$/i.test(word))
    .join(" ")
    .trim()
    .slice(0, 200);
  return {
    isTask: title.length > 0,
    title: title || "Untitled task",
    assigneeName: assignee,
    projectName: parsed.projectName ?? null,
    dueDate: parsed.dueDate ?? null,
    priority: parsed.priority ?? "normal",
    confidence: null,
    method: "rules",
  };
}

export function aiEnabled(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export async function extractTask(context: MessageContext): Promise<Extracted> {
  if (!env.ANTHROPIC_API_KEY || !context.text.trim()) return extractWithRules(context);

  const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(
    fromDateString(context.today),
  );
  const details = [
    `Today: ${context.today} (${weekday})`,
    `Known people: ${context.peopleNames.length ? context.peopleNames.join(", ") : "none yet"}`,
    `Known projects: ${context.projectNames.length ? context.projectNames.join(", ") : "none yet"}`,
    context.chat ? `Chat: ${context.chat}` : null,
    context.author ? `Message written by: ${context.author} (forwarded to the manager)` : "Message written by: the manager",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25_000 });
    const response = await client.beta.messages.parse({
      model: EXTRACT_MODEL,
      max_tokens: 4000,
      // A short extraction: low effort keeps it fast.
      output_config: { effort: "low", format: betaZodOutputFormat(TaskFields) },
      // If the request is declined, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `${details}\n\n<message>\n${context.text.slice(0, 4000)}\n</message>`,
        },
      ],
    });
    const fields = response.stop_reason === "refusal" ? null : response.parsed_output;
    if (!fields) return extractWithRules(context);
    const confidence = Math.min(1, Math.max(0, fields.confidence));
    return {
      isTask: fields.is_task,
      title: clean(fields.title, 300) ?? extractWithRules(context).title,
      assigneeName: clean(fields.assignee),
      projectName: clean(fields.project),
      dueDate: validDate(fields.due_date, context.today),
      priority: fields.priority,
      confidence,
      method: "ai",
    };
  } catch (error) {
    // Network trouble, a bad key or rate limits: still capture the message.
    console.error("Task extraction failed; using rules.", error instanceof Error ? error.message : error);
    return extractWithRules(context);
  }
}
