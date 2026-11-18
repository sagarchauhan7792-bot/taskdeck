// Local preview only: applies the SQL in drizzle/ to the local D1 database so
// `npm run dev` works on a fresh checkout. Deployments apply migrations through
// the hosting platform and never run this.
const applied = new WeakSet<D1Database>();

export async function ensureDevSchema(db: D1Database) {
  if (applied.has(db)) return;
  const files = import.meta.glob<string>('../drizzle/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  await db.prepare('CREATE TABLE IF NOT EXISTS _dev_migrations (name text PRIMARY KEY)').run();
  const done = await db.prepare('SELECT name FROM _dev_migrations').all<{ name: string }>();
  const seen = new Set(done.results.map((row) => row.name));
  for (const name of Object.keys(files).sort()) {
    if (seen.has(name)) continue;
    for (const statement of files[name].split('--> statement-breakpoint')) {
      if (!statement.trim()) continue;
      try {
        await db.prepare(statement).run();
      } catch (error) {
        // A local database created by an older migration set already has these tables.
        if (!String(error instanceof Error ? (error.cause ?? error.message) : error).includes("already exists")) throw error;
      }
    }
    await db.prepare('INSERT INTO _dev_migrations (name) VALUES (?)').bind(name).run();
  }
  applied.add(db);
}
