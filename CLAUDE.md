# Vibehuus

Landing page for **Vibehuus** — a one-day vibecoding event held at Haus am Fluss in Bern, Switzerland. The page is rendered as a stylised cartographic map: the Aare river flows top-to-bottom, and event details (venue, date, agenda) are anchored as labelled "stops" along the path. Blue particles drift down the river to give it gentle motion.

## Files

- **`index.html`** — page structure: title, markers, sign-up form. No inline styles, no inline positions on markers.
- **`styles.css`** — all styling.
- **`scene.js`** — Canvas rendering: Catmull-Rom interpolated river, flowing particles, and the marker editor.

Open `index.html` directly in a browser; no build step.

## Architecture

### `RIVER_POINTS_DESKTOP` / `RIVER_POINTS_MOBILE` are the source of truth

Control-point positions live in two arrays at the top of `scene.js` as `[x, y]` pairs normalized 0–1 inside the poster — one tuned for the wide desktop poster (1900×1200), one for the portrait mobile poster (720×1200):

```js
const RIVER_POINTS_DESKTOP = [
  [0.336, 0.000], //   entry
  [0.321, 0.187], //   topguide
  [0.536, 0.329], // ★ Haus am Fluss
  ...
];
const RIVER_POINTS_MOBILE = [
  [0.186, 0.000], //   entry
  [0.171, 0.187], //   topguide
  [0.386, 0.329], // ★ Haus am Fluss
  ...
];
```

`activeRiverPoints()` picks the set: mobile when canvas width `< 720`, desktop otherwise. The two arrays must stay the **same length and same order** — they share `ID_TO_RIVER_INDEX`.

On startup, `scene.js` walks every `.marker[data-id]` in the DOM, looks up the corresponding entry in the active set, and writes `style.left = x*100 + '%'` / `style.top = y*100 + '%'` on the marker. Then it flips its `visibility` to `visible`.

**Edit the active array and reload — the dot AND the river move together. Never put `top:%; left:%` inline on markers in `index.html`; they're stripped by the JS anyway.**

### Two kinds of control points

- **Markers** (`haus`, `date`, `art`, `enterprise`, `vibecode`, `vibehaton`, `apero`) — labelled stops with text content. Solid blue circles.
- **Guides** (`entry`, `topguide`, `guide2`, `guide3`, `between`, `between2`, `between3`, `exit`) — shape the curve, no content. Smaller dashed circles.

The Catmull-Rom curve passes *through* every control point, markers and guides alike. The `ID_TO_RIVER_INDEX` map in `scene.js` ties each `data-id` to its slot in the array; **inserting a new point shifts every later index**, so update the map too.

### View / Edit mode

The `<body>` accepts `data-mode="edit"`:

- *no attribute* (default) — clean view: dots, position chips, and guide tags hidden. Only labels, the river, the title, and the sign-up form show.
- `data-mode="edit"` — debug: every dot is visible and draggable. Each draggable dot shows a position chip with its current `LEFT%, TOP%`. Releasing a drag prints a snapshot of all positions to the console.

This is a CSS-only toggle, so reload after flipping the attribute.

### Marker editor (edit mode only)

Drag any dot to reposition. The corresponding entry in the **active** river array (`RIVER_POINTS_MOBILE` if on a narrow canvas, else `RIVER_POINTS_DESKTOP`) is updated in memory and the river is re-rendered live (debounced via `requestAnimationFrame`). On reload, the source code wins — drag-edits don't persist.

To bake in dragged values: each drop logs the full active array as a paste-ready `RIVER_POINTS_MOBILE = [...]` / `RIVER_POINTS_DESKTOP = [...]` block — copy it back into `scene.js`. **Tune mobile coords on a narrow viewport; desktop coords on wide.** Switching breakpoints mid-session swaps which set the editor mutates.

## Adding a new control point

1. Decide marker (labelled stop) vs guide (curve-shaper).
2. Insert the new entry in **both** `RIVER_POINTS_DESKTOP` and `RIVER_POINTS_MOBILE` at the correct **order along the river** (index 0 → last is upstream → downstream). Same index in both arrays — they share `ID_TO_RIVER_INDEX`.
3. Update `ID_TO_RIVER_INDEX` — add the new key and **shift every index after the insertion point by +1**.
4. Add the HTML element (no `style="top/left"`):
   ```html
   <div class="marker guide" data-id="myguide">
     <div class="dot"></div>
     <div class="guide-tag">guide</div>
   </div>
   ```
   or for a labelled marker:
   ```html
   <div class="marker" data-id="mystop">
     <div class="dot"></div>
     <div class="label right">My stop</div>
   </div>
   ```
5. Reload. Position is taken from the active river array; the new dot is draggable in edit mode.

## Visual conventions

- Foreground (title, labels, dots, button) — solid brand blue `--blue: #2e72b8`.
- River body — lighter blue `#75ACD2`, deliberately desaturated so labels read as primary content.
- All foreground text has a white `text-shadow` halo so glyphs stay readable wherever the river passes underneath.

## Fonts

- **Bebas Neue** — title only.
- **Space Mono** — everything else (subtitle, labels, sign-up, position chips). Ties the page to a "tech poster" feel rather than a hand-drawn one.
