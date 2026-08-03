// themes/studio.js — the Podcast Studio. Walnut, felt and warm lamps.
//
// The room is built around one intimate set: two chairs turned toward each
// other over a low table, a boom mic reaching in at each side, a rug under all
// of it. A mixing desk sits low against the left wall and a floor lamp does the
// warming. Felt is the room's texture — a staggered treatment grid across the
// end wall and a band high on the side walls.
//
// Wall discipline: exhibit plates hang at y 1.0–2.5 on the side walls, so
// nothing here sits in the y 0.9–2.6 band near them. The treatment band starts
// at 2.65m; the mixing desk tops out at 0.79m.
//
// Draw calls: 13 — 2 felt batches, 3 instanced prop batches, 4 merged shells,
// the sign, the rug and one outline.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS } from '../config.js';

const HALF_W = DIMS.roomW / 2;   // interior face of each side wall
const HALF_T = DIMS.wallT / 2;   // a shared cross wall is a half slab

// --- geometry helpers: every one bakes its transform so results can merge ---

function bx(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function cy(rTop, rBot, h, seg, x, y, z, open) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!open).translate(x, y, z);
}

function disc(r, x, y, z) {
  const g = new THREE.CircleGeometry(r, 16);
  g.rotateX(Math.PI / 2);          // faces down, to fake the lamp's spill
  return g.translate(x, y, z);
}

/** Merge a bucket into one geometry, releasing the sources. */
function fuse(geos) {
  const list = geos.filter(Boolean);
  if (list.length < 2) return list[0] || null;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return merged;
}

export function studio(ctx) {
  const { bounds, theme, rng } = ctx;
  const meshes = [];

  // --- palette, derived so night mode follows automatically -----------------
  const probe = {};
  new THREE.Color(theme.wall).getHSL(probe);
  const night = probe.l < 0.5;

  /** Recolour a theme tone: keep its lightness band, change its character. */
  const tint = (hex, hue, sat, lMul) => {
    const c = new THREE.Color(hex);
    const o = {};
    c.getHSL(o);
    return c.setHSL(hue / 360, sat, Math.max(0.05, Math.min(0.94, o.l * lMul))).getHex();
  };

  const walnut   = ctx.mat(tint(theme.rail, 24, 0.36, night ? 0.82 : 0.54));
  const feltA    = ctx.mat(tint(theme.wallAlt, 14, 0.15, night ? 1.08 : 0.80));
  const feltB    = ctx.mat(tint(theme.wallAlt, 12, 0.23, night ? 0.84 : 0.63));
  const hardware = ctx.mat(tint(theme.frame, 22, 0.07, night ? 0.72 : 1.55));
  const shadeMat = ctx.mat(tint(theme.matte, 34, 0.15, night ? 1.05 : 0.97),
    { side: THREE.DoubleSide });
  const rugMat   = ctx.mat(tint(theme.rail, theme.accentHue, 0.26, night ? 0.96 : 0.80));
  const glowMat  = ctx.glowMat(theme.glow);
  // Its own material: update() animates the opacity, so it must not be shared
  // with anything that expects a constant.
  const onAirMat = ctx.glowMat(tint(theme.glow, 8, 0.62, night ? 1.0 : 0.76),
    { transparent: true, opacity: 0.9 });

  // =========================================================================
  // 1. acoustic treatment — one geometry, two felt batches, staggered
  // =========================================================================
  const PANEL = 0.55;                    // nominal square, scaled per instance
  const STANDOFF = 0.055;                // panel centre out from the wall face
  const panelGeo = new THREE.BoxGeometry(PANEL, PANEL, 0.07);
  const panelsA = [];
  const panelsB = [];

  /** One jittered panel, dropped into whichever batch the rng picks. */
  function panel(x, y, z, ry) {
    (rng() < 0.5 ? panelsA : panelsB).push({
      x, y, z, ry,
      sx: 0.86 + rng() * 0.2,
      sy: 0.86 + rng() * 0.2,
      sz: 0.6 + rng() * 0.8,             // stays inside the standoff either way
    });
  }

  // side walls: two staggered rows, safely above the plate band
  const colPitch = 0.66;
  const zStart = bounds.maxZ - 0.5;
  const zCols = Math.floor((zStart - (bounds.minZ + 0.5)) / colPitch) + 1;
  for (let c = 0; c < zCols; c++) {
    const z = zStart - c * colPitch;
    const lift = c % 2 ? 0.09 : -0.09;
    for (const rowY of [3.03, 3.73]) {
      if (rng() > 0.16) panel(-HALF_W + STANDOFF, rowY + lift, z, Math.PI / 2);
      if (rng() > 0.16) panel(HALF_W - STANDOFF, rowY + lift, z, -Math.PI / 2);
    }
  }

  // end wall: a full grid, opened out around the doorway you leave by
  const endZ = bounds.minZ - HALF_T + STANDOFF;
  const DOOR_CLEAR = 2.6;                // ~1.15m of air either side of the gap
  for (let r = 0; r < 6; r++) {
    const y = 0.72 + r * 0.63;
    for (let c = 0; c < 16; c++) {
      const x = -6.05 + c * 0.807;
      if (y < 3.4 && Math.abs(x) < DOOR_CLEAR) continue;
      if (rng() < 0.2) continue;
      panel(x, y + (c % 2 ? 0.07 : -0.07), endZ, 0);
    }
  }

  meshes.push(ctx.instanced(panelGeo, feltA, panelsA));
  meshes.push(ctx.instanced(panelGeo, feltB, panelsB));

  // =========================================================================
  // 2. the set — laid out in a local frame, then swung toward the corridor so
  //    you see both speakers in three-quarter view as you walk past
  // =========================================================================
  const setX = 3.35;
  const setZ = bounds.centerZ;
  const setYaw = -0.30;
  const ca = Math.cos(setYaw);
  const sa = Math.sin(setYaw);
  const wx = (u, v) => setX + u * ca + v * sa;
  const wz = (u, v) => setZ - u * sa + v * ca;

  // rug: rz spins the plane within itself, rx then lays it flat
  meshes.push(ctx.plane(3.2, 2.4, rugMat,
    { x: setX, y: 0.012, z: setZ, rx: -Math.PI / 2, rz: setYaw }));

  // low table (merged with the mixing desk below — same walnut)
  const walnutGeos = [
    cy(0.56, 0.56, 0.07, 20, setX, 0.44, setZ),
    cy(0.085, 0.085, 0.40, 10, setX, 0.205, setZ),
    cy(0.34, 0.36, 0.05, 16, setX, 0.025, setZ),
  ];
  ctx.collide(setX - 0.6, setX + 0.6, setZ - 0.6, setZ + 0.6);

  // two chairs, instanced as a frame batch and a cushion batch
  const frameGeos = [bx(0.55, 0.055, 0.50, 0, 0.455, 0), bx(0.525, 0.11, 0.06, 0, 1.05, -0.225)];
  for (const s of [-1, 1]) {
    frameGeos.push(bx(0.055, 0.43, 0.055, s * 0.235, 0.215, -0.215));
    frameGeos.push(bx(0.055, 0.43, 0.055, s * 0.235, 0.215, 0.215));
    frameGeos.push(bx(0.055, 0.62, 0.055, s * 0.235, 0.79, -0.225));
    frameGeos.push(bx(0.055, 0.05, 0.46, s * 0.26, 0.66, -0.01));
    frameGeos.push(bx(0.055, 0.20, 0.055, s * 0.26, 0.56, 0.20));
  }
  const cushionGeos = [
    bx(0.50, 0.11, 0.46, 0, 0.535, 0.005),
    bx(0.47, 0.36, 0.10, 0, 0.82, -0.185),
  ];

  // chair geometry looks down local +Z; each seat turns back to face the table
  const seats = [
    { u: 0, v: 1.35, ry: Math.PI },
    { u: 0, v: -1.35, ry: 0 },
  ].map((s) => ({ x: wx(s.u, s.v), y: 0, z: wz(s.u, s.v), ry: s.ry + setYaw }));

  meshes.push(ctx.instanced(fuse(frameGeos), walnut, seats));
  meshes.push(ctx.instanced(fuse(cushionGeos), feltB, seats));
  for (const s of seats) ctx.collide(s.x - 0.4, s.x + 0.4, s.z - 0.4, s.z + 0.4);

  // boom mics, instanced; the boom runs down local +Z, so the same geometry
  // serves both sides once the second one is turned around
  const micGeos = [
    cy(0.17, 0.19, 0.035, 12, 0, 0.018, 0),
    cy(0.022, 0.026, 1.18, 8, 0, 0.60, 0),
    cy(0.035, 0.035, 0.05, 8, 0, 1.16, 0),
    bx(0.028, 0.028, 0.72, 0, 1.18, 0.36),
    bx(0.022, 0.10, 0.022, 0, 1.13, 0.68),
    cy(0.05, 0.045, 0.17, 10, 0, 1.00, 0.68),
  ];
  const mics = [
    { u: 0.62, v: 1.15, ry: Math.PI },
    { u: -0.62, v: -1.15, ry: 0 },
  ].map((m) => ({ x: wx(m.u, m.v), y: 0, z: wz(m.u, m.v), ry: m.ry + setYaw }));

  meshes.push(ctx.instanced(fuse(micGeos), hardware, mics));
  for (const m of mics) ctx.collide(m.x - 0.19, m.x + 0.19, m.z - 0.19, m.z + 0.19);

  // =========================================================================
  // 3. mixing desk — kept under 0.8m so it clears the plate band entirely
  // =========================================================================
  const deskX = -5.55;
  const deskZ = bounds.centerZ;
  walnutGeos.push(bx(0.60, 0.72, 2.05, deskX, 0.36, deskZ));
  walnutGeos.push(bx(0.68, 0.05, 2.15, deskX, 0.745, deskZ));
  ctx.collide(deskX - 0.65, deskX + 0.45, deskZ - 1.15, deskZ + 1.15);

  const hardwareGeos = [bx(0.44, 0.025, 1.90, deskX + 0.05, 0.783, deskZ)];

  const knobGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6);
  const knobs = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      knobs.push({
        x: deskX - 0.09 + r * 0.145,
        y: 0.81,
        z: deskZ - 0.80 + c * 0.20,
        sy: 0.7 + rng() * 0.9,
      });
    }
  }
  meshes.push(ctx.instanced(knobGeo, hardware, knobs));

  // =========================================================================
  // 4. floor lamp, headphones, cable, ON AIR
  // =========================================================================
  const lampX = 5.30;
  const lampZ = bounds.centerZ + 2.75;
  hardwareGeos.push(cy(0.20, 0.23, 0.035, 14, lampX, 0.018, lampZ));
  hardwareGeos.push(cy(0.022, 0.026, 1.55, 8, lampX, 0.79, lampZ));
  ctx.collide(lampX - 0.25, lampX + 0.25, lampZ - 0.25, lampZ + 0.25);

  const shadeGeos = [
    cy(0.17, 0.27, 0.34, 16, lampX, 1.72, lampZ, true),
    // someone always leaves a mug on the table
    cy(0.043, 0.039, 0.10, 10, wx(0.24, -0.12), 0.525, wz(0.24, -0.12)),
  ];

  const glowGeos = [
    new THREE.SphereGeometry(0.105, 10, 6).translate(lampX, 1.66, lampZ),
    disc(0.25, lampX, 1.552, lampZ),
    bx(0.05, 0.012, 0.55, deskX + 0.20, 0.797, deskZ - 0.45),
    bx(0.05, 0.012, 0.55, deskX + 0.20, 0.797, deskZ + 0.45),
  ];

  // headphones resting on the table, knocked off the set axis
  const hpGeos = [new THREE.TorusGeometry(0.095, 0.016, 5, 14, Math.PI)];
  for (const s of [-1, 1]) {
    const cup = new THREE.CylinderGeometry(0.05, 0.05, 0.035, 10);
    cup.rotateX(Math.PI / 2);
    hpGeos.push(cup.translate(s * 0.095, 0, 0));
  }
  const headphones = fuse(hpGeos);
  headphones.rotateY(0.7 + setYaw);
  headphones.translate(wx(-0.22, 0.14), 0.523, wz(-0.22, 0.14));
  hardwareGeos.push(headphones);

  // a coiled cable dropped by the desk
  const coil = new THREE.TorusGeometry(0.15, 0.013, 5, 16);
  coil.rotateX(Math.PI / 2);
  hardwareGeos.push(coil.translate(deskX + 0.75, 0.014, deskZ - 1.6));

  // ON AIR, over the doorway out
  const signZ = bounds.minZ - HALF_T + 0.04;
  hardwareGeos.push(bx(0.92, 0.28, 0.07, 0, 3.55, signZ));
  meshes.push(ctx.box(0.80, 0.17, 0.02, onAirMat, { x: 0, y: 3.55, z: signZ + 0.05 }));

  // --- merge the shells ----------------------------------------------------
  const walnutMesh = ctx.merged(walnutGeos, walnut);
  meshes.push(walnutMesh);
  meshes.push(ctx.merged(hardwareGeos, hardware));
  meshes.push(ctx.merged(shadeGeos, shadeMat));
  meshes.push(ctx.merged(glowGeos, glowMat));
  if (walnutMesh) meshes.push(ctx.outline(walnutMesh));

  // The only moving part in the room: the sign breathes. Numbers only, so the
  // frame loop allocates nothing.
  return {
    meshes,
    update(dt, elapsed) {
      onAirMat.opacity = 0.72 + 0.22 * Math.sin(elapsed * 1.35);
    },
  };
}
