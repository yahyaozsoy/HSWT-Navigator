import { CAMPUSES, getCampus, placesOf, placesInCategory } from './data/campus.js';
import { CATEGORIES, categoryById } from './data/categories.js';
import { PERSON_DIRECTORY_URL, RETRIEVED, FACULTIES } from './data/hswt.js';
import { LABELS, ALLERGEN_FAMILIES } from './data/mensa-labels.js';
import { locateRoom, locateBuilding } from './lib/rooms.js';
import { distanceMeters, estimateBike, estimateWalk, nearest } from './lib/routing.js';
import { getDirections, ROUTE_STYLES } from './lib/directions.js';
import { planJourneys, departures as fetchDepartures, latestArrivingBy } from './lib/transit.js';
import { prepareRoute, progress, isOffRoute, hasArrived, minutesLeft, announcement, rideProgress, maneuverIcon } from './lib/navigation.js';
import { openingStatus } from './lib/hours.js';
import { eventsOn, nextEvent, leaveBy, parseIcs, isoDate } from './lib/schedule.js';
import { search } from './lib/search.js';
import { createI18n, detectLanguage } from './lib/i18n.js';
import {
  menuUrl,
  menuWeekStart,
  daysOf,
  formatPrice,
  matchesTags,
  dishTags,
  conflicts,
  groupByType,
  ROLES,
  TAGS,
  EAT_API,
} from './lib/mensa.js';

// Walking/cycling routes from further away start at Freising station (transit plans from anywhere).
const FAR_AWAY_M = { walk: 5000, bike: 25000 };
const TRAVEL_MODES = ['walk', 'bike', 'transit'];
const MODE_ICON = { walk: 'directions_walk', bike: 'directions_bike', transit: 'directions_bus' };
const MVV_URL = 'https://www.mvv-muenchen.de/';
const NEAR_PLACE_RADIUS_M = 150;
const MAX_RECENT = 6;
const SPRITE = 'icons/sprite.svg';

// ---------- persistence ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`hswt.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`hswt.${key}`, JSON.stringify(value));
    } catch {
      /* private mode / quota – keep working in memory */
    }
  },
};

const tagById = Object.fromEntries(TAGS.map((tag) => [tag.id, tag]));

// Mensa filter tags; older versions stored a single diet ("vegan", "vegetarian", "nopork").
function initialTags() {
  const tags = store.get('mensaTags', null);
  if (Array.isArray(tags)) return tags.filter((id) => tagById[id]);
  const diet = store.get('mensaDiet', 'all');
  return tagById[diet] ? [diet] : [];
}

const state = {
  campus: getCampus(store.get('campus', CAMPUSES[0].id)),
  classes: store.get('classes', []),
  contacts: store.get('contacts', []),
  saved: store.get('saved', []), // [{ key, placeId, roomCode, personId }]
  recent: store.get('recent', []),
  avoidStairs: store.get('avoidStairs', false),
  routeStyle: ROUTE_STYLES.includes(store.get('routeStyle', 'fast')) ? store.get('routeStyle', 'fast') : 'fast',
  travelMode: TRAVEL_MODES.includes(store.get('travelMode', 'walk')) ? store.get('travelMode', 'walk') : 'walk',
  theme: store.get('theme', 'auto'), // 'auto' | 'light' | 'dark'
  bufferMin: store.get('bufferMin', 3),
  lang: detectLanguage(store.get('lang', null), navigator.languages ?? [navigator.language]),
  mensa: { role: store.get('mensaRole', 'students'), tags: initialTags(), avoid: store.get('allergens', []), hide: store.get('hideConflicts', false), week: 0, day: null },
  campusCategory: null, // open category on the Campus tab
  me: null, // [lat, lng] from geolocation
  selected: null, // { placeId, room, personId, routed }
};
let i18n = createI18n(state.lang);
const t = (...args) => i18n.t(...args);

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const svg = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="${SPRITE}#${name}"/></svg>`;
const places = () => placesOf(state.campus);
const placeById = (id) => places().find((p) => p.id === id);
const buildingById = (id) => state.campus.buildings.find((b) => b.id === id);
const statusClass = (s) => (s.open ? (s.closingSoon ? 'soon' : 'open') : 'closed');
const statusHtml = (s) => (s?.known ? `<span class="status ${statusClass(s)}">${esc(i18n.openingStatus(s))}</span>` : '');
const personById = (id) => state.campus.people.find((p) => p.id === id) ?? state.contacts.find((c) => c.id === id);
const isWide = () => window.matchMedia('(min-width: 800px)').matches;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function toast(msg) {
  document.querySelector('.snackbar')?.remove();
  const el = document.createElement('div');
  el.className = 'snackbar';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

// Icon for a place: cafés and the station get their own, everything else its category's.
function placeIcon(p) {
  if (p.kind === 'bikeshare') return 'electric_bike';
  if (p.id?.startsWith('stucafe')) return 'coffee';
  if (p.kind === 'transit') return p.name === 'Freising Bahnhof' ? 'train' : 'directions_bus';
  if (p.kind === 'community') return 'church';
  if (p.kind === 'building') return 'apartment';
  return categoryById[p.category]?.icon ?? 'location_on';
}

// ---------- language ----------

function applyLanguage() {
  i18n = createI18n(state.lang);
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  const daySelect = $('#day-select');
  const selectedDay = daySelect.value || '1';
  daySelect.innerHTML = [1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}">${esc(i18n.weekday(d))}</option>`).join('');
  daySelect.value = selectedDay;
  $('#route-style-select').innerHTML = ROUTE_STYLES.map((s) => `<option value="${s}">${esc(t(`route.style.${s}`))}</option>`).join('');
  $('#route-style-select').value = state.routeStyle;
  $('#travel-mode-select').innerHTML = TRAVEL_MODES.map((m) => `<option value="${m}">${esc(t(`mode.${m}`))}</option>`).join('');
  $('#travel-mode-select').value = state.travelMode;
  $('#about-data').textContent = t('about.data', { date: i18n.shortDate(new Date(RETRIEVED)) });
  $('#people-help').textContent = t('campus.peopleHelp', { date: i18n.shortDate(new Date(RETRIEVED)) });
  $('#directory-link').href = PERSON_DIRECTORY_URL;

  renderChips();
  renderMarkers();
  renderToday();
  renderCampus();
  renderMensa();
  if (state.selected && !$('#sheet').hidden) {
    const { placeId, room, personId, routed } = state.selected;
    selectPlace(placeId, { room, personId, route: routed, keepView: true });
  }
  if (input.value) runSearch();
}

document.querySelectorAll('[data-lang]').forEach((b) =>
  b.addEventListener('click', () => {
    state.lang = b.dataset.lang;
    store.set('lang', state.lang);
    applyLanguage();
  }),
);

// ---------- theme ----------

const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
const isDark = () => state.theme === 'dark' || (state.theme === 'auto' && !!darkQuery?.matches);

function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme-btn').innerHTML = svg(dark ? 'light_mode' : 'dark_mode');
  $('#theme-select').value = state.theme;
  document.querySelector('meta[name="theme-color"]').content = cssVar('--surface') || (dark ? '#131411' : '#f8fbe9');
  renderMarkers(); // building and route colours follow the theme
  if (nav.active) paintNav();
  else paintRoutes();
}

function setTheme(theme) {
  state.theme = theme;
  store.set('theme', theme);
  applyTheme();
}

$('#theme-btn').addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
$('#theme-select').addEventListener('change', (e) => setTheme(e.target.value));
darkQuery?.addEventListener?.('change', () => state.theme === 'auto' && applyTheme());

// ---------- tabs ----------

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((b) => {
    const on = b.dataset.view === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (name === 'map') map?.invalidateSize();
  if (name === 'today') renderToday();
  if (name === 'mensa') renderMensa();
  if (name === 'campus') renderCampus();
}

document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------- map ----------

let map = null;
let shapeLayer = null;
let markerLayer = null;
let routeLayer = null;
let meMarker = null;
const markers = new Map();

// Footprint colours (SVG attributes can't use CSS variables).
const SHAPES = {
  building: { fill: '#7ab800', line: '#568400' }, // HSWT house colour (Pantone 376); dimmed in dark mode via CSS tokens
  study: { fill: '#6f95d3', line: '#2f5fa8' },
  residence: { fill: '#d39aa4', line: '#8f3f52' },
  community: { fill: '#d39aa4', line: '#8f3f52' },
};

function initMap() {
  if (!window.L) {
    $('#map').innerHTML = `<p class="muted" style="padding:200px 16px">${esc(t('map.offline'))}</p>`;
    return;
  }
  // A wide renderer margin keeps route lines drawn while the map pans along during navigation.
  map = L.map('map', { zoomControl: false, renderer: L.svg({ padding: 1 }) });
  fitCampus();
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Lageplan © HSWT',
  }).addTo(map);
  shapeLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('click', () => !nav.active && closeSheet());
  // Dragging the map during navigation stops following the position until "re-centre".
  map.on('dragstart', () => {
    if (!nav.active) return;
    nav.follow = false;
    $('#nav-recenter').hidden = false;
  });
  // Stops and car parks only appear once zoomed in, so the overview stays readable.
  const updateZoomClass = () => map.getContainer().classList.toggle('zoomed-out', map.getZoom() < 17);
  map.on('zoomend', updateZoomClass);
  updateZoomClass();
}

// The part of the map not covered by the floating glass controls and the panel, as Leaflet padding.
function mapPadding() {
  const view = $('#view-map').getBoundingClientRect();
  const sheet = $('#sheet');
  const sheetBox = sheet.hidden ? null : sheet.getBoundingClientRect();
  const navTop = $('.nav-bar').getBoundingClientRect().top;
  if (isWide()) {
    return {
      paddingTopLeft: [sheetBox ? sheetBox.right - view.left + 24 : 24, $('.search').getBoundingClientRect().bottom - view.top + 12],
      paddingBottomRight: [72, view.bottom - navTop + 16],
    };
  }
  return {
    paddingTopLeft: [24, $('.search').getBoundingClientRect().bottom - view.top + 12],
    paddingBottomRight: [64, view.bottom - (sheetBox ? sheetBox.top : navTop) + 16],
  };
}

// Show every HSWT building of the campus, leaving room for the floating search bar.
function fitCampus() {
  map.fitBounds(L.latLngBounds(state.campus.buildings.map((b) => b.latlng)), mapPadding());
}

const divIcon = (html, w, h = w) => L.divIcon({ className: 'mk-wrap', html, iconSize: [w, h], iconAnchor: [w / 2, h / 2] });

function renderMarkers() {
  if (!map) return;
  // Building colours and fill strength follow the theme (the house green is dimmed at night).
  SHAPES.building = { fill: cssVar('--map-building') || '#7ab800', line: cssVar('--map-building-line') || '#568400' };
  const fillOpacity = Number(cssVar('--map-fill-opacity')) || 0.7;
  shapeLayer.clearLayers();
  markerLayer.clearLayers();
  markers.clear();

  for (const ring of state.campus.unlabeledFootprints) {
    L.polygon(ring, { color: SHAPES.building.line, weight: 1, fillColor: SHAPES.building.fill, fillOpacity: fillOpacity / 2, interactive: false }).addTo(shapeLayer);
  }
  for (const latlng of state.campus.bikeParking ?? []) {
    L.marker(latlng, { icon: divIcon(`<div class="mk mk-bike">${svg('pedal_bike')}</div>`, 18), interactive: false, keyboard: false }).addTo(markerLayer);
  }
  for (const latlng of state.campus.parking) {
    L.marker(latlng, { icon: divIcon('<div class="mk mk-parking">P</div>', 20), interactive: false, keyboard: false }).addTo(markerLayer);
  }

  for (const p of places()) {
    if (p.kind === 'service') continue; // shown inside their building
    const shape = SHAPES[p.kind] ?? SHAPES.building;
    for (const ring of p.footprints ?? []) {
      L.polygon(ring, { color: shape.line, weight: 1.5, fillColor: shape.fill, fillOpacity })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          selectPlace(p.id);
        })
        .addTo(shapeLayer);
    }
    let icon;
    if (p.kind === 'building') icon = divIcon(`<div class="mk mk-building ${p.services?.length ? 'has-info' : ''}">${esc(p.id)}</div>`, 38, 26);
    else if (p.kind === 'transit') icon = divIcon(`<div class="mk mk-stop">${svg(placeIcon(p))}</div>`, 22);
    else icon = divIcon(`<div class="mk mk-poi" data-cat="${esc(p.category ?? '')}">${svg(placeIcon(p))}</div>`, 34);
    const name = i18n.pick(p.name);
    const m = L.marker(p.latlng, { icon, keyboard: true, title: name, alt: name, zIndexOffset: p.kind === 'transit' ? -100 : 0 })
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectPlace(p.id);
      })
      .addTo(markerLayer);
    markers.set(p.id, m);
  }
  if (state.selected) highlightMarker(state.selected.placeId);
}

function highlightMarker(id) {
  const target = placeById(id)?.kind === 'service' ? placeById(id).building : id;
  for (const [pid, m] of markers) m.getElement()?.firstElementChild?.classList.toggle('selected', pid === target);
}

// ---------- origins & routes ----------

function originOptionsHtml(excludeId, selected) {
  const opt = (value, label) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
  const start = [state.me ? opt('me', t('route.myLocation')) : '', opt('station', t('route.station'))].join('');
  const buildings = state.campus.buildings.filter((b) => b.id !== excludeId).map((b) => opt(`place:${b.id}`, i18n.pick(b.name)));
  const other = state.campus.pois
    .filter((p) => p.id !== excludeId && ['food', 'study', 'living'].includes(p.category))
    .map((p) => opt(`place:${p.id}`, i18n.pick(p.name)));
  return `<optgroup label="${esc(t('route.group.start'))}">${start}</optgroup>
    <optgroup label="${esc(t('route.group.buildings'))}">${buildings.join('')}</optgroup>
    <optgroup label="${esc(t('route.group.other'))}">${other.join('')}</optgroup>`;
}

function resolveOrigin(value, mode = 'walk') {
  if (value === 'me' && state.me) {
    if (FAR_AWAY_M[mode] && distanceMeters(state.me, state.campus.center) > FAR_AWAY_M[mode]) {
      return { latlng: state.campus.station, key: 'station', note: t('route.farAway') };
    }
    return { latlng: state.me, key: `me:${state.me.map((v) => v.toFixed(3)).join(',')}` };
  }
  if (value?.startsWith('place:')) {
    const p = placeById(value.slice(6));
    if (p) return { latlng: p.latlng, key: value };
  }
  return { latlng: state.campus.station, key: 'station' };
}

const defaultOrigin = () => (state.me ? 'me' : 'station');

// Route results are cached so "leave by" and the map share one request per origin/target/style.
const routeCache = new Map();
function routeFor(origin, target, targetKey, mode = 'walk') {
  const key = `${mode}|${origin.key}|${targetKey}|${state.avoidStairs}|${state.routeStyle}|${state.lang}`;
  if (!routeCache.has(key)) {
    const entry = { promise: null, settled: null };
    entry.promise = getDirections(origin.latlng, target, { mode, stepFree: state.avoidStairs, lang: state.lang, style: state.routeStyle })
      .then((r) => (entry.settled = r))
      .catch(() => null);
    routeCache.set(key, entry);
  }
  return routeCache.get(key);
}

// Public-transport journeys. "Now" searches are reused for two minutes; "arrive by" searches
// (for a class) are keyed by their deadline. `settled`: undefined = pending, null = failed.
const transitCache = new Map();
function transitFor(origin, target, targetKey, { time = null, arriveBy = false } = {}) {
  const when = time ? time.toISOString().slice(0, 16) : `now${Math.floor(Date.now() / 120000)}`;
  const key = `${origin.key}|${targetKey}|${arriveBy}|${when}|${state.avoidStairs}|${state.lang}`;
  if (!transitCache.has(key)) {
    const entry = { promise: null, settled: undefined };
    entry.promise = planJourneys(origin.latlng, target, { time, arriveBy, lang: state.lang, wheelchair: state.avoidStairs })
      .then((j) => (entry.settled = j))
      .catch(() => (entry.settled = null));
    transitCache.set(key, entry);
  }
  return transitCache.get(key);
}

function setTravelMode(mode) {
  if (!TRAVEL_MODES.includes(mode)) return;
  state.travelMode = mode;
  store.set('travelMode', mode);
  $('#travel-mode-select').value = mode;
  renderToday();
}

function setRouteStyle(style) {
  if (!ROUTE_STYLES.includes(style)) return;
  state.routeStyle = style;
  store.set('routeStyle', style);
  $('#route-style-select').value = style;
  renderToday();
}

// ---------- favourites & recents ----------

function itemKey({ placeId, room, roomCode, personId }) {
  if (personId) return `person:${personId}`;
  if (room?.code || roomCode) return `room:${room?.code ?? roomCode}`;
  return `place:${placeId}`;
}

function itemTitle(sel) {
  if (sel.personId) return personById(sel.personId)?.name ?? '';
  if (sel.room) return t('room.title', { code: sel.room.code });
  return i18n.pick(placeById(sel.placeId)?.name);
}

function rememberRecent(sel) {
  const entry = { key: itemKey(sel), placeId: sel.placeId, roomCode: sel.room?.code ?? null, personId: sel.personId ?? null };
  state.recent = [entry, ...state.recent.filter((r) => r.key !== entry.key)].slice(0, MAX_RECENT);
  store.set('recent', state.recent);
}

const isSaved = (sel) => state.saved.some((s) => s.key === itemKey(sel));

function toggleSaved(sel) {
  const key = itemKey(sel);
  state.saved = isSaved(sel)
    ? state.saved.filter((s) => s.key !== key)
    : [...state.saved, { key, placeId: sel.placeId, roomCode: sel.room?.code ?? null, personId: sel.personId ?? null }];
  store.set('saved', state.saved);
}

// Stored entry → arguments for selectPlace (rooms and people are resolved freshly).
function openStored(entry) {
  const room = entry.roomCode ? locateRoom(entry.roomCode, state.campus) : null;
  selectPlace(entry.placeId, { room, personId: entry.personId });
}

function storedLabel(entry) {
  const room = entry.roomCode ? locateRoom(entry.roomCode, state.campus) : null;
  const title = itemTitle({ placeId: entry.placeId, room, personId: entry.personId });
  const person = entry.personId && personById(entry.personId);
  const place = placeById(entry.placeId);
  const sub = person
    ? person.room
    : room
      ? i18n.pick(buildingById(room.building)?.name)
      : place?.category
        ? i18n.pick(categoryById[place.category].name)
        : t(`kind.${place?.kind ?? 'building'}`);
  return { title, sub };
}

// ---------- place sheet ----------

let routeRequest = 0;
let routeView = null; // { routes: [best, ...alternatives], idx, origin }

const row = (icon, label, value) =>
  value ? `<div class="info-row">${svg(icon)}<div><div class="label-m muted">${esc(label)}</div><div>${value}</div></div></div>` : '';

function selectPlace(placeId, { room = null, personId = null, route = false, keepView = false } = {}) {
  const p = placeById(placeId);
  if (!p) return;
  const sel = { placeId, room, personId, routed: route };
  state.selected = sel;
  routeView = null;
  stopDepartures();
  routeLayer?.clearLayers();
  rememberRecent(sel);
  showView('map');
  hideResults();
  $('#welcome').hidden = true;
  highlightMarker(placeId);

  const person = personId ? personById(personId) : null;
  const building = p.kind === 'building' ? p : p.building ? buildingById(p.building) : null;
  const category = p.category ? categoryById[p.category] : null;
  const status = openingStatus(p.hours);
  const title = person ? person.name : room ? t('room.title', { code: room.code }) : i18n.pick(p.name);
  const eyebrow = person ? t(person.url ? 'kind.person' : 'kind.contact') : room ? t('kind.room') : category ? i18n.pick(category.name) : t(`kind.${p.kind}`);
  const eyebrowIcon = person ? 'person' : room ? 'meeting_room' : placeIcon(p);
  const subtitle = person ? i18n.pick(person.field) || i18n.pick(FACULTIES[person.faculty]) : room ? i18n.pick(p.name) : i18n.pick(p.subtitle) || i18n.pick(p.description);

  const roomCode = person?.room ?? room?.code ?? p.room;
  const roomBuilding = building ?? (roomCode ? buildingById(roomCode.split('.')[0]) : null);
  const info = [
    row('meeting_room', t('sheet.room'), roomCode ? `<strong>${esc(roomCode)}</strong> · ${esc(i18n.pick(roomBuilding?.name))}` : ''),
    row('location_on', t('sheet.address'), esc(p.address ?? building?.address ?? '')),
    status.known
      ? row(
          'schedule',
          t('sheet.hours'),
          `${statusHtml(status)}<br>${i18n.weeklyHours(p.hours).map(esc).join('<br>')}${p.note ? `<br><span class="muted small">${esc(i18n.pick(p.note))}</span>` : ''}`,
        )
      : p.note
        ? row('schedule', t('sheet.hours'), `<span class="muted small">${esc(i18n.pick(p.note))}</span>`)
        : '',
    row('call', t('sheet.phone'), p.phone ? `<a href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">${esc(p.phone)}</a>` : ''),
    row('mail', t('sheet.email'), p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''),
    row('info', t('sheet.note'), person?.note ? esc(i18n.pick(person.note)) : ''),
  ].join('');

  const links = [
    person?.url ? `<a class="btn btn-outlined pressable" href="${esc(person.url)}" target="_blank" rel="noopener">${esc(t('sheet.profile'))} ${svg('open_in_new')}</a>` : '',
    !person && p.url
      ? `<a class="btn btn-outlined pressable" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t(/hswt\.de/.test(p.url) ? 'sheet.website' : 'sheet.websiteOther'))} ${svg('open_in_new')}</a>`
      : '',
  ].join('');

  let inside = '';
  if (p.kind === 'building' && !room && !person) {
    const services = (p.services ?? []).map((id) => placeById(id)).filter(Boolean);
    const people = state.campus.people.filter((x) => x.building === p.id);
    inside = [
      services.length
        ? `<h4>${esc(t('sheet.inside'))}</h4><div class="chip-row">${services
            .map((s) => `<button class="filter-chip pressable" data-open-place="${esc(s.id)}">${svg(placeIcon(s))} ${esc(i18n.pick(s.name))}</button>`)
            .join('')}</div>`
        : '',
      people.length
        ? `<h4>${esc(t('sheet.people'))} (${people.length})</h4><details><summary class="linklike">${esc(t('sheet.showPeople'))}</summary><ul class="mini-list">${people
            .map((x) => `<li><button class="linklike" data-open-person="${esc(x.id)}">${esc(x.name)}</button> <span class="muted">${esc(x.room)}</span></li>`)
            .join('')}</ul></details>`
        : '',
    ].join('');
  }

  const roomHint = roomCode && roomBuilding ? `<p class="muted small">${esc(t('room.hint', { room: roomCode, building: roomBuilding.id }))}</p>` : '';
  const planNote = (building ?? p).source === 'plan' ? `<p class="muted small">${esc(t('sheet.positionPlan'))}</p>` : '';
  const sourceNote = person?.url || p.kind === 'service' ? `<p class="muted small">${esc(t('sheet.source', { date: i18n.shortDate(new Date(RETRIEVED)) }))}</p>` : '';
  const saved = isSaved(sel);

  $('#sheet-body').innerHTML = `
    <div class="sheet-head" ${category ? `data-cat="${esc(category.id)}"` : ''}>
      <div class="eyebrow">${svg(eyebrowIcon, 'sm')} ${esc(eyebrow)}</div>
      <h2>${esc(title)}</h2>
      ${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="actions sheet-actions">
      <button id="route-btn" class="btn btn-filled pressable">${svg(MODE_ICON[state.travelMode])} ${esc(t('route.go'))}</button>
      <button id="save-btn" class="btn btn-tonal pressable" aria-pressed="${saved}" aria-label="${esc(t(saved ? 'sheet.saved' : 'sheet.save'))}">${saveLabel(saved)}</button>
      <button id="share-btn" class="btn btn-tonal pressable" aria-label="${esc(t('sheet.share'))}">${svg('ios_share')} <span class="btn-label">${esc(t('sheet.share'))}</span></button>
      ${person && !person.url ? `<button id="remove-contact" class="btn btn-text pressable">${svg('delete')} ${esc(t('sheet.removeContact'))}</button>` : ''}
    </div>
    <label class="from-row">${svg('near_me')} <span>${esc(t('route.from'))}</span>
      <select id="route-from" class="select">${originOptionsHtml(p.kind === 'service' ? p.building : p.id, defaultOrigin())}</select>
    </label>
    <div id="route-summary"></div>
    ${p.kind === 'transit' ? `<h4>${svg('departure_board', 'sm')} ${esc(t('departures.title'))}</h4><div id="departures"><p class="muted small">${esc(t('departures.loading'))}</p></div>` : ''}
    <div class="info">${info}</div>
    ${links ? `<div class="actions">${links}</div>` : ''}
    ${roomHint}
    ${inside}
    ${p.menu ? `<h4>${esc(t('sheet.todayMenu'))}</h4><div id="menu-preview" class="muted">${esc(t('mensa.loading'))}</div>` : ''}
    ${planNote}${sourceNote}`;
  const sheet = $('#sheet');
  sheet.hidden = false;
  sheet.classList.remove('collapsed', 'routing');
  sheet.scrollTop = 0;
  if (map && !keepView && !route) {
    // Centre the place in the part of the map the panel leaves free.
    map.fitBounds(L.latLngBounds([p.latlng, p.latlng]), { ...mapPadding(), maxZoom: Math.max(map.getZoom(), 18) });
  }

  $('#route-btn').addEventListener('click', () => drawRoute(p, $('#route-from').value));
  $('#route-from').addEventListener('change', () => state.selected?.routed && drawRoute(p, $('#route-from').value));
  $('#save-btn').addEventListener('click', () => {
    toggleSaved(sel);
    const now = isSaved(sel);
    $('#save-btn').innerHTML = saveLabel(now);
    $('#save-btn').setAttribute('aria-label', t(now ? 'sheet.saved' : 'sheet.save'));
    $('#save-btn').setAttribute('aria-pressed', String(now));
    renderCampus();
  });
  $('#share-btn').addEventListener('click', () => share(title, roomCode ?? person?.name ?? p.id));
  $('#remove-contact')?.addEventListener('click', () => {
    state.contacts = state.contacts.filter((c) => c.id !== personId);
    store.set('contacts', state.contacts);
    closeSheet();
    renderCampus();
  });
  sheet.querySelectorAll('[data-open-place]').forEach((b) => b.addEventListener('click', () => selectPlace(b.dataset.openPlace)));
  sheet.querySelectorAll('[data-open-person]').forEach((b) => b.addEventListener('click', () => openPerson(b.dataset.openPerson)));
  if (route) drawRoute(p, $('#route-from').value);
  if (p.menu) renderMenuPreview(p.menu);
  if (p.kind === 'transit') {
    loadDepartures(p);
    departuresTimer = setInterval(() => document.visibilityState === 'visible' && loadDepartures(p), 60000);
  }
}

const saveLabel = (saved) => `${svg(saved ? 'star-fill' : 'star')} <span class="btn-label">${esc(t(saved ? 'sheet.saved' : 'sheet.save'))}</span>`;

function openPerson(personId) {
  const person = personById(personId);
  if (!person) return;
  const room = locateRoom(person.room, state.campus);
  const building = room?.buildingRef ?? locateBuilding(person.room, state.campus);
  if (building) selectPlace(building.id, { room, personId });
}

async function share(title, query) {
  const url = `${location.origin}${location.pathname}?q=${encodeURIComponent(query)}`;
  try {
    if (navigator.share) return await navigator.share({ title: `${title} – HSWT Navigator`, url });
    await navigator.clipboard.writeText(url);
    toast(t('sheet.copied'));
  } catch {
    /* share sheet dismissed */
  }
}

const modeToggle = () =>
  `<div class="segmented mode-toggle" role="group" aria-label="${esc(t('route.mode'))}">${TRAVEL_MODES.map(
    (m) => `<button type="button" data-travel-mode="${m}" aria-pressed="${m === state.travelMode}">${svg(MODE_ICON[m], 'sm')} ${esc(t(`mode.${m}`))}</button>`,
  ).join('')}</div>`;

const styleLabel = (mode, style) => (mode === 'bike' && style === 'main' ? t('route.style.bikeMain') : t(`route.style.${style}`));
const styleIcon = (mode, style) => (style === 'fast' ? MODE_ICON[mode] : mode === 'bike' ? 'pedal_bike' : 'wb_incandescent');

const routeStyleToggle = (mode) =>
  `<div class="segmented route-style" role="group" aria-label="${esc(t('settings.routeStyle'))}">${ROUTE_STYLES.map(
    (s) => `<button type="button" data-route-style="${s}" aria-pressed="${s === state.routeStyle}">${svg(styleIcon(mode, s), 'sm')} ${esc(styleLabel(mode, s))}</button>`,
  ).join('')}</div>`;

const panelTop = (mode) => modeToggle() + (mode === 'transit' ? '' : routeStyleToggle(mode));
const mvvLink = () => `<a href="${MVV_URL}" target="_blank" rel="noopener">${esc(t('transit.mvv'))} ${svg('open_in_new', 'sm')}</a>`;

async function drawRoute(place, originValue) {
  const id = ++routeRequest;
  state.selected.routed = true;
  const target = place.kind === 'service' ? buildingById(place.building) ?? place : place;
  const mode = state.travelMode;
  const origin = resolveOrigin(originValue, mode);
  routeView = null;
  routeLayer?.clearLayers();
  $('#route-summary').innerHTML = `<div class="route-panel">${panelTop(mode)}<p class="muted small">${esc(t(mode === 'transit' ? 'transit.loading' : 'route.loading'))}</p></div>`;
  const stale = () => id !== routeRequest || !$('#route-summary'); // a newer request or the sheet closed

  if (mode === 'transit') {
    const all = await transitFor(origin, target.latlng, target.id).promise;
    if (stale()) return;
    const journeys = all?.filter((j) => j.start >= Date.now() - 60000); // drop ones that have already left
    if (!journeys?.length) {
      const msg = journeys ? t('transit.none') : t('transit.error');
      $('#route-summary').innerHTML = `<div class="route-panel">${panelTop(mode)}<p>${esc(msg)}</p><p class="small">${mvvLink()}</p></div>`;
      return;
    }
    routeView = { kind: 'transit', journeys: journeys.slice(0, 4), idx: 0, origin, target };
  } else {
    const route = await routeFor(origin, target.latlng, target.id, mode).promise;
    if (stale()) return;
    if (!route) {
      $('#route-summary').innerHTML = `<div class="route-panel">${panelTop(mode)}<p>${esc(t('route.none'))}</p></div>`;
      return;
    }
    const parking = mode === 'bike' ? nearest(state.campus.bikeParking ?? [], target.latlng, (x) => x) : null;
    routeView = { kind: 'street', mode, routes: [route, ...(route.alternatives ?? [])], idx: 0, origin, target, parking: parking?.meters < 200 ? parking : null };
  }
  renderRoutePanel();
  paintRoutes({ fit: true });
}

function renderRoutePanel() {
  const el = $('#route-summary');
  if (!routeView || !el) return;
  el.innerHTML = `<div class="route-panel">${routeView.kind === 'transit' ? transitPanelHtml() : streetPanelHtml()}</div>`;
}

function streetPanelHtml() {
  const { routes, idx, origin, mode, parking } = routeView;
  const route = routes[idx];
  const best = routes[0];
  const notes = [
    state.routeStyle === 'main' && !route.approx ? t(mode === 'bike' ? 'route.style.bikeMainHelp' : 'route.style.mainHelp') : '',
    mode === 'walk' && state.avoidStairs && !route.approx && !route.noStepFree ? t('route.stepFree') : '',
    route.noStepFree ? t('route.osrmFallback') : '',
    route.approx ? t('route.approx') : '',
    origin.note ?? '',
  ].filter(Boolean);
  const options =
    routes.length > 1
      ? `<div class="route-options" role="group" aria-label="${esc(t('route.options'))}">${routes
          .map((r, i) => {
            const extra = r.minutes > best.minutes ? ` · ${t('route.longer', { min: r.minutes - best.minutes })}` : '';
            return `<button type="button" class="route-option pressable" data-route-idx="${i}" aria-pressed="${i === idx}">
              <span class="time">${esc(t('route.min', { min: r.minutes }))}</span>
              <span class="content"><span class="title">${esc(i === 0 ? t('route.best') : t('route.alt', { n: i }))}</span>
              <span class="sub">${esc(i18n.distance(r.meters) + extra)}</span></span>
            </button>`;
          })
          .join('')}</div>`
      : `<div class="title-m" style="margin-top:10px">${esc(t(mode === 'bike' ? 'route.summaryBike' : 'route.summary', { min: route.minutes, dist: i18n.distance(route.meters) }))}</div>`;
  const parkingNote = parking
    ? `<p class="small note-row">${svg('pedal_bike', 'sm')} ${esc(t('route.bikeParking', { dist: i18n.distance(Math.max(10, parking.meters)) }))}</p>`
    : '';
  const steps = route.steps.length
    ? `<details ${route.steps.length <= 6 ? 'open' : ''}><summary>${esc(t('route.steps'))}</summary><ol class="steps">${route.steps
        .map((s) => `<li>${esc(s.text)}${s.meters >= 10 ? ` <span class="muted">${esc(i18n.distance(s.meters))}</span>` : ''}</li>`)
        .join('')}</ol></details>`
    : '';
  return `${panelTop(mode)}
    ${options}
    ${navStartButton()}
    ${parkingNote}
    ${notes.map((n) => `<p class="muted small" style="margin:8px 0 0">${esc(n)}</p>`).join('')}
    ${steps}
    ${route.provider ? `<div class="muted small" style="margin-top:8px">${esc(t('route.attribution', { provider: route.provider }))}</div>` : ''}`;
}

const TRANSIT_ICON = { BUS: 'directions_bus', COACH: 'directions_bus', TRAM: 'tram', SUBWAY: 'subway', SUBURBAN: 'train', REGIONAL_RAIL: 'train' };
const transitIcon = (mode) => TRANSIT_ICON[mode] ?? (/RAIL|TRAIN/.test(mode ?? '') ? 'train' : 'directions_bus');
const lineBadge = (x) =>
  `<span class="line-badge" ${x.color ? `style="--line:${x.color};--on-line:${x.textColor ?? '#fff'}"` : ''}>${svg(transitIcon(x.mode), 'sm')}${esc(x.line)}</span>`;
const delayHtml = (x) =>
  x.cancelled
    ? `<span class="delay late">${esc(t('transit.cancelled'))}</span>`
    : x.delay > 0
      ? `<span class="delay late">+${x.delay}</span>`
      : x.realTime
        ? `<span class="delay ontime">${esc(t('transit.onTime'))}</span>`
        : '';
const transfersText = (j) => (j.transfers === 0 ? t('transit.direct') : j.transfers === 1 ? t('transit.transfer') : t('transit.transfers', { n: j.transfers }));

function transitPanelHtml() {
  const { journeys, idx, origin, target } = routeView;
  const j = journeys[idx];
  const now = Date.now();
  const options = `<div class="route-options" role="group" aria-label="${esc(t('route.options'))}">${journeys
    .map((x, i) => {
      const chain = x.legs.map((l) => (l.transit ? lineBadge(l) : svg('directions_walk', 'sm'))).join(svg('chevron_right', 'sm sep'));
      return `<button type="button" class="route-option pressable" data-route-idx="${i}" aria-pressed="${i === idx}">
        <span class="time">${esc(i18n.time(x.start))}</span>
        <span class="content"><span class="title">${esc(`${t('route.min', { min: x.minutes })} · ${transfersText(x)}`)}</span>
        <span class="sub leg-chain">${chain}</span></span>
      </button>`;
    })
    .join('')}</div>`;
  const walkTarget = (l, i) => (i === j.legs.length - 1 ? i18n.pick(target.name) : l.to.name);
  const legs = j.legs
    .map((l, i) =>
      l.transit
        ? `<li class="leg transit">${lineBadge(l)}<div>
            <div class="title-m">${esc(l.headsign)}</div>
            <div>${esc(t('transit.dep', { time: i18n.time(l.start), stop: l.from.name }))}${l.from.track ? ` · ${esc(t('transit.track', { track: l.from.track }))}` : ''} ${delayHtml(l)}</div>
            <div>${esc(t('transit.arr', { time: i18n.time(l.end), stop: l.to.name }))}${l.stops ? ` <span class="muted">· ${esc(t('transit.stops', { n: l.stops + 1 }))}</span>` : ''}</div>
          </div></li>`
        : `<li class="leg walk">${svg('directions_walk')}<div class="muted">${esc(t('transit.walkTo', { min: l.minutes, place: walkTarget(l, i) }))}</div></li>`,
    )
    .join('');
  const leaveIn = j.start - now;
  const realTime = j.legs.some((l) => l.transit && l.realTime);
  return `${modeToggle()}
    ${options}
    ${navStartButton()}
    <p class="title-m" style="margin:12px 0 0">${esc(leaveIn > 60000 ? t('transit.leaveIn', { when: i18n.countdown(leaveIn), time: i18n.time(j.start) }) : t('today.leaveNow'))}</p>
    <ol class="legs">${legs}</ol>
    ${origin.note ? `<p class="muted small">${esc(origin.note)}</p>` : ''}
    <p class="muted small" style="margin-top:8px">${realTime ? '' : `${esc(t('transit.scheduledOnly'))} `}${esc(t('transit.source'))} · ${mvvLink()}</p>`;
}

// Selected route on top in the primary colour (with a light casing so it reads on any tiles);
// street alternatives dotted underneath and tappable. Transit: vehicle legs in the line colour,
// walking legs dotted.
function paintRoutes({ fit = false } = {}) {
  if (!map || !routeLayer) return;
  routeLayer.clearLayers();
  if (!routeView) return;
  const casing = (coords) => L.polyline(coords, { color: cssVar('--surface-container-lowest'), weight: 10, opacity: 0.9, interactive: false }).addTo(routeLayer);
  const walkLine = (coords) => L.polyline(coords, { color: cssVar('--primary'), weight: 5, opacity: 0.95, dashArray: '1 9', lineCap: 'round', interactive: false }).addTo(routeLayer);
  let all;
  if (routeView.kind === 'transit') {
    const j = routeView.journeys[routeView.idx];
    for (const l of j.legs) {
      if (l.transit) {
        casing(l.coords);
        L.polyline(l.coords, { color: l.color ?? cssVar('--primary'), weight: 6, opacity: 0.95, interactive: false }).addTo(routeLayer);
      } else walkLine(l.coords);
    }
    for (const l of j.legs.filter((x) => x.transit)) {
      L.circleMarker(l.from.latlng, { radius: 6, color: cssVar('--primary'), weight: 3, fillColor: cssVar('--surface-container-lowest'), fillOpacity: 1, interactive: false }).addTo(routeLayer);
    }
    all = j.legs.flatMap((l) => l.coords);
  } else {
    const { routes, idx, parking } = routeView;
    routes.forEach((r, i) => {
      if (i === idx) return;
      L.polyline(r.coords, { color: cssVar('--outline'), weight: 6, opacity: 0.85, dashArray: '1 10', lineCap: 'round' })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          selectRoute(i);
        })
        .addTo(routeLayer);
    });
    const r = routes[idx];
    casing(r.coords);
    L.polyline(r.coords, { color: cssVar('--primary'), weight: 6, opacity: 0.95, dashArray: r.approx ? '8 10' : null, interactive: false }).addTo(routeLayer);
    if (parking) L.marker(parking.item, { icon: divIcon(`<div class="mk mk-bike target">${svg('pedal_bike')}</div>`, 26), interactive: false, keyboard: false }).addTo(routeLayer);
    all = routes.flatMap((x) => x.coords);
  }
  if (fit) {
    // On phones the panel shrinks to half height while a route is shown, so the route stays visible.
    $('#sheet').classList.add('routing');
    map.fitBounds(L.latLngBounds(all), { ...mapPadding(), maxZoom: 18 });
  }
}

function selectRoute(i) {
  const list = routeView?.kind === 'transit' ? routeView.journeys : routeView?.routes;
  if (!list?.[i]) return;
  routeView.idx = i;
  renderRoutePanel();
  paintRoutes({ fit: routeView.kind === 'transit' });
}

$('#sheet-body').addEventListener('click', (e) => {
  const redraw = () => {
    const p = placeById(state.selected?.placeId);
    if (p) drawRoute(p, $('#route-from').value);
  };
  const mode = e.target.closest('[data-travel-mode]')?.dataset.travelMode;
  if (mode) {
    if (mode !== state.travelMode) {
      setTravelMode(mode);
      redraw();
    }
    return;
  }
  const style = e.target.closest('[data-route-style]')?.dataset.routeStyle;
  if (style) {
    if (style !== state.routeStyle) {
      setRouteStyle(style);
      redraw();
    }
    return;
  }
  if (e.target.closest('[data-nav-start]')) return startNavigation();
  const idx = e.target.closest('[data-route-idx]')?.dataset.routeIdx;
  if (idx !== undefined) selectRoute(Number(idx));
});

// ---------- live departures (stop panels) ----------

let departuresTimer = null;

async function loadDepartures(stop) {
  const el = () => (state.selected?.placeId === stop.id ? $('#departures') : null);
  try {
    const { departures: list } = await fetchDepartures({ name: stop.timetableName ?? stop.name, latlng: stop.latlng });
    if (el()) el().innerHTML = departuresHtml(list);
  } catch {
    if (el()) el().innerHTML = `<p class="muted small">${esc(t('departures.error'))} ${mvvLink()}</p>`;
  }
}

function departuresHtml(list) {
  const now = Date.now();
  const upcoming = list.filter((d) => d.time - now > -60000).slice(0, 8);
  if (!upcoming.length) return `<p class="muted small">${esc(t('departures.none'))}</p>`;
  const when = (d) => (d.time - now < 3600000 ? i18n.countdown(d.time - now) : i18n.time(d.time));
  return `<ul class="departures">${upcoming
    .map(
      (d) => `<li class="${d.cancelled ? 'cancelled' : ''}">${lineBadge(d)}
        <span class="dest"><span class="title">${esc(d.headsign)}</span>${d.track ? `<span class="sub">${esc(t('transit.track', { track: d.track }))}</span>` : ''}</span>
        <span class="when"><span class="time">${esc(when(d))}</span>${delayHtml(d)}</span></li>`,
    )
    .join('')}</ul><p class="muted small">${esc(t(upcoming.some((d) => d.realTime) ? 'departures.live' : 'departures.scheduled'))} · ${esc(t('transit.source'))}</p>`;
}

function stopDepartures() {
  clearInterval(departuresTimer);
  departuresTimer = null;
}

function closeSheet() {
  $('#sheet').hidden = true;
  state.selected = null;
  routeView = null;
  routeRequest++;
  stopDepartures();
  routeLayer?.clearLayers();
  highlightMarker(null);
}
$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet-handle').addEventListener('click', () => $('#sheet').classList.toggle('collapsed'));

// ---------- live navigation ----------
//
// Follows the GPS position along the chosen route: next turn with distance, time left and arrival,
// spoken instructions, automatic rerouting when you leave the route (walking/cycling), and for
// bus & train the walk to the stop, the ride with stops left, and "get off at the next stop".
// The position stays on the device; only a reroute sends it to the routing service.

const nav = { active: false };
let navLayer = null;

const navStartButton = () =>
  `<button type="button" class="btn btn-filled wide pressable nav-start" data-nav-start>${svg('navigation')} ${esc(t('nav.start'))}</button>`;

function navSegments(view) {
  if (view.kind === 'transit') {
    const legs = view.journeys[view.idx].legs;
    return legs.map((leg, i) => ({ kind: leg.transit ? 'ride' : 'walk', leg, route: prepareRoute(leg.coords), last: i === legs.length - 1, next: legs[i + 1] ?? null }));
  }
  const plan = view.routes[view.idx];
  return [{ kind: 'street', route: prepareRoute(plan.coords, plan.steps), plan, last: true }];
}

function startNavigation() {
  if (!routeView || !map) return;
  if (!navigator.geolocation) return toast(t('toast.noGeo'));
  Object.assign(nav, {
    active: true,
    arrived: false,
    mode: routeView.kind === 'transit' ? 'transit' : routeView.mode,
    journey: routeView.kind === 'transit' ? routeView.journeys[routeView.idx] : null,
    segments: navSegments(routeView),
    seg: 0,
    along: null,
    off: 0,
    lastReroute: 0,
    rerouting: false,
    spoken: new Set(),
    follow: true,
    fix: null,
    heading: null,
    target: routeView.target,
    room: state.selected?.room?.code ?? null,
    voice: store.get('navVoice', true),
  });
  navLayer ??= L.layerGroup().addTo(map);
  document.body.classList.add('navigating');
  $('#nav-hud').hidden = false;
  $('#nav-recenter').hidden = true;
  updateVoiceButton();
  paintNav();
  renderHud();
  speak(t('nav.startedSpeech')); // also unlocks speech on iOS (needs a tap)
  nav.watch = navigator.geolocation.watchPosition(onNavFix, onNavError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  nav.timer = setInterval(() => nav.fix && renderHud(), 15000); // keep countdowns fresh while standing still
  requestWakeLock();
}

function stopNavigation() {
  if (!nav.active) return;
  navigator.geolocation?.clearWatch(nav.watch);
  clearInterval(nav.timer);
  nav.wakeLock?.release?.().catch(() => {});
  nav.wakeLock = null;
  window.speechSynthesis?.cancel();
  nav.active = false;
  document.body.classList.remove('navigating');
  $('#nav-hud').hidden = true;
  navLayer?.clearLayers();
  paintRoutes();
}

async function requestWakeLock() {
  try {
    nav.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    /* not supported or denied – the screen may turn off */
  }
}
document.addEventListener('visibilitychange', () => nav.active && document.visibilityState === 'visible' && requestWakeLock());

function speak(text) {
  if (!nav.voice || !text || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = state.lang === 'de' ? 'de-DE' : 'en-GB';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

const bearing = ([lat1, lng1], [lat2, lng2]) => {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};

function onNavError(err) {
  if (err.code === 1) {
    toast(t('toast.geoDenied'));
    stopNavigation();
  }
}

function onNavFix(pos) {
  if (!nav.active || nav.arrived) return;
  const latlng = [pos.coords.latitude, pos.coords.longitude];
  const accuracy = pos.coords.accuracy ?? 20;
  const moved = nav.fix ? distanceMeters(nav.fix.latlng, latlng) : 0;
  if (Number.isFinite(pos.coords.heading) && (pos.coords.speed ?? 0) > 0.5) nav.heading = pos.coords.heading;
  else if (moved > 4) nav.heading = bearing(nav.fix.latlng, latlng);
  const first = !nav.fix;
  if (first || moved > 4 || accuracy < nav.fix.accuracy) nav.fix = { latlng, accuracy };
  state.me = latlng;
  drawNavPosition(latlng, accuracy);
  if (first) map.setView(latlng, Math.max(map.getZoom(), 18));
  else if (nav.follow) map.panTo(latlng, { animate: true, duration: 0.5 });
  advance(latlng, accuracy, 0);
}

// Work out progress on the current part of the trip and move on to the next part when done.
function advance(latlng, accuracy, depth) {
  const seg = nav.segments[nav.seg];
  const prog = progress(seg.route, latlng, { hintAlong: nav.along });
  if (prog.offRoute < 60) nav.along = prog.along;
  nav.prog = prog;

  let done = false;
  if (seg.kind === 'ride') {
    const rp = rideProgress(seg.leg, latlng);
    done = rp.metersToExit < 60 || (Date.now() > seg.leg.end.getTime() + 60000 && rp.metersToExit < 400);
    if (!done && rp.stopsLeft <= 1 && !nav.spoken.has('exit')) {
      nav.spoken.add('exit');
      speak(t('nav.getOffSpeech', { stop: seg.leg.to.name }));
      navigator.vibrate?.([200, 100, 200]);
    }
  } else {
    done = hasArrived(prog, latlng, seg.route.coords.at(-1), seg.route.toXY);
    // Already on the bus although the walk to the stop isn't "finished" (GPS drift, other door …).
    if (!done && seg.kind === 'walk' && seg.next?.transit && Date.now() > seg.next.start.getTime() + 60000 && prog.offRoute > 80) done = true;
  }
  if (done) {
    if (seg.last) return arrive();
    nav.seg++;
    nav.along = null;
    nav.spoken = new Set();
    const next = nav.segments[nav.seg];
    if (next.kind === 'ride') speak(t('nav.board', { line: next.leg.line, headsign: next.leg.headsign }));
    paintNav();
    return depth < 3 ? advance(latlng, accuracy, depth + 1) : renderHud();
  }

  if (seg.kind === 'street') {
    if (isOffRoute(prog, accuracy, nav.mode)) {
      nav.off++;
      if (nav.off >= 2 && !nav.rerouting && Date.now() - nav.lastReroute > 15000) reroute(latlng);
    } else nav.off = 0;
    if (!nav.rerouting) speak(announcement(prog, nav.spoken, nav.mode));
  } else if (seg.kind === 'walk' && !nav.spoken.has('walk')) {
    nav.spoken.add('walk');
    if (seg.next?.transit) speak(t('nav.toStopSpeech', { stop: seg.leg.to.name, line: seg.next.line, time: i18n.time(seg.next.start) }));
  }
  renderHud();
}

async function reroute(latlng) {
  nav.rerouting = true;
  nav.lastReroute = Date.now();
  renderHud();
  const r = await getDirections(latlng, nav.target.latlng, { mode: nav.mode, stepFree: state.avoidStairs, lang: state.lang, style: state.routeStyle, alternates: 0 }).catch(() => null);
  if (!nav.active) return;
  nav.rerouting = false;
  if (r && !r.approx) {
    nav.segments = [{ kind: 'street', route: prepareRoute(r.coords, r.steps), plan: r, last: true }];
    nav.seg = 0;
    nav.along = null;
    nav.off = 0;
    nav.spoken = new Set();
    paintNav();
    speak(t('nav.rerouted'));
  }
  renderHud();
}

function arrive() {
  nav.arrived = true;
  navigator.geolocation?.clearWatch(nav.watch);
  clearInterval(nav.timer);
  speak(t('nav.arrived'));
  navigator.vibrate?.(300);
  renderHud();
}

function paintNav() {
  routeLayer.clearLayers();
  nav.segments.forEach((seg, i) => {
    const done = i < nav.seg;
    const color = done ? cssVar('--outline') : seg.kind === 'ride' ? seg.leg.color ?? cssVar('--primary') : cssVar('--primary');
    if (seg.kind === 'walk') {
      L.polyline(seg.route.coords, { color, weight: 6, opacity: 0.95, dashArray: '1 10', lineCap: 'round', interactive: false }).addTo(routeLayer);
      return;
    }
    L.polyline(seg.route.coords, { color: cssVar('--surface-container-lowest'), weight: 11, opacity: 0.9, interactive: false }).addTo(routeLayer);
    L.polyline(seg.route.coords, { color, weight: 7, opacity: 0.95, interactive: false }).addTo(routeLayer);
  });
}

function drawNavPosition(latlng, accuracy) {
  if (!nav.marker) {
    nav.circle = L.circle(latlng, { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(navLayer);
    nav.marker = L.marker(latlng, { icon: divIcon(`<div class="mk mk-nav">${svg('navigation')}</div>`, 38), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(navLayer);
  } else if (!navLayer.hasLayer(nav.marker)) {
    nav.circle.addTo(navLayer);
    nav.marker.addTo(navLayer);
  }
  nav.circle.setLatLng(latlng).setRadius(accuracy);
  nav.marker.setLatLng(latlng);
  nav.marker.getElement()?.firstElementChild?.style.setProperty('--rot', `${nav.heading ?? 0}deg`);
}

function renderHud() {
  const seg = nav.segments[nav.seg];
  const prog = nav.prog;
  let icon = 'my_location';
  let big = t('nav.waiting');
  let small = '';
  let badge = '';
  if (nav.arrived) {
    icon = 'flag';
    big = t('nav.arrived');
    const building = nav.target.kind === 'building' ? nav.target : null;
    small = nav.room && building ? t('room.hint', { room: nav.room, building: building.id }) : i18n.pick(nav.target.name);
  } else if (nav.rerouting) {
    icon = 'alt_route';
    big = t('nav.rerouting');
  } else if (prog && seg.kind === 'ride') {
    const rp = rideProgress(seg.leg, nav.fix.latlng);
    badge = lineBadge(seg.leg);
    icon = null;
    big = rp.stopsLeft <= 1 ? t('nav.getOff') : t('nav.stopsLeft', { n: rp.stopsLeft });
    small = `${seg.leg.headsign} · ${t('nav.alightAt', { stop: seg.leg.to.name, time: i18n.time(seg.leg.end) })}`;
  } else if (prog && seg.kind === 'walk' && seg.next?.transit) {
    icon = 'directions_walk';
    big = i18n.distance(prog.remaining);
    const leaves = seg.next.start - Date.now();
    small = `${t('nav.toStop', { stop: seg.leg.to.name })} · ${t('nav.departs', { line: seg.next.line, when: leaves > 60000 ? i18n.countdown(leaves) : t('countdown.now') })}`;
  } else if (prog) {
    const m = prog.next;
    icon = m ? maneuverIcon(m.type) : 'flag';
    big = i18n.distance(prog.distanceToNext);
    small = m ? m.text : t('nav.toDestination', { place: i18n.pick(nav.target.name) });
  }
  if (nav.fix && nav.fix.accuracy > 50 && !nav.arrived) small += ` · ${t('nav.weakGps', { m: Math.round(nav.fix.accuracy) })}`;

  $('#nav-icon').innerHTML = badge || svg(icon);
  $('#nav-big').textContent = big;
  $('#nav-small').textContent = small;

  // Time left and arrival: the journey's arrival for bus & train, else scaled from the planned time.
  let minutes = null;
  let meters = null;
  if (nav.journey) {
    minutes = Math.max(0, Math.round((nav.journey.end - Date.now()) / 60000));
  } else if (prog && seg.kind === 'street') {
    minutes = minutesLeft(prog, seg.route, seg.plan.minutes);
    meters = prog.remaining;
  }
  const eta = minutes == null ? null : new Date(Date.now() + minutes * 60000);
  $('#nav-time').textContent = nav.arrived ? '' : minutes == null ? '' : t('nav.left', { min: minutes, dist: meters == null ? '' : `· ${i18n.distance(meters)}` }).trim();
  $('#nav-eta').textContent = nav.arrived || !eta ? '' : t('nav.eta', { time: i18n.time(nav.journey ? nav.journey.end : eta) });
  $('#nav-stop').innerHTML = `${svg(nav.arrived ? 'check' : 'close')} ${esc(t(nav.arrived ? 'nav.done' : 'nav.stop'))}`;
}

function updateVoiceButton() {
  $('#nav-voice').innerHTML = svg(nav.voice ? 'volume_up' : 'volume_off');
  $('#nav-voice').setAttribute('aria-pressed', String(nav.voice));
  $('#nav-voice').setAttribute('aria-label', t('nav.voice'));
}

$('#nav-stop').addEventListener('click', stopNavigation);
$('#nav-voice').addEventListener('click', () => {
  nav.voice = !nav.voice;
  store.set('navVoice', nav.voice);
  if (!nav.voice) window.speechSynthesis?.cancel();
  updateVoiceButton();
});
$('#nav-recenter').addEventListener('click', () => {
  nav.follow = true;
  $('#nav-recenter').hidden = true;
  if (nav.fix) map.setView(nav.fix.latlng, Math.max(map.getZoom(), 17));
});

// ---------- welcome ----------

function showWelcome() {
  $('#welcome').hidden = false;
}
$('#welcome-ok').addEventListener('click', () => {
  $('#welcome').hidden = true;
  store.set('welcomeSeen', true);
  input.focus();
});
$('#reset-welcome').addEventListener('click', () => {
  showView('map');
  closeSheet();
  showWelcome();
});

// ---------- geolocation ----------

function locate({ quiet = false } = {}) {
  if (!navigator.geolocation) return quiet || toast(t('toast.noGeo'));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.me = [pos.coords.latitude, pos.coords.longitude];
      if (map) {
        meMarker?.remove();
        meMarker = L.marker(state.me, { icon: divIcon('<div class="mk mk-me"></div>', 20), interactive: false }).addTo(map);
        if (!quiet) map.setView(state.me, 18);
      }
      if (!quiet) {
        const near = nearest(places().filter((p) => !['transit', 'service'].includes(p.kind)), state.me);
        toast(near && near.meters < NEAR_PLACE_RADIUS_M ? t('toast.near', { name: i18n.pick(near.item.name) }) : t('toast.notOnCampus'));
      }
      renderToday();
    },
    () => quiet || toast(t('toast.geoDenied')),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  );
}
$('#locate-btn').addEventListener('click', () => locate());

// ---------- search ----------

const input = $('#search-input');
const resultsEl = $('#search-results');
let results = [];
let activeIdx = -1;

const CHIPS = [
  { key: 'chip.mensa', icon: 'restaurant', place: 'mensa' },
  { key: 'chip.study', icon: 'local_library', category: 'study' },
  { key: 'chip.studentService', icon: 'support_agent', place: 'student-service' },
  { key: 'chip.cafe', icon: 'coffee', query: 'StuCafé' },
  { key: 'chip.transit', icon: 'directions_bus', category: 'transit' },
  { key: 'chip.people', icon: 'groups', view: 'people' },
];

function renderChips() {
  $('#chips').innerHTML = CHIPS.map((c, i) => `<button class="chip glass pressable" data-chip="${i}">${svg(c.icon)}${esc(t(c.key))}</button>`).join('');
}

$('#chips').addEventListener('click', (e) => {
  const chip = CHIPS[e.target.closest('[data-chip]')?.dataset.chip];
  if (!chip) return;
  if (chip.place) return selectPlace(chip.place);
  if (chip.category) return showCategoryResults(chip.category);
  if (chip.view === 'people') {
    showView('campus');
    return $('#people-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  input.value = chip.query;
  runSearch();
  if (results.length === 1 || results[0]?.score >= 100) pickResult(results[0]);
});

const RESULT_ICON = { room: 'meeting_room', building: 'apartment', person: 'person', contact: 'person', class: 'event' };
const resultIcon = (r) => (r.placeId && r.type !== 'room' && placeById(r.placeId)?.kind !== 'building' && !r.personId ? placeIcon(placeById(r.placeId)) : RESULT_ICON[r.type] ?? 'location_on');

function runSearch() {
  const q = input.value;
  $('#search-clear').hidden = !q;
  if (!q.trim()) return showSuggestions();
  results = search(q, { campus: state.campus, places: places(), classes: state.classes, contacts: state.contacts, i18n });
  activeIdx = results.length ? 0 : -1;
  renderResults(results.length ? '' : `<li class="empty">${esc(t('search.none'))}</li>`);
}

// A whole category as a result list ("Bibliotheken": HSWT and TUM library side by side).
function showCategoryResults(categoryId) {
  const cat = categoryById[categoryId];
  const now = new Date();
  results = placesInCategory(state.campus, categoryId).map((p) => ({
    title: i18n.pick(p.name),
    subtitle: [p.room, i18n.pick(p.description)].filter(Boolean).join(' · '),
    status: openingStatus(p.hours, now),
    placeId: p.id,
    category: categoryId,
    icon: placeIcon(p),
  }));
  activeIdx = -1;
  resultsEl.hidden = false;
  resultsEl.innerHTML = `<li class="group" role="presentation">${esc(i18n.pick(cat.name))}</li>` + results.map((r, i) => resultItem(r, i)).join('');
}

// Empty search box: offer saved places and recent searches.
function showSuggestions() {
  const asResult = (entry, icon) => {
    const { title, sub } = storedLabel(entry);
    return { title, subtitle: sub, stored: entry, icon };
  };
  const saved = state.saved.map((s) => asResult(s, 'star-fill'));
  const recent = state.recent.filter((r) => !state.saved.some((s) => s.key === r.key)).map((r) => asResult(r, 'history'));
  results = [...saved, ...recent].filter((r) => r.title);
  const savedCount = saved.filter((r) => r.title).length;
  activeIdx = -1;
  const header = (key, n) => (n ? `<li class="group" role="presentation">${esc(t(key))}</li>` : '');
  resultsEl.hidden = results.length === 0;
  resultsEl.innerHTML =
    header('search.favorites', savedCount) +
    results.map((r, i) => (i === savedCount ? header('search.recent', results.length - savedCount) : '') + resultItem(r, i)).join('');
}

function resultItem(r, i) {
  return `<li role="option" data-i="${i}" aria-selected="${i === activeIdx}" ${r.category ? `data-cat="${esc(r.category)}"` : ''}>
    <span class="lead round">${svg(r.icon ?? resultIcon(r))}</span>
    <div class="content">
      <div class="title">${esc(r.title)}</div>
      <div class="sub">${r.status?.known ? `${statusHtml(r.status)} · ` : ''}${esc(r.subtitle ?? '')}</div>
    </div>
  </li>`;
}

function renderResults(empty = '') {
  resultsEl.hidden = !results.length && !empty;
  resultsEl.innerHTML = results.map((r, i) => resultItem(r, i)).join('') || empty;
}

function hideResults() {
  results = [];
  resultsEl.hidden = true;
}

function pickResult(r) {
  hideResults();
  input.blur();
  if (r.stored) {
    input.value = r.title;
    return openStored(r.stored);
  }
  input.value = r.title;
  $('#search-clear').hidden = false;
  if (!r.placeId) return toast(t('toast.classNoRoom'));
  selectPlace(r.placeId, { room: r.room ?? null, personId: r.personId ?? null });
}

input.addEventListener('input', runSearch);
input.addEventListener('focus', () => !input.value && showSuggestions());
input.addEventListener('blur', () => setTimeout(() => document.activeElement !== input && (resultsEl.hidden = true), 200));
input.addEventListener('keydown', (e) => {
  if (!results.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    resultsEl.querySelectorAll('li[data-i]').forEach((li) => li.setAttribute('aria-selected', String(Number(li.dataset.i) === activeIdx)));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    pickResult(results[Math.max(0, activeIdx)]);
  } else if (e.key === 'Escape') {
    hideResults();
  }
});
resultsEl.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus so blur doesn't hide first
resultsEl.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) pickResult(results[Number(li.dataset.i)]);
});
// Category lists are opened from a chip (no input focus), so close them on any tap elsewhere.
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.search')) resultsEl.hidden = true;
});
$('#search-clear').addEventListener('click', () => {
  input.value = '';
  $('#search-clear').hidden = true;
  input.focus();
  showSuggestions();
});

// ---------- Mensa ----------

const menuCache = new Map();
// GitHub Pages first; the raw gh-pages branch is a fallback for networks that block github.io.
function loadWeek(canteenId, date) {
  const url = menuUrl(canteenId, date);
  if (!menuCache.has(url)) {
    const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(`HTTP ${r.status}`))));
    const raw = url.replace(EAT_API, 'https://raw.githubusercontent.com/TUM-Dev/eat-api/gh-pages');
    const p = get(url).catch(() => get(raw));
    p.catch(() => menuCache.delete(url));
    menuCache.set(url, p);
  }
  return menuCache.get(url);
}

const mensaPlace = () => placeById('mensa');
const labelNames = (keys) => keys.map((k) => i18n.pick(LABELS[k])).filter(Boolean);

function dishBadges(dish) {
  const badges = dishTags(dish).map((id) => `<span class="tag">${svg(tagById[id].icon)}${esc(t(`mensa.tag.${id}`))}</span>`);
  // Meat and fish dishes name what's in them ("Schwein", "Rind", …).
  if (dish.meat.length && !['vegan', 'vegetarian'].includes(dish.diet)) badges.push(`<span class="tag meat">${esc(labelNames(dish.meat).join(' · '))}</span>`);
  return badges.join('');
}

function dishCard(dish) {
  const hits = conflicts(dish, state.mensa.avoid);
  const price = formatPrice(dish.prices[state.mensa.role], i18n.locale);
  const details = [
    dish.allergens.length ? `<div><strong>${esc(t('mensa.allergens'))}:</strong> ${esc(labelNames(dish.allergens).join(', '))}</div>` : '',
    dish.additives.length ? `<div><strong>${esc(t('mensa.additives'))}:</strong> ${esc(labelNames(dish.additives).join(', '))}</div>` : '',
    dish.quality.length ? `<div><strong>${esc(t('mensa.quality'))}:</strong> ${esc(labelNames(dish.quality).join(', '))}</div>` : '',
  ].join('');
  const warn = hits.length ? `<span class="tag warn">${svg('warning')}${esc(t('mensa.warn', { list: hits.map((f) => i18n.pick(ALLERGEN_FAMILIES[f])).join(', ') }))}</span>` : '';
  return `<li class="dish ${hits.length ? 'conflict' : ''}">
    <div class="dish-main">
      <div class="dish-name">${esc(dish.name)}</div>
      <div class="dish-price">${esc(price || '–')}</div>
    </div>
    <div class="dish-tags">${warn}${dishBadges(dish)}</div>
    ${details ? `<details class="dish-details"><summary>${esc(t('mensa.details'))}</summary>${details}</details>` : ''}
  </li>`;
}

async function renderMensa() {
  const m = state.mensa;
  const place = mensaPlace();
  const status = openingStatus(place.hours);
  $('#mensa-status').className = `status ${statusClass(status)}`;
  $('#mensa-status').textContent = `${place.name} · ${i18n.openingStatus(status)}`;
  $('#mensa-tags').innerHTML =
    `<button type="button" class="filter-chip pressable" data-tag="" aria-pressed="${m.tags.length === 0}">${esc(t('mensa.tag.all'))}</button>` +
    TAGS.map((tag) => {
      const on = m.tags.includes(tag.id);
      return `<button type="button" class="filter-chip pressable" data-tag="${tag.id}" aria-pressed="${on}">${svg(on ? 'check' : tag.icon)}${esc(t(`mensa.tag.${tag.id}`))}</button>`;
    }).join('');
  $('#mensa-role').innerHTML = ROLES.map((r) => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${esc(t(`mensa.role.${r}`))}</option>`).join('');
  $('#allergen-picker').innerHTML = Object.entries(ALLERGEN_FAMILIES)
    .map(([k, v]) => `<label><input type="checkbox" value="${k}" ${m.avoid.includes(k) ? 'checked' : ''}/> ${esc(i18n.pick(v))}</label>`)
    .join('');
  $('#hide-conflicts').checked = m.hide;

  const today = new Date();
  const start = menuWeekStart(today);
  start.setDate(start.getDate() + 7 * m.week);
  const list = $('#mensa-list');
  list.innerHTML = `<p class="muted">${esc(t('mensa.loading'))}</p>`;
  let week;
  try {
    week = await loadWeek(place.menu, start);
  } catch {
    list.innerHTML = `<p class="muted">${esc(t('mensa.error'))}</p>`;
    return;
  }
  const days = daysOf(week);
  const todayIso = isoDate(today);
  if (!m.day || !days.some((d) => d.date === m.day)) m.day = days.find((d) => d.date >= todayIso)?.date ?? days[0]?.date ?? null;

  const tabs = days.map((d) => {
    const date = new Date(`${d.date}T12:00`);
    const label = `${i18n.weekday(date.getDay(), true)} ${i18n.shortDate(date)}${d.date === todayIso ? ` · ${t('mensa.today')}` : ''}`;
    return `<button class="filter-chip pressable" role="tab" data-day="${d.date}" aria-selected="${d.date === m.day}">${esc(label)}</button>`;
  });
  tabs.push(
    `<button class="btn btn-text pressable" data-week="${m.week ? 0 : 1}">${esc(t(m.week ? 'mensa.thisWeek' : 'mensa.nextWeek'))} ${svg('chevron_right', m.week ? 'sm flip' : 'sm')}</button>`,
  );
  $('#mensa-days').innerHTML = tabs.join('');

  const day = days.find((d) => d.date === m.day);
  if (!day || !day.dishes.length) {
    list.innerHTML = `<p class="muted">${esc(t('mensa.none'))}</p>`;
    return;
  }
  const visible = day.dishes.filter((d) => matchesTags(d, m.tags) && !(m.hide && conflicts(d, m.avoid).length));
  const halalShown = m.tags.includes('halal') || visible.some((d) => dishTags(d).includes('halal'));
  list.innerHTML = visible.length
    ? groupByType(visible)
        .map((g) => `<h3 class="dish-type">${esc(g.type)}</h3><ul class="dishes">${g.dishes.map(dishCard).join('')}</ul>`)
        .join('') + (halalShown ? `<p class="footnote">${esc(t('mensa.halalNote'))}</p>` : '')
    : `<p class="muted">${esc(t('mensa.noMatch'))}</p>`;
}

$('#mensa-days').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.week) {
    state.mensa.week = Number(b.dataset.week);
    state.mensa.day = null;
  } else state.mensa.day = b.dataset.day;
  renderMensa();
});
$('#mensa-tags').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  const id = b.dataset.tag;
  const tags = state.mensa.tags;
  state.mensa.tags = !id ? [] : tags.includes(id) ? tags.filter((x) => x !== id) : [...tags, id];
  store.set('mensaTags', state.mensa.tags);
  lunchShownFor = null;
  renderMensa();
});
$('#mensa-role').addEventListener('change', (e) => {
  state.mensa.role = e.target.value;
  store.set('mensaRole', state.mensa.role);
  renderMensa();
});
$('#allergen-picker').addEventListener('change', () => {
  state.mensa.avoid = [...document.querySelectorAll('#allergen-picker input:checked')].map((i) => i.value);
  store.set('allergens', state.mensa.avoid);
  lunchShownFor = null;
  renderMensa();
});
$('#hide-conflicts').addEventListener('change', (e) => {
  state.mensa.hide = e.target.checked;
  store.set('hideConflicts', state.mensa.hide);
  renderMensa();
});
$('#mensa-map').addEventListener('click', () => selectPlace('mensa'));

async function todaysDishes() {
  const place = mensaPlace();
  try {
    return daysOf(await loadWeek(place.menu, new Date())).find((d) => d.date === isoDate(new Date()))?.dishes ?? [];
  } catch {
    return null;
  }
}

async function renderMenuPreview() {
  const dishes = await todaysDishes();
  const el = $('#menu-preview');
  if (!el) return;
  if (!dishes) return (el.textContent = t('mensa.error'));
  if (!dishes.length) return (el.textContent = t('sheet.menuNone'));
  el.classList.remove('muted');
  el.innerHTML = `<ul class="mini-list">${dishes
    .slice(0, 5)
    .map((d) => `<li>${esc(d.name)} <span class="muted">${esc(formatPrice(d.prices[state.mensa.role], i18n.locale))}</span></li>`)
    .join('')}</ul><button class="btn btn-tonal pressable" id="full-menu">${esc(t('sheet.fullMenu'))} ${svg('chevron_right')}</button>`;
  $('#full-menu').addEventListener('click', () => showView('mensa'));
}

// ---------- today / timetable ----------

function classTarget(room) {
  const loc = locateRoom(room, state.campus);
  const building = loc?.buildingRef ?? locateBuilding(room, state.campus);
  return building ? { loc, building } : null;
}

const TRANSIT_PLAN_AHEAD_MS = 12 * 3600000; // plan bus/train trips for classes in the next 12 hours

// How to get to the next class with the chosen travel mode. Walking/cycling: a straight-line
// estimate first, replaced by the real route once it arrives. Bus & train: the latest journey
// that arrives in time (falls back to walking while it loads or if there is none).
function travelTo(target, startsAt) {
  const mode = state.travelMode;
  if (mode === 'transit' && startsAt - Date.now() < TRANSIT_PLAN_AHEAD_MS) {
    const origin = resolveOrigin(defaultOrigin(), 'transit');
    const deadline = new Date(startsAt.getTime() - state.bufferMin * 60000);
    const entry = transitFor(origin, target.building.latlng, target.building.id, { time: deadline, arriveBy: true });
    const journey = entry.settled ? latestArrivingBy(entry.settled, deadline) : null;
    if (journey) return { mode, journey, leave: journey.start, minutes: journey.minutes };
    if (entry.settled === undefined && !entry.rerender) entry.rerender = entry.promise.then(() => renderToday());
  }
  const street = mode === 'bike' ? 'bike' : 'walk';
  const origin = resolveOrigin(defaultOrigin(), street);
  const fromLabel = origin.key === 'station' ? t('today.fromStation') : t('today.fromHere');
  const entry = routeFor(origin, target.building.latlng, target.building.id, street);
  if (entry.settled) return { mode: street, minutes: entry.settled.minutes, fromLabel };
  if (!entry.rerender) entry.rerender = entry.promise.then((r) => r && renderToday());
  const estimate = street === 'bike' ? estimateBike : estimateWalk;
  return { mode: street, minutes: estimate(origin.latlng, target.building.latlng).minutes, fromLabel };
}

function renderToday() {
  const now = new Date();
  const next = nextEvent(state.classes, now);
  const card = $('#next-card');

  if (!next) {
    card.innerHTML = state.classes.length
      ? `<div class="eyebrow">${svg('event', 'sm')} ${esc(t('today.next'))}</div><div class="big">${esc(t('today.none'))}</div>`
      : `<div class="eyebrow">${svg('event', 'sm')} ${esc(t('today.heading'))}</div><div class="big">${esc(t('today.emptyTitle'))}</div><div class="muted">${esc(t('today.emptyText'))}</div>`;
  } else {
    const { entry, startsAt, endsAt, ongoing } = next;
    const target = classTarget(entry.room);
    const travel = target ? travelTo(target, startsAt) : null;
    const sameDay = startsAt.toDateString() === now.toDateString();
    const when = ongoing
      ? t('today.nowUntil', { time: i18n.time(endsAt) })
      : `${i18n.countdown(startsAt - now)} · ${sameDay ? '' : `${i18n.weekday(startsAt.getDay())} `}${i18n.time(startsAt)}`;
    let leaveText = '';
    if (!ongoing && travel) {
      const leave = travel.leave ?? leaveBy(startsAt, travel.minutes, state.bufferMin);
      leaveText = leave <= now ? `<strong>${esc(t('today.leaveNow'))}</strong>` : t('today.leaveBy', { time: esc(i18n.time(leave)) });
      const ride = travel.journey?.legs.find((l) => l.transit);
      leaveText += ` · ${esc(
        ride
          ? t('today.transit', { line: ride.line, stop: ride.from.name, time: i18n.time(ride.start) })
          : t(travel.mode === 'bike' ? 'today.bike' : 'today.walk', { min: travel.minutes, from: travel.fromLabel }),
      )}`;
    }
    let where = entry.room ? t('today.roomUnknown', { room: entry.room }) : t('today.noRoom');
    if (target) where = [target.loc ? t('room.title', { code: target.loc.code }) : '', i18n.pick(target.building.name), target.building.address].filter(Boolean).join(' · ');
    card.innerHTML = `
      <div class="eyebrow">${svg('event', 'sm')} ${esc(ongoing ? t('today.current') : t('today.next'))}</div>
      <div class="big">${esc(entry.title)}</div>
      <div class="title-m">${esc(when)}</div>
      <div class="muted">${esc(where)}</div>
      ${leaveText ? `<div style="margin-top:6px">${leaveText}</div>` : ''}
      ${target ? `<div class="actions"><button class="btn btn-filled pressable" id="nav-next">${svg(MODE_ICON[state.travelMode])} ${esc(t('today.navigate'))}</button></div>` : ''}`;
    $('#nav-next')?.addEventListener('click', () => selectPlace(target.building.id, { room: target.loc, route: true }));
  }

  renderLunch(now);

  const today = eventsOn(state.classes, now);
  $('#today-list').innerHTML = today.length
    ? today
        .map(({ entry, startsAt, endsAt }) => {
          const past = endsAt <= now;
          return `<li><div class="list-item ${past ? 'muted' : ''}">
            <span class="lead text">${esc(i18n.time(startsAt))}</span>
            <div class="content"><div class="title">${esc(entry.title)}</div>
            <div class="sub">${esc(entry.room || '—')} · ${esc(t('today.until', { time: i18n.time(endsAt) }))}</div></div>
          </div></li>`;
        })
        .join('')
    : `<li class="empty-note">${esc(t('today.nothing'))}</li>`;

  const sorted = [...state.classes].sort(
    (a, b) => (a.day ?? 7) - (b.day ?? 7) || (a.date ?? '').localeCompare(b.date ?? '') || a.start.localeCompare(b.start),
  );
  $('#timetable-list').innerHTML = sorted.length
    ? sorted
        .map(
          (c) => `<li><div class="list-item">
            <span class="lead text">${c.date ? esc(c.date.slice(5)) : esc(i18n.weekday(c.day, true))}</span>
            <div class="content"><div class="title">${esc(c.title)}</div>
            <div class="sub">${esc(c.start)}–${esc(c.end)} · ${esc(c.room || '—')}</div></div>
            <button class="icon-btn pressable" data-delete="${esc(c.id)}" aria-label="${esc(t('timetable.remove', { title: c.title }))}">${svg('delete')}</button>
          </div></li>`,
        )
        .join('')
    : `<li class="empty-note">${esc(t('timetable.empty'))}</li>`;
}

// On weekdays before the Mensa closes, suggest today's cheapest dish that fits the filters.
let lunchShownFor = null;
async function renderLunch(now) {
  const card = $('#lunch-card');
  const status = openingStatus(mensaPlace().hours, now);
  const before = status.open || (status.opensIn === 0 && status.opensAt);
  if (!before) return (card.hidden = true);
  const key = `${isoDate(now)}|${state.lang}|${state.mensa.role}`;
  if (lunchShownFor === key) return;
  lunchShownFor = key;
  const dishes = (await todaysDishes())?.filter((d) => matchesTags(d, state.mensa.tags) && !conflicts(d, state.mensa.avoid).length);
  if (!dishes?.length) return (card.hidden = true);
  const cheapest = [...dishes].sort((a, b) => (a.prices[state.mensa.role]?.base_price ?? 99) - (b.prices[state.mensa.role]?.base_price ?? 99))[0];
  card.hidden = false;
  card.innerHTML = `<div class="eyebrow" style="color:inherit">${svg('restaurant', 'sm')} ${esc(t('tab.mensa'))}</div>
    <div>${esc(t('today.lunch', { dish: `${cheapest.name} (${formatPrice(cheapest.prices[state.mensa.role], i18n.locale)})` }))}</div>
    <div class="actions"><button class="btn btn-filled pressable" data-go="mensa">${esc(t('sheet.fullMenu'))}</button></div>`;
  card.querySelector('[data-go]').addEventListener('click', () => showView('mensa'));
}

$('#timetable-list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-delete]')?.dataset.delete;
  if (!id) return;
  state.classes = state.classes.filter((c) => c.id !== id);
  store.set('classes', state.classes);
  renderToday();
});

$('#class-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const entry = {
    id: `c-${Date.now()}`,
    title: f.get('title').trim(),
    room: f.get('room').trim().toUpperCase(),
    day: Number(f.get('day')),
    start: f.get('start'),
    end: f.get('end'),
  };
  if (entry.end <= entry.start) return toast(t('form.endBeforeStart'));
  if (entry.room && !classTarget(entry.room)) toast(t('form.roomNotFound', { room: entry.room }));
  state.classes.push(entry);
  store.set('classes', state.classes);
  e.target.reset();
  renderToday();
});

$('#ics-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const imported = parseIcs(await file.text());
  const ids = new Set(imported.map((c) => c.id));
  state.classes = [...state.classes.filter((c) => !ids.has(c.id)), ...imported];
  store.set('classes', state.classes);
  $('#ics-status').textContent = imported.length ? t('ics.imported', { n: imported.length }) : t('ics.none');
  e.target.value = '';
  renderToday();
});

// ---------- campus view ----------

function listButton(attrs, { lead, title, sub = '', status = null, cat = null }) {
  return `<li><button class="list-item pressable" ${attrs} ${cat ? `data-cat="${esc(cat)}"` : ''}>
    <span class="lead">${lead}</span>
    <span class="content"><span class="title">${esc(title)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${status?.known ? `<span class="sub">${statusHtml(status)}</span>` : ''}</span>
    ${svg('chevron_right', 'trailing')}
  </button></li>`;
}

const placeRow = (p, status) =>
  listButton(`data-place="${esc(p.id)}"`, {
    lead: p.building ? esc(p.building) : svg(placeIcon(p)),
    title: i18n.pick(p.name),
    sub: [p.room, i18n.pick(p.description)].filter(Boolean).join(' · '),
    status,
    cat: p.category,
  });

const personRow = (p) =>
  listButton(`data-person="${esc(p.id)}"`, {
    lead: esc(p.room.split('.')[0]),
    title: p.name,
    sub: [p.room, i18n.pick(p.field) || i18n.pick(p.note)].filter(Boolean).join(' · '),
  });

// Category tiles; tapping one lists its places (open ones first).
function renderCategories() {
  const el = $('#categories');
  const now = new Date();
  const cat = categoryById[state.campusCategory];
  if (cat) {
    const items = placesInCategory(state.campus, cat.id)
      .map((p) => ({ p, status: openingStatus(p.hours, now) }))
      .sort((a, b) => Number(!!b.status.open) - Number(!!a.status.open));
    el.innerHTML = `<div class="back-row"><button class="btn btn-text pressable" data-cat-back>${svg('chevron_right', 'flip')} ${esc(t('campus.allCategories'))}</button></div>
      <h3 class="title-l" style="margin:0 4px 12px">${esc(i18n.pick(cat.name))}</h3>
      <ul class="list">${items.map(({ p, status }) => placeRow(p, status)).join('')}</ul>`;
    return;
  }
  el.innerHTML = `<div class="tile-grid">${CATEGORIES.map((c) => {
    const items = placesInCategory(state.campus, c.id);
    if (!items.length) return '';
    const withHours = items.filter((p) => p.hours);
    const open = withHours.filter((p) => openingStatus(p.hours, now).open).length;
    const sub = [t('campus.count', { n: items.length }), withHours.length ? t('campus.openCount', { n: open }) : ''].filter(Boolean).join(' · ');
    return `<button class="tile pressable" data-category="${c.id}" data-cat="${c.id}">
      <span class="lead">${svg(c.icon)}</span>
      <span><span class="title">${esc(i18n.pick(c.name))}</span><span class="sub">${esc(sub)}</span></span>
    </button>`;
  }).join('')}</div>`;
}

function renderCampus() {
  $('#saved-list').innerHTML = state.saved.length
    ? state.saved
        .map((s, i) => {
          const { title, sub } = storedLabel(s);
          return title ? listButton(`data-saved="${i}"`, { lead: svg('star-fill'), title, sub }) : '';
        })
        .join('')
    : `<li class="empty-note">${esc(t('campus.savedEmpty'))}</li>`;

  renderCategories();

  $('#people-list').innerHTML = Object.entries(FACULTIES)
    .map(([key, name]) => {
      const people = state.campus.people.filter((p) => p.faculty === key);
      return people.length
        ? `<details class="card"><summary><span>${esc(i18n.pick(name))} <span class="muted">(${people.length})</span></span></summary><ul class="list">${people.map(personRow).join('')}</ul></details>`
        : '';
    })
    .join('');
  $('#contacts-list').innerHTML = state.contacts.length ? state.contacts.map(personRow).join('') : `<li class="empty-note">${esc(t('campus.contactsEmpty'))}</li>`;

  $('#buildings-summary').textContent = t('campus.buildingsCount', { n: state.campus.buildings.length });
  $('#buildings-list').innerHTML = state.campus.buildings
    .map((b) =>
      listButton(`data-place="${esc(b.id)}"`, {
        lead: esc(b.id),
        title: i18n.pick(b.subtitle) || i18n.pick(b.name),
        sub: b.address ? b.address.replace(', 85354 Freising', '') : '',
      }),
    )
    .join('');
}

$('#view-campus').addEventListener('click', (e) => {
  const el = e.target.closest('[data-place],[data-person],[data-saved],[data-category],[data-cat-back]');
  if (!el) return;
  if (el.dataset.place) selectPlace(el.dataset.place);
  else if (el.dataset.person) openPerson(el.dataset.person);
  else if (el.dataset.saved) openStored(state.saved[Number(el.dataset.saved)]);
  else {
    state.campusCategory = el.dataset.category ?? null;
    renderCategories();
    $('#categories-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

$('#contact-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const roomInput = f.get('room').trim();
  const loc = locateRoom(roomInput, state.campus);
  const building = loc?.buildingRef ?? locateBuilding(roomInput, state.campus);
  if (!building) return toast(t('contact.badRoom', { room: roomInput }));
  // Store the official spelling ("d1 436" → "D1.436") so it matches the profile pages.
  const contact = { id: `contact-${Date.now()}`, name: f.get('name').trim(), room: loc?.code ?? building.id, note: f.get('note').trim() };
  state.contacts.push(contact);
  store.set('contacts', state.contacts);
  e.target.reset();
  renderCampus();
  toast(t('toast.contactSaved', { name: contact.name }));
});

const stairsToggle = $('#avoid-stairs');
stairsToggle.checked = state.avoidStairs;
stairsToggle.addEventListener('change', () => {
  state.avoidStairs = stairsToggle.checked;
  store.set('avoidStairs', state.avoidStairs);
});

$('#route-style-select').addEventListener('change', (e) => setRouteStyle(e.target.value));
$('#travel-mode-select').addEventListener('change', (e) => setTravelMode(e.target.value));

const bufferInput = $('#buffer-min');
bufferInput.value = state.bufferMin;
bufferInput.addEventListener('change', () => {
  state.bufferMin = Math.min(30, Math.max(0, Number(bufferInput.value) || 0));
  bufferInput.value = state.bufferMin;
  store.set('bufferMin', state.bufferMin);
});

// ---------- campus switcher (shown once there is more than one campus) ----------

const campusSelect = $('#campus-select');
campusSelect.closest('label').hidden = CAMPUSES.length < 2;
campusSelect.innerHTML = CAMPUSES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
campusSelect.value = state.campus.id;
campusSelect.addEventListener('change', () => {
  state.campus = getCampus(campusSelect.value);
  store.set('campus', state.campus.id);
  closeSheet();
  input.value = '';
  hideResults();
  if (map) fitCampus();
  applyLanguage();
});

// ---------- boot ----------

initMap();
applyTheme();
applyLanguage();
locate({ quiet: true });
setInterval(() => {
  if ($('#view-today').classList.contains('active')) renderToday();
}, 30000);

// Deep links: ?q=A6.301 or ?q=Laube opens the room / person directly (e.g. from a QR code on a door sign);
// ?view=today|mensa|campus opens a tab (used by the app shortcuts).
const params = new URLSearchParams(location.search);
const q = params.get('q');
if (['today', 'mensa', 'campus'].includes(params.get('view'))) {
  showView(params.get('view'));
} else if (q) {
  const hit = search(q, { campus: state.campus, places: places(), classes: state.classes, contacts: state.contacts, i18n })[0];
  if (hit) pickResult(hit);
} else if (!store.get('welcomeSeen', false)) {
  showWelcome();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
