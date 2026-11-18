"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type AppState,
  type Person,
  type Priority,
  type Project,
  type Status,
  type Task,
  toDateString,
} from "@/lib/todo";

const POLL_MS = 20_000;

export type NewTask = {
  title: string;
  notes?: string;
  status?: Status;
  priority?: Priority;
  assigneeId?: number | null;
  assigneeName?: string;
  projectId?: number | null;
  projectName?: string;
  dueDate?: string | null;
};

export type TaskPatch = Partial<NewTask>;
export type PersonPatch = Partial<Pick<Person, "name" | "whatsapp" | "telegram" | "slack">>;

type Todo = {
  state: AppState;
  today: string;
  peopleById: Map<number, Person>;
  projectsById: Map<number, Project>;
  openTaskId: number | null;
  openTask: (id: number | null) => void;
  addTask: (task: NewTask) => Promise<boolean>;
  patchTask: (id: number, patch: TaskPatch) => Promise<boolean>;
  removeTask: (id: number) => Promise<boolean>;
  addPerson: (name: string) => Promise<boolean>;
  patchPerson: (id: number, patch: PersonPatch) => Promise<boolean>;
  removePerson: (id: number) => Promise<boolean>;
  addProject: (name: string) => Promise<boolean>;
  removeProject: (id: number) => Promise<boolean>;
};

const TodoContext = createContext<Todo | null>(null);

export function useTodo(): Todo {
  const value = useContext(TodoContext);
  if (!value) throw new Error("useTodo must be used inside TodoProvider.");
  return value;
}

export function TodoProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: (error: string | null) => React.ReactNode;
}) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [openTaskId, openTask] = useState<number | null>(null);
  // Writes in flight. Polled data is ignored while this is above zero so it
  // cannot overwrite an optimistic change with an older snapshot.
  const writes = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const next = (await response.json()) as AppState;
      if (writes.current === 0) setState(next);
      setToday(toDateString(new Date()));
      setError(null);
    } catch {
      setError("Could not reach the server. Retrying…");
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const write = useCallback(
    async (
      method: "POST" | "PATCH" | "DELETE",
      url: string,
      body?: unknown,
      optimistic?: (current: AppState) => AppState,
    ) => {
      writes.current += 1;
      if (optimistic) setState((current) => (current ? optimistic(current) : current));
      let ok = true;
      try {
        const response = await fetch(url, {
          method,
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(detail?.error ?? `Request failed (${response.status}).`);
        }
      } catch (cause) {
        ok = false;
        toast.error(cause instanceof Error ? cause.message : "Something went wrong.");
      } finally {
        writes.current -= 1;
        await refresh();
      }
      return ok;
    },
    [refresh],
  );

  const actions = useMemo(() => {
    const editTasks = (edit: (tasks: Task[]) => Task[]) => (current: AppState) => ({
      ...current,
      tasks: edit(current.tasks),
    });
    const result: Pick<
      Todo,
      "addTask" | "patchTask" | "removeTask" | "addPerson" | "patchPerson" | "removePerson" | "addProject" | "removeProject"
    > = {
      addTask: (task) => write("POST", "/api/tasks", task),
      patchTask: (id, patch) => {
        // Names are resolved to ids on the server, so only plain fields are applied early.
        const fields = { ...patch };
        delete fields.assigneeName;
        delete fields.projectName;
        return write(
          "PATCH",
          `/api/tasks/${id}`,
          patch,
          editTasks((tasks) => tasks.map((task) => (task.id === id ? { ...task, ...fields } : task))),
        );
      },
      removeTask: (id) =>
        write("DELETE", `/api/tasks/${id}`, undefined, editTasks((tasks) => tasks.filter((task) => task.id !== id))),
      addPerson: (name) => write("POST", "/api/people", { name }),
      patchPerson: (id, patch) => write("PATCH", `/api/people/${id}`, patch),
      removePerson: (id) => write("DELETE", `/api/people/${id}`),
      addProject: (name) => write("POST", "/api/projects", { name }),
      removeProject: (id) => write("DELETE", `/api/projects/${id}`),
    };
    return result;
  }, [write]);

  const maps = useMemo(
    () => ({
      peopleById: new Map((state?.people ?? []).map((person) => [person.id, person])),
      projectsById: new Map((state?.projects ?? []).map((project) => [project.id, project])),
    }),
    [state],
  );

  if (!state) return <>{fallback(error)}</>;
  return (
    <TodoContext.Provider value={{ state, today, openTaskId, openTask, ...maps, ...actions }}>
      {children}
    </TodoContext.Provider>
  );
}
