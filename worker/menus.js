// Menu data in eat-api's format, so the app reads our API and eat-api the same way:
//   week = { number, year, days: [{ date: 'YYYY-MM-DD', dishes: [dish] }] }
//   dish = { name, prices: { students|staff|guests: { base_price, price_per_unit, unit } },
//            labels: ['VEGAN', …], dish_type }
// Everything that comes in (eat-api or the admin endpoint) is validated and trimmed here.

import { isoWeek } from '../js/lib/mensa.js';

export const LANGS = ['de', 'en'];
export const ROLES = ['students', 'staff', 'guests'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LABEL = /^[A-Z][A-Z0-9_]{0,39}$/;
const MAX_DISHES = 60;

export { isoWeek };

export const isDate = (s) => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

const text = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const amount = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : null);

function cleanPrice(p) {
  if (!p || typeof p !== 'object') return null;
  const price = { base_price: amount(p.base_price), price_per_unit: amount(p.price_per_unit), unit: text(p.unit, 20) || null };
  return price.base_price === null && price.price_per_unit === null ? null : price;
}

// One dish → clean dish, or null if it has no name.
export function cleanDish(d) {
  if (!d || typeof d !== 'object') return null;
  const name = text(d.name, 200);
  if (!name) return null;
  const prices = {};
  for (const role of ROLES) {
    const p = cleanPrice(d.prices?.[role]);
    if (p) prices[role] = p;
  }
  const labels = [...new Set((Array.isArray(d.labels) ? d.labels : []).filter((l) => typeof l === 'string' && LABEL.test(l)))].slice(0, 40);
  return { name, prices, labels, dish_type: text(d.dish_type, 60) };
}

export function cleanDishes(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_DISHES).map(cleanDish).filter(Boolean);
}

// eat-api week JSON → [{ date, dishes }] (days without dishes are left out).
export function daysOfWeek(json) {
  return (Array.isArray(json?.days) ? json.days : [])
    .filter((d) => isDate(d?.date))
    .map((d) => ({ date: d.date, dishes: cleanDishes(d.dishes) }))
    .filter((d) => d.dishes.length);
}

// Monday … Sunday of an ISO week as 'YYYY-MM-DD'.
export function weekDates(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - (((jan4.getUTCDay() || 7) - 1) * 86400000) + (week - 1) * 7 * 86400000);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10));
}

export function weekJson(year, week, days) {
  return { number: week, year, days: days.map((d) => ({ date: d.date, dishes: d.dishes })) };
}

// /api/menus/[en/]<canteen>/<year>/<week>.json → { lang, canteen, year, week }
const MENU_PATH = /^\/api\/menus\/(?:(en)\/)?([a-z0-9-]{1,60})\/(\d{4})\/(\d{1,2})\.json$/;
export function parseMenuPath(pathname) {
  const m = MENU_PATH.exec(pathname);
  if (!m) return null;
  const year = Number(m[3]);
  const week = Number(m[4]);
  if (week < 1 || week > 53) return null;
  return { lang: m[1] ?? 'de', canteen: m[2], year, week };
}

export function eatApiUrl(base, canteen, lang, year, week) {
  return `${base}/${lang === 'en' ? 'en/' : ''}${canteen}/${year}/${String(week).padStart(2, '0')}.json`;
}
