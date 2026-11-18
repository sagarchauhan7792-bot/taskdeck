import { deleteProject, notFound, parseId } from "@/lib/todo-server";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (id === null) return notFound();
  await deleteProject(id);
  return Response.json({ deleted: true });
}
