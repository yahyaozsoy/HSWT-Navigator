# HSWT Navigator

A campus app for the Weihenstephan campus of Hochschule Weihenstephan-Triesdorf (Freising). Find rooms,
offices and the Mensa, get walking, cycling or bus directions with live navigation, and see when you need
to leave for your next class. German and English.

## Features

- **Search** rooms as HSWT writes them (`A6.301`, `D1.436`), lecturers by name, offices and places by topic
  (libraries, food, advice, faculties, bus & bike …).
- **Directions** on foot, by bike or by bus & train, with alternative routes, step-free routing and a
  *main paths* option.
- **Live navigation**: turn-by-turn guidance that follows your GPS position, spoken instructions, automatic
  rerouting, and on the bus "get off at the next stop".
- **Today**: your timetable (typed in or imported as `.ics`), the next class, and when to leave.
- **Mensa**: this week's menu with prices, allergens and filters (vegan, vegetarian, halal-friendly*,
  gluten-free …).
- **Live departures** at the bus stops around campus and at Freising station.
- **Works like an app**: add it to your home screen; it keeps working on patchy Wi-Fi. Light and dark mode.

\* *Halal-friendly* is derived from the Studierendenwerk's labels. The Mensa is not halal-certified.

## Privacy

There are no accounts and no server of our own. Your timetable, saved places and settings stay in your
browser. Your location stays on your device; only start and destination are sent to the route planner
when you ask for a route.

## Run it locally

No build step and no dependencies – it's plain HTML, CSS and JavaScript.

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy

Any static host works. On Cloudflare (*Workers & Pages → Import a repository*): leave the build command
empty and use `npx wrangler deploy` as the deploy command. `wrangler.jsonc` serves the folder as static
files.

## Data sources

| Data | Source |
|---|---|
| Map, building outlines, bike parking | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (via [Overture Maps](https://overturemaps.org)) |
| Building codes | Official HSWT site plan (*Lageplan Weihenstephan*) |
| Offices, opening hours, lecturers | Public pages on [hswt.de](https://www.hswt.de) |
| Mensa menu | Studierendenwerk München Oberbayern via [eat-api](https://github.com/TUM-Dev/eat-api) |
| Walking and cycling routes | [FOSSGIS](https://www.fossgis.de) Valhalla and OSRM |
| Bus and train | [Transitous](https://transitous.org) (DELFI/MVV timetables) |
| Icons | [Material Symbols](https://fonts.google.com/icons) (Apache 2.0, see `icons/LICENSE-material-symbols.txt`) |
| Map library | [Leaflet](https://leafletjs.com) |

Information can be out of date – the linked hswt.de page and the notice at the Mensa are authoritative.
This is a student project and not an official HSWT service.

## Project structure

```
index.html            app shell
css/styles.css        design (light and dark)
js/app.js             user interface
js/lib/               search, routing, transit, navigation, Mensa, timetable logic
js/data/              campus, offices, lecturers, bike parking
icons/                app icons and icon sprite
sw.js                 offline support
```
