import { deleteTask, notFound, parseId, readJson, taskPatch, updateTask } from "@/lib/todo-server";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (id === null) return notFound();
  const body = await readJson(request, taskPatch);
  if (body.error) return body.error;
  const task = await updateTask(id, body.data);
  return task ? Response.json({ task }) : notFound();
}

export async function DELETE(_request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (id === null) return notFound();
  await deleteTask(id);
  return Response.json({ deleted: true });
}
