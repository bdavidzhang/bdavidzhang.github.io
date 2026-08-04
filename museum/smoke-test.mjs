// smoke-test.mjs — headless contract check for the museum modules.
// Run from the repo root:  node museum/smoke-test.mjs
//
// This does NOT render anything. It stubs just enough DOM to let the geometry
// and content modules execute in Node, then asserts the module contract that
// main.js relies on. It catches the integration mistakes that a browser would
// only reveal as a blank canvas.

import * as THREE from 'three';

// --- minimal DOM stub -------------------------------------------------------
function stubCanvas(w = 300, h = 150) {
  const ctx = {
    canvas: null,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    textAlign: '', textBaseline: '', globalAlpha: 1, filter: '',
    shadowBlur: 0, shadowColor: '',
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, rect() {}, roundRect() {},
    fill() {}, stroke() {}, clip() {}, translate() {}, rotate() {}, scale() {},
    clearRect() {}, fillRect() {}, strokeRect() {}, drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getImageData: (x, y, gw = 1, gh = 1) => ({ data: new Uint8ClampedArray(gw * gh * 4), width: gw, height: gh }),
    createImageData: (gw = 1, gh = 1) => ({
      data: new Uint8ClampedArray((gw.width || gw) * (gh.height || gh) * 4),
      width: gw.width || gw, height: gh.height || gh,
    }),
    putImageData() {},
    measureText: (t) => ({ width: String(t).length * 9, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 }),
    fillText() {}, strokeText() {},
  };
  const el = {
    width: w, height: h, style: {}, nodeType: 1,
    getContext: (kind) => (kind === '2d' ? ctx : null),
    toDataURL: () => 'data:,',
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { return c; },
  };
  ctx.canvas = el;
  return el;
}

globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? stubCanvas() : {
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [], appendChild(c) { this.children.push(c); return c; },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], remove() {}, focus() {},
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
  }),
  createElementNS: () => stubCanvas(),
  body: { appendChild: (c) => c, style: {} },
  head: { appendChild: (c) => c },
  documentElement: { style: {} },
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  activeElement: null,
  hidden: false,
};
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.location = { hash: '', replace() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = class { set src(v) { this._src = v; } addEventListener() {} };

// --- tiny assert harness ----------------------------------------------------
let pass = 0;
const failures = [];
function check(label, fn) {
  try {
    const msg = fn();
    if (msg) throw new Error(msg);
    pass++;
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    console.log(`  FAIL ${label} — ${err.message}`);
  }
}

// --- run --------------------------------------------------------------------
const { ROOMS, DIMS, roomZRange, roomCenterZ, roomIndexAtZ } = await import('./config.js');

console.log('\nconfig');
check('ROOMS is a non-empty array', () => (Array.isArray(ROOMS) && ROOMS.length ? null : 'not an array'));
check('room ranges tile without gaps', () => {
  for (let i = 0; i < ROOMS.length - 1; i++) {
    const [far] = roomZRange(i);
    const [, near] = roomZRange(i + 1);
    if (Math.abs(far - near) > 1e-9) return `room ${i} far ${far} != room ${i + 1} near ${near}`;
  }
  return null;
});
check('roomIndexAtZ agrees with roomCenterZ', () => {
  for (let i = 0; i < ROOMS.length; i++) {
    if (roomIndexAtZ(roomCenterZ(i)) !== i) return `centre of room ${i} maps to ${roomIndexAtZ(roomCenterZ(i))}`;
  }
  return null;
});

console.log('\ncontent');
const contentMod = await import('./content.js');
check('exports loadContent', () => (typeof contentMod.loadContent === 'function' ? null : 'missing'));
check('excerpt strips tags and truncates', () => {
  const out = contentMod.excerpt('<p>hello <b>there</b> friend</p>', 12);
  if (/[<>]/.test(out)) return `left markup: ${out}`;
  if (out.length > 14) return `too long: ${out}`;
  return null;
});

// Fake rooms so we don't need network fetches.
const rooms = ROOMS.map((r, i) => ({
  ...r,
  exhibits: Array.from({ length: 3 + (i % 3) }, (_, k) => ({
    id: `${r.id}-${k}`, kind: 'essay', title: `Exhibit ${k} in ${r.title}`,
    meta: '2025', blurb: 'A reasonably long blurb that should wrap across a few lines on the plate.',
    tags: ['tag'], bodyHtml: '<p>body</p>', href: '#',
  })),
}));

console.log('\narchitecture');
let world = null;
try {
  const arch = await import('./architecture.js');
  check('exports buildWorld', () => (typeof arch.buildWorld === 'function' ? null : 'missing buildWorld'));
  world = arch.buildWorld(rooms);
  check('returns group/colliders/anchors/roomGroups', () => {
    if (!world) return 'nothing returned';
    if (!world.group?.isObject3D) return 'group is not an Object3D';
    if (!Array.isArray(world.colliders)) return 'colliders not an array';
    if (!(world.anchors instanceof Map)) return 'anchors is not a Map';
    if (!Array.isArray(world.roomGroups)) return 'roomGroups not an array';
    return null;
  });
  check('one room group per room', () => (world.roomGroups.length === rooms.length
    ? null : `${world.roomGroups.length} groups for ${rooms.length} rooms`));
  check('room groups are attached to world.group', () => {
    const missing = world.roomGroups.filter((g) => !g || !world.group.getObjectById(g.id));
    return missing.length ? `${missing.length} groups not parented under group` : null;
  });
  check('colliders are well-formed AABBs', () => {
    if (!world.colliders.length) return 'no colliders emitted';
    for (const c of world.colliders) {
      if (!['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(c[k]))) return `bad box ${JSON.stringify(c)}`;
      if (c.minX > c.maxX || c.minZ > c.maxZ) return `inverted box ${JSON.stringify(c)}`;
    }
    return null;
  });
  check('every room has >= exhibits anchors', () => {
    for (const r of rooms) {
      const a = world.anchors.get(r.id);
      if (!a || !a.length) return `room ${r.id} has no anchors`;
      if (a.length < r.exhibits.length) return `room ${r.id}: ${a.length} anchors < ${r.exhibits.length} exhibits`;
      for (const an of a) {
        if (!an.position?.isVector3) return `room ${r.id}: anchor missing Vector3 position`;
        if (!Number.isFinite(an.rotationY)) return `room ${r.id}: anchor missing rotationY`;
        if (!(an.width > 0 && an.height > 0)) return `room ${r.id}: anchor has no size`;
      }
    }
    return null;
  });
  check('anchors sit inside their room bounds', () => {
    for (let i = 0; i < rooms.length; i++) {
      const [far, near] = roomZRange(i);
      for (const an of world.anchors.get(rooms[i].id) || []) {
        const { x, z } = an.position;
        if (Math.abs(x) > DIMS.roomW / 2 + 0.6) return `room ${i}: anchor x=${x.toFixed(2)} outside width`;
        if (z < far - 0.6 || z > near + 0.6) return `room ${i}: anchor z=${z.toFixed(2)} outside [${far}, ${near}]`;
      }
    }
    return null;
  });
  check('doorway gaps exist between rooms', () => {
    // walking down the centre line (x=0) must not hit a collider at any z
    for (let z = -1; z > -DIMS.roomD * rooms.length + 1; z -= 0.25) {
      const blocked = world.colliders.some((c) => 0 >= c.minX - DIMS.bodyR && 0 <= c.maxX + DIMS.bodyR
        && z >= c.minZ - DIMS.bodyR && z <= c.maxZ + DIMS.bodyR);
      if (blocked) return `centre line blocked at z=${z.toFixed(2)} — doorway missing or too narrow`;
    }
    return null;
  });
  check('draw calls stay low', () => {
    let meshes = 0;
    world.group.traverse((o) => { if (o.isMesh || o.isLineSegments) meshes++; });
    const per = meshes / rooms.length;
    console.log(`       (${meshes} drawable objects total, ~${per.toFixed(1)} per room)`);
    return per > 30 ? `${per.toFixed(1)} per room is too many` : null;
  });
} catch (err) {
  failures.push(`architecture: ${err.message}`);
  console.log(`  FAIL architecture threw — ${err.message}`);
}

console.log('\nexhibits');
try {
  const ex = await import('./exhibits.js');
  check('exports buildExhibits', () => (typeof ex.buildExhibits === 'function' ? null : 'missing'));
  if (world) {
    const built = ex.buildExhibits(rooms, world);
    check('returns group/targets/update/dispose', () => {
      if (!built.group?.isObject3D) return 'group missing';
      if (!Array.isArray(built.targets)) return 'targets missing';
      if (typeof built.update !== 'function') return 'update missing';
      if (typeof built.dispose !== 'function') return 'dispose missing';
      return null;
    });
    check('one raycast target per exhibit', () => {
      const want = rooms.reduce((n, r) => n + r.exhibits.length, 0);
      return built.targets.length === want ? null : `${built.targets.length} targets for ${want} exhibits`;
    });
    check('every target carries userData.exhibit', () => {
      const bad = built.targets.filter((t) => !t.userData?.exhibit?.id);
      return bad.length ? `${bad.length} targets missing userData.exhibit` : null;
    });
    check('update() runs without allocating a crash', () => {
      const cam = new THREE.PerspectiveCamera();
      built.update(0.016, cam, built.targets[0]);
      built.update(0.016, cam, null);
      return null;
    });
  }
} catch (err) {
  failures.push(`exhibits: ${err.message}`);
  console.log(`  FAIL exhibits threw — ${err.message}`);
}

console.log('\ncontrols');
try {
  const mod = await import('./controls.js');
  check('exports createControls', () => (typeof mod.createControls === 'function' ? null : 'missing'));
  const cam = new THREE.PerspectiveCamera();
  cam.rotation.order = 'YXZ';
  const colliders = world ? world.colliders : [{ minX: 1, maxX: 2, minZ: -2, maxZ: -1 }];
  const c = mod.createControls({ camera: cam, domElement: stubCanvas(), colliders, isMobile: false });
  check('has the full API', () => {
    for (const k of ['update', 'lock', 'unlock', 'teleportTo', 'setEnabled', 'dispose']) {
      if (typeof c[k] !== 'function') return `missing ${k}()`;
    }
    if (typeof c.isLocked !== 'boolean') return 'isLocked is not a boolean';
    return null;
  });
  check('update() is stable over 120 frames', () => {
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    const p = cam.position;
    if (![p.x, p.y, p.z].every(Number.isFinite)) return `camera went NaN: ${p.toArray()}`;
    return null;
  });
  check('teleportTo moves the camera', () => {
    c.teleportTo(0, -40, Math.PI);
    return Math.abs(cam.position.z + 40) < 1.5 ? null : `z=${cam.position.z}`;
  });
  check('player never ends up inside a collider', () => {
    c.teleportTo(0, -5, 0);
    for (let i = 0; i < 240; i++) c.update(1 / 60);
    const { x, z } = cam.position;
    for (const b of colliders) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const d = Math.hypot(x - cx, z - cz);
      if (d < DIMS.bodyR - 0.05) return `inside a wall, penetration ${(DIMS.bodyR - d).toFixed(3)}m`;
    }
    return null;
  });
  c.dispose();
} catch (err) {
  failures.push(`controls: ${err.message}`);
  console.log(`  FAIL controls threw — ${err.message}`);
}

console.log('\nindex.html (the museum entry)');
try {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // An id/class rule that sets `display` outranks the UA's
  // `[hidden] { display: none }`, so an element can carry `hidden` and still
  // render. This shipped once: the boot-error card covered the canvas at
  // z-index 999 and the museum looked broken while running fine underneath.
  check('elements using [hidden] are not overridden by a display rule', () => {
    const hiddenIds = [...html.matchAll(/<[^>]*\bid=["']([\w-]+)["'][^>]*\bhidden\b[^>]*>/g)].map((m) => m[1]);
    if (!hiddenIds.length) return 'no [hidden] elements found — did the markup change?';

    // Parse the <style> blocks into real rules. Comments are stripped first:
    // an earlier version of this test matched the literal "[hidden]" inside a
    // CSS comment and passed vacuously.
    const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((m) => m[1])
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const rules = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      rules.push({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] });
    }
    const declaresDisplay = (r) => /(^|;)\s*display\s*:/.test(r.body);
    const declaresDisplayNone = (r) => /(^|;)\s*display\s*:\s*none\s*(;|$)/.test(r.body);

    const globalGuard = rules.some(
      (r) => r.selectors.some((s) => s === '[hidden]') && declaresDisplayNone(r),
    );

    const bad = [];
    for (const id of hiddenIds) {
      const unguardedDisplay = rules.some(
        (r) => declaresDisplay(r)
          && r.selectors.some((s) => s.includes(`#${id}`) && !s.includes('[hidden]')),
      );
      const guarded = rules.some(
        (r) => declaresDisplayNone(r)
          && r.selectors.some((s) => s.includes(`#${id}[hidden]`)),
      );
      if (unguardedDisplay && !guarded && !globalGuard) bad.push(`#${id}`);
    }
    return bad.length
      ? `${bad.join(', ')} set display via an id rule, which outranks [hidden] — they will never hide`
      : null;
  });

  check('canvas and fallbacks are present', () => {
    if (!/id=["']scene["']/.test(html)) return 'missing #scene canvas';
    if (!/id=["']boot-error["']/.test(html)) return 'missing #boot-error';
    if (!/type=["']importmap["']/.test(html)) return 'missing import map';
    return null;
  });

  check('import map targets exist on disk', () => {
    const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    if (!map) return 'no import map';
    const { imports } = JSON.parse(map[1]);
    for (const [, target] of Object.entries(imports)) {
      if (target.endsWith('/')) continue;               // prefix mapping
      const p = new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url);
      try { readFileSync(p); } catch { return `${target} does not exist`; }
    }
    return null;
  });
} catch (err) {
  failures.push(`index.html: ${err.message}`);
  console.log(`  FAIL index.html checks threw — ${err.message}`);
}

console.log('\nui');
try {
  const mod = await import('./ui.js');
  check('exports createUI', () => (typeof mod.createUI === 'function' ? null : 'missing'));
} catch (err) {
  failures.push(`ui: ${err.message}`);
  console.log(`  FAIL ui import threw — ${err.message}`);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
