"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { Check, Download, ExternalLink, Pencil, Share, Plus, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  type Status,
  type Task,
  addDays,
  fromDateString,
  isOverdue,
  toDateString,
} from "@/lib/todo";
import { cn } from "@/lib/utils";
import { ChannelsSection } from "./channels";
import { useInstall } from "./install";
import { useTodo } from "./store";
import { DropColumn, DueBadge, PersonAvatar, SourceIcon, TaskCard, sortActive } from "./task-card";

function EmptyNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-dashed p-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function ColumnShell({
  header,
  count,
  children,
  onDropTask,
  label,
}: {
  header: React.ReactNode;
  count: number;
  children: React.ReactNode;
  onDropTask: (taskId: number) => void;
  label: string;
}) {
  return (
    <DropColumn
      aria-label={label}
      onDropTask={onDropTask}
      className="flex max-h-full w-[calc(100vw-3rem)] shrink-0 snap-start flex-col rounded-xl border bg-muted/40 sm:w-[19rem]"
    >
      <header className="p-3 pb-2">{header}</header>
      <div className="scrollbar-thin flex min-h-16 flex-col gap-2 overflow-y-auto p-2 pt-1">
        {count === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
            Nothing here. Drop a task to move it.
          </p>
        ) : (
          children
        )}
      </div>
    </DropColumn>
  );
}

// ── People board ─────────────────────────────────────────────────────────────

function AddPersonColumn() {
  const { addPerson } = useTodo();
  const [name, setName] = useState("");
  return (
    <form
      className="flex w-[calc(100vw-3rem)] shrink-0 snap-start gap-2 rounded-xl border border-dashed p-3 sm:w-64"
      onSubmit={async (event) => {
        event.preventDefault();
        if (name.trim() && (await addPerson(name.trim()))) setName("");
      }}
    >
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Add a person"
        aria-label="New person name"
        maxLength={80}
      />
      <Button type="submit" size="icon" variant="secondary" aria-label="Add person" disabled={!name.trim()}>
        <UserPlus />
      </Button>
    </form>
  );
}

export function PeopleBoard({ tasks }: { tasks: Task[] }) {
  const { state, today, patchTask } = useTodo();
  const active = tasks.filter((task) => task.status !== "inbox");
  const unassigned = active.filter((task) => task.assigneeId === null && task.status !== "done");
  const columns = [
    ...state.people.map((person) => ({ id: person.id as number | null, name: person.name })),
    ...(unassigned.length > 0 || state.people.length === 0 ? [{ id: null, name: "Unassigned" }] : []),
  ];

  return (
    <div className="scrollbar-thin flex h-full snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-4 sm:snap-none sm:px-6">
      {columns.map((column) => {
        const mine = active.filter((task) => task.assigneeId === column.id);
        const open = sortActive(mine.filter((task) => task.status !== "done"));
        const doneCount = mine.length - open.length;
        const overdue = open.filter((task) => isOverdue(task, today)).length;
        const progress = mine.length ? Math.round((doneCount / mine.length) * 100) : 0;
        return (
          <ColumnShell
            key={column.id ?? "none"}
            label={`${column.name}: ${open.length} open`}
            count={open.length}
            onDropTask={(taskId) => void patchTask(taskId, { assigneeId: column.id })}
            header={
              <>
                <div className="flex items-center gap-2">
                  {column.id === null ? (
                    <span className="size-6 rounded-full border border-dashed border-muted-foreground/60" />
                  ) : (
                    <PersonAvatar name={column.name} />
                  )}
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{column.name}</h2>
                  <span className="font-mono text-sm tabular-nums">{open.length}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full rounded-full bg-done" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {overdue > 0 && <span className="font-semibold text-overdue">{overdue} overdue · </span>}
                  {doneCount} done
                </p>
              </>
            }
          >
            {open.map((task) => (
              <TaskCard key={task.id} task={task} showAssignee={false} />
            ))}
          </ColumnShell>
        );
      })}
      <AddPersonColumn />
    </div>
  );
}

// ── Status board ─────────────────────────────────────────────────────────────

const BOARD_STATUSES: Status[] = ["open", "in_progress", "waiting", "done"];
const DONE_LIMIT = 30;

export function StatusBoard({ tasks }: { tasks: Task[] }) {
  const { patchTask } = useTodo();
  return (
    <div className="scrollbar-thin flex h-full snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-4 sm:snap-none sm:px-6">
      {BOARD_STATUSES.map((status) => {
        const all = tasks.filter((task) => task.status === status);
        const shown =
          status === "done"
            ? [...all].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, DONE_LIMIT)
            : sortActive(all);
        return (
          <ColumnShell
            key={status}
            label={`${STATUS_LABEL[status]}: ${all.length}`}
            count={shown.length}
            onDropTask={(taskId) => void patchTask(taskId, { status })}
            header={
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-sm font-semibold">{STATUS_LABEL[status]}</h2>
                <span className="font-mono text-sm tabular-nums">{all.length}</span>
              </div>
            }
          >
            {shown.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
            {all.length > shown.length && (
              <p className="px-1 text-xs text-muted-foreground">Showing the latest {DONE_LIMIT}.</p>
            )}
          </ColumnShell>
        );
      })}
    </div>
  );
}

// ── Agenda ───────────────────────────────────────────────────────────────────

export function AgendaView({ tasks }: { tasks: Task[] }) {
  const { today } = useTodo();
  const weekEnd = today ? toDateString(addDays(fromDateString(today), 7)) : "";
  const open = sortActive(tasks.filter((task) => task.status !== "done" && task.status !== "inbox"));
  const sections = [
    { title: "Overdue", tone: "text-overdue", items: open.filter((task) => isOverdue(task, today)) },
    { title: "Today", tone: "text-today", items: open.filter((task) => task.dueDate === today) },
    {
      title: "Next 7 days",
      tone: "",
      items: open.filter((task) => task.dueDate && task.dueDate > today && task.dueDate <= weekEnd),
    },
    { title: "Later", tone: "", items: open.filter((task) => task.dueDate && task.dueDate > weekEnd) },
    { title: "No due date", tone: "", items: open.filter((task) => !task.dueDate) },
  ].filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    return <EmptyNote title="All clear">No open tasks match. Add one from the bar above.</EmptyNote>;
  }
  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 pb-6 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h2 className={cn("mb-2 flex items-baseline gap-2 text-sm font-semibold", section.tone)}>
              {section.title}
              <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">
                {section.items.length}
              </span>
            </h2>
            <div className="flex flex-col gap-2">
              {section.items.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Review inbox ─────────────────────────────────────────────────────────────

export function InboxView({ tasks }: { tasks: Task[] }) {
  const { peopleById, openTask, patchTask, removeTask } = useTodo();
  const inbox = tasks.filter((task) => task.status === "inbox");

  if (inbox.length === 0) {
    return (
      <EmptyNote title="Inbox is empty">
        Tasks picked up automatically from WhatsApp, Telegram and Slack will wait here for a one-tap
        approval. No channel is connected yet, so nothing arrives on its own.
      </EmptyNote>
    );
  }
  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 pb-6 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {inbox.map((task) => {
          const person = task.assigneeId ? peopleById.get(task.assigneeId) : undefined;
          return (
            <article key={task.id} className="rounded-xl border bg-card p-4">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <SourceIcon task={task} />
                <span>{SOURCE_LABEL[task.source]}</span>
                {task.sourceChat && <span>· {task.sourceChat}</span>}
                <span>· {formatDistanceToNowStrict(task.createdAt * 1000, { addSuffix: true })}</span>
                {task.confidence !== null && <span>· {Math.round(task.confidence * 100)}% sure</span>}
              </p>
              <h2 className="mt-2 font-semibold break-words">{task.title}</h2>
              {task.sourceText && (
                <blockquote className="mt-2 border-l-2 pl-3 text-sm break-words text-muted-foreground">
                  {task.sourceText}
                </blockquote>
              )}
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {person ? (
                  <span className="inline-flex items-center gap-1.5">
                    <PersonAvatar name={person.name} className="size-5" />
                    {person.name}
                  </span>
                ) : (
                  <span>Unassigned</span>
                )}
                <DueBadge task={task} />
                {task.priority !== "normal" && <span>{PRIORITY_LABEL[task.priority]} priority</span>}
                {task.sourceUrl && (
                  <a
                    href={task.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                  >
                    Open chat <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                )}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void patchTask(task.id, { status: "open" })}>
                  <Check /> Approve
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openTask(task.id)}>
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void removeTask(task.id)}>
                  <X /> Not a task
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

function HandleInput({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (value: string | null) => void;
}) {
  return (
    <Input
      key={value ?? ""}
      defaultValue={value ?? ""}
      aria-label={label}
      placeholder={label}
      maxLength={120}
      className="h-8 min-w-0 text-xs"
      onBlur={(event) => {
        const next = event.target.value.trim() || null;
        if (next !== value) onSave(next);
      }}
    />
  );
}

function InstallSection() {
  const { state, install } = useInstall();
  return (
    <section aria-labelledby="setup-app" className="rounded-xl border bg-card p-4">
      <h2 id="setup-app" className="text-sm font-semibold">
        Phone app
      </h2>
      {state === "installed" && (
        <p className="mt-1 text-sm text-muted-foreground">Installed. Open Taskdeck from your home screen.</p>
      )}
      {state === "available" && (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Add Taskdeck to your home screen. It opens full screen, like any other app.
          </p>
          <Button className="mt-3" onClick={() => void install()}>
            <Download /> Install app
          </Button>
        </>
      )}
      {state === "ios" && (
        <p className="mt-1 text-sm text-muted-foreground">
          In Safari, tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> Share, then{" "}
          <span className="font-medium text-foreground">Add to Home Screen</span>.
        </p>
      )}
      {state === "unsupported" && (
        <p className="mt-1 text-sm text-muted-foreground">
          Open this page on your phone in Chrome (Android) or Safari (iPhone), then use{" "}
          <span className="font-medium text-foreground">Install app</span> or{" "}
          <span className="font-medium text-foreground">Add to Home Screen</span> from the browser menu.
        </p>
      )}
    </section>
  );
}

export function SetupView() {
  const { state, patchPerson, removePerson, addPerson, addProject, removeProject } = useTodo();
  const [person, setPerson] = useState("");
  const [project, setProject] = useState("");
  const taskCount = (match: (task: Task) => boolean) => state.tasks.filter(match).length;

  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 pb-8 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <InstallSection />

        <ChannelsSection />

        <section aria-labelledby="setup-people">
          <h2 id="setup-people" className="text-sm font-semibold">
            People
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Handles let incoming messages be matched to the right person once channels are connected.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {state.people.map((entry) => {
              const count = taskCount((task) => task.assigneeId === entry.id);
              return (
                <li
                  key={entry.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 rounded-xl border bg-card p-3 sm:grid-cols-[auto_9rem_1fr_auto]"
                >
                  <PersonAvatar name={entry.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="text-xs text-muted-foreground">{count} tasks</p>
                  </div>
                  <div className="col-span-3 row-start-2 grid grid-cols-3 gap-2 sm:col-span-1 sm:row-start-auto">
                    <HandleInput
                      label="WhatsApp number"
                      value={entry.whatsapp}
                      onSave={(whatsapp) => void patchPerson(entry.id, { whatsapp })}
                    />
                    <HandleInput
                      label="Telegram username"
                      value={entry.telegram}
                      onSave={(telegram) => void patchPerson(entry.id, { telegram })}
                    />
                    <HandleInput
                      label="Slack name"
                      value={entry.slack}
                      onSave={(slack) => void patchPerson(entry.id, { slack })}
                    />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${entry.name}`}
                    onClick={() => {
                      const warning = count ? ` Their ${count} tasks become unassigned.` : "";
                      if (window.confirm(`Remove ${entry.name}?${warning}`)) void removePerson(entry.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
          <form
            className="mt-3 flex max-w-sm gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (person.trim() && (await addPerson(person.trim()))) setPerson("");
            }}
          >
            <Input
              value={person}
              onChange={(event) => setPerson(event.target.value)}
              placeholder="Name"
              aria-label="New person name"
              maxLength={80}
            />
            <Button type="submit" variant="secondary" disabled={!person.trim()}>
              <Plus /> Add person
            </Button>
          </form>
        </section>

        <section aria-labelledby="setup-projects">
          <h2 id="setup-projects" className="text-sm font-semibold">
            Projects
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {state.projects.map((entry) => {
              const count = taskCount((task) => task.projectId === entry.id);
              return (
                <li key={entry.id} className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-3 text-sm">
                  {entry.name}
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{count}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={`Remove project ${entry.name}`}
                    onClick={() => {
                      const warning = count ? ` Its ${count} tasks stay, without a project.` : "";
                      if (window.confirm(`Remove project ${entry.name}?${warning}`)) void removeProject(entry.id);
                    }}
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
          <form
            className="mt-3 flex max-w-sm gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (project.trim() && (await addProject(project.trim()))) setProject("");
            }}
          >
            <Input
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="Project name"
              aria-label="New project name"
              maxLength={80}
            />
            <Button type="submit" variant="secondary" disabled={!project.trim()}>
              <Plus /> Add project
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
