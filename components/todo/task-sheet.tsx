"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { Check, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STATUSES,
  STATUS_LABEL,
  type Priority,
  type Status,
  type Task,
} from "@/lib/todo";
import { useTodo } from "./store";
import { SourceIcon } from "./task-card";

const NONE = "none";
const ago = (seconds: number) => formatDistanceToNowStrict(seconds * 1000, { addSuffix: true });

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function TaskForm({ task }: { task: Task }) {
  const { state, patchTask, removeTask, openTask } = useTodo();
  const done = task.status === "done";

  return (
    <div className="flex flex-col gap-5 px-4 pb-6">
      <Field label="Task" htmlFor="task-title">
        <Textarea
          id="task-title"
          defaultValue={task.title}
          rows={2}
          maxLength={300}
          className="min-h-0 resize-none text-base font-medium"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={(event) => {
            const title = event.target.value.trim();
            if (!title) event.target.value = task.title;
            else if (title !== task.title) void patchTask(task.id, { title });
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Assigned to" htmlFor="task-assignee">
          <Select
            value={task.assigneeId === null ? NONE : String(task.assigneeId)}
            onValueChange={(value) => void patchTask(task.id, { assigneeId: value === NONE ? null : Number(value) })}
          >
            <SelectTrigger id="task-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Unassigned</SelectItem>
              {state.people.map((person) => (
                <SelectItem key={person.id} value={String(person.id)}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Due date" htmlFor="task-due">
          <Input
            id="task-due"
            type="date"
            value={task.dueDate ?? ""}
            onChange={(event) => void patchTask(task.id, { dueDate: event.target.value || null })}
          />
        </Field>
        <Field label="Status" htmlFor="task-status">
          <Select value={task.status} onValueChange={(value) => void patchTask(task.id, { status: value as Status })}>
            <SelectTrigger id="task-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABEL[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Priority" htmlFor="task-priority">
          <Select
            value={task.priority}
            onValueChange={(value) => void patchTask(task.id, { priority: value as Priority })}
          >
            <SelectTrigger id="task-priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {PRIORITY_LABEL[priority]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="col-span-2">
          <Field label="Project" htmlFor="task-project">
            <Select
              value={task.projectId === null ? NONE : String(task.projectId)}
              onValueChange={(value) => void patchTask(task.id, { projectId: value === NONE ? null : Number(value) })}
            >
              <SelectTrigger id="task-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No project</SelectItem>
                {state.projects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <Field label="Notes" htmlFor="task-notes">
        <Textarea
          id="task-notes"
          defaultValue={task.notes}
          rows={4}
          maxLength={5000}
          placeholder="Details, links, context"
          onBlur={(event) => {
            if (event.target.value !== task.notes) void patchTask(task.id, { notes: event.target.value });
          }}
        />
      </Field>

      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <SourceIcon task={task} />
          <span>
            {task.source === "manual" ? "Added by hand" : `Captured from ${SOURCE_LABEL[task.source]}`}
            {task.sourceKind === "voice" && " voice note"}
          </span>
          {task.sourceChat && <span>· {task.sourceChat}</span>}
          <span>· {ago(task.createdAt)}</span>
        </p>
        {task.sourceText && (
          <blockquote className="mt-2 border-l-2 pl-3 break-words text-muted-foreground">{task.sourceText}</blockquote>
        )}
        {task.sourceUrl && (
          <a
            href={task.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-2"
          >
            Open original chat <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        )}
        {task.audioKey && (
          <audio controls preload="none" src={`/api/${task.audioKey}`} className="mt-3 w-full">
            <track kind="captions" />
          </audio>
        )}
        {task.completedAt && <p className="mt-2 text-xs text-done">Completed {ago(task.completedAt)}</p>}
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button
          variant={done ? "secondary" : "default"}
          onClick={() => void patchTask(task.id, { status: done ? "open" : "done" })}
        >
          {done ? <RotateCcw /> : <Check />}
          {done ? "Reopen" : "Mark done"}
        </Button>
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (!window.confirm("Delete this task? This cannot be undone.")) return;
            openTask(null);
            void removeTask(task.id);
          }}
        >
          <Trash2 /> Delete
        </Button>
      </div>
    </div>
  );
}

export function TaskSheet() {
  const { state, openTaskId, openTask } = useTodo();
  const task = state.tasks.find((entry) => entry.id === openTaskId);
  return (
    <Sheet open={Boolean(task)} onOpenChange={(open) => !open && openTask(null)}>
      <SheetContent
        className="scrollbar-thin w-full overflow-y-auto sm:max-w-md"
        // Keep the phone keyboard closed until a field is tapped.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>Task details</SheetTitle>
          <SheetDescription>Changes save as you make them.</SheetDescription>
        </SheetHeader>
        {task && <TaskForm key={task.id} task={task} />}
      </SheetContent>
    </Sheet>
  );
}
