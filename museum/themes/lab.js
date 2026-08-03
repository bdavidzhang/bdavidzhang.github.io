// lab.js — Research Hall. Cool, clean, a little clinical: two long display
// benches down the room, a compute rack against the end wall, a whiteboard
// beside the doorway, and suspended linear fixtures overhead.
//
// Draw calls added: 11 — 5 merged meshes, 5 instanced meshes, 1 outline.
// Everything repeated (rack units, status lights, screens, marks, samples)
// goes through ctx.instanced(), so a wall of blinking LEDs is one draw call.

const RACKS = 2;
const RACK_UNITS = 8;                                   // 1U faces per rack
const LEDS_PER_UNIT = 2;
const LED_COUNT = RACKS * RACK_UNITS * LEDS_PER_UNIT;   // 32
const SAMPLES = 44;                                     // Monte Carlo scatter

// bounds is inset from the true wall faces; the cross wall's interior face
// sits this far outside bounds.minZ / bounds.maxZ.
const WALL_INSET_Z = 0.18;

export function lab(ctx) {
  const T = ctx.THREE;
  const b = ctx.bounds;
  const th = ctx.theme;
  const rng = ctx.rng;
  const cz = b.centerZ;
  const wallZ = b.minZ - WALL_INSET_Z;   // interior face of the far wall

  // --- palette ------------------------------------------------------------
  // Everything derives from the theme so night mode follows for free. Mixing
  // towards theme.frame darkens by day and lightens by night, which is exactly
  // the contrast we want in either mode.
  const _c1 = new T.Color();
  const _c2 = new T.Color();
  const mix = (a, c, t) => _c1.set(a).lerp(_c2.set(c), t).getHex();

  const paleC   = mix(th.wall, th.rail, 0.60);    // bench bodies
  const railC   = mix(th.rail, th.frame, 0.30);   // bench tops, frames, hangers
  const techC   = mix(th.rail, th.frame, 0.55);   // rack shells, monitor cases
  const unitC   = mix(th.rail, th.frame, 0.85);   // 1U faces
  const boardC  = mix(th.glow, th.wall, 0.20);    // whiteboard surface
  const markC   = mix(th.ink, th.accent, 0.30);   // marker
  const screenC = mix(th.glow, th.accent, 0.50);
  const sampleC = mix(th.accent, th.glow, 0.35);

  // --- geometry helpers (baked into world space, ready to merge) -----------
  const box = (w, h, d, x, y, z) => new T.BoxGeometry(w, h, d).translate(x, y, z);
  const cyl = (r, h, x, y, z, seg = 10) =>
    new T.CylinderGeometry(r, r, h, seg).translate(x, y, z);

  const pale = [];
  const rail = [];
  const tech = [];
  const glow = [];

  // --- benches ------------------------------------------------------------
  // Two long low plinths flanking a 3.7m centre corridor, leaving a 3m viewing
  // walkway outside each of them for the wall plates.
  const BENCH_W = 1.6;
  const BENCH_H = 0.72;
  const BENCH_L = 8.0;
  const benchX = [-2.65, 2.65];
  const zA = cz - BENCH_L / 2;
  const zB = cz + BENCH_L / 2;

  for (const bx of benchX) {
    pale.push(box(BENCH_W, BENCH_H - 0.06, BENCH_L, bx, (BENCH_H - 0.06) / 2, cz));
    rail.push(box(BENCH_W + 0.10, 0.06, BENCH_L + 0.10, bx, BENCH_H - 0.03, cz));
    ctx.collide(bx - BENCH_W / 2 - 0.07, bx + BENCH_W / 2 + 0.07, zA - 0.07, zB + 0.07);
  }

  // --- monitors on stands -------------------------------------------------
  // Two per bench, turned to face the corridor. A flat screen reads from both
  // sides, so the case is simply built edge-on rather than rotated.
  const screenXf = [];
  for (let i = 0; i < benchX.length; i++) {
    const inward = benchX[i] < 0 ? 1 : -1;
    const mx = benchX[i] + inward * 0.15;
    for (const mz of [cz - 2.6, cz + 2.6]) {
      tech.push(cyl(0.15, 0.03, mx, BENCH_H + 0.015, mz));       // foot
      tech.push(cyl(0.045, 0.20, mx, BENCH_H + 0.10, mz));       // stalk
      tech.push(box(0.05, 0.42, 0.66, mx, 1.13, mz));            // case
      screenXf.push({ x: mx + inward * 0.033, y: 1.13, z: mz });
    }
  }

  // --- bench features -----------------------------------------------------
  // Right bench: a small stepped mound, a reward landscape in profile.
  const steps = [0.08, 0.17, 0.27, 0.38, 0.29, 0.17];
  for (let i = 0; i < steps.length; i++) {
    tech.push(box(0.30, steps[i], 0.28, benchX[1], BENCH_H + steps[i] / 2, cz - 0.85 + i * 0.34));
  }

  // Left bench: a Monte Carlo scatter, sampled once and frozen.
  const sampleXf = [];
  for (let i = 0; i < SAMPLES; i++) {
    const r = 0.52 * Math.sqrt(rng());          // uniform over the disc
    const a = rng() * Math.PI * 2;
    sampleXf.push({
      x: benchX[0] + r * Math.cos(a),
      y: BENCH_H + 0.045 + (1 - r / 0.52) * 0.30 * rng(),
      z: cz + r * Math.sin(a),
    });
  }

  // --- compute rack -------------------------------------------------------
  // Against the end wall, left of the doorway, clear of both the door and the
  // side-wall plate band.
  const RACK_W = 1.45;
  const RACK_D = 0.72;
  const RACK_H = 2.05;
  const rackX = [-5.00, -3.47];
  const rackZ = wallZ + 0.05 + RACK_D / 2;
  const faceZ = wallZ + 0.05 + RACK_D + 0.015;

  const unitXf = [];
  const ledXf = [];
  for (const rx of rackX) {
    tech.push(box(RACK_W, RACK_H, RACK_D, rx, RACK_H / 2, rackZ));
    rail.push(box(RACK_W + 0.08, 0.06, RACK_D + 0.08, rx, RACK_H + 0.03, rackZ));
    for (let u = 0; u < RACK_UNITS; u++) {
      const uy = 0.36 + u * 0.19;
      unitXf.push({ x: rx, y: uy, z: faceZ });
      for (let k = 0; k < LEDS_PER_UNIT; k++) {
        ledXf.push({ x: rx - 0.52 + k * 0.06, y: uy, z: faceZ + 0.027 });
      }
    }
  }
  ctx.collide(rackX[0] - RACK_W / 2 - 0.06, rackX[1] + RACK_W / 2 + 0.06,
    wallZ, wallZ + 0.05 + RACK_D + 0.06);

  // --- whiteboard ---------------------------------------------------------
  const WB_W = 3.40;
  const WB_H = 1.55;
  const wbX = 4.05;
  const wbY = 1.72;
  const wbFace = wallZ + 0.06;          // front surface of the panel
  const markZ = wbFace + 0.014;

  const boardMesh = ctx.merged([box(WB_W, WB_H, 0.16, wbX, wbY, wbFace - 0.08)], ctx.mat(boardC));

  rail.push(box(WB_W + 0.14, 0.07, 0.20, wbX, wbY + WB_H / 2 + 0.035, wbFace - 0.07));
  rail.push(box(WB_W + 0.14, 0.07, 0.20, wbX, wbY - WB_H / 2 - 0.035, wbFace - 0.07));
  rail.push(box(0.07, WB_H + 0.14, 0.20, wbX - WB_W / 2 - 0.035, wbY, wbFace - 0.07));
  rail.push(box(0.07, WB_H + 0.14, 0.20, wbX + WB_W / 2 + 0.035, wbY, wbFace - 0.07));
  rail.push(box(WB_W * 0.9, 0.045, 0.16, wbX, wbY - WB_H / 2 - 0.12, wbFace + 0.04));

  // marker strokes: one plotted curve with axes, then a few lines of notes
  const markXf = [];
  function stroke(x1, y1, x2, y2, w) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    markXf.push({
      x: (x1 + x2) / 2, y: (y1 + y2) / 2, z: markZ,
      rz: Math.atan2(dy, dx), sx: len, sy: w,
    });
  }

  const ox = wbX - 1.42;
  const oy = wbY - 0.54;
  stroke(ox, oy, ox, oy + 1.02, 0.016);         // y axis
  stroke(ox, oy, ox + 1.32, oy, 0.016);         // x axis
  let px = ox;
  let py = oy;
  for (let i = 1; i <= 9; i++) {
    const t = i / 9;
    const nx = ox + t * 1.28;
    const ny = oy + (1 - Math.exp(-3 * t)) * 0.86 + (rng() - 0.5) * 0.05;
    stroke(px, py, nx, ny, 0.020);
    px = nx;
    py = ny;
  }
  for (let row = 0; row < 3; row++) {
    let x = wbX + 0.16;
    const y = wbY + 0.42 - row * 0.40;
    while (x < wbX + 1.48) {
      const len = 0.16 + rng() * 0.30;
      stroke(x, y, Math.min(x + len, wbX + 1.50), y, 0.018);
      x += len + 0.09;
    }
  }

  // --- suspended linear fixtures ------------------------------------------
  // Offset in X so they never fight the architecture's own ceiling strip.
  const BAR_Y = 3.50;
  const barTop = BAR_Y + 0.035;
  const dropTop = b.height - 0.02;      // stop just short of the ceiling plane
  const dropH = dropTop - barTop;
  const dropY = (barTop + dropTop) / 2;
  for (const fx of [-3.2, 3.2]) {
    for (const fz of [cz - 2.6, cz + 2.6]) {
      glow.push(box(0.30, 0.07, 4.2, fx, BAR_Y, fz));
      rail.push(cyl(0.018, dropH, fx, dropY, fz - 1.8, 6));
      rail.push(cyl(0.018, dropH, fx, dropY, fz + 1.8, 6));
    }
  }

  // --- assemble -----------------------------------------------------------
  const techMesh = ctx.merged(tech, ctx.mat(techC));

  const meshes = [
    ctx.merged(pale, ctx.mat(paleC)),
    ctx.merged(rail, ctx.mat(railC)),
    techMesh,
    boardMesh,
    ctx.merged(glow, ctx.glowMat(th.glow)),
    ctx.instanced(new T.BoxGeometry(1.25, 0.155, 0.03), ctx.mat(unitC), unitXf),
    ctx.instanced(new T.BoxGeometry(0.014, 0.36, 0.60), ctx.glowMat(screenC), screenXf),
    ctx.instanced(new T.BoxGeometry(1, 1, 0.012), ctx.mat(markC), markXf),
    ctx.instanced(new T.SphereGeometry(0.028, 6, 4), ctx.mat(sampleC), sampleXf),
  ];
  if (techMesh) meshes.push(ctx.outline(techMesh));

  // --- status lights ------------------------------------------------------
  // One InstancedMesh; brightness is written straight into the instance colour
  // buffer each frame, so the update loop allocates nothing.
  const leds = ctx.instanced(new T.BoxGeometry(0.032, 0.032, 0.024),
    ctx.glowMat(th.glow), ledXf);
  meshes.push(leds);

  _c1.set(th.accent);
  const peak = Math.max(_c1.r, _c1.g, _c1.b) || 1;
  const tintR = _c1.r / peak;
  const tintG = _c1.g / peak;
  const tintB = _c1.b / peak;

  const ledBase = new Float32Array(LED_COUNT * 3);
  const ledPhase = new Float32Array(LED_COUNT);
  const ledRate = new Float32Array(LED_COUNT);
  const ledMode = new Uint8Array(LED_COUNT);

  _c2.set(0xffffff);
  leds.setColorAt(0, _c2);              // allocates the instanceColor buffer
  const ledArr = leds.instanceColor.array;

  for (let i = 0; i < LED_COUNT; i++) {
    const accent = rng() < 0.55;
    const j = i * 3;
    ledBase[j] = accent ? tintR : 1;
    ledBase[j + 1] = accent ? tintG : 1;
    ledBase[j + 2] = accent ? tintB : 1;
    ledPhase[i] = rng() * Math.PI * 2;
    ledRate[i] = 0.5 + rng() * 1.9;
    const r = rng();
    ledMode[i] = r < 0.35 ? 0 : r < 0.78 ? 1 : 2;   // steady / breathe / blink
  }

  function update(dt, elapsed) {
    for (let i = 0; i < LED_COUNT; i++) {
      const mode = ledMode[i];
      let k;
      if (mode === 0) k = 0.92;
      else if (mode === 1) {
        k = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(elapsed * ledRate[i] + ledPhase[i]));
      } else {
        k = ((elapsed * ledRate[i] + ledPhase[i]) % 1) < 0.42 ? 1 : 0.16;
      }
      const j = i * 3;
      ledArr[j] = ledBase[j] * k;
      ledArr[j + 1] = ledBase[j + 1] * k;
      ledArr[j + 2] = ledBase[j + 2] * k;
    }
    leds.instanceColor.needsUpdate = true;
  }

  return { meshes: meshes.filter(Boolean), update };
}
