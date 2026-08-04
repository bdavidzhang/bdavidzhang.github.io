// integration-test.mjs — builds the REAL museum from the REAL site JSON,
// headlessly, and reports what the browser would actually have to draw.
// Run from the repo root:  node museum/integration-test.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import './smoke-test-dom.mjs';   // DOM stub, shared with smoke-test
import * as THREE from 'three';

// content.js fetches relative to a file:// base in Node — teach fetch to read disk.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const href = String(url);
  if (href.startsWith('file:')) {
    const buf = await readFile(fileURLToPath(href));
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()) };
  }
  return realFetch(url);
};

const { loadContent } = await import('./content.js');
const { buildWorld } = await import('./architecture.js');
const { buildExhibits } = await import('./exhibits.js');
const { buildDecor } = await import('./decor.js');
const { TUNING, DIMS } = await import('./config.js');

const rooms = await loadContent();

console.log('\n=== content ===');
let total = 0;
for (const r of rooms) {
  total += r.exhibits.length;
  console.log(`  ${r.id.padEnd(12)} ${String(r.exhibits.length).padStart(2)} exhibits  — ${r.title}`);
  for (const e of r.exhibits) {
    if (!e.title) console.log(`     !! exhibit ${e.id} has no title`);
    if (!e.id) console.log(`     !! exhibit has no id`);
  }
}
console.log(`  ${'TOTAL'.padEnd(12)} ${String(total).padStart(2)} exhibits`);

const empty = rooms.filter((r) => !r.exhibits.length);
if (empty.length) console.log(`  WARNING: empty rooms — ${empty.map((r) => r.id).join(', ')}`);

console.log('\n=== build ===');
const world = buildWorld(rooms);

// snapshot the shell so the clearance check below can tell decor from architecture
const shellNodes = new Set();
world.roomGroups.forEach((g) => g && g.traverse((o) => shellNodes.add(o)));

const decor = buildDecor(rooms, world);

// Anything now in a room group that wasn't part of the shell is decor. Captured
// BEFORE buildExhibits so the plates themselves are never mistaken for props.
const decorNodes = new Set();
world.roomGroups.forEach((g) => g && g.traverse((o) => { if (!shellNodes.has(o)) decorNodes.add(o); }));

const exhibits = buildExhibits(rooms, world);

for (const b of decor.built) console.log(`  decor ${b.room.padEnd(12)} ${b.theme.padEnd(9)} ${b.meshes} nodes`);
const unthemed = rooms.filter((r) => !decor.built.some((b) => b.room === r.id));
if (unthemed.length) console.log(`  NOTE: no decor for ${unthemed.map((r) => r.id).join(', ')}`);
console.log(`  decor colliders: ${decor.colliders.length}`);
console.log(`  colliders:       ${world.colliders.length}`);
console.log(`  raycast targets: ${exhibits.targets.length} (expected ${total})`);
if (exhibits.targets.length !== total) console.log('  !! target count mismatch');

// Count what a single frame would submit, honouring the engine's cull radius.
const scene = new THREE.Scene();
scene.add(world.group, decor.group, exhibits.group);

// three.js honours ancestor visibility at render time, so a child's own
// .visible flag is not enough — walk up to the root.
function effectivelyVisible(o) {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

function countDrawables(root) {
  let n = 0;
  const geos = new Set();
  const mats = new Set();
  const texs = new Set();
  root.traverse((o) => {
    if (!effectivelyVisible(o)) return;
    if (o.isMesh || o.isLineSegments || o.isPoints) {
      n++;
      geos.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        mats.add(m);
        for (const k of ['map', 'emissiveMap', 'alphaMap']) if (m[k]) texs.add(m[k]);
      }
    }
  });
  return { n, geos: geos.size, mats: mats.size, texs: texs.size };
}

const all = countDrawables(scene);
console.log(`  whole building:  ${all.n} drawables, ${all.geos} geometries, ${all.mats} materials, ${all.texs} textures`);

// simulate culling to current room +/- cullRadius
const r = TUNING.cullRadius;
let worst = 0;
for (let i = 0; i < rooms.length; i++) {
  world.roomGroups.forEach((g, j) => { if (g) g.visible = Math.abs(j - i) <= r; });
  const c = countDrawables(scene);
  worst = Math.max(worst, c.n);
  console.log(`  standing in ${rooms[i].id.padEnd(12)} -> ${String(c.n).padStart(3)} drawables submitted`);
}
console.log(`  WORST CASE:      ${worst} drawables per frame`);

// texture memory: every generated plate is a canvas texture
let bytes = 0;
const seen = new Set();
scene.traverse((o) => {
  for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
    if (!m || !m.map || seen.has(m.map)) continue;
    seen.add(m.map);
    const img = m.map.image;
    if (img?.width) bytes += img.width * img.height * 4 * 1.33; // +mipmaps
  }
});
console.log(`  texture VRAM:    ~${(bytes / 1048576).toFixed(1)} MB across ${seen.size} textures`);

// --- do any props cover the artwork? ----------------------------------------
// Themes place shelving and panels around the exhibit plates, and the plate
// positions come from the content — so adding one essay reflows the anchors and
// could push a bookcase over a plate. This is the guard for that.
//
// Granularity was chosen the hard way. Whole-mesh boxes over-report (a merged
// prop or the room shell spans the room by construction). Per-vertex UNDER-
// reports, and precisely on the case that matters: a panel straddling a plate
// has every corner outside it. So the unit is the triangle, transformed into
// world space through the per-instance matrix where there is one.
console.log('\n=== prop / plate clearance ===');
const vtx = new THREE.Vector3();
const wm = new THREE.Matrix4();
const tri = new THREE.Box3();
const intrusions = [];

rooms.forEach((room, i) => {
  const group = world.roomGroups[i];
  if (!group) return;
  group.updateMatrixWorld(true);

  const anchors = (world.anchors.get(room.id) || []).slice(0, room.exhibits.length);
  if (!anchors.length) return;

  // the volume a plate needs: its slot, plus 0.22m of clearance into the room
  const plates = anchors.map((a, k) => {
    const nx = Math.sin(a.rotationY);
    const nz = Math.cos(a.rotationY);
    const hw = a.width / 2;
    const hh = a.height / 2;
    const b = new THREE.Box3();
    for (const d of [0, 0.22]) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          b.expandByPoint(vtx.set(
            a.position.x + nx * d - nz * hw * sx,
            a.position.y + hh * sy,
            a.position.z + nz * d + nx * hw * sx,
          ));
        }
      }
    }
    return { k, box: b };
  });

  group.traverse((node) => {
    if (!decorNodes.has(node)) return;                 // shell or exhibit, not a prop
    if (!(node.isMesh || node.isInstancedMesh)) return;
    const pos = node.geometry && node.geometry.attributes && node.geometry.attributes.position;
    if (!pos) return;
    // Per-TRIANGLE AABBs, not per-vertex. A vertex test misses the case that
    // matters most: a panel straddling a plate has every corner outside it.
    // Whole-mesh boxes are useless in the other direction (a merged prop spans
    // the room), so the triangle is the right granularity.
    const idx = node.geometry.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    const n = node.isInstancedMesh ? node.count : 1;
    for (let inst = 0; inst < n; inst++) {
      if (node.isInstancedMesh) { node.getMatrixAt(inst, wm); wm.premultiply(node.matrixWorld); }
      else wm.copy(node.matrixWorld);
      for (let t = 0; t < triCount; t++) {
        tri.makeEmpty();
        for (let c = 0; c < 3; c++) {
          const vi = idx ? idx.getX(t * 3 + c) : t * 3 + c;
          tri.expandByPoint(vtx.fromBufferAttribute(pos, vi).applyMatrix4(wm));
        }
        for (const p of plates) {
          if (p.box.intersectsBox(tri)) {
            intrusions.push(`${room.id}: "${node.name || node.type}" over plate ${p.k}`);
            return;
          }
        }
      }
    }
  });
});

if (intrusions.length) {
  for (const s of [...new Set(intrusions)]) console.log(`  !! ${s}`);
} else {
  console.log('  no prop intrudes on any exhibit plate');
}

// Link exhibits stand on the floor as lecterns, so unlike a wall plate they can
// be fouled by furniture rather than just covered by it. The plate-clearance
// pass above only guards the wall band, so check the floor footprints directly.
console.log('\n=== lectern footprints ===');
const lecterns = exhibits.colliders || [];
const blocked = [];

const overlaps = (a, b) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

for (let i = 0; i < lecterns.length; i++) {
  const L = lecterns[i];
  if (!(L.maxX > L.minX) || !(L.maxZ > L.minZ)) {
    blocked.push(`lectern ${i} has an inverted or degenerate footprint`);
    continue;
  }
  // the centre line has to stay walkable end to end
  if (L.minX < 0 && L.maxX > 0) blocked.push(`lectern ${i} straddles the x=0 walkway`);
  for (const d of decor.colliders) {
    if (overlaps(L, d)) blocked.push(`lectern ${i} overlaps a prop`);
  }
  for (let j = i + 1; j < lecterns.length; j++) {
    if (overlaps(L, lecterns[j])) blocked.push(`lecterns ${i} and ${j} overlap`);
  }
}

console.log(`  ${lecterns.length} lectern(s) placed`);
if (blocked.length) for (const s of [...new Set(blocked)]) console.log(`  !! ${s}`);
else console.log('  every lectern stands clear of the props and the walkway');

console.log('\n=== update loop ===');
const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 140);
cam.position.set(0, DIMS.eyeH, -2);
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < 2000; i++) { decor.update(1 / 60, i / 60); exhibits.update(1 / 60, cam, i % 3 === 0 ? exhibits.targets[0] : null); }
global.gc?.();
const after = process.memoryUsage().heapUsed;
console.log(`  2000 frames: heap ${(before / 1048576).toFixed(1)} -> ${(after / 1048576).toFixed(1)} MB`);

const targetCount = exhibits.targets.length;

console.log('\n=== dispose ===');
exhibits.dispose();
decor.dispose();
world.dispose();
console.log('  disposed without throwing');

const problems = [];
if (targetCount !== total) problems.push('raycast target count mismatch');
if (empty.length) problems.push(`empty rooms: ${empty.map((e) => e.id).join(', ')}`);
if (worst > 120) problems.push(`${worst} drawables per frame is too many`);
if (bytes / 1048576 > 40) problems.push(`${(bytes / 1048576).toFixed(1)} MB of textures is too much`);
if (intrusions.length) problems.push(`${new Set(intrusions).size} prop(s) cover an exhibit plate`);
if (blocked.length) problems.push(`${new Set(blocked).size} lectern placement problem(s)`);

console.log(problems.length ? `\nPROBLEMS:\n  - ${problems.join('\n  - ')}` : '\nAll integration checks clean.');
process.exit(problems.length ? 1 : 0);
