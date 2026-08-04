// portal.js — the Open Reality gateway standing in the Atrium.
//
// The site's owner founded Open Reality, so the museum's first room carries a
// door out to it: a teal-lit gateway off the right-hand side of the flagstone
// path. Walk through the aperture and the site opens in a new tab.
//
// Three things make this different from an exhibit, and all three are load
// bearing:
//
//   * It is NOT an exhibit and NEVER joins exhibits.targets. The raycast target
//     list is asserted to be exactly one entry per exhibit by both smoke-test
//     and integration-test, so a portal in there fails the build. It is
//     proximity-triggered only — update() watches the camera position.
//   * The threshold is not solid. Only the two frame legs are colliders, so the
//     player can actually cross the plane between them.
//   * It never touches the centre of the room. smoke-test walks the line x=0
//     from the entrance to the last room and fails if anything blocks it, so
//     the whole gateway lives at x >= 1.04 — 0.62 m clear of the widest the
//     player can be at x=0 (DIMS.bodyR = 0.42).
//
// Five drawables: frame (merged) · frame outline · membrane · header plate ·
// floor pool. No lights, no shadows, no per-frame allocation.

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// --- the brand ---------------------------------------------------------------
// Copy is verbatim and lives in exactly one place: the in-world header plate and
// the DOM fallback both read from here, so they can never drift apart.

export const PORTAL_BRAND = {
  title: 'Open Reality',
  tagline: 'Turn messy teleop and human-demo video into trainable, policy-ready robot datasets',
  url: 'https://www.open-reality.io',
};

// --- placement ---------------------------------------------------------------
//
// The Atrium's interior is x [-6.15, 6.15], z [-14.65, -0.35]. garden.js fills
// most of it: long beds at |x| >= 4.35 over z [-13.75, -2.75], four tree boxes,
// a pool at x [-4.40, -2.10] z [-8.65, -6.35] and a bench at x [2.90, 3.60]
// z [-8.45, -6.55]. The one deep pocket left over is the bay between the two
// right-hand tree boxes, z (-9.80, -5.20) — which is also the first thing in
// clear view when you spawn at (0, -1.8) looking down the room.
//
// So the gateway stands there, square-on to the entrance, one lane right of the
// flagstone path (whose right-hand pavers stop at x ~ 1.58):
//
//   frame legs   x [1.04, 1.30] and [2.80, 3.06],  z [-5.97, -5.73]
//   aperture     x [1.30, 2.80] (1.50 m), y [0, 2.46]
//   header       x [1.04, 3.06], y [2.46, 3.13]
//
// Clearances, all computed against garden.js's own ctx.collide() calls:
//   right long bed  x 4.35  vs frame maxX 3.06        -> 1.29 m
//   left long bed   x -4.35 vs frame minX 1.04        -> 5.39 m
//   near tree box   z -5.20 vs frame minZ... maxZ -5.73 -> 0.53 m
//   bench           z -6.55 vs frame minZ -5.97       -> 0.58 m
//   pool            x -2.10 vs frame minX 1.04        -> 3.14 m
//   far tree boxes  z -9.80 vs frame minZ -5.97       -> 3.83 m
//   side walls      x 6.44  vs frame maxX 3.06        -> 3.38 m
//   centre line     frame minX 1.04 - bodyR 0.42      -> 0.62 m clear of x=0
//
// Height 3.13 m clears the canopy blobs (their nearest edge is z -5.25, and
// they top out at 3.30) and sits well under the skylight bars at y 4.22.

const THRESHOLD_Z = -5.85;   // the plane you cross
const APERTURE_X0 = 1.30;
const APERTURE_X1 = 2.80;
const APERTURE_H = 2.46;

const LEG_W = 0.26;
const LEG_D = 0.24;
const HEADER_H = 0.67;

const FRAME_X0 = APERTURE_X0 - LEG_W;   // 1.04
const FRAME_X1 = APERTURE_X1 + LEG_W;   // 3.06
const FRAME_Z0 = THRESHOLD_Z - LEG_D / 2;   // -5.97
const FRAME_Z1 = THRESHOLD_Z + LEG_D / 2;   // -5.73

const APERTURE_CX = (APERTURE_X0 + APERTURE_X1) / 2;   // 2.05
const APERTURE_W = APERTURE_X1 - APERTURE_X0;          // 1.50
const FRAME_W = FRAME_X1 - FRAME_X0;                   // 2.02

// The trigger slab. 0.70 m deep so even a sprinting visitor on a 20 fps device
// (6.29 m/s * 0.05 s = 0.31 m per frame) cannot tunnel through it, and no wider
// than the aperture, so brushing past the outside of a leg does nothing.
const TRIG_HALF_D = 0.35;
const TRIG_Z0 = THRESHOLD_Z - TRIG_HALF_D;   // -6.20
const TRIG_Z1 = THRESHOLD_Z + TRIG_HALF_D;   // -5.50

// Open Reality is near-monochrome with a muted teal/sage accent. The Atrium's
// garden theme is hue 124; pulling to 172 gives the gateway its own identity
// while staying in the same family as the room.
const PORTAL_HUE = 172;
const INK_HUE = 176;

// -----------------------------------------------------------------------------
// canvas textures
// -----------------------------------------------------------------------------

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

/**
 * The membrane: greyscale bands that tile seamlessly in v, so the texture can be
 * scrolled forever without a seam. Greyscale on purpose — the material's colour
 * does the tinting, so the same bitmap serves day and night.
 */
function membraneTexture(THREE) {
  const made = makeCanvas(128, 512);
  if (!made) return null;
  const { canvas, ctx } = made;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#8c8c8c';
  ctx.fillRect(0, 0, W, H);

  // Integer wave counts keep the pattern periodic over the full height.
  // The map MULTIPLIES the material colour, so it has to sit high: a mid-grey
  // bitmap would halve the teal and the membrane would read as a dirty window
  // rather than as something lit. Bands ride near the top of the range instead.
  const STEP = 4;
  for (let y = 0; y < H; y += STEP) {
    const t = y / H;
    const wave =
      0.80 +
      0.12 * Math.sin(t * Math.PI * 2 * 3) +
      0.07 * Math.sin(t * Math.PI * 2 * 8 + 1.1) +
      0.05 * Math.sin(t * Math.PI * 2 * 17 + 2.7);
    const v = Math.max(0, Math.min(255, Math.round(wave * 255)));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, W, STEP);
  }

  // Edge falloff across u only — u never repeats, so this may be non-periodic.
  const edge = ctx.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.38)');
  edge.addColorStop(0.22, 'rgba(0,0,0,0)');
  edge.addColorStop(0.78, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Greedy word wrap against the 2D context's own metrics. Once the last allowed
 * line is reached it stops breaking, so the tail always lands on screen rather
 * than being silently dropped.
 */
function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    const canBreak = line && lines.length < maxLines - 1;
    if (canBreak && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The header board: wordmark, tagline, and who it belongs to. */
function headerTexture(THREE, ink, paper, accent, muted) {
  const made = makeCanvas(1024, 340);
  if (!made) return null;
  const { canvas, ctx } = made;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, W, H);

  // a single accent rule down the left edge — the whole of the brand's colour
  ctx.fillStyle = accent;
  ctx.fillRect(46, 58, 7, H - 116);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // The type block deliberately stops around 70% of the board. The nearest tree
  // canopy hangs at y 1.77-3.33 over x 2.30-4.20 and z -5.25, i.e. half a metre
  // in front of this plate and across its right-hand end, so a visitor standing
  // square on at x ~ 2 has leaves over that corner. Keeping the words inside the
  // left two-thirds means the tagline is never chopped mid-word, and the empty
  // right end reads as margin rather than as something missing.
  const left = 82;
  const maxW = 660;

  ctx.fillStyle = paper;
  ctx.font = '600 92px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(PORTAL_BRAND.title, left, 118);

  ctx.fillStyle = muted;
  ctx.font = '400 34px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const lines = wrapLines(ctx, PORTAL_BRAND.tagline, maxW, 3);
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], left, 176 + i * 46);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft ellipse of light on the flagstones, marking where to step. */
function poolTexture(THREE) {
  const made = makeCanvas(256, 256);
  if (!made) return null;
  const { canvas, ctx } = made;
  const S = canvas.width;

  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// -----------------------------------------------------------------------------

/**
 * Build the Open Reality portal into the Atrium.
 *
 * @param {object}   opts
 * @param {object}   opts.THREE      the same three.js module instance the rest of the museum uses
 * @param {object}   opts.room       content.js room object for room 0
 * @param {object}   opts.roomGroup  world.roomGroups[0]; everything is parented here
 * @param {object}   opts.theme      themeFor(0)
 * @param {object}   opts.ui         createUI() result; ui.showPortalPrompt() is the popup fallback
 * @returns {{group:object, colliders:Array, update:Function, dispose:Function}}
 */
export function createPortal({ THREE, room, roomGroup, theme, ui } = {}) {
  if (!THREE) throw new Error('[museum] createPortal needs the THREE namespace');

  const palette = theme || {};
  const group = new THREE.Group();
  group.name = `portal:${(room && room.id) || 'atrium'}`;

  const geometries = [];
  const materials = [];
  const textures = [];

  // --- colour ---------------------------------------------------------------
  // Same contract as themes/library.js and themes/studio.js: read the mode off
  // the wall's lightness, then retarget lightness per mode. Never
  // prefers-color-scheme. Night wants the frame LIGHTER than the wall, because
  // Lambert shades as albedo x light and a dark prop in a dim room is just black.
  const hsl = {};
  new THREE.Color(palette.wall != null ? palette.wall : 0xf2f5ec)
    .getHSL(hsl, THREE.SRGBColorSpace);
  const night = hsl.l < 0.5;

  const tone = (hex, hue, sat, dayL, nightL) => {
    const c = new THREE.Color(hex);
    const o = {};
    c.getHSL(o, THREE.SRGBColorSpace);
    const l = Math.max(0.05, Math.min(0.95, o.l * (night ? nightL : dayL)));
    return c.setHSL(hue / 360, sat, l, THREE.SRGBColorSpace).getHex();
  };

  const railHex = palette.rail != null ? palette.rail : 0xc3cdb2;
  const glowHex = palette.glow != null ? palette.glow : 0xfbffef;
  const inkHex = palette.ink != null ? palette.ink : 0x231f1a;

  // day  l 0.75 * 0.75 = 0.56 — reads solid against a 0.94 wall
  // night l 0.38 * 1.62 = 0.62 — reads solid against a 0.30 wall
  const stone = tone(railHex, PORTAL_HUE, 0.14, 0.75, 1.62);
  // Unlit, so these are literally what you see: day l 0.60, night l 0.66. Night
  // is only a little brighter than day on purpose — pushed any higher the bands
  // clip to white and the gateway stops reading as teal at all.
  const membraneHex = tone(glowHex, PORTAL_HUE, 0.40, 0.62, 0.76);
  const poolHex = tone(glowHex, PORTAL_HUE, 0.28, 0.72, 0.86);
  const outlineHex = tone(inkHex, INK_HUE, 0.30, 1.0, 1.0);

  const css = (hex) => `#${(hex >>> 0).toString(16).padStart(6, '0')}`;
  // The header is unlit and carries type, so it sets its own contrast rather
  // than riding the wall: dark slab, light wordmark, in both modes.
  const plateInk = css(tone(inkHex, INK_HUE, 0.26, 1.0, 0.52));
  const platePaper = css(tone(glowHex, PORTAL_HUE, 0.10, 0.99, 1.06));
  const plateMuted = css(tone(glowHex, PORTAL_HUE, 0.16, 0.80, 0.92));
  const plateAccent = css(membraneHex);

  const keep = (list, item) => {
    if (item) list.push(item);
    return item;
  };

  const stoneMat = keep(materials, new THREE.MeshLambertMaterial({ color: stone }));
  const outlineMat = keep(materials, new THREE.LineBasicMaterial({ color: outlineHex }));

  // --- 1. frame: two legs and a header, merged into one draw call -----------
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

  const parts = [
    box(LEG_W, APERTURE_H, LEG_D, APERTURE_X0 - LEG_W / 2, APERTURE_H / 2, THRESHOLD_Z),
    box(LEG_W, APERTURE_H, LEG_D, APERTURE_X1 + LEG_W / 2, APERTURE_H / 2, THRESHOLD_Z),
    box(FRAME_W, HEADER_H, LEG_D, APERTURE_CX, APERTURE_H + HEADER_H / 2, THRESHOLD_Z),
  ];
  const frameGeo = mergeGeometries(parts, false);
  for (const g of parts) {
    if (g !== frameGeo) g.dispose();
  }
  if (!frameGeo) throw new Error('[museum] portal frame merge failed');
  geometries.push(frameGeo);

  const frame = new THREE.Mesh(frameGeo, stoneMat);
  frame.matrixAutoUpdate = false;
  frame.updateMatrix();
  group.add(frame);

  // one outline, matching the sketchbook edges the rest of the museum draws
  const edgeGeo = keep(geometries, new THREE.EdgesGeometry(frameGeo, 15));
  const outline = new THREE.LineSegments(edgeGeo, outlineMat);
  outline.matrixAutoUpdate = false;
  outline.updateMatrix();
  group.add(outline);

  // --- 2. membrane: the surface you walk through ----------------------------
  const membraneMap = keep(textures, membraneTexture(THREE));
  const membraneMat = keep(materials, new THREE.MeshBasicMaterial({
    color: membraneHex,
    map: membraneMap || null,
    side: THREE.DoubleSide,   // one mesh serves both faces
    transparent: true,
    // Nearly opaque on purpose. Let too much through and you are looking at the
    // same garden on the other side, which is the opposite of what a door to
    // somewhere else should say.
    opacity: 0.94,
  }));
  const membraneGeo = keep(geometries, new THREE.PlaneGeometry(APERTURE_W, APERTURE_H));
  const membrane = new THREE.Mesh(membraneGeo, membraneMat);
  membrane.position.set(APERTURE_CX, APERTURE_H / 2, THRESHOLD_Z);
  membrane.matrixAutoUpdate = false;
  membrane.updateMatrix();
  group.add(membrane);

  // --- 3. header plate ------------------------------------------------------
  const headerMap = keep(textures, headerTexture(THREE, plateInk, platePaper, plateAccent, plateMuted));
  const headerMat = keep(materials, new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: headerMap || null,
    toneMapped: false,
  }));
  const headerGeo = keep(geometries, new THREE.PlaneGeometry(FRAME_W - 0.04, HEADER_H - 0.04));
  const header = new THREE.Mesh(headerGeo, headerMat);
  // 5 mm proud of the header block's front face, looking back at the entrance
  header.position.set(APERTURE_CX, APERTURE_H + HEADER_H / 2, FRAME_Z1 + 0.005);
  header.matrixAutoUpdate = false;
  header.updateMatrix();
  group.add(header);

  // --- 4. light pooled on the flagstones ------------------------------------
  const poolMap = keep(textures, poolTexture(THREE));
  const poolMat = keep(materials, new THREE.MeshBasicMaterial({
    color: poolHex,
    map: poolMap || null,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  }));
  const poolGeo = keep(geometries, new THREE.PlaneGeometry(FRAME_W - 0.04, TRIG_HALF_D * 2 + 0.4));
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.set(APERTURE_CX, 0.014, THRESHOLD_Z);
  pool.rotation.x = -Math.PI / 2;
  pool.renderOrder = -1;
  pool.matrixAutoUpdate = false;
  pool.updateMatrix();
  group.add(pool);

  // --- parent in ------------------------------------------------------------
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  if (roomGroup && typeof roomGroup.add === 'function') roomGroup.add(group);

  // --- colliders ------------------------------------------------------------
  // The legs only. The threshold between them is deliberately empty, and the
  // header is overhead, so neither gets a footprint.
  const colliders = [
    { minX: FRAME_X0, maxX: APERTURE_X0, minZ: FRAME_Z0, maxZ: FRAME_Z1 },
    { minX: APERTURE_X1, maxX: FRAME_X1, minZ: FRAME_Z0, maxZ: FRAME_Z1 },
  ];

  // -------------------------------------------------------------------------
  // firing
  // -------------------------------------------------------------------------

  /**
   * Open the site, and fall back to a DOM prompt if the browser refuses.
   *
   * On the window.open() call: the obvious spelling is
   * `window.open(url, '_blank', 'noopener')`, but the HTML spec says that when
   * the `noopener` feature is set the method returns null *even on success*
   * (there is no WindowProxy to hand back once the opener link is severed), so
   * the return value stops being a signal and the fallback would show every
   * single time. Passing no feature string keeps the return value meaningful —
   * null means blocked — and `win.opener = null` on the very next statement,
   * synchronously and long before the new document can run any script, gives
   * exactly the protection the feature would have. A features string also nudges
   * some browsers into opening a popup window rather than a tab, which is worse.
   * The DOM fallback's anchor carries rel="noopener noreferrer" outright.
   */
  function fire() {
    let opened = null;
    try {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        opened = window.open(PORTAL_BRAND.url, '_blank');
        if (opened) {
          try { opened.opener = null; } catch { /* cross-origin, already severed */ }
        }
      }
    } catch {
      opened = null;
    }

    if (opened) return;

    // Blocked, or no window at all: hand it to the overlay, whose button is a
    // real user gesture and therefore always allowed to open a tab.
    try {
      if (ui && typeof ui.showPortalPrompt === 'function') {
        ui.showPortalPrompt({
          title: PORTAL_BRAND.title,
          tagline: PORTAL_BRAND.tagline,
          url: PORTAL_BRAND.url,
        });
      }
    } catch (err) {
      console.error('[museum] portal prompt failed', err);
    }
  }

  // -------------------------------------------------------------------------
  // update — allocation-free. Nothing here constructs a Vector3, a Matrix4 or
  // an object; the only writes are to numbers already owned by the materials.
  // -------------------------------------------------------------------------

  let clock = 0;
  let inside = false;
  let seeded = false;
  let disposed = false;

  function update(dt, playerPosition) {
    if (disposed) return;

    const step = typeof dt === 'number' && Number.isFinite(dt) ? dt : 0;
    clock += step;

    // drift + breathe: numbers only, no new objects
    if (membraneMap) membraneMap.offset.y = -((clock * 0.055) % 1);
    membraneMat.opacity = 0.9 + 0.05 * Math.sin(clock * 1.15);
    poolMat.opacity = 0.3 + 0.1 * Math.sin(clock * 1.15 + 2.1);

    if (!playerPosition) return;
    const px = playerPosition.x;
    const pz = playerPosition.z;
    const now = px >= APERTURE_X0 && px <= APERTURE_X1 && pz >= TRIG_Z0 && pz <= TRIG_Z1;

    // The first sample only seeds the latch: if main.js ever drops the player
    // straight into the aperture (a map teleport, a #hash deep link) they should
    // not be thrown into a new tab before they have taken a step.
    if (!seeded) {
      seeded = true;
      inside = now;
      return;
    }

    if (now && !inside) fire();   // once per entry
    inside = now;                 // leaving re-arms; leaving itself never fires
  }

  // -------------------------------------------------------------------------

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (group.parent) group.parent.remove(group);
    for (const g of geometries) {
      if (g && typeof g.dispose === 'function') g.dispose();
    }
    for (const m of materials) {
      if (m && typeof m.dispose === 'function') m.dispose();
    }
    for (const t of textures) {
      if (t && typeof t.dispose === 'function') t.dispose();
    }
    geometries.length = 0;
    materials.length = 0;
    textures.length = 0;
    group.clear();
  }

  return { group, colliders, update, dispose };
}

export default createPortal;
