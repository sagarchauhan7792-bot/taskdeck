import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { channelEvents, settings } from "@/db/schema";

const now = () => Math.floor(Date.now() / 1000);

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null) {
  const db = getDb();
  if (value === null) {
    await db.delete(settings).where(eq(settings.key, key));
    return;
  }
  await db
    .insert(settings)
    .values({ key, value, updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } });
}

/** Records an incoming event. Returns false when it was already handled. */
export async function firstDelivery(id: string): Promise<boolean> {
  const inserted = await getDb()
    .insert(channelEvents)
    .values({ id, createdAt: now() })
    .onConflictDoNothing()
    .returning({ id: channelEvents.id });
  return inserted.length > 0;
}

/** Today's date (YYYY-MM-DD) where the owner lives. */
export const OWNER_TIME_ZONE = "Asia/Kolkata";

export function ownerToday(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OWNER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
