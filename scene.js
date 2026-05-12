const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

let W = 0,
  H = 0;
let dpr = 1;
let started = false;
let particles = [];
let riverSamples = [];
let totalLen = 0;
let bgCanvas = null;
let lastT = 0;

// River path. Each ★ is a MARKER POSITION — the (x, y) here matches the
// `top:%` / `left:%` of the corresponding HTML marker, so the dot sits
// exactly on the river. Catmull-Rom interpolation passes through every
// control point, so the curve is guaranteed to flow through the markers.
//
// Two sets: one tuned for the wide desktop poster (1900×1200), one for
// the portrait mobile poster (720×1200). The active set is picked by
// `activeRiverPoints()` based on canvas width. Edit-mode drags mutate
// whichever set is currently active.
const RIVER_POINTS_DESKTOP = [
  [0.34, 0.0], //   entry
  [0.34, 0.19], //   topguide
  [0.36, 0.323], //   guide2
  [0.485, 0.33], // ★ Haus am Fluss
  [0.62, 0.345], //   guide3
  [0.64, 0.41], // ★ Date + Time
  [0.625, 0.475], //   between
  [0.525, 0.485], //   between2
  [0.435, 0.49], //   between3
  [0.41, 0.55], // ★ Talks
  [0.41, 0.6], // ★ Vibecode: from craft to art
  [0.41, 0.65], // ★ Entreprise grade
  [0.41, 0.7], // ★ Vibecode reviewing
  [0.41, 0.78], // ★ Vibehaton workshop
  [0.41, 0.86], // ★ Apero by the Aare
  [0.41, 1.0], //   exit
];

// Seeded as desktop x minus 0.15 — a starting point. Tune by switching
// <body data-mode="edit">, dragging on a narrow viewport, and copying the
// console snapshot back here.
const RIVER_POINTS_MOBILE = [
  [0.07, 0.0], //   entry
  [0.09, 0.2], //   topguide
  [0.25, 0.26], //   guide2
  [0.44, 0.275], // ★ Haus am Fluss
  [0.76, 0.285], //   guide3
  [0.84, 0.335], // ★ Date + Time
  [0.76, 0.385], //   between
  [0.53, 0.39], //   between2
  [0.255, 0.4], //   between3
  [0.21, 0.49], // ★ Talks
  [0.21, 0.53], // ★ Vibecode: from craft to art
  [0.21, 0.57], // ★ Entreprise grade
  [0.21, 0.61], // ★ Vibecode reviewing
  [0.21, 0.71], // ★ Vibehaton workshop
  [0.21, 0.81], // ★ Apero by the Aare
  [0.21, 1.0], //   exit
];

function activeRiverPoints() {
  return W < 720 ? RIVER_POINTS_MOBILE : RIVER_POINTS_DESKTOP;
}

// ────────────────────────────────────────────────────────────────────────────
// Catmull-Rom — the curve passes through every control point so the rendered
// river and the particles' flow path coincide with the HTML markers exactly.

function catmullSamples(pts, perSeg = 70) {
  const out = [];
  if (pts.length < 2) return out;
  const all = [pts[0], ...pts, pts[pts.length - 1]];

  for (let i = 0; i < all.length - 3; i++) {
    const p0 = all[i],
      p1 = all[i + 1],
      p2 = all[i + 2],
      p3 = all[i + 3];
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const dx =
        0.5 *
        (-p0[0] +
          p2[0] +
          2 * (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t +
          3 * (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t2);
      const dy =
        0.5 *
        (-p0[1] +
          p2[1] +
          2 * (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t +
          3 * (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t2);
      const l = Math.hypot(dx, dy) || 1;
      out.push({ x, y, tx: dx / l, ty: dy / l, s: 0, u: 0 });
    }
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1] || { tx: 0, ty: 1 };
  out.push({ x: last[0], y: last[1], tx: prev.tx, ty: prev.ty, s: 0, u: 0 });

  // Cumulative arc length → uniform parameterization for particles.
  let cum = 0;
  for (let i = 0; i < out.length; i++) {
    if (i > 0)
      cum += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    out[i].s = cum;
  }
  totalLen = cum || 1;
  for (let i = 0; i < out.length; i++) out[i].u = out[i].s / totalLen;
  return out;
}

function strokeRiver(g, samples, width, color) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(samples[0].x, samples[0].y);
  for (let i = 1; i < samples.length; i++) g.lineTo(samples[i].x, samples[i].y);
  g.stroke();
}

// ────────────────────────────────────────────────────────────────────────────
// Cartographic embellishments — contour hills in the empty side strips, a
// compass rose top-left, and tick marks along the top/bottom borders. Pure
// decoration to fill the bare canvas around the river. Drawn into bgCanvas
// BEFORE the river so the river overlays anything it crosses.

// Straight vertical rules fill the empty left and right thirds — they read
// as depth/ruling marks rather than terrain. Each strip has an inner edge
// (next to the river) and an outer edge (poster edge); lines are biased so
// they pack near the inner edge and fan outward, giving a perspective-like
// opening effect away from the river. `pow(s, FAN_EXPONENT)` controls how
// aggressively the spacing widens — >1 packs near inner, =1 is even.
const FAN_EXPONENT = 1.15;
const SIDE_STRIPS = [
  { xInner: 0.22, xOuter: 0.04, count: 7 },
  { xInner: 0.78, xOuter: 0.96, count: 7 },
];

function drawCartography(g) {
  // On narrow / portrait posters (mobile) the side strips crowd the river
  // and add visual noise without breathing room — skip them entirely so the
  // page reads as just title + river + stops.
  if (W < 720) return;

  g.save();

  g.strokeStyle = "rgba(117, 172, 210, 0.34)";
  g.lineWidth = 1;
  for (const strip of SIDE_STRIPS) {
    for (let i = 0; i < strip.count; i++) {
      const s = strip.count === 1 ? 0 : i / (strip.count - 1);
      const t = Math.pow(s, FAN_EXPONENT);
      const x = (strip.xInner + (strip.xOuter - strip.xInner) * t) * W;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
  }

  g.restore();
}

// ────────────────────────────────────────────────────────────────────────────
// Background — white plate plus the river. Drawn once per resize.

function buildBackground() {
  bgCanvas = document.createElement("canvas");
  bgCanvas.width = W * dpr;
  bgCanvas.height = H * dpr;
  const g = bgCanvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  g.fillStyle = "#FFFFFF";
  g.fillRect(0, 0, W, H);

  drawCartography(g);

  const samplesPx = riverSamples.map((s) => ({ x: s.x, y: s.y }));

  // Soft halo just under the river — gives the brush stroke a tiny bit of weight.
  // The body colour is intentionally LIGHTER than the label/dot blue so the
  // foreground content (title, markers, button) reads as primary.
  strokeRiver(
    g,
    samplesPx,
    Math.max(28, W * 0.026),
    "rgba(90, 149, 200, 0.18)",
  );
  strokeRiver(g, samplesPx, Math.max(22, W * 0.02), "#75ACD2");
}

// ────────────────────────────────────────────────────────────────────────────
// Particles — small bright sparkles riding the river. Subtle, just enough to
// add motion against the static blue stroke.

class Particle {
  constructor() {
    this.reset(true);
  }

  reset(initial) {
    this.u = initial ? Math.random() : Math.random() * 0.04;
    this.speed = 0.00001 + Math.random() * 0.000028; // per ms — slow Aare current
    this.depth = Math.random();
    this.lateral = (Math.random() - 0.5) * 1.4;
    this.size = 0.5 + Math.random() * (1.1 + this.depth * 0.9);
    this.swayPhase = Math.random() * Math.PI * 2;
    this.swayFreq = 0.0009 + Math.random() * 0.0017;
    this.swayAmp = 0.4 + Math.random() * 2.6;
    this.breathePh = Math.random() * Math.PI * 2;
  }

  update(t, dt, samples) {
    this.u += this.speed * dt;
    if (this.u >= 1) this.reset(false);

    const fIdx = this.u * (samples.length - 1);
    const i0 = Math.floor(fIdx);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const f = fIdx - i0;
    const s0 = samples[i0],
      s1 = samples[i1];
    const x = s0.x + (s1.x - s0.x) * f;
    const y = s0.y + (s1.y - s0.y) * f;
    const tx = s0.tx + (s1.tx - s0.tx) * f;
    const ty = s0.ty + (s1.ty - s0.ty) * f;
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl,
      ny = tx / tl;

    const channelHalf = Math.max(7, W * 0.008);
    const sway = Math.sin(t * this.swayFreq + this.swayPhase) * this.swayAmp;
    const off = this.lateral * channelHalf + sway;

    this.x = x + nx * off;
    this.y = y + ny * off;

    const fadeIn = Math.min(1, this.u * 14);
    const fadeOut = Math.min(1, (1 - this.u) * 14);
    const breathe = 0.78 + 0.22 * Math.sin(t * 0.0013 + this.breathePh);
    this.alpha = fadeIn * fadeOut * breathe * (0.45 + this.depth * 0.55);
  }

  draw(g) {
    if (this.alpha < 0.01) return;
    g.globalAlpha = this.alpha;
    // Bright cool-white sparkle on the blue stroke.
    g.fillStyle = "#F2F8FF";
    g.beginPath();
    g.arc(this.x, this.y, Math.max(0.3, this.size), 0, 6.2832);
    g.fill();
  }
}

// ────────────────────────────────────────────────────────────────────────────

// Map data-id → index in the active river array. Both desktop/mobile arrays
// share this mapping, so it lives at module scope alongside the marker DOM
// references — both `init()` (runs on resize) and the editor IIFE need them.
const ID_TO_RIVER_INDEX = {
  entry: 0,
  topguide: 1,
  guide2: 2,
  haus: 3,
  guide3: 4,
  date: 5,
  between: 6,
  between2: 7,
  between3: 8,
  talks: 9,
  art: 10,
  enterprise: 11,
  vibecode: 12,
  vibehaton: 13,
  apero: 14,
  exit: 15,
};
const MARKERS = document.querySelectorAll(".marker[data-id]");

function placeMarkers() {
  const points = activeRiverPoints();
  MARKERS.forEach((m) => {
    const idx = ID_TO_RIVER_INDEX[m.dataset.id];
    if (idx !== undefined && points[idx]) {
      const [x, y] = points[idx];
      m.style.left = `${(x * 100).toFixed(2)}%`;
      m.style.top = `${(y * 100).toFixed(2)}%`;
    }
    m.style.visibility = "visible";
  });
}

function init() {
  if (!W || !H) return;
  const px = activeRiverPoints().map(([x, y]) => [x * W, y * H]);
  riverSamples = catmullSamples(px, 70);
  buildBackground();
  // Density tied to river length so longer rivers get more sparkles.
  const target = Math.floor(Math.min(2000, totalLen * 1.4));
  particles = new Array(target).fill(0).map(() => new Particle());
  // Re-place markers so they track viewport-driven array switches
  // (mobile↔desktop) and any percentage rounding from the new dimensions.
  placeMarkers();
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  const nW = Math.round(rect.width);
  const nH = Math.round(rect.height);
  if (nW === W && nH === H && canvas.width === nW * dpr) return;
  W = nW;
  H = nH;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  init();
}

function animate(t) {
  requestAnimationFrame(animate);
  const dt = lastT ? Math.min(50, t - lastT) : 16;
  lastT = t;
  if (!particles.length) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);
  else {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  for (let i = 0; i < particles.length; i++) {
    particles[i].update(t, dt, riverSamples);
    particles[i].draw(ctx);
  }
  ctx.globalAlpha = 1;
}

let resizeTimer;
const ro = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 150);
});
ro.observe(canvas);

resize();
if (!started) {
  started = true;
  requestAnimationFrame(animate);
}

// ────────────────────────────────────────────────────────────────────────────
// Marker editor — drag any dot to reposition it. The corresponding river
// control point updates live so the curve follows. The chip above each
// dot shows its current `left%, top%` so you can copy the values back into
// the HTML once you're happy.

(function setupMarkerEditor() {
  let rebuildPending = false;
  function scheduleRebuild() {
    if (rebuildPending) return;
    rebuildPending = true;
    requestAnimationFrame(() => {
      rebuildPending = false;
      if (!W || !H) return;
      const px = activeRiverPoints().map(([x, y]) => [x * W, y * H]);
      riverSamples = catmullSamples(px, 90);
      buildBackground();
    });
  }

  function snapshot() {
    const out = {};
    MARKERS.forEach((m) => {
      out[m.dataset.id] = `top: ${m.style.top}; left: ${m.style.left};`;
    });
    return out;
  }

  // Initial placement happens in init() (which runs on every resize); the
  // editor only needs to attach drag handlers below.

  MARKERS.forEach((m) => {
    const dot = m.querySelector(".dot");
    const chip = document.createElement("div");
    chip.className = "pos-chip";
    m.appendChild(chip);

    const refresh = () => {
      const top = parseFloat(m.style.top);
      const left = parseFloat(m.style.left);
      chip.textContent = `${left.toFixed(1)}, ${top.toFixed(1)}`;
    };
    refresh();

    let dragging = false;
    let offX = 0,
      offY = 0;

    dot.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      m.classList.add("dragging");
      const rect = m.parentElement.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const mx = (parseFloat(m.style.left) / 100) * rect.width;
      const my = (parseFloat(m.style.top) / 100) * rect.height;
      offX = cx - mx;
      offY = cy - my;
      try {
        dot.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    dot.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const rect = m.parentElement.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left - offX) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top - offY) / rect.height) * 100;
      const x = Math.max(0, Math.min(100, xPct));
      const y = Math.max(0, Math.min(100, yPct));
      m.style.left = `${x.toFixed(2)}%`;
      m.style.top = `${y.toFixed(2)}%`;

      const idx = ID_TO_RIVER_INDEX[m.dataset.id];
      if (idx !== undefined) {
        activeRiverPoints()[idx] = [x / 100, y / 100];
        scheduleRebuild();
      }
      refresh();
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      m.classList.remove("dragging");
      const setName =
        activeRiverPoints() === RIVER_POINTS_MOBILE
          ? "RIVER_POINTS_MOBILE"
          : "RIVER_POINTS_DESKTOP";
      const arrSrc = activeRiverPoints()
        .map(([x, y]) => `  [${x.toFixed(3)}, ${y.toFixed(3)}],`)
        .join("\n");
      console.log(
        `[${m.dataset.id}] left: ${m.style.left}; top: ${m.style.top};`,
      );
      console.log(`${setName} = [\n${arrSrc}\n];`);
    };
    dot.addEventListener("pointerup", endDrag);
    dot.addEventListener("pointercancel", endDrag);
  });
})();
