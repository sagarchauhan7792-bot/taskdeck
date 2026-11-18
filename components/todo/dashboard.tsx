"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import {
  CalendarClock,
  CircleCheck,
  Columns3,
  Inbox,
  Loader2,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { APP_NAME, type Task, addDays, fromDateString, isOverdue } from "@/lib/todo";
import { cn } from "@/lib/utils";
import { QuickAdd } from "./quick-add";
import { TodoProvider, useTodo } from "./store";
import { SourceIcon } from "./task-card";
import { TaskSheet } from "./task-sheet";
import { AgendaView, InboxView, PeopleBoard, SetupView, StatusBoard } from "./views";

const VIEWS = [
  { key: "people", label: "People", icon: Users },
  { key: "agenda", label: "Agenda", icon: CalendarClock },
  { key: "status", label: "Status", icon: Columns3 },
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "setup", label: "Setup", icon: Settings },
] as const;

type View = (typeof VIEWS)[number]["key"];
const ALL_PROJECTS = "all";

function viewFromHash(): View {
  const key = window.location.hash.slice(1);
  return VIEWS.find((view) => view.key === key)?.key ?? "people";
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
      {dark ? "Light mode" : "Dark mode"}
    </Button>
  );
}

function Stat({
  label,
  short,
  value,
  tone,
  onClick,
}: {
  label: string;
  /** Label for narrow screens. */
  short: string;
  value: number;
  tone?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={cn("block font-mono text-2xl leading-none font-semibold tabular-nums sm:text-3xl", value > 0 && tone)}>
        {value}
      </span>
      <span className="mt-1.5 block truncate text-[11px] text-muted-foreground sm:text-xs">
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
    </>
  );
  const className = "min-w-0 rounded-xl border bg-card px-1 py-3 text-center sm:px-4 sm:text-left";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(className, "outline-none transition-colors hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring")}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Feed() {
  const { state, peopleById, openTask } = useTodo();
  const events = useMemo(
    () =>
      state.tasks
        .flatMap((task) => [
          { at: task.createdAt, done: false, task },
          ...(task.completedAt ? [{ at: task.completedAt, done: true, task }] : []),
        ])
        .sort((a, b) => b.at - a.at)
        .slice(0, 40),
    [state.tasks],
  );
  return (
    <aside aria-label="Live feed" className="hidden w-72 shrink-0 flex-col border-l xl:flex">
      <h2 className="flex items-center gap-2 px-4 pt-5 pb-3 text-sm font-semibold">
        <span className="size-2 rounded-full bg-done motion-safe:animate-pulse" aria-hidden="true" />
        Live feed
      </h2>
      {events.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">New and finished tasks show up here as they happen.</p>
      ) : (
        <ul className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-4">
          {events.map((event) => {
            const person = event.task.assigneeId ? peopleById.get(event.task.assigneeId) : undefined;
            return (
              <li key={`${event.task.id}-${event.done}`}>
                <button
                  type="button"
                  onClick={() => openTask(event.task.id)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <span className="mt-0.5">
                    {event.done ? (
                      <CircleCheck className="size-3.5 text-done" aria-hidden="true" />
                    ) : (
                      <SourceIcon task={event.task} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">
                      {event.done ? "Done" : `To ${person?.name ?? "nobody yet"}`} ·{" "}
                      {formatDistanceToNowStrict(event.at * 1000, { addSuffix: true })}
                    </span>
                    <span className="line-clamp-2 text-sm break-words">{event.task.title}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function Shell() {
  const { state, today, peopleById, projectsById, openTask } = useTodo();
  const { resolvedTheme, setTheme } = useTheme();
  const [view, setViewState] = useState<View>(viewFromHash);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState(ALL_PROJECTS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const quickAddRef = useRef<HTMLInputElement>(null);

  const setView = (next: View) => {
    setViewState(next);
    window.history.replaceState(null, "", `#${next}`);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable], [role=dialog]");
      if (event.key === "n" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        quickAddRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stats = useMemo(() => {
    const active = state.tasks.filter((task) => task.status !== "inbox" && task.status !== "done");
    // Seven calendar days, counting today.
    const weekAgo = today ? addDays(fromDateString(today), -6).getTime() / 1000 : 0;
    return {
      open: active.length,
      overdue: active.filter((task) => isOverdue(task, today)).length,
      today: active.filter((task) => task.dueDate === today).length,
      done: state.tasks.filter((task) => task.completedAt !== null && task.completedAt >= weekAgo).length,
      inbox: state.tasks.filter((task) => task.status === "inbox").length,
    };
  }, [state.tasks, today]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (task: Task) => {
      if (project !== ALL_PROJECTS && String(task.projectId) !== project) return false;
      if (!needle) return true;
      const person = task.assigneeId ? peopleById.get(task.assigneeId)?.name : "";
      const projectName = task.projectId ? projectsById.get(task.projectId)?.name : "";
      return `${task.title} ${task.notes} ${person} ${projectName}`.toLowerCase().includes(needle);
    };
    return state.tasks.filter(matches);
  }, [state.tasks, query, project, peopleById, projectsById]);

  const current = VIEWS.find((entry) => entry.key === view)!;
  const taskView = view !== "setup";
  const focusQuickAdd = () => {
    if (!taskView) setView("people");
    window.setTimeout(() => quickAddRef.current?.focus(), 50);
  };

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <nav aria-label="Views" className="hidden w-52 shrink-0 flex-col gap-1 border-r bg-sidebar p-3 md:flex">
        <div className="flex items-center gap-2 px-2 pt-2 pb-4">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="size-4" aria-hidden="true" />
          </span>
          <span className="font-semibold tracking-tight">{APP_NAME}</span>
        </div>
        {VIEWS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-current={view === entry.key ? "page" : undefined}
            onClick={() => setView(entry.key)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring",
              view === entry.key && "bg-sidebar-accent font-medium text-foreground",
            )}
          >
            <entry.icon className={cn("size-4", view === entry.key && "text-brand-ink")} aria-hidden="true" />
            <span className="flex-1 text-left">{entry.label}</span>
            {entry.key === "inbox" && stats.inbox > 0 && (
              <span className="rounded-full bg-primary px-1.5 font-mono text-xs font-semibold text-primary-foreground tabular-nums">
                {stats.inbox}
              </span>
            )}
          </button>
        ))}
        <div className="mt-auto flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => setPaletteOpen(true)}>
            <Search /> Search
            <Kbd className="ml-auto">Ctrl K</Kbd>
          </Button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">{current.label}</h1>
            <p className="text-xs text-muted-foreground">{today && format(fromDateString(today), "EEEE, d MMMM")}</p>
          </div>
          {taskView && (
            <>
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter tasks"
                  aria-label="Filter tasks"
                  className="w-44 pl-8 lg:w-56"
                />
              </div>
              {state.projects.length > 0 && (
                <Select value={project} onValueChange={setProject}>
                  <SelectTrigger aria-label="Project" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
                    {state.projects.map((entry) => (
                      <SelectItem key={entry.id} value={String(entry.id)}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}>
            <Search />
          </Button>
        </header>

        {taskView && (
          <>
            <div className="px-4 pt-4 sm:px-6">
              <QuickAdd inputRef={quickAddRef} />
            </div>
            <div className="grid grid-cols-5 gap-2 px-4 pt-3 sm:gap-3 sm:px-6">
              <Stat label="Open" short="Open" value={stats.open} />
              <Stat label="Overdue" short="Overdue" value={stats.overdue} tone="text-overdue" onClick={() => setView("agenda")} />
              <Stat label="Due today" short="Today" value={stats.today} tone="text-today" onClick={() => setView("agenda")} />
              <Stat label="Done, 7 days" short="Done 7d" value={stats.done} tone="text-done" onClick={() => setView("status")} />
              <Stat label="To review" short="Review" value={stats.inbox} tone="text-brand-ink" onClick={() => setView("inbox")} />
            </div>
          </>
        )}

        <main className="min-h-0 flex-1 pt-4">
          {view === "people" && <PeopleBoard tasks={visible} />}
          {view === "agenda" && <AgendaView tasks={visible} />}
          {view === "status" && <StatusBoard tasks={visible} />}
          {view === "inbox" && <InboxView tasks={visible} />}
          {view === "setup" && <SetupView />}
        </main>

        <nav aria-label="Views" className="grid grid-cols-5 border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
          {VIEWS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-current={view === entry.key ? "page" : undefined}
              onClick={() => setView(entry.key)}
              className={cn(
                "relative flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground outline-none focus-visible:bg-sidebar-accent",
                view === entry.key && "font-medium text-foreground",
              )}
            >
              <entry.icon className={cn("size-5", view === entry.key && "text-brand-ink")} aria-hidden="true" />
              {entry.label}
              {entry.key === "inbox" && stats.inbox > 0 && (
                <span className="absolute top-1.5 left-1/2 ml-2 rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-primary-foreground">
                  {stats.inbox}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {taskView && <Feed />}
      <TaskSheet />

      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="Search"
        description="Find a task or jump to a view."
      >
        <CommandInput placeholder="Search tasks, or jump to a view" />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                setPaletteOpen(false);
                focusQuickAdd();
              }}
            >
              <Plus /> New task
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setTheme(resolvedTheme === "light" ? "dark" : "light");
                setPaletteOpen(false);
              }}
            >
              {resolvedTheme === "light" ? <Moon /> : <Sun />} Switch theme
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Go to">
            {VIEWS.map((entry) => (
              <CommandItem
                key={entry.key}
                onSelect={() => {
                  setView(entry.key);
                  setPaletteOpen(false);
                }}
              >
                <entry.icon /> {entry.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Tasks">
            {state.tasks.slice(0, 200).map((task) => {
              const person = task.assigneeId ? peopleById.get(task.assigneeId)?.name : undefined;
              return (
                <CommandItem
                  key={task.id}
                  value={`${task.title} ${person ?? ""} ${task.id}`}
                  onSelect={() => {
                    setPaletteOpen(false);
                    openTask(task.id);
                  }}
                >
                  <SourceIcon task={task} />
                  <span className={cn("min-w-0 flex-1 truncate", task.status === "done" && "line-through opacity-60")}>
                    {task.title}
                  </span>
                  {person && <span className="text-xs text-muted-foreground">{person}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}

function Loading({ error }: { error: string | null }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3" role="status">
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{error ?? `Loading ${APP_NAME}…`}</p>
    </div>
  );
}

export function Dashboard() {
  return (
    <TodoProvider fallback={(error) => <Loading error={error} />}>
      <Shell />
    </TodoProvider>
  );
}
