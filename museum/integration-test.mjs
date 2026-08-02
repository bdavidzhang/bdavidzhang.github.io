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
const exhibits = buildExhibits(rooms, world);

console.log(`  colliders:       ${world.colliders.length}`);
console.log(`  raycast targets: ${exhibits.targets.length} (expected ${total})`);
if (exhibits.targets.length !== total) console.log('  !! target count mismatch');

// Count what a single frame would submit, honouring the engine's cull radius.
const scene = new THREE.Scene();
scene.add(world.group, exhibits.group);

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

console.log('\n=== update loop ===');
const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 140);
cam.position.set(0, DIMS.eyeH, -2);
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < 2000; i++) exhibits.update(1 / 60, cam, i % 3 === 0 ? exhibits.targets[0] : null);
global.gc?.();
const after = process.memoryUsage().heapUsed;
console.log(`  2000 frames: heap ${(before / 1048576).toFixed(1)} -> ${(after / 1048576).toFixed(1)} MB`);

const targetCount = exhibits.targets.length;   // capture before dispose clears it

console.log('\n=== dispose ===');
exhibits.dispose();
world.dispose();
console.log('  disposed without throwing');

const problems = [];
if (targetCount !== total) problems.push('raycast target count mismatch');
if (empty.length) problems.push(`empty rooms: ${empty.map((e) => e.id).join(', ')}`);
if (worst > 120) problems.push(`${worst} drawables per frame is too many`);
if (bytes / 1048576 > 40) problems.push(`${(bytes / 1048576).toFixed(1)} MB of textures is too much`);

console.log(problems.length ? `\nPROBLEMS:\n  - ${problems.join('\n  - ')}` : '\nAll integration checks clean.');
process.exit(problems.length ? 1 : 0);
