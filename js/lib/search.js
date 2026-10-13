// Search across rooms, buildings, services and the user's own classes.

import { locateBuilding, locateRoom } from './rooms.js';
import { categoryById } from '../data/categories.js';

// Lowercase, accent-free. German umlauts become "ae/oe/ue" (or plain "a/o/u" with `transliterate: false`).
export function normalize(s, { transliterate = true } = {}) {
  let t = String(s ?? '').toLowerCase();
  if (transliterate) t = t.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  return t
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function scoreForm(query, t) {
  if (!t) return 0;
  if (t === query) return 100;
  if (t.startsWith(query)) return 80;
  if (t.split(/[\s/–·(),.-]+/).some((w) => w.startsWith(query))) return 60;
  if (t.includes(query)) return 40;
  return 0;
}

// `query` is already normalized; the text is tried in both umlaut spellings.
function scoreText(query, text) {
  return Math.max(scoreForm(query, normalize(text)), scoreForm(query, normalize(text, { transliterate: false })));
}

const texts = (v) => (v && typeof v === 'object' ? Object.values(v) : [v]);

// places: placesOf(campus); classes: schedule entries; contacts: the user's own saved offices
export function search(query, { campus, places, classes = [], contacts = [], i18n }) {
  const q = normalize(query);
  if (!q) return [];
  const results = [];

  const room = locateRoom(query, campus);
  if (room) {
    results.push({
      type: 'room',
      score: 120,
      title: i18n.t('room.title', { code: room.code }),
      subtitle: [i18n.pick(room.buildingRef.name), room.buildingRef.address].filter(Boolean).join(' · '),
      placeId: room.buildingRef.id,
      room,
    });
  }

  for (const p of places) {
    const score = Math.max(
      scoreText(q, p.id) + (normalize(p.id) === q ? 20 : 0),
      ...texts(p.name).map((n) => scoreText(q, n)),
      ...texts(p.subtitle).map((n) => scoreText(q, n) - 5),
      ...(p.aliases ?? []).map((a) => scoreText(q, a) - 5),
      ...texts(p.description).map((d) => scoreText(q, d) / 2),
      p.room ? scoreText(q, p.room) : 0,
    );
    // Stops are numerous; keep them below buildings and services for equal matches.
    const adjusted = p.kind === 'transit' ? score - 15 : score;
    if (adjusted > 0) {
      results.push({
        type: p.kind,
        score: adjusted,
        title: i18n.pick(p.name),
        // Label by category ("Bibliotheken & Lernen"), so related places read alike whoever runs them.
        subtitle: [p.category ? i18n.pick(categoryById[p.category].name) : i18n.t(`kind.${p.kind}`), p.room ?? i18n.pick(p.subtitle), i18n.pick(p.description)]
          .filter(Boolean)
          .join(' · '),
        category: p.category ?? null,
        placeId: p.id,
      });
    }
  }

  const person = (p, type, extraScore = 0) => {
    // Match any part of the name ("laube", "julia"), the room or the subject.
    const nameScore = Math.max(...p.name.split(/\s+/).filter((w) => !/^(prof|dr)\.?$/i.test(w)).map((w) => scoreText(q, w)), scoreText(q, p.name));
    const score = Math.max(nameScore, scoreText(q, p.room) - 10, ...texts(p.field).map((f) => scoreText(q, f) / 2), ...texts(p.facultyName).map((f) => scoreText(q, f) / 3));
    if (score <= 0) return;
    const loc = locateRoom(p.room, campus);
    results.push({
      type,
      score: score + extraScore,
      title: p.name,
      subtitle: [i18n.t(`kind.${type}`), p.room, i18n.pick(p.field)].filter(Boolean).join(' · '),
      placeId: loc?.buildingRef.id ?? locateBuilding(p.room, campus)?.id ?? null,
      room: loc,
      personId: p.id,
    });
  };
  campus.people.forEach((p) => person(p, 'person'));
  contacts.forEach((c) => person(c, 'contact', 5));

  for (const c of classes) {
    const score = Math.max(scoreText(q, c.title), scoreText(q, c.room) - 10);
    if (score > 0) {
      const loc = locateRoom(c.room, campus);
      const building = loc?.buildingRef ?? locateBuilding(c.room, campus);
      results.push({
        type: 'class',
        score: score - 1,
        title: c.title,
        subtitle: `${i18n.t('kind.class')} · ${c.room || '—'}`,
        placeId: building?.id ?? null,
        room: loc,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}
