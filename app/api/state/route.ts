import { getState } from "@/lib/todo-server";

export async function GET() {
  return Response.json(await getState());
}
