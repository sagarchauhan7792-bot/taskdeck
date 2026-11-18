import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
// ── To-Do app ────────────────────────────────────────────────────────────────
// Timestamps are unix seconds. Due dates are date-only strings (YYYY-MM-DD) so
// they never shift with time zones.
export const people = sqliteTable('people', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  // Channel handles, used later to match incoming messages to a person.
  whatsapp: text('whatsapp'),
  telegram: text('telegram'),
  slack: text('slack'),
  createdAt: integer('created_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    // inbox = captured automatically, waiting for review.
    status: text('status', { enum: ['inbox', 'open', 'in_progress', 'waiting', 'done'] })
      .notNull()
      .default('open'),
    priority: text('priority', { enum: ['low', 'normal', 'high', 'urgent'] })
      .notNull()
      .default('normal'),
    assigneeId: integer('assignee_id').references(() => people.id, { onDelete: 'set null' }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    dueDate: text('due_date'),
    // Where the task came from.
    source: text('source', { enum: ['manual', 'whatsapp', 'telegram', 'slack'] })
      .notNull()
      .default('manual'),
    sourceKind: text('source_kind', { enum: ['text', 'voice'] }).notNull().default('text'),
    sourceText: text('source_text'),
    sourceChat: text('source_chat'),
    sourceUrl: text('source_url'),
    audioKey: text('audio_key'),
    confidence: real('confidence'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (table) => [
    index('tasks_status_idx').on(table.status),
    index('tasks_assignee_idx').on(table.assigneeId),
  ],
);

// Small key/value store for app settings (e.g. the linked Telegram chat).
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// Incoming channel events already handled. Channels retry deliveries, so this
// stops one message from becoming two tasks.
export const channelEvents = sqliteTable('channel_events', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
});
