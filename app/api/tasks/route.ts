import { createTask, readJson, taskInput } from "@/lib/todo-server";

export async function POST(request: Request) {
  const body = await readJson(request, taskInput);
  if (body.error) return body.error;
  return Response.json({ task: await createTask(body.data) }, { status: 201 });
}
