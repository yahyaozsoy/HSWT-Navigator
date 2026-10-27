// Campus Triesdorf (Weidenbach, Middle Franconia).
//
// Geometry comes from the official HSWT site plan, georeferenced against OpenStreetMap and
// snapped to its footprints (triesdorf.generated.js). The numbered neighbours of the plan
// belong to the Landwirtschaftliche Lehranstalten Triesdorf and other schools, not to HSWT.

import geo from './triesdorf.generated.js';

const weekdays = (open, close, friClose = close) => ({
  1: [[open, close]],
  2: [[open, close]],
  3: [[open, close]],
  4: [[open, close]],
  5: [[open, friClose]],
});

const ADDRESS = 'Markgrafenstraße 16, 91746 Weidenbach';
const STATION = { name: 'Triesdorf Bahnhof', latlng: [49.200252, 10.680034] }; // OSM railway=station

// What people know a building for (the library room is from the HSWT library guide).
const BUILDING_NAMES = {
  A: { de: 'Teilbibliothek (A.004)', en: 'Branch library (A.004)' },
  H: 'Mensateria',
};

const buildings = Object.entries(geo.buildings).map(([id, b]) => {
  const extra = BUILDING_NAMES[id];
  return {
    id,
    kind: 'building',
    name: { de: `Gebäude ${id}`, en: `Building ${id}` },
    subtitle: extra ?? null,
    description: null,
    address: id === 'H' ? 'Markgrafenstraße 14, 91746 Weidenbach' : ADDRESS,
    aliases: extra ? Object.values(typeof extra === 'object' ? extra : { x: extra }) : [],
    latlng: b.latlng,
    footprints: b.footprints,
    source: b.source,
    services: [],
  };
});

const [llaMensa, mensateria] = [...geo.gastro].sort((a, b) => a[0] - b[0]);

const canteens = [
  {
    id: 'mensa',
    kind: 'food',
    category: 'food',
    name: 'Mensateria Triesdorf',
    subtitle: 'Gastwirtschaft zum Adler',
    description: { de: 'Mittagessen 11:30–14:00 · Studierendenwerk Erlangen-Nürnberg', en: 'Lunch 11:30–14:00 · Studierendenwerk Erlangen-Nürnberg' },
    address: 'Markgrafenstraße 14, 91746 Weidenbach',
    building: 'H',
    aliases: ['Mensa', 'Mensateria', 'Adler', 'Canteen', 'Essen', 'Mittagessen', 'Lunch', 'Speiseplan', 'Menu', 'Café', 'Cafe'],
    latlng: mensateria,
    hours: weekdays('08:00', '16:00', '14:00'),
    note: { de: 'Mittagessen Mo–Fr 11:30–14:00', en: 'Lunch Mon–Fri 11:30–14:00' },
    menu: 'mensateria-triesdorf', // stored by our menu API (worker/) when entered
    menuUrl: 'https://www.werkswelt.de/?id=trie',
    menuProvider: 'Studierendenwerk Erlangen-Nürnberg',
    url: 'https://www.werkswelt.de/?id=trie',
  },
  {
    id: 'lla-mensa',
    kind: 'food',
    category: 'food',
    name: { de: 'Mensa der Landwirtschaftlichen Lehranstalten', en: 'Landwirtschaftliche Lehranstalten canteen' },
    subtitle: 'Marstall',
    description: { de: 'Mittagessen · LLA Triesdorf', en: 'Lunch · LLA Triesdorf' },
    address: 'Markgrafenstraße 2, 91746 Weidenbach',
    aliases: ['Mensa', 'LLA', 'Marstall', 'Canteen', 'Mittagessen', 'Lunch'],
    latlng: llaMensa,
    hours: weekdays('11:00', '13:15', '13:00'),
    url: 'https://www.triesdorf.de/essen-trinken-einkaufen/speiseplan',
  },
];

// The site plan doesn't mark the library; HSWT's library guide puts it in room A.004. Like the
// offices in Weihenstephan it is shown inside its building, not as a marker of its own.
const study = [
  {
    id: 'library',
    kind: 'service',
    category: 'study',
    name: { de: 'HSWT Teilbibliothek Triesdorf', en: 'HSWT Branch Library Triesdorf' },
    description: { de: 'Raum A.004 · Ausleihe, Lernplätze', en: 'Room A.004 · lending, study spaces' },
    address: ADDRESS,
    building: 'A',
    room: 'A.004',
    aliases: ['Bibliothek', 'Library', 'Teilbibliothek', 'Lernplatz', 'Lernen', 'Study', 'A.004'],
    latlng: geo.buildings.A.latlng,
  },
];
for (const s of study) {
  const b = buildings.find((x) => x.id === s.building);
  b.services.push(s.id);
  b.description = { de: s.name.de, en: s.name.en };
}

// Campusseelsorge is campus life; the other numbered buildings are landmarks people ask for.
const neighbours = Object.entries(geo.neighbours).map(([num, n]) =>
  num === '13'
    ? {
        id: 'campusseelsorge',
        kind: 'community',
        category: 'living',
        name: { de: 'Campusseelsorge', en: 'Campus chaplaincy' },
        description: { de: 'Hochschul- und Campusseelsorge Triesdorf', en: 'University and campus chaplaincy Triesdorf' },
        aliases: ['Seelsorge', 'KHG', 'ESG', 'Chaplaincy'],
        latlng: n.latlng,
        footprints: n.footprints,
      }
    : {
        id: `lla-${num}`,
        kind: 'landmark',
        name: n.name,
        description: { de: `Nr. ${num} im Lageplan`, en: `No. ${num} on the site plan` },
        aliases: [`Nr. ${num}`, 'LLA', 'Triesdorf'],
        latlng: n.latlng,
        footprints: n.footprints,
      },
);

const km = (a, b) => Math.hypot((a[0] - b[0]) * 111.1, (a[1] - b[1]) * 73);
const nearCampus = (latlng) => buildings.some((b) => km(b.latlng, latlng) < 0.4);

const stops = [...geo.stops, { ...STATION, modes: ['regional_rail', 'bus'] }].map((s, i) => {
  const rail = s.modes.includes('regional_rail');
  return {
    id: `stop-${i}`,
    kind: 'transit',
    category: 'transit',
    listed: rail || nearCampus(s.latlng),
    rail,
    name: s.name,
    timetableName: s.name,
    description: rail ? { de: 'Regionalzüge, Busse', en: 'Regional trains, buses' } : { de: 'Bushaltestelle', en: 'Bus stop' },
    aliases: ['Bus', 'Haltestelle', 'Stop', ...(rail ? ['Bahnhof', 'Station', 'Zug', 'Train'] : [])],
    latlng: s.latlng,
  };
});

export default {
  id: 'triesdorf',
  name: 'Triesdorf',
  city: 'Weidenbach',
  town: 'Triesdorf',
  center: [49.2027, 10.6525],
  zoom: 17,
  station: STATION.latlng,
  stationName: { de: 'Bahnhof Triesdorf', en: 'Triesdorf station' },
  journeyPlanner: { name: { de: 'VGN-Fahrplanauskunft', en: 'VGN journey planner' }, url: 'https://www.vgn.de/' },
  mensaPass: false,
  roomExample: 'A.004',
  georeference: geo.georeference,
  buildings,
  pois: [...canteens, ...study, ...neighbours, ...stops],
  bikeParking: geo.bikeParking,
  people: [],
  unlabeledFootprints: [],
  parking: geo.parking,
};
