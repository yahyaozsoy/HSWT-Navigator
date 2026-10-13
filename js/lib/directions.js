// Real walking and cycling directions from free OpenStreetMap routing services.
//
//   1. FOSSGIS Valhalla (valhalla1.openstreetmap.de) – pedestrian, wheelchair or bicycle profile,
//      turn-by-turn instructions in German/English.
//   2. FOSSGIS OSRM foot/bike profile (routing.openstreetmap.de) – geometry only, no step-free option.
//   3. Offline straight-line estimate.
//
// Both services are the ones openstreetmap.org uses for its own directions; they are free for
// light use. For production traffic, self-host Valhalla or use a keyed provider.

import { estimateBike, estimateWalk, walkingMinutes } from './routing.js';

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
export const OSRM_URLS = {
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
};
const TIMEOUT_MS = 8000;

// Google encoded polyline; Valhalla uses precision 6, Google/OSRM precision 5.
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let lat = 0;
  let lng = 0;
  let i = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = str.charCodeAt(i++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

export const MODES = ['walk', 'bike'];

// Route styles. Walking: "main" approximates the paths people actually use – designated
// footways and lit paths are preferred, field tracks avoided. (True "where people walk" needs
// usage data.) Cycling: "main" keeps to cycleways and quiet
// streets and avoids rough surfaces; "fast" accepts main roads.
export const ROUTE_STYLES = ['fast', 'main'];
const STYLE_OPTIONS = {
  walk: {
    fast: {},
    main: { walkway_factor: 0.7, sidewalk_factor: 0.85, use_lit: 1, use_tracks: 0, alley_factor: 2 },
  },
  bike: {
    fast: { bicycle_type: 'Hybrid', cycling_speed: 16, use_roads: 0.6, use_hills: 0.5 },
    main: { bicycle_type: 'Hybrid', cycling_speed: 15, use_roads: 0.15, use_hills: 0.3, avoid_bad_surfaces: 0.5, use_living_streets: 0.8 },
  },
};

export function valhallaRequestUrl(from, to, { mode = 'walk', stepFree = false, lang = 'de', style = 'fast', alternates = 2 } = {}) {
  const options = { ...(STYLE_OPTIONS[mode]?.[style] ?? STYLE_OPTIONS[mode]?.fast ?? {}) };
  const costing = mode === 'bike' ? 'bicycle' : 'pedestrian';
  if (costing === 'pedestrian' && stepFree) options.type = 'wheelchair';
  const body = {
    locations: [
      { lat: from[0], lon: from[1] },
      { lat: to[0], lon: to[1] },
    ],
    costing,
    costing_options: { [costing]: options },
    directions_options: { units: 'kilometers', language: lang === 'de' ? 'de-DE' : 'en-US' },
    ...(alternates ? { alternates } : {}),
  };
  return `${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(body))}`;
}

function parseValhallaTrip(trip) {
  const leg = trip?.legs?.[0];
  if (!leg?.shape) return null;
  return {
    provider: 'Valhalla (FOSSGIS)',
    coords: decodePolyline(leg.shape, 6),
    meters: trip.summary.length * 1000,
    minutes: Math.max(1, Math.round(trip.summary.time / 60)),
    // Each step keeps where it starts on the line (for live guidance) and Valhalla's spoken versions.
    steps: (leg.maneuvers ?? [])
      .filter((m) => m.instruction)
      .map((m) => ({
        text: m.instruction,
        meters: (m.length ?? 0) * 1000,
        type: m.type ?? 0,
        shapeIndex: m.begin_shape_index ?? null,
        verbal: m.verbal_pre_transition_instruction || m.instruction,
        alert: m.verbal_transition_alert_instruction || null,
      })),
    approx: false,
  };
}

// → [main route, ...alternatives] (empty if the response has no route)
export function parseValhalla(json) {
  return [json?.trip, ...(json?.alternates ?? []).map((a) => a.trip)].map(parseValhallaTrip).filter(Boolean);
}

export function osrmRequestUrl(from, to, mode = 'walk') {
  return `${OSRM_URLS[mode] ?? OSRM_URLS.walk}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&alternatives=true`;
}

// Walking time comes from the distance (OSRM's foot speed is optimistic); cycling uses OSRM's duration.
export function parseOsrm(json, mode = 'walk') {
  if (json?.code !== 'Ok') return [];
  return (json.routes ?? []).map((route) => ({
    provider: 'OSRM (FOSSGIS)',
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    meters: route.distance,
    minutes: mode === 'bike' ? Math.max(1, Math.round(route.duration / 60)) : walkingMinutes(route.distance),
    steps: [],
    approx: false,
    noStepFree: true,
  }));
}

// Drop alternatives that are practically the same walk as an earlier route.
export function distinctRoutes(routes) {
  const kept = [];
  for (const r of routes) {
    const sameAs = (k) => Math.abs(k.meters - r.meters) < 25 && overlap(k.coords, r.coords) > 0.9;
    if (!kept.some(sameAs)) kept.push(r);
  }
  return kept;
}

// Share of `b`'s points lying within ~15 m of a point of `a`.
function overlap(a, b) {
  const near = (p) => a.some((q) => Math.abs(p[0] - q[0]) < 0.000135 && Math.abs(p[1] - q[1]) < 0.0002);
  return b.filter(near).length / Math.max(1, b.length);
}

async function fetchJson(url, fetchImpl) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// → the best route, with `alternatives` (other sensible walks, fastest first) attached.
export async function getDirections(from, to, options = {}, fetchImpl = globalThis.fetch) {
  const withAlternatives = (routes) => {
    const [best, ...rest] = distinctRoutes(routes);
    return { ...best, alternatives: rest };
  };
  try {
    const routes = parseValhalla(await fetchJson(valhallaRequestUrl(from, to, options), fetchImpl));
    if (routes.length) return withAlternatives(routes);
  } catch {
    /* fall through to OSRM */
  }
  const mode = options.mode ?? 'walk';
  try {
    const routes = parseOsrm(await fetchJson(osrmRequestUrl(from, to, mode), fetchImpl), mode);
    if (routes.length) return withAlternatives(routes.map((r) => ({ ...r, noStepFree: mode === 'walk' && !!options.stepFree })));
  } catch {
    /* fall through to estimate */
  }
  const estimate = mode === 'bike' ? estimateBike(from, to) : estimateWalk(from, to);
  return { provider: null, coords: [from, to], steps: [], alternatives: [], ...estimate };
}
