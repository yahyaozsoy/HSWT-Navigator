// Distances and walking-time estimates (used offline and for "leave by" before a real route arrives).

const EARTH_RADIUS_M = 6371000;
export const WALKING_SPEED_M_PER_MIN = 80; // ~4.8 km/h
export const CYCLING_SPEED_M_PER_MIN = 250; // ~15 km/h, relaxed city cycling
const DETOUR_FACTOR = 1.3; // paths are longer than the straight line

export function distanceMeters([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function walkingMinutes(meters) {
  return Math.max(1, Math.ceil(meters / WALKING_SPEED_M_PER_MIN));
}

export function cyclingMinutes(meters) {
  return Math.max(1, Math.ceil(meters / CYCLING_SPEED_M_PER_MIN));
}

export function estimateWalk(from, to) {
  const meters = distanceMeters(from, to) * DETOUR_FACTOR;
  return { meters, minutes: walkingMinutes(meters), approx: true };
}

export function estimateBike(from, to) {
  const meters = distanceMeters(from, to) * DETOUR_FACTOR;
  return { meters, minutes: cyclingMinutes(meters), approx: true };
}

export function nearest(items, latlng, key = (x) => x.latlng) {
  let best = null;
  for (const item of items) {
    const meters = distanceMeters(latlng, key(item));
    if (!best || meters < best.meters) best = { item, meters };
  }
  return best;
}
