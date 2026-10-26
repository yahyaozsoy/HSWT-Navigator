#!/usr/bin/env node
// Enter menus by hand into the menu API (worker/), e.g. for Triesdorf, which has no feed yet.
//
//   MENU_API_URL=https://hswt-navigator.example.workers.dev MENU_ADMIN_TOKEN=… \
//     node tools/menu_import.mjs week.json
//
// week.json – one canteen, one language, any number of days (eat-api's dish format):
//   { "canteen": "mensateria-triesdorf", "lang": "de",
//     "days": [ { "date": "2026-10-26",
//                 "dishes": [ { "name": "Gemüse-Lasagne", "dish_type": "Vegetarisch",
//                               "prices": { "students": { "base_price": 3.2 }, "staff": { "base_price": 4.5 } },
//                               "labels": ["VEGETARIAN", "GLUTEN", "MILK"] } ] } ] }
//
// Labels use eat-api's codes (js/data/mensa-labels.js). Every dish must list them – allergens
// included – because the app shows "contains" warnings from them.

import { readFileSync } from 'node:fs';

const [file] = process.argv.slice(2);
const base = process.env.MENU_API_URL?.replace(/\/$/, '');
const token = process.env.MENU_ADMIN_TOKEN;
if (!file || !base || !token) {
  console.error('usage: MENU_API_URL=https://… MENU_ADMIN_TOKEN=… node tools/menu_import.mjs week.json');
  process.exit(2);
}

const week = JSON.parse(readFileSync(file, 'utf8'));
let failed = 0;
for (const day of week.days ?? []) {
  const url = `${base}/api/menus/admin/${encodeURIComponent(week.canteen)}/${encodeURIComponent(day.date)}?lang=${week.lang ?? 'de'}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dishes: day.dishes }),
  });
  const body = await res.text();
  console.log(`${day.date}: ${res.status} ${body}`);
  if (!res.ok) failed++;
}
process.exit(failed ? 1 : 0);
