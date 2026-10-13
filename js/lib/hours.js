// Opening-hours status. Formatting ("Geöffnet · bis 14:00 Uhr") lives in i18n.js.

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function openingStatus(hours, now = new Date()) {
  if (!hours) return { known: false };
  const day = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();

  for (const [start, end] of hours[day] ?? []) {
    if (minute >= toMinutes(start) && minute < toMinutes(end)) {
      return { known: true, open: true, closesAt: end, closingSoon: toMinutes(end) - minute <= 30 };
    }
  }

  // Look ahead up to a week for the next opening.
  for (let offset = 0; offset < 8; offset++) {
    const d = (day + offset) % 7;
    const ranges = [...(hours[d] ?? [])].sort((a, b) => toMinutes(a[0]) - toMinutes(b[0]));
    for (const [start] of ranges) {
      if (offset > 0 || toMinutes(start) > minute) {
        return { known: true, open: false, opensAt: start, opensDay: d, opensIn: offset };
      }
    }
  }
  return { known: true, open: false };
}
