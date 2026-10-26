// Canteen menus from TUM-Dev's open eat-api (Studierendenwerk München Oberbayern data).
// https://tum-dev.github.io/eat-api/<canteen>/<iso-year>/<iso-week>.json

import { LABELS } from '../data/mensa-labels.js';

export const EAT_API = 'https://tum-dev.github.io/eat-api';
export const EAT_API_RAW = 'https://raw.githubusercontent.com/TUM-Dev/eat-api/gh-pages';
// Our own menu API (worker/, same site): keeps every published day, also for canteens eat-api
// doesn't cover. Same paths and format as eat-api.
export const MENU_API = 'api/menus';
export const ROLES = ['students', 'staff', 'guests'];

// Filter tags derived from eat-api labels. eat-api (and the Studierendenwerk) publish no halal
// certification, so "halal" only marks dishes that avoid what is clearly not halal: it must be
// meat-free (vegan, vegetarian or fish) and contain no pork, alcohol or gelatine.
export const TAGS = [
  { id: 'vegan', icon: 'eco', test: (d) => d.diet === 'vegan' },
  { id: 'vegetarian', icon: 'nutrition', test: (d) => d.diet === 'vegan' || d.diet === 'vegetarian' },
  { id: 'halal', icon: 'mosque', test: (d) => ['vegan', 'vegetarian', 'fish'].includes(d.diet) && !has(d, 'PORK', 'ALCOHOL', 'GELATIN') },
  { id: 'nopork', icon: 'no_food', test: (d) => !has(d, 'PORK') },
  { id: 'noalcohol', icon: 'no_food', test: (d) => !has(d, 'ALCOHOL') },
  { id: 'glutenfree', icon: 'check', test: (d) => !d.allergenFamilies.includes('gluten') },
  { id: 'lactosefree', icon: 'check', test: (d) => !d.allergenFamilies.includes('milk') },
  { id: 'fish', icon: 'set_meal', test: (d) => has(d, 'FISH') },
  { id: 'poultry', icon: 'egg', test: (d) => has(d, 'POULTRY') },
  { id: 'beef', icon: 'restaurant', test: (d) => has(d, 'BEEF', 'VEAL') },
  { id: 'regional', icon: 'location_on', test: (d) => has(d, 'BAVARIA') },
  { id: 'msc', icon: 'set_meal', test: (d) => has(d, 'MSC') },
];
const tagById = Object.fromEntries(TAGS.map((t) => [t.id, t]));
const has = (dish, ...labels) => labels.some((l) => dish.labels.includes(l));

// Badges that are only true if every allergen and ingredient is labelled.
const FREE_FROM = ['halal', 'glutenfree', 'lactosefree'];

// Tags shown as badges on a dish (the "free-from" ones only when they say something useful).
// `completeLabels: false` (menus not labelled by the Studierendenwerk's own system) drops the
// badges that are concluded from a missing label: a missing label must never read as "free from".
export function dishTags(dish, { completeLabels = true } = {}) {
  const shown = ['vegan', 'vegetarian', 'halal', 'glutenfree', 'lactosefree', 'regional', 'msc'].filter((id) => completeLabels || !FREE_FROM.includes(id));
  const tags = shown.filter((id) => tagById[id].test(dish));
  // "vegetarian" is implied by "vegan".
  return tags.includes('vegan') ? tags.filter((t) => t !== 'vegetarian') : tags;
}

// A dish passes when it has every selected tag.
export function matchesTags(dish, selected) {
  return selected.every((id) => tagById[id]?.test(dish) ?? true);
}

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

// eat-api (and our API) publish the same menus with English dish names under /en/.
export function menuUrl(canteenId, date, lang = 'de', base = EAT_API) {
  const { year, week } = isoWeek(date);
  return `${base}/${lang === 'en' ? 'en/' : ''}${canteenId}/${year}/${String(week).padStart(2, '0')}.json`;
}

// Where to look for a canteen's week, in order: our API first, then eat-api if it covers the canteen.
export function menuSources(canteen, date, lang = 'de') {
  return [MENU_API, ...(canteen.eatApi ? [EAT_API, EAT_API_RAW] : [])].map((base) => menuUrl(canteen.menu, date, lang, base));
}

// On weekends the useful menu is next week's.
export function menuWeekStart(today) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 6 ? 2 : dow === 0 ? 1 : 1 - dow));
  return d;
}

function dietOf(labels) {
  if (labels.has('VEGAN')) return 'vegan';
  if (labels.has('VEGETARIAN')) return 'vegetarian';
  if (['MEAT', 'PORK', 'BEEF', 'VEAL', 'WILD_MEAT', 'LAMB', 'POULTRY'].some((l) => labels.has(l))) return 'meat';
  if (labels.has('FISH')) return 'fish';
  return null;
}

// Raw eat-api dish → display model (language-neutral; names are picked in the UI).
export function parseDish(dish) {
  const labels = new Set(dish.labels ?? []);
  const known = [...labels].filter((l) => LABELS[l]);
  const byGroup = (g) => known.filter((l) => LABELS[l].group === g);
  const allergenFamilies = [...new Set(byGroup('allergen').map((l) => LABELS[l].allergen))];
  return {
    name: dish.name,
    labels: [...labels],
    type: dish.dish_type ?? '',
    prices: dish.prices ?? {},
    diet: dietOf(labels),
    meat: ['PORK', 'BEEF', 'VEAL', 'WILD_MEAT', 'LAMB', 'POULTRY', 'FISH'].filter((l) => labels.has(l)),
    allergens: byGroup('allergen'),
    allergenFamilies,
    additives: byGroup('additive'),
    quality: byGroup('quality'),
  };
}

export function daysOf(weekJson) {
  return (weekJson?.days ?? []).map((d) => ({ date: d.date, dishes: (d.dishes ?? []).map(parseDish) }));
}

export function dishesOn(weekJson, isoDate) {
  return daysOf(weekJson).find((d) => d.date === isoDate)?.dishes ?? [];
}

// { base_price, price_per_unit, unit } → "3,35 €", "0,90 €/100g", "1,50 € + 0,90 €/100g", or "" if unknown.
export function formatPrice(p, locale = 'de-DE') {
  if (!p) return '';
  const eur = (v) => v.toLocaleString(locale, { style: 'currency', currency: 'EUR' });
  return [p.base_price ? eur(p.base_price) : '', p.price_per_unit ? `${eur(p.price_per_unit)}/${p.unit ?? ''}` : '']
    .filter(Boolean)
    .join(' + ');
}

// Allergen families of `dish` the user wants to avoid.
export function conflicts(dish, avoid) {
  return dish.allergenFamilies.filter((f) => avoid.includes(f));
}

// Keep the API's order of dish types ("StudiTopf", "Gericht 1", …).
export function groupByType(dishes) {
  const groups = new Map();
  for (const d of dishes) {
    if (!groups.has(d.type)) groups.set(d.type, []);
    groups.get(d.type).push(d);
  }
  return [...groups].map(([type, items]) => ({ type, dishes: items }));
}
