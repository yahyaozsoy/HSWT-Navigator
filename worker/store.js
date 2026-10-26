// D1 access for the menu API. `db` is a D1 binding (prepare / bind / all / first / run / batch).

const now = () => new Date().toISOString();

// Insert or update days. A synced day never replaces one entered by hand.
export async function saveDays(db, canteen, lang, days, source) {
  if (!days.length) return 0;
  const at = now();
  const stmt = db.prepare(
    `INSERT INTO menu_day (canteen, lang, date, dishes, source, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (canteen, lang, date) DO UPDATE SET dishes = excluded.dishes, source = excluded.source, updated_at = excluded.updated_at
     WHERE excluded.source = 'manual' OR (menu_day.source <> 'manual' AND menu_day.dishes <> excluded.dishes)`,
  );
  await db.batch(days.map((d) => stmt.bind(canteen, lang, d.date, JSON.stringify(d.dishes), source, at)));
  return days.length;
}

export async function deleteDay(db, canteen, lang, date) {
  const r = await db.prepare('DELETE FROM menu_day WHERE canteen = ?1 AND lang = ?2 AND date = ?3').bind(canteen, lang, date).run();
  return r.meta?.changes ?? 0;
}

export async function loadDays(db, canteen, lang, from, to) {
  const { results } = await db
    .prepare('SELECT date, dishes FROM menu_day WHERE canteen = ?1 AND lang = ?2 AND date BETWEEN ?3 AND ?4 ORDER BY date')
    .bind(canteen, lang, from, to)
    .all();
  return results.map((r) => ({ date: r.date, dishes: JSON.parse(r.dishes) }));
}

export async function logSync(db, entries) {
  if (!entries.length) return;
  const at = now();
  const stmt = db.prepare('INSERT INTO sync_log (ran_at, canteen, lang, week, status, days, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)');
  await db.batch(entries.map((e) => stmt.bind(at, e.canteen, e.lang, e.week, e.status, e.days ?? 0, e.error ?? null)));
  // Keep about half a year of log entries.
  await db.prepare("DELETE FROM sync_log WHERE ran_at < ?1").bind(new Date(Date.now() - 180 * 86400000).toISOString()).run();
}

export async function status(db) {
  const days = await db.prepare('SELECT canteen, lang, COUNT(*) AS days, MIN(date) AS first, MAX(date) AS last FROM menu_day GROUP BY canteen, lang').all();
  const runs = await db.prepare('SELECT ran_at, canteen, lang, week, status, days, error FROM sync_log ORDER BY id DESC LIMIT 30').all();
  return { stored: days.results, recentSyncs: runs.results };
}
