"use client";

import { format } from "date-fns";
import { Check, Flag, FolderOpen, Hash, MessageCircle, Mic, PenLine, Send } from "lucide-react";
import { useState } from "react";
import {
  PRIORITY_LABEL,
  PRIORITY_RANK,
  SOURCE_LABEL,
  type Source,
  type Task,
  addDays,
  fromDateString,
  isOverdue,
  toDateString,
} from "@/lib/todo";
import { cn } from "@/lib/utils";
import { useTodo } from "./store";

export const TASK_DRAG_TYPE = "application/x-task-id";

const AVATAR_COLORS = ["#e5484d", "#e26a12", "#a87d06", "#2b9a63", "#0f9488", "#0a84e6", "#6e56cf", "#cf3d95"];

export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  const hash = [...name.toLowerCase()].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      title={name}
      aria-hidden="true"
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
        className,
      )}
      style={{ backgroundColor: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}
    >
      {initials}
    </span>
  );
}

const SOURCE_ICON = { manual: PenLine, whatsapp: MessageCircle, telegram: Send, slack: Hash } as const;
const SOURCE_COLOR: Record<Source, string> = {
  manual: "text-muted-foreground",
  whatsapp: "text-whatsapp",
  telegram: "text-telegram",
  slack: "text-slack",
};

export function SourceIcon({ task, className }: { task: Pick<Task, "source" | "sourceKind">; className?: string }) {
  const Icon = task.sourceKind === "voice" ? Mic : SOURCE_ICON[task.source];
  const label = `${SOURCE_LABEL[task.source]}${task.sourceKind === "voice" ? " voice note" : ""}`;
  return (
    <span title={label} className={cn("inline-flex", SOURCE_COLOR[task.source], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function dueLabel(dueDate: string, today: string): string {
  if (!today) return dueDate;
  const now = fromDateString(today);
  if (dueDate === today) return "Today";
  if (dueDate === toDateString(addDays(now, 1))) return "Tomorrow";
  const days = Math.round((fromDateString(dueDate).getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return `${-days}d overdue`;
  return format(fromDateString(dueDate), days < 7 ? "EEE" : "d MMM");
}

export function DueBadge({ task }: { task: Task }) {
  const { today } = useTodo();
  if (!task.dueDate) return null;
  const overdue = isOverdue(task, today);
  return (
    <span
      className={cn(
        "tabular-nums",
        overdue && "font-semibold text-overdue",
        !overdue && task.dueDate === today && task.status !== "done" && "font-semibold text-today",
      )}
    >
      {dueLabel(task.dueDate, today)}
    </span>
  );
}

/** Overdue first, then nearest due date, then priority, then newest. */
export function sortActive(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      b.createdAt - a.createdAt,
  );
}

export function TaskCard({ task, showAssignee = true }: { task: Task; showAssignee?: boolean }) {
  const { today, peopleById, projectsById, openTask, patchTask } = useTodo();
  const done = task.status === "done";
  const person = task.assigneeId ? peopleById.get(task.assigneeId) : undefined;
  const project = task.projectId ? projectsById.get(task.projectId) : undefined;

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(TASK_DRAG_TYPE, String(task.id));
        event.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "group relative flex items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/25",
        isOverdue(task, today) && "border-l-2 border-l-overdue",
        done && "opacity-60",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen: ${task.title}` : `Mark done: ${task.title}`}
        onClick={() => void patchTask(task.id, { status: done ? "open" : "done" })}
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border border-muted-foreground/50 outline-none transition-colors hover:border-done focus-visible:ring-[3px] focus-visible:ring-ring",
          done && "border-done bg-done text-background",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
      </button>
      <button
        type="button"
        onClick={() => openTask(task.id)}
        className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <span className={cn("block text-sm leading-snug font-medium break-words", done && "line-through")}>
          {task.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <SourceIcon task={task} />
          <DueBadge task={task} />
          {task.priority !== "normal" && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                task.priority === "urgent" && "font-semibold text-overdue",
                task.priority === "high" && "text-today",
              )}
            >
              <Flag className="size-3" aria-hidden="true" />
              {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {project && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <FolderOpen className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{project.name}</span>
            </span>
          )}
        </span>
      </button>
      {showAssignee && person && <PersonAvatar name={person.name} />}
    </div>
  );
}

/** A column that accepts dragged task cards. */
export function DropColumn({
  onDropTask,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "onDrop"> & { onDropTask: (taskId: number) => void }) {
  const [over, setOver] = useState(false);
  return (
    <section
      {...props}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const id = Number(event.dataTransfer.getData(TASK_DRAG_TYPE));
        if (id) onDropTask(id);
      }}
      className={cn(className, over && "ring-2 ring-ring")}
    >
      {children}
    </section>
  );
}
