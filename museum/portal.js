// portal.js — the Open Reality installation on the Atrium's entrance wall.
//
// The site's owner founded Open Reality, so the museum's first room carries a
// way out to it. This used to be a small freestanding gateway parked off to one
// side of the flagstone path; it is now the whole entrance wall — a 12.9 m
// frontispiece with the wordmark across the top, a lit threshold dead centre and
// two description boards flanking it. Walk up to the threshold and the site
// opens in a new tab.
//
// Four things make this different from an exhibit, and all four are load
// bearing:
//
//   * It is NOT an exhibit and NEVER joins exhibits.targets. The raycast target
//     list is asserted to be exactly one entry per exhibit by both smoke-test
//     and integration-test, so a portal in there fails the build. It is
//     proximity-triggered only — update() watches the camera position.
//   * The wall stays SOLID. architecture.js already emits the k === 0 boundary
//     collider (minZ -0.06, maxZ 0.35, full width), so this module returns NO
//     colliders of its own: everything it builds is applied relief no deeper
//     than 0.17 m, and the player is stopped 0.48 m short of the wall face long
//     before they could touch it. You never pass through.
//   * It must not fire at spawn. engine.js drops the player at z = -1.80 facing
//     AWAY down the room; the trigger band starts at z = -1.15, so there is
//     0.65 m of slack before a booting museum could possibly open a tab. See
//     TRIGGER below for the full arithmetic.
//   * The x = 0 centre line stays walkable — trivially, since there are no
//     colliders at all — which is what smoke-test.mjs walks the room with.
//
// Six drawables: relief (8 boxes merged) · relief outline · wordmark ·
// description boards + lintel plate (3 planes merged over one atlas) ·
// threshold · light spill. Four canvas textures, ~9.4 MB with mipmaps.
// No lights, no shadows, no per-frame allocation.

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// --- the brand ---------------------------------------------------------------
// Copy is verbatim and lives in exactly one place: the in-world lettering and
// the DOM fallback both read from here, so they can never drift apart. Nothing
// in this object is invented — it is the live site's own wording plus the one
// first-person line the owner wrote for the museum.

export const PORTAL_BRAND = {
  title: 'Open Reality',
  tagline: 'Turn messy teleop and human-demo video into trainable, policy-ready robot datasets',
  founder: "I'm currently the founder of Open Reality, working on it full time.",
  whatBody: 'A spatial AI platform that maps physical spaces in real time from a '
    + 'phone camera, and lets AI agents reason and act in 3D.',
  whatNote: '$20K in prizes · HackIllinois 2026',
  platformHead: 'Live 3D scanning from a mobile browser. No app required.',
  platformBody: 'Reconstructs 3D geometry from monocular video, recovers metric '
    + 'depth and camera pose, grounds object labels in metric space, validates '
    + 'trajectories, and exports LeRobot-format datasets for policy training.',
  url: 'https://www.open-reality.io',
  urlShort: 'open-reality.io',
};

// -----------------------------------------------------------------------------
// placement — all coordinates are world space, in room 0's own frame
// -----------------------------------------------------------------------------
//
// The Atrium spans z [-15, 0]. architecture.js makes the k === 0 boundary a
// SOLID end wall (`solidEnd(zNear + wallT / 2)`), a slab occupying z [0, 0.35],
// so its room-facing interior surface is the plane z = 0 exactly — the mirror of
// themes/library.js:101, which finds the far end wall's face at
// `bounds.minZ - DIMS.wallT`. Interior side walls are at x = +/- 6.50 and the
// ceiling at y = 4.40.
//
// Elevation, floor upwards:
//
//   0.00 ─ floor
//   0.20 ─ plinth top                      full width, 0.16 m proud
//   0.20 ─ threshold sill  ┐
//   2.50 ─ threshold head  ┘ opening 3.24 m wide, jambs 0.34 m either side
//   2.82 ─ reveal top                      lintel carries the founder line
//   2.92 ─ datum ledge                     full width, 0.10 m proud
//   3.06 ─ wordmark        ┐
//   4.00 ─               ─ ┘ OPEN REALITY + the tagline, 9.60 m wide
//   4.08 ─ cornice                         full width, 0.12 m proud
//   4.40 ─ ceiling
//
// Plan, left to right:
//
//   -6.44 .. -5.45   margin
//   -5.45 .. -3.16   board: "A spatial AI platform."
//   -3.16 .. -1.96   margin
//   -1.96 .. -1.62   jamb
//   -1.62 ..  1.62   the lit threshold (the trigger's x span is the reveal, 1.96)
//    1.62 ..  1.96   jamb
//    1.96 ..  3.16   margin
//    3.16 ..  5.45   board: "Live 3D scanning from a mobile browser."
//    5.45 ..  6.44   margin
//
// Clearances, all computed against themes/garden.js's own ctx.collide() calls
// and prop footprints, which are what actually fouls:
//   flagstone pavers  nearest run z -1.20 +/- 0.05 jitter, 0.94 deep * <=1.04
//                     scale -> front edge z -0.66; relief reaches z -0.16, so
//                     0.50 m clear, and they are 0.05 m tall with no collider
//   long wall beds    collide() maxZ -2.75  vs relief minZ -0.17  -> 2.58 m
//   near tree boxes   collide() maxZ -3.40  vs relief minZ -0.17  -> 3.23 m
//   pool / bench      collide() maxZ -6.35 / -6.55                -> 6.18 m+
//   skylight bars     nearest bar z -1.65 at y 4.16..4.28; cornice sits at
//                     z -0.12..0, so they share a height band but are 1.53 m
//                     apart in z
//   side-wall skirt   inner face x 6.45 vs installation edge x 6.44 -> 0.01 m,
//                     deliberately flush; they are 0.14 m and 0.20 m tall and
//                     never overlap in x
//   exhibit plates    room 0 hangs its four `about` plates on the SIDE walls at
//                     x +/- 6.48, nearest at z -4.33 — nowhere near this wall
//   centre line       no colliders at all, so x = 0 is walkable by construction

const EDGE_X = 6.44;        // half-width of the installation
const BURY = 0.01;          // relief boxes bury this far into the wall, so no
                            // face of theirs is ever coplanar with the wall's

const PLINTH_Y = 0.20;
const PLINTH_D = 0.16;

const CORNICE_Y0 = 4.08;
const CORNICE_Y1 = 4.24;
const CORNICE_D = 0.12;

const LEDGE_Y0 = 2.92;
const LEDGE_Y1 = 2.98;
const LEDGE_D = 0.10;

const GATE_HALF = 1.62;                    // half the clear opening
const JAMB_W = 0.34;
const GATE_X = GATE_HALF + JAMB_W;         // 1.96 — outer edge of the reveal
const GATE_Y0 = PLINTH_Y;                  // 0.20
const GATE_Y1 = 2.50;
const LINTEL_Y1 = 2.82;
const REVEAL_D = 0.16;

// wordmark strip. Its plane's aspect is locked to its canvas so the type never
// stretches: 2048 x 200 over 9.60 m gives 213 px per metre.
const MARK_TEX_W = 2048;
const MARK_TEX_H = 200;
const MARK_W = 9.60;
const MARK_H = (MARK_W * MARK_TEX_H) / MARK_TEX_W;   // 0.9375
const MARK_CY = 3.53;

// description boards
const BOARD_CX = 4.30;
const BOARD_CY = 1.40;
const PANEL_W = 2.15;
const PANEL_H = 1.55;
const BOARD_PAD = 0.07;
const BOARD_D = 0.055;

// the plate on the lintel face
const STRIP_W = 3.80;
const STRIP_TEX_W = 1792;
const STRIP_TEX_H = 64;
const STRIP_H = (STRIP_W * STRIP_TEX_H) / STRIP_TEX_W;   // 0.1357
const STRIP_CY = (GATE_Y1 + LINTEL_Y1) / 2;              // 2.66

// light spill on the floor and the wash up the wall off the plinth
const SPILL_D = 1.30;
const SPILL_Y = 0.056;      // just clear of the 0.05 m flagstones
const WASH_H = 0.42;

// the description-board atlas. Two 888 px cells side by side with a 16 px
// gutter, and a full-width strip beneath them for the lintel plate — one canvas,
// one material, one merged mesh for all three.
const ATLAS_W = 1792;
const ATLAS_H = 720;
const CELL_W = 888;
const CELL_H = 640;
const CELL_R_X = 904;
const STRIP_Y = 656;

// -----------------------------------------------------------------------------
// TRIGGER
// -----------------------------------------------------------------------------
//
// Occupancy, not plane-crossing: the player is "at the threshold" when they are
// within TRIG_Z0 of the wall face and inside the reveal's x span. Latched, so it
// fires once per entry and re-arms only when they step back out.
//
// Spawn safety, the whole arithmetic:
//   engine.js:48   camera.position.set(0, DIMS.eyeH, -1.8)   spawn z = -1.80
//   controls.js    yaw starts at camera.rotation.y = 0, i.e. facing -Z, which
//                  is AWAY from this wall and down the room
//   trigger        fires only for z >= -1.15
//                  -1.80 is 0.65 m short of that. Booting the museum cannot
//                  open a tab, and the first update() only seeds the latch
//                  anyway, so even a spawn inside the band would be silent.
//   main.js:119    the room-map teleport into the Atrium lands at
//                  roomCenterZ(0) + roomD * 0.32 = -7.50 + 4.80 = -2.70,
//                  a further 1.55 m clear
//   architecture   the k = 0 wall collider is minZ -0.06, so a body of radius
//                  DIMS.bodyR 0.42 is stopped at z = -0.48. The reachable slice
//                  of the trigger band is therefore z [-1.15, -0.48], 0.67 m
//                  deep — more than twice the 0.3145 m a sprinting player covers
//                  in one frame at controls.js's 0.05 s dt clamp
//                  (TUNING.moveSpeed 3.4 * sprintMult 1.85 * 0.05), so it cannot
//                  be tunnelled, and the wall itself stops you inside it.
// TRIG_Z1 is only a guard against a wild teleport; nothing can legally reach it.
const TRIG_X = GATE_X;      // 1.96 — the boards, at |x| >= 3.16, are readable
                            // without being yanked into a new tab
const TRIG_Z0 = -1.15;
const TRIG_Z1 = 0.60;

// Open Reality is near-monochrome with a muted teal/sage accent. The Atrium's
// garden theme is hue 124; pulling to 172 gives the installation its own
// identity while staying in the same family as the room.
const PORTAL_HUE = 172;
const INK_HUE = 176;

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

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

function finish(THREE, canvas, opts = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.wrapT) tex.wrapT = opts.wrapT;
  if (opts.wrapS) tex.wrapS = opts.wrapS;
  tex.anisotropy = 4;       // these are read at a glancing angle as you walk past
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

/** Width of `text` drawn one glyph at a time with `track` px between glyphs. */
function trackedWidth(ctx, text, track) {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += ctx.measureText(text[i]).width;
    if (i < text.length - 1) w += track;
  }
  return w;
}

/** Draw `text` glyph by glyph so the tracking is identical in every browser —
 *  ctx.letterSpacing is still missing from enough engines to be worth avoiding. */
function drawTracked(ctx, text, startX, baseline, track) {
  let x = startX;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, x, baseline);
    x += ctx.measureText(ch).width + track;
  }
}

/**
 * The wordmark strip. Deliberately TRANSPARENT apart from the lettering: the
 * type sits straight on the wall with no plate behind it, which is what makes it
 * read as architecture rather than as a poster stuck to the plaster. Because the
 * material is unlit, the letters are literally the colour baked here, so they
 * flip with the mode — dark on the day wall, light on the night wall.
 */
function wordmarkTexture(THREE, ink, sub) {
  const made = makeCanvas(MARK_TEX_W, MARK_TEX_H);
  if (!made) return null;
  const { canvas, ctx } = made;
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Size the wordmark so that, letterspaced, it fills ~72% of the strip. Solved
  // rather than searched: measure once at a reference size, then scale, since
  // advance widths are linear in font size.
  const title = PORTAL_BRAND.title.toUpperCase();
  const TRACK_EM = 0.20;
  const REF = 100;
  ctx.font = `600 ${REF}px ${FONT}`;
  const refW = trackedWidth(ctx, title, 0) / REF;      // glyph advance per px of size
  const gaps = TRACK_EM * Math.max(0, title.length - 1);
  const target = W * 0.72;
  const size = Math.max(24, Math.min(H * 0.86, target / (refW + gaps)));

  ctx.font = `600 ${size.toFixed(1)}px ${FONT}`;
  ctx.fillStyle = ink;
  const track = size * TRACK_EM;
  const markW = trackedWidth(ctx, title, track);
  drawTracked(ctx, title, (W - markW) / 2, H * 0.62, track);

  // the tagline, centred beneath, shrunk to fit rather than wrapped — one line
  // is what makes it read as a strapline instead of a paragraph
  let subSize = 40;
  ctx.font = `400 ${subSize}px ${FONT}`;
  const maxSub = W * 0.82;
  const subW = ctx.measureText(PORTAL_BRAND.tagline).width;
  if (subW > maxSub) {
    subSize = Math.max(18, subSize * (maxSub / subW));
    ctx.font = `400 ${subSize.toFixed(1)}px ${FONT}`;
  }
  ctx.fillStyle = sub;
  ctx.textAlign = 'center';
  ctx.fillText(PORTAL_BRAND.tagline, W / 2, H * 0.93);

  return finish(THREE, canvas);
}

/**
 * One atlas for all three pieces of running text: the two description boards
 * (opaque plates, so they set their own contrast in both modes) and the lintel
 * plate above the threshold (transparent, so the founder line sits directly on
 * the stone). Three planes, one texture, one merged mesh.
 */
function boardsTexture(THREE, c) {
  const made = makeCanvas(ATLAS_W, ATLAS_H);
  if (!made) return null;
  const { canvas, ctx } = made;

  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  function board(ox, spec) {
    const pad = 54;
    const inner = CELL_W - pad * 2;

    ctx.fillStyle = c.plate;
    ctx.fillRect(ox, 0, CELL_W, CELL_H);

    // a single accent rule along the top edge — the whole of the brand's colour
    ctx.fillStyle = c.accent;
    ctx.fillRect(ox, 0, CELL_W, 7);

    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = c.accent;
    drawTracked(ctx, spec.eyebrow, ox + pad, pad + 34, 3.4);

    ctx.font = `600 40px ${FONT}`;
    ctx.fillStyle = c.paper;
    const head = wrapLines(ctx, spec.head, inner, 3);
    let y = pad + 104;
    for (const line of head) {
      ctx.fillText(line, ox + pad, y);
      y += 50;
    }

    y += 4;
    ctx.fillStyle = c.rule;
    ctx.fillRect(ox + pad, y, inner, 1);

    ctx.font = `400 31px ${FONT}`;
    ctx.fillStyle = c.muted;
    y += 46;
    for (const line of wrapLines(ctx, spec.body, inner, 6)) {
      ctx.fillText(line, ox + pad, y);
      y += 42;
    }

    if (spec.note) {
      ctx.font = `600 27px ${FONT}`;
      ctx.fillStyle = c.accent;
      ctx.fillText(spec.note, ox + pad, CELL_H - pad + 10);
    }
  }

  board(0, {
    eyebrow: 'FOUNDER',
    head: PORTAL_BRAND.founder,
    body: PORTAL_BRAND.whatBody,
    note: PORTAL_BRAND.whatNote,
  });
  board(CELL_R_X, {
    eyebrow: 'THE PLATFORM',
    head: PORTAL_BRAND.platformHead,
    body: PORTAL_BRAND.platformBody,
    note: `${PORTAL_BRAND.urlShort}  →`,
  });

  // the lintel plate: transparent ground, the address over the door, tracked out
  // so a short string still reads as signage across a 3.8 m lintel
  ctx.font = `500 46px ${FONT}`;
  ctx.fillStyle = c.stoneInk;
  const sign = PORTAL_BRAND.urlShort;
  const signTrack = 7;
  drawTracked(ctx, sign, (ATLAS_W - trackedWidth(ctx, sign, signTrack)) / 2,
    STRIP_Y + 48, signTrack);

  return finish(THREE, canvas);
}

/**
 * The threshold: greyscale bands that tile seamlessly in v, so the texture can
 * be scrolled forever without a seam. Greyscale on purpose — the material's
 * colour does the tinting, so the same bitmap serves day and night.
 */
function thresholdTexture(THREE) {
  const made = makeCanvas(128, 512);
  if (!made) return null;
  const { canvas, ctx } = made;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#8c8c8c';
  ctx.fillRect(0, 0, W, H);

  // Integer wave counts keep the pattern periodic over the full height. The map
  // MULTIPLIES the material colour, so it has to sit high: a mid-grey bitmap
  // would halve the teal and the threshold would read as a dirty window rather
  // than as something lit. Bands ride near the top of the range instead.
  // Amplitudes stay low deliberately. Wound up any further the bands stop
  // reading as light moving through a depth and start reading as a roller
  // shutter — regular, hard-edged and industrial, which is the one thing a
  // threshold must not look like.
  const STEP = 2;
  for (let y = 0; y < H; y += STEP) {
    const t = y / H;
    const wave =
      0.88 +
      0.055 * Math.sin(t * Math.PI * 2 * 2) +
      0.035 * Math.sin(t * Math.PI * 2 * 5 + 1.1) +
      0.020 * Math.sin(t * Math.PI * 2 * 11 + 2.7);
    const v = Math.max(0, Math.min(255, Math.round(wave * 255)));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, W, STEP);
  }

  // Edge falloff across u only — u never repeats, so this may be non-periodic.
  const edge = ctx.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.42)');
  edge.addColorStop(0.16, 'rgba(0,0,0,0)');
  edge.addColorStop(0.84, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);

  return finish(THREE, canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.RepeatWrapping });
}

/**
 * A one-dimensional falloff, white at v = 1 and gone at v = 0. Used twice: laid
 * flat it is the light pooling on the flagstones, stood up it is the wash
 * climbing the wall off the plinth.
 */
function spillTexture(THREE) {
  const made = makeCanvas(8, 128);
  if (!made) return null;
  const { canvas, ctx } = made;
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.30)');
  g.addColorStop(0.86, 'rgba(255,255,255,0.80)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  return finish(THREE, canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

// -----------------------------------------------------------------------------

/**
 * Build the Open Reality installation onto the Atrium's entrance wall.
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
  // prefers-color-scheme. Night wants props LIGHTER than the wall, because
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

  // day  l 0.75 * 0.78 = 0.59 — reads as a solid form against a 0.94 wall
  // night l 0.38 * 1.62 = 0.62 — reads as a solid form against a 0.30 wall
  const stone = tone(railHex, PORTAL_HUE, 0.13, 0.78, 1.62);
  // Unlit, so these are literally what you see: day l 0.60, night l 0.66. Night
  // is only a little brighter than day on purpose — pushed any higher the bands
  // clip to white and the threshold stops reading as teal at all.
  const gateHex = tone(glowHex, PORTAL_HUE, 0.40, 0.62, 0.76);
  const spillHex = tone(glowHex, PORTAL_HUE, 0.28, 0.72, 0.86);
  const outlineHex = tone(inkHex, INK_HUE, 0.30, 1.0, 1.0);

  const css = (hex) => `#${(hex >>> 0).toString(16).padStart(6, '0')}`;

  // The boards are unlit and carry small type, so they set their own contrast
  // rather than riding the wall: dark plate, light lettering, in both modes.
  const boardInk = {
    plate: css(tone(inkHex, INK_HUE, 0.24, 1.0, 0.42)),
    paper: css(tone(glowHex, PORTAL_HUE, 0.09, 0.99, 1.06)),
    muted: css(tone(glowHex, PORTAL_HUE, 0.15, 0.80, 0.90)),
    rule: css(tone(glowHex, PORTAL_HUE, 0.10, 0.46, 0.52)),
    accent: css(gateHex),
    // The lintel plate has no ground of its own — it reads against the stone
    // reveal. That stone is a light element in BOTH modes (the whole point of
    // the night multiplier above is that Lambert cannot light a dark prop), so
    // this line stays dark in both; night only needs a push, because the shared
    // night ink is a mid grey that would vanish on it.
    stoneInk: css(tone(inkHex, INK_HUE, 0.24, 1.0, 0.34)),
  };
  // Same reasoning for the wordmark, which sits straight on the wall.
  const markCss = night
    ? css(tone(glowHex, PORTAL_HUE, 0.10, 1.0, 1.04))
    : css(tone(inkHex, INK_HUE, 0.20, 1.0, 1.0));
  const markSubCss = night
    ? css(tone(glowHex, PORTAL_HUE, 0.16, 1.0, 0.80))
    : css(tone(inkHex, INK_HUE, 0.16, 2.9, 1.0));

  const keep = (list, item) => {
    if (item) list.push(item);
    return item;
  };

  // --- geometry helpers -----------------------------------------------------
  // Everything is baked into world space at build time so it can merge.

  /** An axis-aligned box from its bounds. */
  const slab = (x0, x1, y0, y1, z0, z1) =>
    new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
      .translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  /**
   * A plane turned round to face the room. THREE.PlaneGeometry is built looking
   * down +Z, but this wall's interior surface looks down -Z, so every plate has
   * to be flipped or it is back-face culled and simply vanishes.
   *
   * The half-turn is all it needs, and the UVs must be left alone. It moves the
   * u = 1 edge from world +X to world -X, and a viewer looking down +Z sees
   * world -X on their RIGHT — turn to face +Z and the x axis swaps sides —
   * so u still runs left to right on screen. "Correcting" the u axis here is
   * what makes every word on the wall read backwards. The same swap is why the
   * boards below are hung on the opposite x to the atlas cell they carry.
   */
  const wallPlane = (w, h, wSeg, hSeg) =>
    new THREE.PlaneGeometry(w, h, wSeg || 1, hSeg || 1).rotateY(Math.PI);

  /** Turn a gradient the other way up. */
  const flipV = (g) => {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    uv.needsUpdate = true;
    return g;
  };

  /** A wall plane whose UVs are remapped into a sub-rectangle of an atlas, so
   *  several plates can share one canvas and merge into one mesh. Takes canvas
   *  pixels, since that is how the atlas was painted; flipY is on by default for
   *  a CanvasTexture, so canvas row 0 is v = 1. */
  const cell = (w, h, x, y, z, px, py, pw, ph) => {
    const g = wallPlane(w, h);
    const u0 = px / ATLAS_W;
    const u1 = (px + pw) / ATLAS_W;
    const v0 = 1 - (py + ph) / ATLAS_H;
    const v1 = 1 - py / ATLAS_H;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
    uv.needsUpdate = true;
    return g.translate(x, y, z);
  };

  const fuse = (parts, label) => {
    const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!geo) throw new Error(`[museum] portal ${label} merge failed`);
    if (parts.length > 1) for (const g of parts) g.dispose();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  };

  const stat = (mesh) => {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    return mesh;
  };

  // --- 1. the relief: eight boxes, one draw call ----------------------------
  // Nothing here reaches further than REVEAL_D (0.16 m) into the room, and the
  // wall's own collider stops the player 0.48 m short of the face, so none of it
  // is reachable and none of it needs a collider. Each box buries BURY into the
  // wall so no face of the relief is ever coplanar with the wall's own.

  const relief = [
    // plinth and cornice — the full-width bands that make it one object
    slab(-EDGE_X, EDGE_X, 0, PLINTH_Y, -PLINTH_D, BURY),
    slab(-EDGE_X, EDGE_X, CORNICE_Y0, CORNICE_Y1, -CORNICE_D, BURY),
    // the datum ledge under the wordmark
    slab(-EDGE_X, EDGE_X, LEDGE_Y0, LEDGE_Y1, -LEDGE_D, BURY),
    // the threshold reveal: two jambs and a lintel
    slab(-GATE_X, -GATE_HALF, GATE_Y0, LINTEL_Y1, -REVEAL_D, BURY),
    slab(GATE_HALF, GATE_X, GATE_Y0, LINTEL_Y1, -REVEAL_D, BURY),
    slab(-GATE_X, GATE_X, GATE_Y1, LINTEL_Y1, -REVEAL_D, BURY),
    // the two board backings, a hair larger than the plates they carry
    slab(-BOARD_CX - PANEL_W / 2 - BOARD_PAD, -BOARD_CX + PANEL_W / 2 + BOARD_PAD,
      BOARD_CY - PANEL_H / 2 - BOARD_PAD, BOARD_CY + PANEL_H / 2 + BOARD_PAD, -BOARD_D, BURY),
    slab(BOARD_CX - PANEL_W / 2 - BOARD_PAD, BOARD_CX + PANEL_W / 2 + BOARD_PAD,
      BOARD_CY - PANEL_H / 2 - BOARD_PAD, BOARD_CY + PANEL_H / 2 + BOARD_PAD, -BOARD_D, BURY),
  ];

  const reliefGeo = keep(geometries, fuse(relief, 'relief'));
  const stoneMat = keep(materials, new THREE.MeshLambertMaterial({ color: stone }));
  stat(new THREE.Mesh(reliefGeo, stoneMat)).name = 'portal-relief';

  // one outline, matching the sketchbook edges the rest of the museum draws
  const outlineMat = keep(materials, new THREE.LineBasicMaterial({ color: outlineHex }));
  const edgeGeo = keep(geometries, new THREE.EdgesGeometry(reliefGeo, 15));
  stat(new THREE.LineSegments(edgeGeo, outlineMat)).name = 'portal-outline';

  // --- 2. the threshold -----------------------------------------------------
  // A lit plane set 0.15 m behind the reveal's face, so the opening genuinely
  // reads as a recess rather than as a decal. It runs 0.01 m wide of the jambs
  // at each side and under the lintel, which hides the seam.
  const gateMap = keep(textures, thresholdTexture(THREE));
  const gateMat = keep(materials, new THREE.MeshBasicMaterial({
    color: gateHex,
    map: gateMap || null,
    vertexColors: true,
  }));
  const gateGeo = keep(geometries,
    wallPlane(GATE_HALF * 2 + 0.02, GATE_Y1 - GATE_Y0 + 0.02, 1, 6));
  {
    // a static vertical ramp, brightest at the sill: cheaper than a second
    // texture and it survives the scrolling map, which would drag a baked one
    const pos = gateGeo.attributes.position;
    const shade = new Float32Array(pos.count * 3);
    const h = GATE_Y1 - GATE_Y0 + 0.02;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + h / 2) / h;         // 0 at the sill, 1 at the head
      const k = 1.08 - 0.36 * t * t;
      shade[i * 3] = k;
      shade[i * 3 + 1] = k;
      shade[i * 3 + 2] = k;
    }
    gateGeo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    gateGeo.translate(0, (GATE_Y0 + GATE_Y1) / 2, -0.010);
  }
  stat(new THREE.Mesh(gateGeo, gateMat)).name = 'portal-threshold';

  // --- 3. the wordmark ------------------------------------------------------
  const markMap = keep(textures, wordmarkTexture(THREE, markCss, markSubCss));
  if (markMap) {
    const markMat = keep(materials, new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: markMap,
      transparent: true,     // the ground is the wall itself
      depthWrite: false,     // nothing is ever behind it but opaque geometry
      toneMapped: false,
    }));
    const markGeo = keep(geometries,
      wallPlane(MARK_W, MARK_H).translate(0, MARK_CY, -0.012));
    stat(new THREE.Mesh(markGeo, markMat)).name = 'portal-wordmark';
  }

  // --- 4. the description boards and the lintel plate -----------------------
  // Three plates, one atlas, one mesh. The board plates are painted opaque and
  // sit 7 mm proud of their backings; the lintel plate is painted on a clear
  // ground and sits 7 mm proud of the lintel face.
  const boardsMap = keep(textures, boardsTexture(THREE, boardInk));
  if (boardsMap) {
    const boardsMat = keep(materials, new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: boardsMap,
      transparent: true,     // for the lintel plate's clear ground
      depthWrite: false,
      toneMapped: false,
    }));
    // Hung on the opposite x to the cell they carry: a visitor facing this wall
    // is looking down +Z, so world +X is on their left. Atlas cell 0 — the one
    // that answers "what is it" — therefore goes on the +X board, and is the
    // first thing read.
    const boardsGeo = keep(geometries, fuse([
      cell(PANEL_W, PANEL_H, BOARD_CX, BOARD_CY, -BOARD_D - 0.007, 0, 0, CELL_W, CELL_H),
      cell(PANEL_W, PANEL_H, -BOARD_CX, BOARD_CY, -BOARD_D - 0.007, CELL_R_X, 0, CELL_W, CELL_H),
      cell(STRIP_W, STRIP_H, 0, STRIP_CY, -REVEAL_D - 0.007, 0, STRIP_Y, ATLAS_W, STRIP_TEX_H),
    ], 'boards'));
    stat(new THREE.Mesh(boardsGeo, boardsMat)).name = 'portal-boards';
  }

  // --- 5. the light it throws -----------------------------------------------
  // Two quads on one gradient: the pool on the flagstones in front of the
  // threshold, and the wash climbing the wall off the plinth. Both fade to
  // nothing, so neither has a visible edge except where the plinth already ends.
  const spillMap = keep(textures, spillTexture(THREE));
  const spillMat = keep(materials, new THREE.MeshBasicMaterial({
    color: spillHex,
    map: spillMap || null,
    transparent: true,
    opacity: 0.30,
    depthWrite: false,
  }));
  const poolGeo = new THREE.PlaneGeometry(GATE_X * 2, SPILL_D);
  poolGeo.rotateX(-Math.PI / 2);            // lie it flat, facing up
  flipV(poolGeo);                           // v = 1 now sits against the wall
  poolGeo.translate(0, SPILL_Y, -SPILL_D / 2);
  const washGeo = wallPlane(EDGE_X * 2, WASH_H);
  flipV(washGeo);                           // v = 1 now sits on the plinth
  washGeo.translate(0, PLINTH_Y + WASH_H / 2, -0.012);
  const spillGeo = keep(geometries, fuse([poolGeo, washGeo], 'spill'));
  stat(new THREE.Mesh(spillGeo, spillMat)).name = 'portal-spill';

  // --- parent in ------------------------------------------------------------
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  if (roomGroup && typeof roomGroup.add === 'function') roomGroup.add(group);

  // --- colliders ------------------------------------------------------------
  // None, deliberately. The wall is already solid — architecture.js emits a
  // full-width collider for the k = 0 boundary — and nothing here protrudes far
  // enough into the room for the player to reach it. Adding one would only make
  // the wall thicker and could crowd the x = 0 walkway smoke-test.mjs asserts.
  const colliders = [];

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
  // Color.setRGB with the default (working) colour space is a plain field
  // assignment, so the breathing costs nothing either.
  // -------------------------------------------------------------------------

  const gateR = gateMat.color.r;
  const gateG = gateMat.color.g;
  const gateB = gateMat.color.b;

  let clock = 0;
  let inside = false;
  let seeded = false;
  let disposed = false;

  function update(dt, playerPosition) {
    if (disposed) return;

    const step = typeof dt === 'number' && Number.isFinite(dt) ? dt : 0;
    clock += step;

    // drift + breathe: numbers only, no new objects
    if (gateMap) gateMap.offset.y = -((clock * 0.045) % 1);
    const k = 0.93 + 0.07 * Math.sin(clock * 0.9);
    gateMat.color.setRGB(gateR * k, gateG * k, gateB * k);
    spillMat.opacity = 0.27 + 0.08 * Math.sin(clock * 0.9 + 2.1);

    if (!playerPosition) return;
    const px = playerPosition.x;
    const pz = playerPosition.z;
    const now = px >= -TRIG_X && px <= TRIG_X && pz >= TRIG_Z0 && pz <= TRIG_Z1;

    // The first sample only seeds the latch: if main.js ever drops the player
    // straight onto the threshold (a map teleport, a #hash deep link) they
    // should not be thrown into a new tab before they have taken a step.
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
