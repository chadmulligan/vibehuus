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
// Only entry, exit, and one off-screen guide at the top (to keep the
// river clear of the title block) are non-marker points.
const RIVER_POINTS = [
  [0.336, 0.0], //   entry
  [0.321, 0.187], //   topguide
  [0.375, 0.316], //   guide2
  [0.536, 0.329], // ★ Haus am Fluss
  [0.631, 0.353], //   guide3
  [0.644, 0.408], // ★ Date + Time
  [0.623, 0.466], //   between
  [0.525, 0.495], //   between2
  [0.412, 0.498], //   between3
  [0.396, 0.553], // ★ Talks
  [0.39, 0.594], // ★ Vibecode: from craft to art
  [0.387, 0.638], // ★ Entreprise grade
  [0.384, 0.682], // ★ Vibecode reviewing
  [0.38, 0.749], // ★ Vibehaton workshop
  [0.375, 0.823], // ★ Apero by the Aare
  [0.363, 1.0], //   exit
];

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

// Wave-topo strips fill the empty left and right thirds. Each strip has a
// "carrier" — a sum of two low-frequency sines seeded per strip — that all
// lines in the strip ride along, scaled slightly differently per line. The
// shared carrier gives the topographic look (neighbours track each other);
// the per-line scaling and wiggle break dead parallelism.
// Right strip mirrors the left: same seed → same carrier shape, `mirror`
// negates the horizontal offset so bends flip across the page axis. xStart
// > xEnd on the right so iteration runs outer→inner on both sides, matching
// the left's line ordering.
const WAVE_STRIPS = [
  { xStart: 0.04, xEnd: 0.22, count: 9, seed: 30, mirror: false },
  { xStart: 0.96, xEnd: 0.78, count: 9, seed: 30, mirror: true },
];

function seededRand(seed, k) {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function drawCartography(g) {
  g.save();

  g.strokeStyle = "rgba(117, 172, 210, 0.34)";
  g.lineWidth = 1;
  for (const strip of WAVE_STRIPS) {
    const sr = (k) => seededRand(strip.seed, k);
    // Carrier — the strip's overall topographic shape.
    const c = {
      a1: W * (0.022 + 0.014 * sr(1)), // big sweep ~40–65px on 1800 wide
      f1: 0.35 + 0.5 * sr(2), //          0.35–0.85 cycles over H
      p1: sr(3) * Math.PI * 2,
      a2: W * (0.007 + 0.006 * sr(4)),
      f2: 1.0 + 0.8 * sr(5),
      p2: sr(6) * Math.PI * 2,
    };

    const flip = strip.mirror ? -1 : 1;
    for (let i = 0; i < strip.count; i++) {
      const t = strip.count === 1 ? 0.5 : i / (strip.count - 1);
      const baseX = (strip.xStart + (strip.xEnd - strip.xStart) * t) * W;
      const lr = (k) => seededRand(strip.seed * 100 + i + 1, k);
      const ampScale1 = 0.72 + 0.56 * lr(1); // 0.72–1.28
      const ampScale2 = 0.55 + 0.9 * lr(2);
      const wiggleA = W * 0.004;
      const wiggleF = 1.6 + 1.4 * lr(3);
      const wiggleP = lr(4) * Math.PI * 2;

      g.beginPath();
      const steps = 140;
      for (let s = 0; s <= steps; s++) {
        const y = (s / steps) * H;
        const yt = y / H;
        const offset =
          c.a1 * ampScale1 * Math.sin(2 * Math.PI * c.f1 * yt + c.p1) +
          c.a2 * ampScale2 * Math.sin(2 * Math.PI * c.f2 * yt + c.p2) +
          wiggleA * Math.sin(2 * Math.PI * wiggleF * yt + wiggleP);
        const x = baseX + flip * offset;
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
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

function init() {
  if (!W || !H) return;
  const px = RIVER_POINTS.map(([x, y]) => [x * W, y * H]);
  riverSamples = catmullSamples(px, 70);
  buildBackground();
  // Density tied to river length so longer rivers get more sparkles.
  const target = Math.floor(Math.min(2000, totalLen * 1.4));
  particles = new Array(target).fill(0).map(() => new Particle());
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
  // Map data-id → index in RIVER_POINTS (must match the array above).
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

  let rebuildPending = false;
  function scheduleRebuild() {
    if (rebuildPending) return;
    rebuildPending = true;
    requestAnimationFrame(() => {
      rebuildPending = false;
      if (!W || !H) return;
      const px = RIVER_POINTS.map(([x, y]) => [x * W, y * H]);
      riverSamples = catmullSamples(px, 90);
      buildBackground();
    });
  }

  const markers = document.querySelectorAll(".marker[data-id]");

  function snapshot() {
    const out = {};
    markers.forEach((m) => {
      out[m.dataset.id] = `top: ${m.style.top}; left: ${m.style.left};`;
    });
    return out;
  }

  // Position every marker from RIVER_POINTS — the single source of truth.
  // Edit values in the array at the top of this file and reload; markers
  // follow automatically. No need to keep HTML top/left in sync by hand.
  markers.forEach((m) => {
    const idx = ID_TO_RIVER_INDEX[m.dataset.id];
    if (idx !== undefined && RIVER_POINTS[idx]) {
      const [x, y] = RIVER_POINTS[idx];
      m.style.left = `${(x * 100).toFixed(2)}%`;
      m.style.top = `${(y * 100).toFixed(2)}%`;
    }
    m.style.visibility = "visible";
  });

  markers.forEach((m) => {
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
        RIVER_POINTS[idx] = [x / 100, y / 100];
        scheduleRebuild();
      }
      refresh();
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      m.classList.remove("dragging");
      console.log(
        `[${m.dataset.id}] left: ${m.style.left}; top: ${m.style.top};`,
      );
      console.log("snapshot:", snapshot());
    };
    dot.addEventListener("pointerup", endDrag);
    dot.addEventListener("pointercancel", endDrag);
  });
})();
