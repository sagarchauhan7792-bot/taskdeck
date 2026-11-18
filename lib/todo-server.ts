// Server-side task operations. The API routes call these today; the channel
// bots (Telegram, Slack, WhatsApp) will call createTask the same way.
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { people, projects, tasks } from "@/db/schema";
import { PRIORITIES, SOURCES, STATUSES } from "@/lib/todo";

const now = () => Math.floor(Date.now() / 1000);

const name = z.string().trim().min(1).max(80);
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const handle = z.string().trim().max(120).nullable();

export const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(5000).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.number().int().nullable().optional(),
  // Used by quick add and by bots: matched to a person by name, created if new.
  assigneeName: name.optional(),
  projectId: z.number().int().nullable().optional(),
  projectName: name.optional(),
  dueDate: dueDate.optional(),
  source: z.enum(SOURCES).optional(),
  sourceKind: z.enum(["text", "voice"]).optional(),
  sourceText: z.string().max(10000).nullable().optional(),
  sourceChat: z.string().max(200).nullable().optional(),
  sourceUrl: z.string().url().max(1000).nullable().optional(),
  audioKey: z.string().max(300).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export const taskPatch = taskInput
  .omit({ source: true, sourceKind: true, sourceText: true, sourceChat: true, sourceUrl: true, audioKey: true, confidence: true })
  .partial();

export const personInput = z.object({
  name,
  whatsapp: handle.optional(),
  telegram: handle.optional(),
  slack: handle.optional(),
});

export const projectInput = z.object({ name });

export async function getState() {
  const db = getDb();
  const [taskRows, peopleRows, projectRows] = await Promise.all([
    db.select().from(tasks).orderBy(desc(tasks.createdAt), desc(tasks.id)),
    db.select().from(people).orderBy(asc(people.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
  ]);
  return { tasks: taskRows, people: peopleRows, projects: projectRows };
}

async function personIdByName(value: string) {
  const db = getDb();
  const [found] = await db
    .select({ id: people.id })
    .from(people)
    .where(sql`lower(${people.name}) = ${value.toLowerCase()}`)
    .limit(1);
  if (found) return found.id;
  const [created] = await db.insert(people).values({ name: value, createdAt: now() }).returning();
  return created.id;
}

async function projectIdByName(value: string) {
  const db = getDb();
  const [found] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(sql`lower(${projects.name}) = ${value.toLowerCase()}`)
    .limit(1);
  if (found) return found.id;
  const [created] = await db.insert(projects).values({ name: value, createdAt: now() }).returning();
  return created.id;
}

export async function createTask(input: z.infer<typeof taskInput>) {
  const { assigneeName, projectName, ...fields } = input;
  const at = now();
  const assigneeId = assigneeName ? await personIdByName(assigneeName) : fields.assigneeId ?? null;
  const projectId = projectName ? await projectIdByName(projectName) : fields.projectId ?? null;
  const [task] = await getDb()
    .insert(tasks)
    .values({
      ...fields,
      assigneeId,
      projectId,
      createdAt: at,
      updatedAt: at,
      completedAt: fields.status === "done" ? at : null,
    })
    .returning();
  return task;
}

export async function updateTask(id: number, patch: z.infer<typeof taskPatch>) {
  const { assigneeName, projectName, ...fields } = patch;
  const at = now();
  const values: Partial<typeof tasks.$inferInsert> = { ...fields, updatedAt: at };
  if (assigneeName) values.assigneeId = await personIdByName(assigneeName);
  if (projectName) values.projectId = await projectIdByName(projectName);
  if (fields.status) values.completedAt = fields.status === "done" ? at : null;
  const [task] = await getDb().update(tasks).set(values).where(eq(tasks.id, id)).returning();
  return task ?? null;
}

export async function deleteTask(id: number) {
  await getDb().delete(tasks).where(eq(tasks.id, id));
}

export async function createPerson(input: z.infer<typeof personInput>) {
  const [person] = await getDb().insert(people).values({ ...input, createdAt: now() }).returning();
  return person;
}

export async function updatePerson(id: number, patch: Partial<z.infer<typeof personInput>>) {
  const [person] = await getDb().update(people).set(patch).where(eq(people.id, id)).returning();
  return person ?? null;
}

// D1 does not enforce foreign keys by default, so unassign explicitly.
export async function deletePerson(id: number) {
  const db = getDb();
  await db.update(tasks).set({ assigneeId: null }).where(eq(tasks.assigneeId, id));
  await db.delete(people).where(eq(people.id, id));
}

export async function createProject(input: z.infer<typeof projectInput>) {
  const [project] = await getDb().insert(projects).values({ ...input, createdAt: now() }).returning();
  return project;
}

export async function deleteProject(id: number) {
  const db = getDb();
  await db.update(tasks).set({ projectId: null }).where(eq(tasks.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
}

// ── Route helpers ────────────────────────────────────────────────────────────

export function parseId(value: string): number | null {
  return /^\d{1,12}$/.test(value) ? Number(value) : null;
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: Response.json({ error: "Request body must be JSON." }, { status: 400 }) } as const;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = `${issue.path.join(".") || "body"}: ${issue.message}`;
    return { error: Response.json({ error: message }, { status: 400 }) } as const;
  }
  return { data: parsed.data as z.infer<T> } as const;
}

export const notFound = () => Response.json({ error: "Not found." }, { status: 404 });
