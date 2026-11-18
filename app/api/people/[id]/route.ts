import { deletePerson, notFound, parseId, personInput, readJson, updatePerson } from "@/lib/todo-server";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (id === null) return notFound();
  const body = await readJson(request, personInput.partial());
  if (body.error) return body.error;
  const person = await updatePerson(id, body.data);
  return person ? Response.json({ person }) : notFound();
}

export async function DELETE(_request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (id === null) return notFound();
  await deletePerson(id);
  return Response.json({ deleted: true });
}
