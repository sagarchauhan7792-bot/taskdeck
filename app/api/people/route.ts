import { createPerson, personInput, readJson } from "@/lib/todo-server";

export async function POST(request: Request) {
  const body = await readJson(request, personInput);
  if (body.error) return body.error;
  return Response.json({ person: await createPerson(body.data) }, { status: 201 });
}
