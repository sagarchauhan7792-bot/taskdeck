import { connect, disconnect, slackEnabled } from "@/lib/channels/slack";

export async function POST() {
  if (!slackEnabled()) {
    return Response.json({ error: "Add SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET to the app's secrets first." }, { status: 400 });
  }
  try {
    return Response.json(await connect());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not reach Slack." }, { status: 502 });
  }
}

export async function DELETE() {
  await disconnect();
  return Response.json({ disconnected: true });
}
