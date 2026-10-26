// Canteens served by the menu API. `source` says where the daily sync gets the menu:
//   eat-api – TUM-Dev eat-api (Studierendenwerk München Oberbayern), German and English
//   manual  – entered through the admin endpoint (no machine-readable source yet)
// Ids of eat-api canteens are the same as in eat-api, so the app can fall back to it.

export const CANTEENS = [
  {
    id: 'mensa-weihenstephan',
    name: 'Mensa Weihenstephan',
    campus: 'weihenstephan',
    operator: 'Studierendenwerk München Oberbayern',
    source: 'eat-api',
  },
  {
    id: 'stucafe-weihenstephan-maximus',
    name: 'StuCafé Weihenstephan-Maximus',
    campus: 'weihenstephan',
    operator: 'Studierendenwerk München Oberbayern',
    source: 'eat-api',
  },
  {
    id: 'stucafe-akademie-weihenstephan',
    name: 'StuCafé Akademie Weihenstephan',
    campus: 'weihenstephan',
    operator: 'Studierendenwerk München Oberbayern',
    source: 'eat-api',
  },
  {
    id: 'mensateria-triesdorf',
    name: 'Mensateria Triesdorf',
    campus: 'triesdorf',
    operator: 'Studierendenwerk Erlangen-Nürnberg',
    source: 'manual',
    website: 'https://www.werkswelt.de/?id=trie',
  },
  {
    id: 'lla-mensa-triesdorf',
    name: 'Mensa der Landwirtschaftlichen Lehranstalten Triesdorf',
    campus: 'triesdorf',
    operator: 'Landwirtschaftliche Lehranstalten Triesdorf',
    source: 'manual',
    website: 'https://www.triesdorf.de/essen-trinken-einkaufen/speiseplan',
  },
];

export const canteenById = Object.fromEntries(CANTEENS.map((c) => [c.id, c]));
