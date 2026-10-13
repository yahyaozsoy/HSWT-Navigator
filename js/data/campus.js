// Campus data for HSWT Navigator.
//
// Geometry (footprints, positions, bus stops, car parks) comes from the official HSWT site plan,
// snapped to OpenStreetMap footprints (weihenstephan.generated.js). Offices, people and addresses come from www.hswt.de (hswt.js).
//
// Hours format: { <weekday 0=Sun..6=Sat>: [["HH:MM", "HH:MM"], ...] }

import geo from './weihenstephan.generated.js';
import { ADDRESSES, FACULTIES, PEOPLE, SERVICES } from './hswt.js';
import scrapedPeople from './people.generated.js';
import mobility from './mobility.generated.js';

const weekdays = (open, close, friClose = close) => ({
  1: [[open, close]],
  2: [[open, close]],
  3: [[open, close]],
  4: [[open, close]],
  5: [[open, friClose]],
});

// Extra names people use for a building (OSM names and well-known uses).
const BUILDING_NAMES = {
  A7: 'Salettl',
  A8: { de: 'Zentralbibliothek', en: 'Central library' },
  A9: 'Kustermannhalle',
};

const buildings = Object.entries(geo.buildings).map(([id, b]) => {
  const here = SERVICES.filter((s) => s.building === id);
  const extra = BUILDING_NAMES[id];
  return {
    id,
    kind: 'building',
    name: { de: `Gebäude ${id}`, en: `Building ${id}` },
    subtitle: extra ?? null,
    description: here.length
      ? { de: here.map((s) => s.name.de ?? s.name).join(' · '), en: here.map((s) => s.name.en ?? s.name).join(' · ') }
      : null,
    address: ADDRESSES[id] ? `${ADDRESSES[id]}, 85354 Freising` : null,
    aliases: [...(b.aliases ?? []), ...(extra ? Object.values(typeof extra === 'object' ? extra : { x: extra }) : [])],
    latlng: b.latlng,
    footprints: b.footprints,
    source: b.source,
    services: here.map((s) => s.id),
  };
});
const buildingById = Object.fromEntries(buildings.map((b) => [b.id, b]));

// Offices and facilities from hswt.de, placed at their building.
const services = SERVICES.filter((s) => buildingById[s.building]).map((s) => ({
  ...s,
  kind: 'service',
  latlng: buildingById[s.building].latlng,
  address: buildingById[s.building].address,
}));

// Canteens: locations and hours from TUM-Dev eat-api, menus fetched live.
const canteens = [
  {
    id: 'mensa',
    kind: 'food',
    category: 'food',
    name: 'Mensa Weihenstephan',
    description: { de: 'Mittagessen · Studierendenwerk', en: 'Lunch · Studierendenwerk' },
    address: 'Maximus-von-Imhof-Forum 5, 85354 Freising',
    aliases: ['Mensa', 'Canteen', 'Essen', 'Mittagessen', 'Lunch', 'Speiseplan', 'Menu'],
    latlng: [48.39959, 11.723147],
    hours: weekdays('11:00', '13:30'),
    menu: 'mensa-weihenstephan',
  },
  {
    id: 'stucafe-maximus',
    kind: 'food',
    category: 'food',
    name: 'StuCafé Weihenstephan-Maximus',
    description: { de: 'Kaffee & Snacks', en: 'Coffee & snacks' },
    address: 'Maximus-von-Imhof-Forum 5, 85354 Freising',
    aliases: ['Café', 'Cafe', 'Kaffee', 'Coffee', 'StuCafé', 'Snack'],
    latlng: [48.399751, 11.723394],
    hours: weekdays('08:30', '15:00', '14:00'),
  },
  {
    id: 'stucafe-akademie',
    kind: 'food',
    category: 'food',
    name: 'StuCafé Akademie Weihenstephan',
    description: { de: 'Kaffee & Snacks', en: 'Coffee & snacks' },
    address: 'Alte Akademie 1, 85354 Freising',
    aliases: ['Café', 'Cafe', 'Kaffee', 'Coffee', 'StuCafé', 'Akademie', 'Snack'],
    latlng: [48.3948, 11.729338],
    hours: weekdays('08:00', '14:30', '14:00'),
  },
];

// TUM's branch library next to the Mensa: open late and on weekends, a popular study spot.
// Hours from ub.tum.de (via NavigaTUM, Aug 2026).
const study = geo.extras?.tumLibrary
  ? [
      {
        id: 'tum-library',
        kind: 'study',
        category: 'study',
        name: { de: 'TUM Teilbibliothek Weihenstephan', en: 'TUM Branch Library Weihenstephan' },
        description: { de: 'Lernplätze bis Mitternacht, auch am Wochenende', en: 'Study spaces until midnight, weekends too' },
        address: 'Maximus-von-Imhof-Forum 1, 85354 Freising',
        aliases: ['Bibliothek', 'Library', 'TUM', 'UB', 'Teilbibliothek', 'Lernplatz', 'Lernen', 'Study', 'Wochenende'],
        latlng: geo.extras.tumLibrary.latlng,
        footprints: geo.extras.tumLibrary.footprints,
        hours: { ...weekdays('08:00', '24:00'), 6: [['10:00', '20:00']], 0: [['10:00', '20:00']] },
        note: {
          de: 'Ausleihe mit Bibliotheksausweis; HSWT-Studierende melden sich über die gemeinsame Anmeldekarte HSWT/TUM an.',
          en: 'Borrowing needs a library card; HSWT students register with the joint HSWT/TUM registration card.',
        },
        url: 'https://www.ub.tum.de/en/branch-library-weihenstephan',
      },
    ]
  : [];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const residences = Object.entries(geo.residences)
  .map(([code, r]) => ({
    id: code.replace(' ', ''),
    kind: 'residence',
    category: 'living',
    name: { de: `Wohnheim ${code.slice(3)}`, en: `Residence hall ${code.slice(3)}` },
    description: { de: 'Studierendenwohnheim', en: 'Student residence' },
    aliases: ['Wohnheim', 'WH', 'Residence', 'Dorm', code],
    latlng: r.latlng,
    footprints: r.footprints,
  }))
  .sort((a, b) => ROMAN.indexOf(a.id.slice(2)) - ROMAN.indexOf(b.id.slice(2)));

const community = [
  {
    id: 'hsg',
    kind: 'community',
    category: 'living',
    name: { de: 'Hochschulgemeinde (HSG)', en: 'University chaplaincy (HSG)' },
    description: { de: 'Hochschulgemeinde Freising', en: 'Hochschulgemeinde Freising' },
    aliases: ['HSG', 'Hochschulgemeinde', 'KHG', 'ESG'],
    latlng: geo.hsg.latlng,
    footprints: geo.hsg.footprints,
  },
];

// Stops within a short walk of an HSWT building (plus the station) are listed under "Bus & Bahn";
// the others stay searchable and on the map.
const nearCampus = (latlng) => buildings.some((b) => Math.hypot((b.latlng[0] - latlng[0]) * 111.1, (b.latlng[1] - latlng[1]) * 74) < 0.3);

const stops = geo.stops.map((s, i) => ({
  id: `stop-${i}`,
  kind: 'transit',
  category: 'transit',
  listed: s.modes.includes('regional_rail') || nearCampus(s.latlng),
  name: s.name === 'Freising' ? 'Freising Bahnhof' : s.name,
  timetableName: s.name, // as in the DELFI timetable (used to match live departures)
  description: s.modes.includes('regional_rail')
    ? { de: 'S-Bahn, Regionalzüge, Busse', en: 'S-Bahn, regional trains, buses' }
    : { de: 'Bushaltestelle', en: 'Bus stop' },
  aliases: ['Bus', 'Haltestelle', 'Stop', ...(s.modes.includes('regional_rail') ? ['Bahnhof', 'Station', 'S-Bahn', 'Zug', 'Train'] : [])],
  latlng: s.latlng,
}));

// Bike parking checked on site but not (yet) in OpenStreetMap. Kept here so a data refresh
// doesn't lose it; once it is mapped in OSM, remove it here.
const EXTRA_BIKE_PARKING = [
  { latlng: [48.39845, 11.73356], where: 'C5, courtyard between the north and east wing (on site, Oct 2026)' },
];

// Bike sharing stations (OpenStreetMap amenity=bicycle_rental, via mobility.generated.js).
// Several stations share one name, so each says where it is (nearest HSWT building or stop).
const km = (a, b) => Math.hypot((a[0] - b[0]) * 111.1, (a[1] - b[1]) * 74);
const closest = (list, latlng) => list.reduce((best, x) => (km(x.latlng, latlng) < km(best.latlng, latlng) ? x : best));
const bikeRental = mobility.bikeRental
  .map((r) => {
    const building = closest(buildings, r.latlng);
    const near = km(building.latlng, r.latlng) < 0.25 ? { de: `Gebäude ${building.id}`, en: `building ${building.id}` } : null;
    const stop = closest(geo.stops, r.latlng).name;
    return { ...r, where: near ?? { de: `Haltestelle ${stop}`, en: `stop ${stop}` } };
  })
  .sort((a, b) => km(a.latlng, [48.3985, 11.7265]) - km(b.latlng, [48.3985, 11.7265]))
  .map((r, i) => ({
    id: `bikeshare-${i}`,
    kind: 'bikeshare',
    category: 'transit',
    listed: true,
    name: r.name,
    description: {
      de: `Leihrad-Station bei ${r.where.de} · Ausleihe per App des Anbieters`,
      en: `Bike sharing near ${r.where.en} · rent via the provider's app`,
    },
    aliases: ['Fahrrad', 'Rad', 'Leihrad', 'Lastenrad', 'Bike', 'Bike sharing', 'Cargo bike'],
    latlng: r.latlng,
  }));

// Curated people (hswt.js) plus everyone from the directory data who isn't curated yet.
const personKey = (name) => name.replace(/^(Prof\.|Dr\.|-Ing\.|habil\.|\s)+/g, '').toLowerCase();
const curated = new Set(PEOPLE.map((p) => personKey(p.name)));
const scraped = scrapedPeople
  .filter((p) => p.room && !curated.has(personKey(p.name)))
  .map((p) => ({
    name: p.name,
    faculty: p.faculty,
    room: p.room,
    field: p.field ? { de: p.field, en: p.field } : null,
    note: p.hours ? { de: `Sprechzeiten: ${p.hours}`, en: `Office hours: ${p.hours}` } : null,
    url: p.url,
  }));

const people = [...PEOPLE, ...scraped].map((p, i) => {
  const building = p.room.split('.')[0];
  return { ...p, id: `person-${i}`, kind: 'person', building, facultyName: FACULTIES[p.faculty] };
});

export const CAMPUSES = [
  {
    id: 'weihenstephan',
    name: 'Weihenstephan',
    city: 'Freising',
    center: [48.3985, 11.7265],
    zoom: 16,
    station: stops.find((s) => s.name === 'Freising Bahnhof')?.latlng ?? [48.395252, 11.744187],
    georeference: geo.georeference,
    buildings,
    pois: [...canteens, ...services, ...study, ...community, ...residences, ...stops, ...bikeRental],
    bikeParking: [...mobility.bikeParking, ...EXTRA_BIKE_PARKING.map((b) => b.latlng)],
    people,
    unlabeledFootprints: geo.unlabeledFootprints,
    parking: geo.parking,
  },
];

export function getCampus(id) {
  return CAMPUSES.find((c) => c.id === id) ?? CAMPUSES[0];
}

// Every building and POI as one list of navigable places.
export function placesOf(campus) {
  return [...campus.buildings, ...campus.pois];
}

// Places shown under a category heading (transit only lists the stops near campus).
export function placesInCategory(campus, category) {
  return campus.pois.filter((p) => p.category === category && (category !== 'transit' || p.listed));
}
