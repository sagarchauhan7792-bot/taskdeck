import { connect, disconnect, whatsappEnabled } from "@/lib/channels/whatsapp";

export async function POST() {
  if (!whatsappEnabled()) {
    return Response.json(
      { error: "Add WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_APP_SECRET to the app's secrets first." },
      { status: 400 },
    );
  }
  try {
    return Response.json(await connect());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not reach WhatsApp." }, { status: 502 });
  }
}

export async function DELETE() {
  await disconnect();
  return Response.json({ disconnected: true });
}
