# Vibehuus

Landing page for **Vibehuus** — a one-day vibecoding event at Haus am Fluss in Bern, Switzerland.

The page is rendered as a stylised cartographic map: the Aare river flows top-to-bottom on a canvas (drawn with a Catmull-Rom spline), and event details — venue, date, agenda, sign-up — are anchored as labelled "stops" along the river path. Slow-drifting blue particles animate the current.

## Running it

Static page, no build step.

```sh
open index.html
```

Or serve the directory with anything (`python3 -m http.server`, `npx serve`, …) and load it in a browser.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure — title, markers, sign-up form |
| `styles.css` | All styling |
| `scene.js` | Canvas rendering, particles, marker editor |
| `CLAUDE.md` | Architecture notes for AI assistants working on the code |

## Editing the river path

All control-point positions live in `RIVER_POINTS` at the top of `scene.js`:

```js
const RIVER_POINTS = [
  [0.323, 0.000], //   entry
  [0.301, 0.192], //   topguide
  [0.522, 0.307], // ★ Haus am Fluss
  // …
];
```

Edit a value, reload — the river curve and the corresponding dot move together. There's no separate `top:%; left:%` to keep in sync; markers position themselves from this array on startup.

## Edit mode

For interactive repositioning, set `data-mode="edit"` on the `<body>` tag in `index.html`:

```html
<body data-mode="edit">
```

Every dot becomes visible and draggable. Each dot shows a live position chip with its current `LEFT%, TOP%`; dropping a dot logs a full snapshot to the console, ready to paste back into `RIVER_POINTS` (divide each value by 100).

Remove the attribute (or set anything else) to return to the clean view.

## Two kinds of control points

- **Markers** — labelled stops with text content (Haus am Fluss, the date, agenda items). Solid blue circles.
- **Guides** — shape the curve, no content. Smaller dashed circles, only visible in edit mode.

The Catmull-Rom curve passes *through* every control point.
