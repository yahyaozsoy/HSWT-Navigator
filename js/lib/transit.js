// Public transport: journeys and live departures from Transitous (https://transitous.org),
// a free, community-run MOTIS server with timetables for all of Germany (DELFI, incl. MVV
// buses in Freising) and real-time data where operators publish it.
//
// Usage policy (transitous.org/api): open-source, non-commercial apps; identify yourself (in
// browsers the Referer is enough, with contact details on the site); ask the maintainers
// before sending a lot of routing traffic. The app therefore only asks when someone opens the
// public-transport tab of a route or a stop's departures, and caches answers.

import { decodePolyline } from './directions.js';

export const TRANSITOUS = 'https://api.transitous.org';
// Newest API version first; servers that don't know it answer 404 and the next one is tried.
export const API_VERSIONS = ['v6', 'v5'];
const TIMEOUT_MS = 12000;
const STREET_MODES = new Set(['WALK', 'BIKE', 'CAR', 'RENTAL', 'CAR_PARKING', 'CAR_DROPOFF', 'FLEX', 'ODM', 'RIDE_SHARING', 'HGV']);

const ll = ([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

// Journey planner request. `time` + `arriveBy` plan backwards from a class start.
export function planUrl(from, to, { version = API_VERSIONS[0], time = null, arriveBy = false, lang = 'de', wheelchair = false } = {}) {
  const p = new URLSearchParams({ fromPlace: ll(from), toPlace: ll(to), arriveBy: String(arriveBy), language: lang, numItineraries: '4' });
  if (time) p.set('time', time.toISOString());
  if (wheelchair) p.set('pedestrianProfile', 'WHEELCHAIR');
  return `${TRANSITOUS}/api/${version}/plan?${p}`;
}

export function reverseGeocodeUrl(latlng) {
  return `${TRANSITOUS}/api/v1/reverse-geocode?${new URLSearchParams({ place: ll(latlng), type: 'STOP' })}`;
}

export function stopTimesUrl(stopId, { version = API_VERSIONS[0], n = 12 } = {}) {
  return `${TRANSITOUS}/api/${version}/stoptimes?${new URLSearchParams({ stopId, n: String(n) })}`;
}

const validColor = (c) => (/^[0-9a-f]{6}$/i.test(c ?? '') ? `#${c}` : null);
const minutesBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 60000);
const delayOf = (actual, scheduled) => (actual && scheduled ? minutesBetween(actual, scheduled) : 0);

function place(p) {
  return { name: p?.name ?? '', latlng: [p?.lat, p?.lon], track: p?.track ?? p?.scheduledTrack ?? null, stopId: p?.stopId ?? null };
}

function parseLeg(l) {
  const transit = !STREET_MODES.has(l.mode);
  const from = place(l.from);
  const to = place(l.to);
  return {
    mode: l.mode,
    transit,
    line: transit ? l.displayName || l.routeShortName || l.tripShortName || '' : '',
    headsign: l.headsign ?? '',
    color: validColor(l.routeColor),
    textColor: validColor(l.routeTextColor),
    from,
    to,
    start: new Date(l.startTime),
    end: new Date(l.endTime),
    delay: delayOf(l.startTime, l.scheduledStartTime),
    realTime: !!l.realTime,
    cancelled: !!l.cancelled,
    minutes: Math.max(1, Math.round((l.duration ?? (Date.parse(l.endTime) - Date.parse(l.startTime)) / 1000) / 60)),
    meters: l.distance ?? null,
    stops: l.intermediateStops?.length ?? 0,
    intermediate: (l.intermediateStops ?? []).map((s) => ({ name: s.name ?? '', latlng: [s.lat, s.lon] })),
    coords: l.legGeometry?.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6) : [from.latlng, to.latlng],
  };
}

// MOTIS plan response → journeys that actually use public transport (walk-only answers are
// covered by the walking route), earliest departure first.
export function parsePlan(json) {
  return (json?.itineraries ?? [])
    .map((it) => {
      const legs = (it.legs ?? []).map(parseLeg);
      return {
        start: new Date(it.startTime),
        end: new Date(it.endTime),
        minutes: Math.max(1, Math.round((it.duration ?? (Date.parse(it.endTime) - Date.parse(it.startTime)) / 1000) / 60)),
        transfers: it.transfers ?? Math.max(0, legs.filter((l) => l.transit).length - 1),
        legs,
      };
    })
    .filter((j) => j.legs.some((l) => l.transit) && !j.legs.some((l) => l.cancelled))
    .sort((a, b) => a.start - b.start);
}

// MOTIS stoptimes response → departures, soonest first.
export function parseStopTimes(json) {
  return (json?.stopTimes ?? [])
    .map((s) => ({
      line: s.displayName || s.routeShortName || s.tripShortName || '',
      headsign: s.headsign || s.tripTo?.name || '',
      mode: s.mode,
      color: validColor(s.routeColor),
      textColor: validColor(s.routeTextColor),
      time: new Date(s.place?.departure ?? s.place?.arrival),
      delay: delayOf(s.place?.departure, s.place?.scheduledDeparture),
      track: s.place?.track ?? s.place?.scheduledTrack ?? null,
      realTime: !!s.realTime,
      cancelled: !!(s.cancelled || s.tripCancelled),
    }))
    .filter((d) => !Number.isNaN(d.time.getTime()))
    .sort((a, b) => a.time - b.time);
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

// Pick the Transitous stop for one of our stops: same name if possible, otherwise the nearest.
export function pickStop(matches, name) {
  const stops = (matches ?? []).filter((m) => m.type === 'STOP' && m.id);
  const want = norm(name).replace(/\s*\(s\)\s*/, ' ').trim();
  const score = (m) => {
    const n = norm(m.name);
    if (n === want) return 3;
    if (n.endsWith(`, ${want}`) || n.startsWith(`${want},`)) return 2;
    return n.includes(want) ? 1 : 0;
  };
  // Stable: among equal scores the server's order (nearest first) wins.
  return stops.reduce((best, m) => (best && score(best) >= score(m) ? best : m), null);
}

// Journey that gets you there by `deadline` and leaves as late as possible (for "leave by").
export function latestArrivingBy(journeys, deadline) {
  const ok = journeys.filter((j) => j.end <= deadline);
  return ok.sort((a, b) => b.start - a.start)[0] ?? null;
}

async function fetchJson(url, fetchImpl) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Try each API version until one exists on the server.
async function versioned(makeUrl, fetchImpl) {
  let last;
  for (const version of API_VERSIONS) {
    try {
      return await fetchJson(makeUrl(version), fetchImpl);
    } catch (e) {
      last = e;
      if (e.status !== 404) throw e;
    }
  }
  throw last;
}

export async function planJourneys(from, to, options = {}, fetchImpl = globalThis.fetch) {
  return parsePlan(await versioned((version) => planUrl(from, to, { ...options, version }), fetchImpl));
}

const stopIds = new Map(); // our stop → Transitous stop id (stable, so looked up once)

export async function departures(stop, { n = 12 } = {}, fetchImpl = globalThis.fetch) {
  const key = ll(stop.latlng);
  if (!stopIds.has(key)) {
    const match = pickStop(await fetchJson(reverseGeocodeUrl(stop.latlng), fetchImpl), stop.name);
    if (!match) return { stopName: stop.name, departures: [] };
    stopIds.set(key, match);
  }
  const match = stopIds.get(key);
  const json = await versioned((version) => stopTimesUrl(match.id, { version, n }), fetchImpl);
  return { stopName: json?.place?.name || match.name, departures: parseStopTimes(json) };
}
