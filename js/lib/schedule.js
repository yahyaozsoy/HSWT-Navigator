// Personal timetable: weekly classes and one-off events, plus .ics import.
//
// Entry shape:
//   { id, title, room, start: "HH:MM", end: "HH:MM", day?: 0-6 (weekly), date?: "YYYY-MM-DD" (one-off) }

import { toMinutes } from './hours.js';

export function isoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function at(date, hhmm) {
  const d = new Date(date);
  const mins = toMinutes(hhmm);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d;
}

export function occursOn(entry, date) {
  if (entry.date) return entry.date === isoDate(date);
  if (entry.until && isoDate(date) > entry.until) return false;
  if (entry.from && isoDate(date) < entry.from) return false;
  return entry.day === date.getDay();
}

export function eventsOn(entries, date) {
  return entries
    .filter((e) => occursOn(e, date))
    .map((e) => ({ entry: e, startsAt: at(date, e.start), endsAt: at(date, e.end) }))
    .sort((a, b) => a.startsAt - b.startsAt);
}

// The class happening now, or the next one within `horizonDays`.
export function nextEvent(entries, now = new Date(), horizonDays = 7) {
  for (let offset = 0; offset <= horizonDays; offset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    for (const ev of eventsOn(entries, day)) {
      if (ev.endsAt <= now) continue;
      return { ...ev, ongoing: ev.startsAt <= now };
    }
  }
  return null;
}

// When to leave to arrive `bufferMin` minutes early.
export function leaveBy(startsAt, walkMinutes, bufferMin = 3) {
  return new Date(startsAt.getTime() - (walkMinutes + bufferMin) * 60000);
}

// ---------- iCalendar (.ics) import ----------

const ICS_DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

// "20261012T081500" / "20261012T081500Z" / "20261012" → Date (local time; Z is converted)
export function parseIcsDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  return z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function parseIcs(text) {
  const entries = [];
  let ev = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') {
      if (ev?.start && ev.summary) entries.push(...toEntries(ev, entries.length));
      ev = null;
    } else if (ev) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const name = line.slice(0, idx).split(';')[0].toUpperCase();
      const value = line.slice(idx + 1);
      if (name === 'SUMMARY') ev.summary = unescapeText(value);
      else if (name === 'LOCATION') ev.location = unescapeText(value);
      else if (name === 'DTSTART') ev.start = parseIcsDate(value);
      else if (name === 'DTEND') ev.end = parseIcsDate(value);
      else if (name === 'RRULE') ev.rrule = Object.fromEntries(value.split(';').map((p) => p.split('=')));
      else if (name === 'UID') ev.uid = value.trim();
    }
  }
  return entries;
}

function toEntries(ev, index) {
  const end = ev.end ?? new Date(ev.start.getTime() + 90 * 60000);
  const base = {
    title: ev.summary,
    room: ev.location ?? '',
    start: hhmm(ev.start),
    end: hhmm(end),
    source: 'ics',
  };
  const id = ev.uid ?? `ics-${index}`;
  if (ev.rrule?.FREQ === 'WEEKLY') {
    const days = ev.rrule.BYDAY
      ? ev.rrule.BYDAY.split(',').map((d) => ICS_DAYS[d.slice(-2)]).filter((d) => d !== undefined)
      : [ev.start.getDay()];
    const until = ev.rrule.UNTIL ? parseIcsDate(ev.rrule.UNTIL) : null;
    return days.map((day) => ({
      ...base,
      id: `${id}-${day}`,
      day,
      from: isoDate(ev.start),
      ...(until ? { until: isoDate(until) } : {}),
    }));
  }
  return [{ ...base, id, date: isoDate(ev.start) }];
}
