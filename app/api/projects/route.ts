import { createProject, projectInput, readJson } from "@/lib/todo-server";

export async function POST(request: Request) {
  const body = await readJson(request, projectInput);
  if (body.error) return body.error;
  return Response.json({ project: await createProject(body.data) }, { status: 201 });
}
