// themes/library.js — the Reading Room. Oak, parchment, and the way out.
//
// The last room, so its end wall is solid: a tall window sits dead centre in
// the gap between the two back plates, and the light it drops on the floor is
// the last thing you walk toward. Bookcases fill every bay the exhibit plates
// leave free — three per side wall plus a pair in the back corners — and a
// reading table, a ladder and a globe give you a reason to stop.
//
// The bays are derived from architecture.js's anchor layout: with six contact
// exhibits the side plates land at z -79.325 / -85.675 and the back plates at
// x ±2.675, all 2.15m wide. Everything below keys off those numbers, so the
// shelving never fouls a plate.
//
// Draw calls: 14 — 4 book batches, 2 other instanced batches, 5 merged shells,
// the globe, the rug and one outline.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS } from '../config.js';

const HALF_W = DIMS.roomW / 2;      // interior face of each side wall

const CASE_D = 0.42;                // bookcase depth
const CASE_H = 3.30;
const BOARD_T = 0.035;
const BOOK_D = 0.24;
const LEVELS = [0.36, 0.94, 1.52, 2.10, 2.68];

// where the exhibit plates land, and how much air to leave beside them
const PLATE_Z = [-79.325, -85.675];
const PLATE_X = 2.675;
const PLATE_HALF = 1.075 + 0.30;

// --- geometry helpers: each bakes its transform, so results can merge -------

function bx(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function cyl(rTop, rBot, h, seg, x, y, z, open) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!open).translate(x, y, z);
}

/** Merge a bucket into one geometry, releasing the sources. */
function fuse(geos) {
  const list = geos.filter(Boolean);
  if (list.length < 2) return list[0] || null;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return merged;
}

export function library(ctx) {
  const { bounds, theme, rng } = ctx;
  const meshes = [];

  // --- palette, derived so night mode follows automatically -----------------
  const probe = {};
  new THREE.Color(theme.wall).getHSL(probe, THREE.SRGBColorSpace);
  const night = probe.l < 0.5;

  /**
   * Recolour a theme tone: keep its family, retarget its lightness. Worked in
   * sRGB space so the multipliers mean what they look like, and given a value
   * per mode because night wants props lighter than the wall, not darker —
   * Lambert multiplies albedo by light, so a dark prop in a dim room is just
   * black.
   */
  const tone = (hex, hue, sat, dayL, nightL) => {
    const c = new THREE.Color(hex);
    const o = {};
    c.getHSL(o, THREE.SRGBColorSpace);
    const l = Math.max(0.05, Math.min(0.95, o.l * (night ? nightL : dayL)));
    return c.setHSL(hue / 360, sat, l, THREE.SRGBColorSpace).getHex();
  };

  const oak       = ctx.mat(tone(theme.rail, 34, 0.28, 0.91, 1.31));
  const oakDark   = ctx.mat(tone(theme.rail, 30, 0.34, 0.68, 1.06));
  const ironwork  = ctx.mat(tone(theme.frame, 34, 0.09, 1.70, 0.55));
  const parchment = ctx.mat(tone(theme.glow, 40, 0.15, 0.91, 0.87),
    { side: THREE.DoubleSide });
  const rugMat    = ctx.mat(tone(theme.rail, theme.accentHue, 0.24, 0.83, 1.17));
  const glowMat   = ctx.glowMat(theme.glow);
  // Its own material: update() drifts the opacity like cloud passing the window.
  const poolMat   = ctx.glowMat(tone(theme.glow, 46, 0.40, 1.00, 1.00),
    { transparent: true, opacity: 0.2, depthWrite: false });

  // four spines, one instanced batch each — a hundred books is four draw calls
  const bookMats = [[9, 0.34, 0.64, 1.14], [211, 0.20, 0.76, 1.31],
    [40, 0.38, 0.88, 1.49], [152, 0.21, 0.52, 0.97]]
    .map(([hue, sat, d, n]) => ctx.mat(tone(theme.rail, hue, sat, d, n)));

  // =========================================================================
  // 1. bookcases — carcasses merge, boards and books instance
  // =========================================================================
  const backFace = bounds.minZ - DIMS.wallT;      // solid end wall, no doorway
  const unit = new THREE.BoxGeometry(1, 1, 1);    // shared by boards and books
  const caseGeos = [];
  const boards = [];
  const books = bookMats.map(() => []);

  /** Fill one shelf run with books, splitting them across the colour batches. */
  function stock(axis, fixed, shelfY, from, to) {
    const limit = from + (to - from) * (0.62 + rng() * 0.36);
    let u = from;
    while (u < limit) {
      if (rng() < 0.07) { u += 0.05 + rng() * 0.16; continue; }     // a reader's gap
      const t = 0.032 + rng() * 0.05;
      if (u + t > limit) break;
      const h = 0.20 + rng() * 0.17;
      const lean = rng() < 0.06 ? (rng() < 0.5 ? -0.13 : 0.13) : 0;
      const cu = u + t / 2;
      const by = shelfY + BOARD_T / 2 + h / 2 + (lean ? 0.014 : 0);
      books[(rng() * books.length) | 0].push(axis === 'z'
        ? { x: fixed, y: by, z: cu, sx: BOOK_D, sy: h, sz: t, rx: lean }
        : { x: cu, y: by, z: fixed, sx: t, sy: h, sz: BOOK_D, rz: lean });
      u += t + 0.004;
    }
  }

  /**
   * One bookcase. `axis` is the wall it stands on ('z' = a side wall, run along
   * z; 'x' = the end wall, run along x) and `sign` points out into the room.
   */
  function bookcase(axis, cx, cz, len, sign) {
    // du runs along the case, dv out from the wall
    const put = (du, dv, y, runW, h, depthW) => {
      if (axis === 'z') caseGeos.push(bx(depthW, h, runW, cx + sign * dv, y, cz + du));
      else caseGeos.push(bx(runW, h, depthW, cx + du, y, cz + sign * dv));
    };
    put(0, -CASE_D / 2 + 0.011, CASE_H / 2, len, CASE_H, 0.022);          // back
    put(0, 0, CASE_H - 0.0225, len, 0.045, CASE_D);                        // cornice
    put(0, 0, 0.08, len, 0.16, CASE_D);                                    // plinth
    for (const s of [-1, 1]) put(s * (len / 2 - 0.016), 0, CASE_H / 2, 0.032, CASE_H, CASE_D);

    const runC = axis === 'z' ? cz : cx;
    const bookFixed = (axis === 'z' ? cx : cz) + sign * (CASE_D / 2 - 0.02 - BOOK_D / 2);

    for (const y of LEVELS) {
      boards.push(axis === 'z'
        ? { x: cx, y, z: cz, sx: CASE_D - 0.02, sy: BOARD_T, sz: len - 0.034 }
        : { x: cx, y, z: cz, sx: len - 0.034, sy: BOARD_T, sz: CASE_D - 0.02 });
      stock(axis, bookFixed, y, runC - len / 2 + 0.05, runC + len / 2 - 0.05);
    }

    if (axis === 'z') ctx.collide(cx - CASE_D / 2, cx + CASE_D / 2, cz - len / 2, cz + len / 2);
    else ctx.collide(cx - len / 2, cx + len / 2, cz - CASE_D / 2, cz + CASE_D / 2);
  }

  // three bays per side wall, in the gaps the plates leave
  const bays = [
    [bounds.maxZ - 0.40, PLATE_Z[0] + PLATE_HALF],
    [PLATE_Z[0] - PLATE_HALF, PLATE_Z[1] + PLATE_HALF],
    [PLATE_Z[1] - PLATE_HALF, bounds.minZ + 0.10],
  ];
  for (const [near, far] of bays) {
    const mid = (near + far) / 2;
    const len = near - far;
    bookcase('z', -HALF_W + CASE_D / 2, mid, len, 1);
    bookcase('z', HALF_W - CASE_D / 2, mid, len, -1);
  }
  // and a pair in the back corners, clear of the two back plates
  const backLen = (HALF_W - 0.35) - (PLATE_X + PLATE_HALF);
  const backMid = (PLATE_X + PLATE_HALF + HALF_W - 0.35) / 2;
  for (const s of [-1, 1]) bookcase('x', s * backMid, backFace + CASE_D / 2, backLen, 1);

  // a few volumes left on the reading table, added to an existing batch
  const tableX = -3.30;
  const tableZ = bounds.centerZ + 0.30;
  for (let i = 0; i < 3; i++) {
    books[2].push({
      x: tableX + 0.06 * i, y: 0.775 + i * 0.042, z: tableZ - 0.62,
      sx: 0.17, sy: 0.04, sz: 0.25, ry: 0.1 * i,
    });
  }

  meshes.push(ctx.merged(caseGeos, oak));
  meshes.push(ctx.instanced(unit, oak, boards));
  books.forEach((batch, i) => {
    if (batch.length) meshes.push(ctx.instanced(unit, bookMats[i], batch));
  });

  // =========================================================================
  // 2. the window — dead centre on the end wall, between the two back plates
  // =========================================================================
  const ironGeos = [
    bx(2.72, 0.11, 0.10, 0, 3.605, backFace + 0.07),
    bx(2.72, 0.11, 0.10, 0, 0.995, backFace + 0.07),
    bx(0.11, 2.72, 0.10, -1.355, 2.30, backFace + 0.07),
    bx(0.11, 2.72, 0.10, 1.355, 2.30, backFace + 0.07),
    bx(0.055, 2.50, 0.07, 0, 2.30, backFace + 0.055),
    bx(2.60, 0.05, 0.07, 0, 1.72, backFace + 0.055),
    bx(2.60, 0.05, 0.07, 0, 2.88, backFace + 0.055),
  ];
  const glowGeos = [bx(2.44, 2.34, 0.03, 0, 2.30, backFace + 0.025)];

  // the light it drops on the floor — the last thing you walk toward
  meshes.push(ctx.plane(2.6, 3.6, poolMat,
    { x: 0, y: 0.02, z: backFace + 2.05, rx: -Math.PI / 2 }));

  // sill: kept to the frame's width so it stays clear of the back plates
  const furnitureGeos = [bx(2.72, 0.09, 0.20, 0, 0.955, backFace + 0.13)];

  // =========================================================================
  // 3. reading table, chairs, ladder, globe, pendant
  // =========================================================================
  furnitureGeos.push(bx(1.05, 0.05, 2.20, tableX, 0.725, tableZ));
  furnitureGeos.push(bx(0.92, 0.07, 2.06, tableX, 0.660, tableZ));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      furnitureGeos.push(bx(0.07, 0.66, 0.07, tableX + sx * 0.44, 0.33, tableZ + sz * 0.99));
    }
  }
  ctx.collide(tableX - 0.62, tableX + 0.62, tableZ - 1.22, tableZ + 1.22);
  meshes.push(ctx.plane(3.0, 3.6, rugMat, { x: tableX, y: 0.012, z: tableZ, rx: -Math.PI / 2 }));

  // two chairs, instanced; the geometry looks down local +Z
  const chairGeos = [bx(0.44, 0.05, 0.42, 0, 0.465, 0), bx(0.43, 0.06, 0.05, 0, 1.03, -0.19)];
  for (const s of [-1, 1]) {
    chairGeos.push(bx(0.045, 0.44, 0.045, s * 0.19, 0.22, -0.18));
    chairGeos.push(bx(0.045, 0.44, 0.045, s * 0.19, 0.22, 0.18));
    chairGeos.push(bx(0.045, 0.52, 0.045, s * 0.19, 0.75, -0.19));
  }
  chairGeos.push(bx(0.40, 0.07, 0.03, 0, 0.78, -0.19));
  chairGeos.push(bx(0.40, 0.07, 0.03, 0, 0.92, -0.19));

  const chairs = [
    { x: tableX - 0.95, y: 0, z: tableZ + 0.50, ry: Math.PI / 2 },
    { x: tableX + 1.02, y: 0, z: tableZ - 0.50, ry: -Math.PI / 2 },
  ];
  meshes.push(ctx.instanced(fuse(chairGeos), oakDark, chairs));
  for (const c of chairs) ctx.collide(c.x - 0.35, c.x + 0.35, c.z - 0.35, c.z + 0.35);

  // library ladder, leaning on the middle bay of the right-hand wall
  const ladderGeos = [];
  for (const s of [-1, 1]) ladderGeos.push(bx(0.05, 3.10, 0.05, 0, 1.55, s * 0.22));
  for (let i = 0; i < 7; i++) ladderGeos.push(bx(0.05, 0.04, 0.44, 0, 0.35 + i * 0.40, 0));
  const ladder = fuse(ladderGeos);
  ladder.rotateZ(-0.24);
  const ladderX = HALF_W - CASE_D - 0.78;
  const ladderZ = bounds.centerZ + 1.30;
  furnitureGeos.push(ladder.translate(ladderX, 0.008, ladderZ));   // lean lifts a heel
  ctx.collide(ladderX - 0.20, ladderX + 0.82, ladderZ - 0.35, ladderZ + 0.35);

  // globe on a turned stand — the room's one round thing
  const globeX = 3.50;
  const globeZ = bounds.centerZ - 0.50;
  furnitureGeos.push(cyl(0.26, 0.28, 0.05, 16, globeX, 0.025, globeZ));
  furnitureGeos.push(cyl(0.05, 0.055, 0.62, 10, globeX, 0.335, globeZ));
  const yoke = new THREE.TorusGeometry(0.30, 0.018, 5, 20);
  yoke.rotateY(Math.PI / 2);
  yoke.rotateZ(0.36);
  furnitureGeos.push(yoke.translate(globeX, 0.92, globeZ));
  ctx.collide(globeX - 0.32, globeX + 0.32, globeZ - 0.32, globeZ + 0.32);
  meshes.push(ctx.sphere(0.27, parchment, { x: globeX, y: 0.92, z: globeZ }, 14));

  // pendant over the reading table
  ironGeos.push(cyl(0.09, 0.09, 0.05, 10, tableX, bounds.height - 0.025, tableZ));
  ironGeos.push(cyl(0.008, 0.008, 1.55, 6, tableX, bounds.height - 0.825, tableZ));
  ironGeos.push(cyl(0.14, 0.42, 0.30, 18, tableX, 2.70, tableZ, true));
  glowGeos.push(new THREE.SphereGeometry(0.09, 10, 6).translate(tableX, 2.62, tableZ));
  const spill = new THREE.CircleGeometry(0.40, 18);
  spill.rotateX(Math.PI / 2);                  // faces down, toward the table
  glowGeos.push(spill.translate(tableX, 2.53, tableZ));

  // --- merge the shells ----------------------------------------------------
  const furniture = ctx.merged(furnitureGeos, oakDark);
  meshes.push(furniture);
  meshes.push(ctx.merged(ironGeos, ironwork));
  meshes.push(ctx.merged(glowGeos, glowMat));
  if (furniture) meshes.push(ctx.outline(furniture));

  // Cloud drifting past the window. Numbers only — nothing allocates per frame.
  return {
    meshes,
    update(dt, elapsed) {
      poolMat.opacity = 0.19 + 0.06 * Math.sin(elapsed * 0.21) + 0.03 * Math.sin(elapsed * 0.57);
    },
  };
}
