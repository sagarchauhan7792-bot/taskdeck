"use client";

import { CalendarDays, Flag, FolderOpen, Plus, User } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIORITY_LABEL, parseQuickAdd } from "@/lib/todo";
import { useTodo } from "./store";
import { dueLabel } from "./task-card";

function Chip({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
      <Icon className="size-3" aria-hidden="true" />
      {children}
    </span>
  );
}

export function QuickAdd({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const { today, addTask } = useTodo();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const hasFields = parsed.assigneeName || parsed.projectName || parsed.priority || parsed.dueDate;

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!parsed.title || saving) return;
        setSaving(true);
        const saved = await addTask(parsed);
        setSaving(false);
        if (saved) setText("");
      }}
    >
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="@Rahul GST report kal"
          aria-label="New task"
          aria-describedby="quick-add-hint"
          maxLength={400}
          autoComplete="off"
          className="h-11 bg-card text-base md:text-sm"
        />
        <Button type="submit" className="h-11 px-4" disabled={!parsed.title || saving}>
          <Plus /> Add
        </Button>
      </div>
      <p id="quick-add-hint" className="mt-1.5 flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {hasFields ? (
          <>
            {parsed.assigneeName && <Chip icon={User}>{parsed.assigneeName}</Chip>}
            {parsed.projectName && <Chip icon={FolderOpen}>{parsed.projectName}</Chip>}
            {parsed.priority && <Chip icon={Flag}>{PRIORITY_LABEL[parsed.priority]}</Chip>}
            {parsed.dueDate && <Chip icon={CalendarDays}>{dueLabel(parsed.dueDate, today)}</Chip>}
          </>
        ) : (
          <span>
            <span className="font-mono">@person #project !urgent</span> and a day (today, kal, friday, 2026-12-01)
            fill in the details.
          </span>
        )}
      </p>
    </form>
  );
}
