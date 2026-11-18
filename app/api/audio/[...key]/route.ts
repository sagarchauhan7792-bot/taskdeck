import { env } from "cloudflare:workers";

type Context = { params: Promise<{ key: string[] }> };

// Plays a stored voice note. Behind sign-in like every other /api route.
export async function GET(_request: Request, { params }: Context) {
  const key = ["audio", ...(await params).key].join("/");
  if (!/^audio\/[\w-]+\/[\w-]+\.[a-z0-9]{1,5}$/i.test(key) || !env.BUCKET) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const object = await env.BUCKET.get(key);
  if (!object) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "audio/ogg",
      "content-length": String(object.size),
    },
  });
}
