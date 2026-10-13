// Live guidance along a route: where you are on the line, what comes next, whether you have
// left the route, and when you have arrived. Pure functions, so they can be tested without GPS.

const M_PER_DEG = 111320;

// Flat local projection (metres) around the route; plenty accurate for a few kilometres.
function projector(lat0) {
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  return ([lat, lng]) => [lng * kx, lat * M_PER_DEG];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Valhalla maneuver types → icon name (Material Symbols).
const MANEUVER_ICONS = {
  4: 'flag', 5: 'flag', 6: 'flag',
  9: 'turn_slight_right', 10: 'turn_right', 11: 'turn_sharp_right', 12: 'u_turn_right',
  13: 'u_turn_left', 14: 'turn_sharp_left', 15: 'turn_left', 16: 'turn_slight_left',
  18: 'turn_slight_right', 19: 'turn_slight_left', 20: 'turn_slight_right', 21: 'turn_slight_left',
  23: 'fork_right', 24: 'fork_left', 25: 'merge', 26: 'roundabout_right', 27: 'roundabout_right',
  39: 'elevator', 40: 'stairs', 41: 'stairs',
};
export const maneuverIcon = (type) => MANEUVER_ICONS[type] ?? 'straight';

// coords: [[lat, lng], …]; steps: [{ text, type, shapeIndex, verbal, alert }, …]
export function prepareRoute(coords, steps = []) {
  const toXY = projector(coords[0][0]);
  const pts = coords.map(toXY);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const at = (index) => cum[Math.max(0, Math.min(index, cum.length - 1))];
  const maneuvers = steps
    .map((s, i) => ({ ...s, id: i, at: s.shapeIndex == null ? null : at(s.shapeIndex) }))
    .filter((m) => m.at != null);
  return { coords, pts, cum, length: cum.at(-1), toXY, maneuvers };
}

// Closest point on the route. `hintAlong` (the last known progress) avoids jumping onto an
// earlier part of the line where the route doubles back or runs parallel to itself.
export function snap(route, latlng, hintAlong = null) {
  const p = route.toXY(latlng);
  const { pts, cum } = route;
  let best = null;
  for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
    const a = pts[i];
    const b = pts[i + 1] ?? a;
    const len = dist(a, b);
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len ** 2)) : 0;
    const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = dist(p, q);
    const along = cum[i] + t * len;
    const score = d + (hintAlong != null && along < hintAlong - 40 ? 25 : 0);
    if (!best || score < best.score) best = { index: i, along, distance: d, score };
  }
  return best;
}

export function progress(route, latlng, { hintAlong = null } = {}) {
  const s = snap(route, latlng, hintAlong);
  const remaining = Math.max(0, route.length - s.along);
  const next = route.maneuvers.find((m) => m.at > s.along + 3) ?? null;
  return {
    along: s.along,
    offRoute: s.distance,
    remaining,
    fraction: route.length ? s.along / route.length : 1,
    next,
    distanceToNext: next ? next.at - s.along : remaining,
  };
}

// Off the route when further away than GPS noise explains (walking paths are narrower than roads).
export function isOffRoute(prog, accuracy = 10, mode = 'walk') {
  const limit = (mode === 'bike' ? 40 : 30) + Math.min(Math.max(accuracy, 0), 60) * 0.5;
  return prog.offRoute > limit;
}

export function hasArrived(prog, latlng, target, toXY) {
  return prog.remaining < 15 || (toXY && dist(toXY(latlng), toXY(target)) < 20);
}

// Minutes left, scaled from the planned duration.
export function minutesLeft(prog, route, plannedMinutes) {
  if (!route.length) return 0;
  return Math.max(0, Math.round((plannedMinutes * prog.remaining) / route.length));
}

// What to say, if anything, at this point: a heads-up when a turn is still far away, the
// instruction itself shortly before it. Each is spoken once (tracked in `spoken`).
export function announcement(prog, spoken, mode = 'walk') {
  const m = prog.next;
  if (!m) return null;
  const soon = mode === 'bike' ? 60 : 30;
  if (prog.distanceToNext <= soon && !spoken.has(`${m.id}:now`)) {
    spoken.add(`${m.id}:now`).add(`${m.id}:alert`);
    return m.verbal || m.text;
  }
  if (prog.distanceToNext <= soon * 5 && prog.distanceToNext > soon * 2 && m.alert && !spoken.has(`${m.id}:alert`)) {
    spoken.add(`${m.id}:alert`);
    return m.alert;
  }
  return null;
}

// Public transport: which stop of the ride you are closest to, and how many are left.
export function rideProgress(leg, latlng) {
  const toXY = projector(latlng[0]);
  const p = toXY(latlng);
  const stops = [leg.from, ...(leg.intermediate ?? []), leg.to];
  let nearest = 0;
  stops.forEach((s, i) => {
    if (dist(p, toXY(s.latlng)) < dist(p, toXY(stops[nearest].latlng))) nearest = i;
  });
  const toEnd = dist(p, toXY(leg.to.latlng));
  return { stopsLeft: stops.length - 1 - nearest, metersToExit: toEnd };
}
