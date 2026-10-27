// HSWT Navigator menu API (Cloudflare Worker + D1). Static files are served by Cloudflare's assets;
// this Worker only runs for /api/* (paths that are not a file).
//
//   GET    /api/menus/canteens.json                     canteens and where their menus come from
//   GET    /api/menus/[en/]<canteen>/<year>/<week>.json  a week in eat-api format (404 if nothing stored)
//   GET    /api/menus/admin/status                       stored days per canteen, latest syncs (Bearer MENU_ADMIN_TOKEN)
//   PUT    /api/menus/admin/<canteen>/<date>?lang=de     enter a day by hand   (Bearer MENU_ADMIN_TOKEN)
//   DELETE /api/menus/admin/<canteen>/<date>?lang=de     remove a day         (Bearer MENU_ADMIN_TOKEN)
//   POST   /api/menus/admin/sync                         run the sync now      (Bearer MENU_ADMIN_TOKEN)
//
// The cron trigger (wrangler.jsonc) runs the sync every morning: eat-api canteens, this and next
// week, German and English.

import { CANTEENS, canteenById } from './canteens.js';
import { LANGS, cleanDishes, daysOfWeek, eatApiUrl, isDate, isoWeek, parseMenuPath, weekDates, weekJson } from './menus.js';
import { deleteDay, loadDays, logSync, saveDays, status } from './store.js';

const EAT_API = 'https://tum-dev.github.io/eat-api';
const EAT_API_RAW = 'https://raw.githubusercontent.com/TUM-Dev/eat-api/gh-pages';
const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024; // an eat-api week is ~10–30 KB

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
};

function json(body, status = 200, { cache = 0, cors = true } = {}) {
  const headers = { ...BASE_HEADERS, 'cache-control': cache ? `public, max-age=${cache}` : 'no-store' };
  // Menus are public data: other apps (and the native app shell) may read them.
  if (cors) headers['access-control-allow-origin'] = '*';
  return new Response(JSON.stringify(body), { status, headers });
}

const notFound = () => json({ error: 'not found' }, 404, { cache: 300 });

// ---------- sync ----------

async function fetchWeek(fetchImpl, canteen, lang, year, week) {
  for (const base of [EAT_API, EAT_API_RAW]) {
    const res = await fetchImpl(eatApiUrl(base, canteen, lang, year, week), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'hswt-navigator-menu-sync' },
    }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) {
      const body = await res.text();
      if (body.length > MAX_UPSTREAM_BYTES) throw new Error('eat-api answer too large');
      return JSON.parse(body);
    }
  }
  throw new Error('eat-api unreachable');
}

export async function sync(env, { fetchImpl = fetch, today = new Date() } = {}) {
  const weeks = [today, new Date(today.getTime() + 7 * 86400000)].map(isoWeek);
  const log = [];
  for (const c of CANTEENS.filter((c) => c.source === 'eat-api')) {
    for (const lang of LANGS) {
      for (const { year, week } of weeks) {
        const entry = { canteen: c.id, lang, week: `${year}-W${String(week).padStart(2, '0')}` };
        try {
          const data = await fetchWeek(fetchImpl, c.id, lang, year, week);
          if (!data) {
            log.push({ ...entry, status: 'missing' });
            continue;
          }
          const days = daysOfWeek(data);
          await saveDays(env.DB, c.id, lang, days, 'eat-api');
          log.push({ ...entry, status: 'ok', days: days.length });
        } catch (e) {
          log.push({ ...entry, status: 'error', error: String(e?.message ?? e).slice(0, 200) });
        }
      }
    }
  }
  await logSync(env.DB, log);
  return log;
}

// ---------- admin ----------

// Compare secrets in constant time (hash both, then compare every byte).
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const ux = new Uint8Array(x);
  const uy = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ux.length; i++) diff |= ux[i] ^ uy[i];
  return diff === 0;
}

async function authorized(request, env) {
  const token = env.MENU_ADMIN_TOKEN;
  if (!token || token.length < 32) return false; // admin is off until a long secret is set
  const m = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  return Boolean(m) && (await sameSecret(m[1], token));
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY_BYTES) return null;
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function admin(request, env, ctx, parts) {
  if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401, { cors: false });
  if (parts.length === 1 && parts[0] === 'sync' && request.method === 'POST') {
    return json({ log: await sync(env) }, 200, { cors: false });
  }
  // Reads the whole table: admin only, so it can't be used to run up the database quota.
  if (parts.length === 1 && parts[0] === 'status' && request.method === 'GET') {
    return json(await status(env.DB), 200, { cors: false });
  }
  const [canteen, date] = parts;
  const lang = new URL(request.url).searchParams.get('lang') ?? 'de';
  if (parts.length !== 2 || !canteenById[canteen] || !isDate(date) || !LANGS.includes(lang)) return json({ error: 'bad request' }, 400, { cors: false });
  // Drop the cached week so the change is visible at once.
  const { year, week } = isoWeek(new Date(`${date}T12:00:00`));
  const purge = () => edgeCache()?.delete(new URL(`/api/menus/${lang === 'en' ? 'en/' : ''}${canteen}/${year}/${String(week).padStart(2, '0')}.json`, request.url).toString());
  if (request.method === 'DELETE') {
    const deleted = await deleteDay(env.DB, canteen, lang, date);
    ctx.waitUntil(Promise.resolve(purge()));
    return json({ deleted }, 200, { cors: false });
  }
  if (request.method !== 'PUT') return json({ error: 'method not allowed' }, 405, { cors: false });
  const body = await readJson(request);
  const dishes = cleanDishes(body?.dishes);
  // Allergens are mandatory: every dish must list its labels explicitly (an empty list means
  // "checked, none"), so a forgotten field can't turn into "free from" in the app.
  const labelled = Array.isArray(body?.dishes) && body.dishes.every((d) => Array.isArray(d?.labels));
  if (!dishes.length || !labelled) {
    return json({ error: 'body must be { "dishes": [{ "name": …, "prices": …, "labels": [allergens, diet …], "dish_type": … }] }' }, 400, { cors: false });
  }
  await saveDays(env.DB, canteen, lang, [{ date, dishes }], 'manual');
  ctx.waitUntil(Promise.resolve(purge()));
  return json({ saved: { canteen, lang, date, dishes: dishes.length } }, 200, { cors: false });
}

// ---------- public API ----------

const edgeCache = () => (typeof caches !== 'undefined' ? caches.default : null);

// Cached by path only: a query string (?x=random) can't be used to skip the cache and reach D1.
async function cached(request, ctx, produce) {
  const url = new URL(request.url);
  const key = new Request(`${url.origin}${url.pathname}`);
  const cache = request.method === 'GET' ? edgeCache() : null;
  const hit = await cache?.match(key);
  if (hit) return hit;
  const res = await produce();
  if (cache && res.ok) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/menus/')) return notFound();
  const rest = url.pathname.slice('/api/menus/'.length);

  if (rest.startsWith('admin/')) return admin(request, env, ctx, rest.slice(6).split('/'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method not allowed' }, 405);

  if (rest === 'canteens.json') {
    return json(
      CANTEENS.map(({ id, name, campus, operator, source, website }) => ({ id, name, campus, operator, source, website: website ?? null })),
      200,
      { cache: 3600 },
    );
  }

  const q = parseMenuPath(url.pathname);
  if (!q || !canteenById[q.canteen]) return notFound();
  return cached(request, ctx, async () => {
    const dates = weekDates(q.year, q.week);
    const days = await loadDays(env.DB, q.canteen, q.lang, dates[0], dates[6]);
    return days.length ? json(weekJson(q.year, q.week, days), 200, { cache: 900 }) : notFound();
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      console.error('menu api', e);
      return json({ error: 'internal error' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sync(env));
  },
};
