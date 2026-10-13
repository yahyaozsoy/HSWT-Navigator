// HSWT room numbers: "<building>.<room>", e.g. "A6.301", "H10.215", "F9.410", "C4.204".
// Also accepted: spaces or dashes instead of the dot ("a6 301", "H10-215") and building aliases
// ("H9A.012"). The room part is kept as written; HSWT room numbers don't reliably encode the floor.

// With a separator any room number is accepted ("A6.3"); without one ("A6301") it must have
// three digits, so a bare "H10" stays building H10 instead of becoming room "H1.0".
const ROOM_PART = /^([\s.\-]*)([a-z]?\d{1,4}[a-z]?(?:\.\d{1,3}[a-z]?)?)\s*$/i;

// `buildings`: [{ id, aliases? }]
export function parseRoomCode(input, buildings) {
  const raw = String(input ?? '').trim().toUpperCase();
  if (!raw) return null;
  // Longest code first so "A10.201" is building A10, not A1.
  const codes = buildings
    .flatMap((b) => [b.id, ...(b.aliases ?? []).filter((a) => /^[A-Z]\d{1,2}[A-Z]?$/i.test(a))].map((code) => ({ code: code.toUpperCase(), id: b.id })))
    .sort((a, b) => b.code.length - a.code.length);
  for (const { code, id } of codes) {
    if (!raw.startsWith(code)) continue;
    const m = ROOM_PART.exec(raw.slice(code.length));
    if (!m || (!m[1] && !/^\d{3}/.test(m[2]))) continue;
    return { building: id, room: m[2], code: `${id}.${m[2]}` };
  }
  return null;
}

// Resolve a room against a campus. Returns null when it isn't a room on this campus.
export function locateRoom(input, campus) {
  const parsed = parseRoomCode(input, campus.buildings);
  if (!parsed) return null;
  return { ...parsed, buildingRef: campus.buildings.find((b) => b.id === parsed.building) };
}

// A plain building code ("H10", "a6", "H9A") → building, so classes with only a building still navigate.
export function locateBuilding(input, campus) {
  const raw = String(input ?? '').trim().toUpperCase();
  return campus.buildings.find((b) => b.id.toUpperCase() === raw || (b.aliases ?? []).some((a) => a.toUpperCase() === raw)) ?? null;
}
