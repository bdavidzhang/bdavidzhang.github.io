// exhibits.js — the framed plates hanging on the walls.
//
// Every exhibit becomes: a thin frame box + a face plane carrying a canvas
// texture we draw ourselves (title, meta, wrapped blurb, tag chips, accent bar).
// The face is the only raycast target; sub-meshes stay out of `targets` so the
// picker in main.js walks a short list.
//
// Performance strategy:
//   * ONE BoxGeometry and ONE PlaneGeometry shared by every plate — the per-plate
//     transform lives in mesh.scale/position, never in a cloned geometry.
//   * one MeshLambertMaterial shared by every frame at rest. A plate only gets
//     its own frame material the first time it is looked at (so the emissive can
//     be animated per plate), and it is cached from then on.
//   * static parts have matrixAutoUpdate = false and are composed once. Only the
//     handful of plates mid-transition recompute a matrix on a given frame.
//   * no shadows, no transparency, no per-frame allocation.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, CSS, DIMS, isDark, roomCenterZ } from './config.js';

const BASE = new URL('../', import.meta.url); // site root — museum.html lives there

// --- plate geometry (metres) -------------------------------------------------

// Canvas texture size. Every plate carries its own texture, so this number is
// multiplied by the exhibit count: at 512x640 the 24 plates cost ~40 MB of VRAM
// once mipmaps are included, which is far more than a wall label needs. The
// plate only has to be legible enough to decide whether to press E — the real
// reading happens in the DOM panel — so 384x480 (~24 MB) is the desktop budget
// and coarse-pointer devices drop to 256x320 (~10 MB).
const HI_RES = !(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
const CARD_W = HI_RES ? 384 : 256;
const CARD_H = HI_RES ? 480 : 320;
const CARD_ASPECT = CARD_W / CARD_H;
const DESIGN_W = 512;             // the card layout is authored at this width and
                                  // scaled to whatever CARD_W ends up being
const PHOTO_ASPECT = 1;           // portrait plates are square
const FRAME_BORDER = 0.055;       // frame visible around the face, per side
const FRAME_DEPTH = 0.05;         // how far the frame stands off the wall
const FACE_GAP = 0.004;           // face sits just proud of the frame
const SLOT_FILL = 0.94;           // fraction of the anchor slot a plate may use
const FALLBACK_W = 1.6;
const FALLBACK_H = 1.2;

// --- focus feedback ----------------------------------------------------------

const LIFT_DIST = 0.02;           // metres off the wall when focused
const LIFT_SCALE = 1.03;
const FOCUS_RATE = 9.5;           // exponential damping, per second
const FRAME_GLOW = 0.55;          // frame emissive at full focus
const FACE_GLOW = 0.1;            // face emissive at full focus

// --- lecterns (kind: 'link') --------------------------------------------------
//
// A link is not something you read, it is somewhere you go — so it gets a
// standing lectern with a lit button rather than a card hung on the wall. The
// lectern parks in front of its wall anchor, which is the one strip of floor a
// theme is already required to keep clear (themes derive their bays from
// `ctx.anchors`), so it never lands inside the furniture.
//
// Local space matches a plate's: +Z points into the room, +X runs along the
// wall, y = 0 is the floor.
const LECT_OFFSET = 0.66;         // metres from the anchor plane into the room
const LECT_TILT = 0.42;           // radians the head is tilted back toward the eye
const LECT_HEAD_Y = 1.07;
const LECT_HEAD_Z = 0.015;
const LECT_HEAD_T = 0.10;         // head thickness, so the face clears it
const LECT_FACE_W = 0.60;
const LECT_FACE_H = 0.375;
const LECT_HALF_W = 0.36;         // collider half-extents (along the wall / into the room)
const LECT_HALF_D = 0.30;
const LECT_BTN_R = 0.05;

// Landscape label — a lectern is read at a glance and from above, so the card is
// wider and carries far less text than a wall plate.
const LINK_W = HI_RES ? 512 : 320;
const LINK_H = HI_RES ? 320 : 200;
const LINK_DESIGN_W = 512;

const KIND_LABEL = {
  about: 'About',
  essay: 'Essay',
  publication: 'Publication',
  math: 'Note',
  podcast: 'Episode',
  log: 'Logbook',
  link: 'Elsewhere',
};

// ---------------------------------------------------------------------------
// canvas text helpers
// ---------------------------------------------------------------------------

// Anything in these blocks may break between any two characters; everything else
// breaks on whitespace only.
const CJK = /[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

// Punctuation that may never open a line (the common half of kinsoku).
const NO_BREAK_BEFORE = /[、。，；：？！）》」』】〉％”’…]/;

/**
 * Split into break-opportunity tokens: whitespace-delimited words, plus one
 * token per CJK glyph. `glue` records whether a token was flush against its
 * predecessor in the source, so rejoining never invents or eats a space — a
 * mixed title keeps the spaces it was written with and a tight CJK run keeps
 * none.
 */
function tokenize(text) {
  const out = [];
  let buf = '';
  let glue = true;
  let space = false;
  const flush = () => { if (buf) { out.push({ s: buf, glue }); buf = ''; } };

  for (const ch of String(text)) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      flush();
      space = true;
    } else if (NO_BREAK_BEFORE.test(ch) && (buf || out.length)) {
      if (buf) buf += ch;                    // rides along with the current word
      else out[out.length - 1].s += ch;      // ...or with the glyph in front of it
    } else if (CJK.test(ch)) {
      flush();
      out.push({ s: ch, glue: !space });
      space = false;
    } else {
      if (!buf) { glue = !space; space = false; }
      buf += ch;
    }
  }
  flush();
  return out;
}

/** Append a token to a line, restoring the spacing the source had. */
const joinTokens = (line, token) =>
  (line ? (token.glue ? line + token.s : `${line} ${token.s}`) : token.s);

/** Trim `text` until it plus an ellipsis fits inside `maxWidth`. */
function ellipsise(ctx, text, maxWidth) {
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s.replace(/[\s,;:·—–-]+$/, '')}…`;
}

/**
 * Greedy word wrap. Returns at most `maxLines` lines; if the text does not fit,
 * the final line is ellipsised so there is never a clipped half-line.
 */
function wrapText(ctx, text, maxWidth, maxLines) {
  const out = [];
  if (!text || maxLines < 1 || maxWidth <= 0) return out;

  const tokens = tokenize(text);
  let line = '';
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    const candidate = joinTokens(line, token);
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      i++;
      continue;
    }
    if (!line) {
      // a single token wider than the whole line — hard-break it by character
      if (token.s.length <= 1) { line = token.s; i++; continue; }
      let n = token.s.length - 1;
      while (n > 1 && ctx.measureText(token.s.slice(0, n)).width > maxWidth) n--;
      tokens.splice(i, 1, { s: token.s.slice(0, n), glue: token.glue }, { s: token.s.slice(n), glue: true });
      continue;
    }
    if (out.length === maxLines - 1) {        // no room for another line
      out.push(ellipsise(ctx, line, maxWidth));
      return out;
    }
    out.push(line);
    line = '';
  }

  if (line) out.push(line);
  return out;
}

/** One line, ellipsised if it overflows. */
function fitLine(ctx, text, maxWidth) {
  if (!text) return '';
  const s = String(text);
  return ctx.measureText(s).width <= maxWidth ? s : ellipsise(ctx, s, maxWidth);
}

function accentCss(hue, light) {
  const h = Number.isFinite(hue) ? hue : 210;
  return isDark ? `hsl(${h}, 72%, ${light || 66}%)` : `hsl(${h}, 62%, ${light || 42}%)`;
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function roundedPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);   // old browsers get square chips, nothing worse
}

// ---------------------------------------------------------------------------
// the card itself
// ---------------------------------------------------------------------------

/**
 * Draw an exhibit card onto `canvas`. The 2D context is acquired and dropped
 * here so nothing holds onto it once the texture has been uploaded.
 */
function drawCard(canvas, exhibit, hue) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const u = (n) => n * (W / DESIGN_W);      // every size below is authored at DESIGN_W
  const PAD = u(42);
  const maxW = W - PAD * 2;
  const spacedText = 'letterSpacing' in ctx;
  const sans = 'Inter, system-ui, sans-serif';

  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // matte + hairline border
  ctx.fillStyle = CSS.matte;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = CSS.rule;
  ctx.lineWidth = Math.max(1, u(2));
  ctx.strokeRect(1, 1, W - 2, H - 2);

  const accent = accentCss(hue);
  let y = PAD;

  // accent bar — the one thing that differs room to room at a glance
  ctx.fillStyle = accent;
  ctx.fillRect(PAD, y, u(92), Math.max(1, u(8)));
  y += u(8 + 26);

  // kind label
  ctx.font = `600 ${u(19)}px ${sans}`;
  ctx.fillStyle = accent;
  if (spacedText) ctx.letterSpacing = `${u(3)}px`;
  ctx.fillText(fitLine(ctx, (KIND_LABEL[exhibit.kind] || 'Exhibit').toUpperCase(), maxW), PAD, y);
  if (spacedText) ctx.letterSpacing = '0px';
  y += u(24 + 16);

  // title — up to four lines
  ctx.font = `600 ${u(40)}px ${sans}`;
  ctx.fillStyle = CSS.ink;
  const titleLines = wrapText(ctx, exhibit.title || 'Untitled', maxW, 4);
  for (let i = 0; i < titleLines.length; i++) {
    ctx.fillText(titleLines[i], PAD, y);
    y += u(47);
  }
  y += u(10);

  // meta
  if (exhibit.meta) {
    ctx.font = `400 ${u(22)}px ${sans}`;
    ctx.fillStyle = CSS.inkSoft;
    ctx.fillText(fitLine(ctx, exhibit.meta, maxW), PAD, y);
    y += u(30);
  }

  // rule
  ctx.fillStyle = CSS.rule;
  ctx.fillRect(PAD, y + u(8), maxW, Math.max(1, u(1)));
  y += u(8 + 1 + 24);

  // tag chips are pinned to the bottom, so the blurb knows what room it has
  const tags = Array.isArray(exhibit.tags) ? exhibit.tags.filter(Boolean).slice(0, 3) : [];
  const chipH = u(34);
  const chipY = H - PAD - chipH;
  const floor = tags.length ? chipY - u(22) : H - PAD;

  // blurb — as many whole lines as fit, ellipsised at the cut
  if (exhibit.blurb) {
    ctx.font = `400 ${u(25)}px ${sans}`;
    ctx.fillStyle = CSS.inkSoft;
    const lineH = u(34);
    const lines = wrapText(ctx, exhibit.blurb, maxW, Math.max(0, Math.floor((floor - y) / lineH)));
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], PAD, y);
      y += lineH;
    }
  }

  if (tags.length) {
    ctx.font = `500 ${u(19)}px ${sans}`;
    ctx.lineWidth = Math.max(1, u(1.5));
    let x = PAD;
    for (const tag of tags) {
      const label = fitLine(ctx, String(tag), u(190));
      const w = ctx.measureText(label).width + u(28);
      if (x + w > W - PAD) break;
      ctx.strokeStyle = CSS.rule;
      roundedPath(ctx, x, chipY, w, chipH, chipH / 2);
      ctx.stroke();
      ctx.fillStyle = CSS.inkSoft;
      ctx.fillText(label, x + u(14), chipY + u(8));
      x += w + u(10);
    }
  }
}

/** Composite a loaded portrait over the matte so its alpha never shows black. */
function drawPortrait(canvas, image, exhibit, hue) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const W = canvas.width;
  const H = canvas.height;
  const u = (n) => n * (W / DESIGN_W);
  const PAD = u(31);
  const sans = 'Inter, system-ui, sans-serif';

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = CSS.matte;
  ctx.fillRect(0, 0, W, H);

  const capH = u(74);
  const boxW = W - PAD * 2;
  const boxH = H - PAD * 2 - capH;
  const scale = Math.min(boxW / image.width, boxH / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, PAD + (boxW - dw) / 2, PAD + (boxH - dh) / 2, dw, dh);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `600 ${u(32)}px ${sans}`;
  ctx.fillStyle = CSS.ink;
  ctx.fillText(fitLine(ctx, exhibit.title || '', boxW), W / 2, H - PAD - capH + u(6));
  ctx.font = `400 ${u(21)}px ${sans}`;
  ctx.fillStyle = CSS.inkSoft;
  ctx.fillText(fitLine(ctx, exhibit.meta || '', boxW), W / 2, H - PAD - capH + u(44));

  ctx.fillStyle = accentCss(hue);
  ctx.fillRect(W / 2 - u(46), H - PAD - capH - u(14), u(92), Math.max(1, u(6)));

  ctx.strokeStyle = CSS.rule;
  ctx.lineWidth = Math.max(1, u(2));
  ctx.strokeRect(1, 1, W - 2, H - 2);
  return true;
}

/**
 * Draw a lectern label. Deliberately sparser than `drawCard`: a lectern is read
 * from above while walking up to it, so it carries the destination and the fact
 * that it leaves the museum, and nothing else.
 */
function drawLinkFace(canvas, exhibit, hue) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const u = (n) => n * (W / LINK_DESIGN_W);
  const PAD = u(40);
  const maxW = W - PAD * 2;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = CSS.matte;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = CSS.rule;
  ctx.lineWidth = Math.max(1, u(2));
  ctx.strokeRect(u(1), u(1), W - u(2), H - u(2));

  const accent = accentCss(hue);

  // accent bar, matching the wall plates so the two read as one system
  ctx.fillStyle = accent;
  ctx.fillRect(PAD, u(38), u(92), u(8));

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CSS.inkSoft;
  ctx.font = `600 ${u(20)}px Inter, system-ui, sans-serif`;
  const kind = (KIND_LABEL[exhibit.kind] || 'Elsewhere').toUpperCase();
  ctx.letterSpacing = `${u(2.4)}px`;
  ctx.fillText(fitLine(ctx, kind, maxW), PAD, u(84));
  ctx.letterSpacing = '0px';

  ctx.fillStyle = CSS.ink;
  ctx.font = `600 ${u(58)}px Inter, system-ui, sans-serif`;
  ctx.fillText(fitLine(ctx, exhibit.title || 'Untitled', maxW), PAD, u(160));

  if (exhibit.meta) {
    ctx.fillStyle = CSS.inkSoft;
    ctx.font = `400 ${u(26)}px Inter, system-ui, sans-serif`;
    ctx.fillText(fitLine(ctx, exhibit.meta, maxW), PAD, u(206));
  }

  ctx.strokeStyle = CSS.rule;
  ctx.lineWidth = Math.max(1, u(1.5));
  ctx.beginPath();
  ctx.moveTo(PAD, u(240));
  ctx.lineTo(W - PAD, u(240));
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = `600 ${u(21)}px Inter, system-ui, sans-serif`;
  ctx.letterSpacing = `${u(1.8)}px`;
  ctx.fillText(fitLine(ctx, 'PRESS E · OPENS IN A NEW TAB ↗', maxW), PAD, u(280));
  ctx.letterSpacing = '0px';
}

function tuneTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// module-scope scratch — update() must never allocate
// ---------------------------------------------------------------------------

const _accent = new THREE.Color(PALETTE.accent);
const _mWorld = new THREE.Matrix4();
const _mLocal = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _one = new THREE.Vector3(1, 1, 1);
const _fwd = new THREE.Vector3();
const _spot = new THREE.Vector3();

/** Park `child` at a world position/yaw while parenting it under `parent`. */
function placeInParent(parent, child, position, rotationY) {
  _pos.set(position.x || 0, position.y || 0, position.z || 0);
  _euler.set(0, rotationY || 0, 0, 'YXZ');
  _quat.setFromEuler(_euler);
  _mWorld.compose(_pos, _quat, _one);

  parent.updateWorldMatrix(true, false);
  _mLocal.copy(parent.matrixWorld).invert().multiply(_mWorld);
  _mLocal.decompose(child.position, child.quaternion, child.scale);

  child.matrixAutoUpdate = false;
  child.updateMatrix();
  child.matrixWorldNeedsUpdate = true;
  parent.add(child);
}

/**
 * Anchors of last resort. architecture.js always supplies at least as many
 * anchors as a room has exhibits, but a mismatched room id or a hand-built
 * `world` must not silently swallow content.
 */
function fallbackAnchor(roomIndex, slot) {
  const side = slot % 2 === 0 ? -1 : 1;
  const step = Math.floor(slot / 2);
  const halfW = DIMS.roomW / 2 - 0.02;
  const z = roomCenterZ(roomIndex) + DIMS.roomD * 0.3 - step * 2.4;
  return {
    position: new THREE.Vector3(side * halfW, 1.75, z),
    rotationY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
    width: FALLBACK_W,
    height: FALLBACK_H,
    wall: side < 0 ? 'left' : 'right',
  };
}

function anchorsFor(world, room, index) {
  const src = world && world.anchors;
  if (!src) return null;
  const key = String(room.id != null ? room.id : index);
  const list = typeof src.get === 'function' ? src.get(key) : src[key];
  return Array.isArray(list) ? list : null;
}

// ---------------------------------------------------------------------------

/**
 * @param {Array<{id, title, accentHue, exhibits: Array}>} rooms
 * @param {{group, colliders, anchors: Map, roomGroups: Array}} world
 * @returns {{group: THREE.Group, targets: THREE.Mesh[], update: Function, dispose: Function}}
 */
export function buildExhibits(rooms, world) {
  const list = Array.isArray(rooms) ? rooms : [];
  const roomGroups = (world && world.roomGroups) || [];

  const group = new THREE.Group();
  group.name = 'museum-exhibits';
  group.matrixAutoUpdate = false;
  group.updateMatrix();

  // one geometry per shape for the whole museum; plates differ only by transform
  const frameGeo = new THREE.BoxGeometry(1, 1, 1);
  const faceGeo = new THREE.PlaneGeometry(1, 1);
  const frameRest = new THREE.MeshLambertMaterial({
    color: PALETTE.frame,
    emissive: 0x000000,
  });

  // Lectern parts, shared by every link exhibit. The body is one merged geometry
  // so a lectern costs three draw calls — body, label, button — not five. Built
  // lazily: a museum with no link exhibits should not pay for the merge.
  let lecternBodyGeo = null;
  function bodyGeo() {
    if (lecternBodyGeo) return lecternBodyGeo;
    const parts = [
      new THREE.BoxGeometry(0.62, 0.09, 0.48).translate(0, 0.045, 0),      // plinth
      new THREE.BoxGeometry(0.40, 0.94, 0.30).translate(0, 0.56, 0),       // column
      new THREE.BoxGeometry(0.72, LECT_HEAD_T, 0.54)                       // head
        .rotateX(LECT_TILT).translate(0, LECT_HEAD_Y, LECT_HEAD_Z),
    ];
    lecternBodyGeo = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    // mergeGeometries returns null if attribute sets disagree; these are all
    // indexed BoxGeometry so it cannot, but a lectern-shaped hole in the room
    // is a worse failure than a plain box.
    if (!lecternBodyGeo) lecternBodyGeo = new THREE.BoxGeometry(0.5, 1.1, 0.4).translate(0, 0.55, 0);
    return lecternBodyGeo;
  }
  const buttonGeo = new THREE.CylinderGeometry(LECT_BTN_R, LECT_BTN_R, 0.022, 14)
    .rotateX(Math.PI / 2);          // lies flat against the column's front face
  const bodyMat = new THREE.MeshLambertMaterial({ color: PALETTE.frame, emissive: 0x000000 });
  const buttonRest = new THREE.MeshLambertMaterial({ color: PALETTE.rail, emissive: 0x000000 });

  const textures = new Set();
  const materials = new Set([frameRest, bodyMat, buttonRest]);
  const plates = [];
  const targets = [];
  const colliders = [];             // lecterns are solid; wall plates are not
  const plateAnchors = [];          // anchors actually occupied by a flat plate
  const refresh = [];               // redraw hooks, run once webfonts land
  let disposed = false;

  const loader = new THREE.TextureLoader();

  // --- portrait swap ---------------------------------------------------------

  function applyPortrait(plate, exhibit, hue) {
    let url;
    try { url = new URL(exhibit.image, BASE).href; } catch { return; }

    loader.load(url, (tex) => {
      if (disposed || plate.disposed) { tex.dispose(); return; }
      const img = tex.image;
      const drawable = img && img.width > 0 && img.height > 0;
      const old = plate.faceMat.map;

      let next = null;
      if (drawable) {
        // me_circle.png is a circular cut-out with a transparent surround, so it
        // is composited over the matte rather than hung with its alpha intact
        const canvas = makeCanvas(CARD_W, CARD_W);
        if (drawPortrait(canvas, img, exhibit, hue)) {
          next = tuneTexture(new THREE.CanvasTexture(canvas));
          tex.dispose();                    // the composite owns the pixels now
        }
      }
      if (!next) {
        next = tuneTexture(tex);            // couldn't composite — hang it as-is
        plate.faceMat.transparent = true;
      }

      textures.add(next);
      plate.faceMat.map = next;
      plate.faceMat.needsUpdate = true;
      if (old) { textures.delete(old); old.dispose(); }
    }, undefined, () => { /* keep the generated card */ });
  }

  // --- one plate -------------------------------------------------------------

  function buildPlate(exhibit, anchor, hue, parent) {
    const usePhoto = Boolean(exhibit.image);
    const aspect = usePhoto ? PHOTO_ASPECT : CARD_ASPECT;

    // fit the card's aspect inside the slot, leaving room for the frame border
    const slotW = Math.max(0.4, Number(anchor.width) || FALLBACK_W);
    const slotH = Math.max(0.4, Number(anchor.height) || FALLBACK_H);
    let w = Math.max(0.2, slotW * SLOT_FILL - FRAME_BORDER * 2);
    let h = Math.max(0.2, slotH * SLOT_FILL - FRAME_BORDER * 2);
    if (w / h > aspect) w = h * aspect; else h = w / aspect;

    const canvas = makeCanvas(CARD_W, usePhoto ? CARD_W : CARD_H);
    drawCard(canvas, exhibit, hue);
    const cardTex = tuneTexture(new THREE.CanvasTexture(canvas));
    textures.add(cardTex);

    const faceMat = new THREE.MeshLambertMaterial({ map: cardTex, emissive: 0x000000 });
    materials.add(faceMat);

    const pivot = new THREE.Group();
    pivot.name = `plate-${exhibit.id}`;
    const lift = new THREE.Group();     // the only thing that moves on focus
    lift.matrixAutoUpdate = false;
    lift.updateMatrix();
    pivot.add(lift);

    // frame: one box, back face flush with the anchor plane
    const frame = new THREE.Mesh(frameGeo, frameRest);
    frame.scale.set(w + FRAME_BORDER * 2, h + FRAME_BORDER * 2, FRAME_DEPTH);
    frame.position.set(0, 0, FRAME_DEPTH / 2);
    frame.matrixAutoUpdate = false;
    frame.updateMatrix();

    const face = new THREE.Mesh(faceGeo, faceMat);
    face.scale.set(w, h, 1);
    face.position.set(0, 0, FRAME_DEPTH + FACE_GAP);
    face.matrixAutoUpdate = false;
    face.updateMatrix();
    face.userData.exhibit = exhibit;

    lift.add(frame, face);
    placeInParent(parent, pivot, anchor.position, anchor.rotationY);

    const plate = {
      exhibit, pivot, lift, frame, face, faceMat,
      restMat: frameRest,
      hotMat: null,     // per-plate frame material, cloned on first focus
      t: 0,             // 0 at rest, 1 fully focused
      target: 0,
      active: false,
      disposed: false,
      liftY: 0,         // a plate leans out of the wall…
      liftZ: LIFT_DIST,
    };
    face.userData.plate = plate;

    // one raycast target per exhibit — the face, never the frame
    targets.push(face);
    plates.push(plate);
    plateAnchors.push(anchor);

    refresh.push(() => {
      if (plate.disposed || plate.faceMat.map !== cardTex) return;
      drawCard(canvas, exhibit, hue);
      cardTex.needsUpdate = true;
    });

    if (usePhoto) applyPortrait(plate, exhibit, hue);
    return plate;
  }

  // --- one lectern -----------------------------------------------------------

  function buildLectern(exhibit, anchor, hue, parent) {
    const canvas = makeCanvas(LINK_W, LINK_H);
    drawLinkFace(canvas, exhibit, hue);
    const cardTex = tuneTexture(new THREE.CanvasTexture(canvas));
    textures.add(cardTex);

    const faceMat = new THREE.MeshLambertMaterial({ map: cardTex, emissive: 0x000000 });
    materials.add(faceMat);

    const pivot = new THREE.Group();
    pivot.name = `lectern-${exhibit.id}`;
    const lift = new THREE.Group();
    lift.matrixAutoUpdate = false;
    lift.updateMatrix();
    pivot.add(lift);

    const body = new THREE.Mesh(bodyGeo(), bodyMat);
    body.matrixAutoUpdate = false;
    body.updateMatrix();

    // the head's outward normal, and the label parked just proud of it
    const nY = Math.cos(LECT_TILT);
    const nZ = Math.sin(LECT_TILT);
    const off = LECT_HEAD_T / 2 + 0.006;

    const face = new THREE.Mesh(faceGeo, faceMat);
    face.scale.set(LECT_FACE_W, LECT_FACE_H, 1);
    face.position.set(0, LECT_HEAD_Y + nY * off, LECT_HEAD_Z + nZ * off);
    face.rotation.set(LECT_TILT - Math.PI / 2, 0, 0);   // lie the plane on the head
    face.matrixAutoUpdate = false;
    face.updateMatrix();
    face.userData.exhibit = exhibit;

    const button = new THREE.Mesh(buttonGeo, buttonRest);
    button.position.set(0, 0.86, 0.158);
    button.matrixAutoUpdate = false;
    button.updateMatrix();

    lift.add(body, face, button);

    // stand it in front of the anchor rather than on it
    _fwd.set(Math.sin(anchor.rotationY || 0), 0, Math.cos(anchor.rotationY || 0));
    _spot.copy(anchor.position).addScaledVector(_fwd, LECT_OFFSET);
    _spot.y = 0;
    placeInParent(parent, pivot, _spot, anchor.rotationY);

    // world-space AABB, correct for any yaw rather than just the axis-aligned walls
    const ax = Math.abs(_fwd.x);
    const az = Math.abs(_fwd.z);
    const halfX = az * LECT_HALF_W + ax * LECT_HALF_D;
    const halfZ = ax * LECT_HALF_W + az * LECT_HALF_D;
    colliders.push({
      minX: _spot.x - halfX, maxX: _spot.x + halfX,
      minZ: _spot.z - halfZ, maxZ: _spot.z + halfZ,
    });

    const plate = {
      exhibit, pivot, lift, frame: button, face, faceMat,
      restMat: buttonRest,
      hotMat: null,
      t: 0,
      target: 0,
      active: false,
      disposed: false,
      liftY: LIFT_DIST, // …a lectern rises off the floor instead
      liftZ: 0,
    };
    face.userData.plate = plate;

    targets.push(face);
    plates.push(plate);

    refresh.push(() => {
      if (plate.disposed || plate.faceMat.map !== cardTex) return;
      drawLinkFace(canvas, exhibit, hue);
      cardTex.needsUpdate = true;
    });

    return plate;
  }

  // --- hang everything -------------------------------------------------------

  for (let i = 0; i < list.length; i++) {
    const room = list[i] || {};
    const exhibits = Array.isArray(room.exhibits) ? room.exhibits : [];
    if (!exhibits.length) continue;

    const parent = roomGroups[i] || group;
    const anchors = anchorsFor(world, room, i);
    if (!anchors && exhibits.length) {
      console.warn(`[museum] no anchors for room "${room.id}", using fallback placement`);
    }

    for (let k = 0; k < exhibits.length; k++) {
      const exhibit = exhibits[k];
      if (!exhibit) continue;
      const anchor = (anchors && anchors[k]) || fallbackAnchor(i, k);
      // links are somewhere to go, not something to read — they stand up off the
      // floor as a pressable lectern instead of hanging on the wall
      if (exhibit.kind === 'link') buildLectern(exhibit, anchor, room.accentHue, parent);
      else buildPlate(exhibit, anchor, room.accentHue, parent);
    }
  }

  // Webfonts usually land after boot; redraw once so the plates pick up Inter
  // instead of the system fallback. Costs one pass, only when it matters.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    let needed = true;
    try { needed = !document.fonts.check('600 40px Inter'); } catch { needed = true; }
    if (needed) {
      document.fonts.ready.then(() => {
        if (disposed) return;
        for (const fn of refresh) fn();
      }).catch(() => {});
    }
  }

  // --- per-frame -------------------------------------------------------------

  const animating = [];
  let focusPlate = null;

  function wake(plate) {
    if (plate.active) return;
    plate.active = true;
    animating.push(plate);
  }

  function update(dt, camera, focusedObject) {
    const next = (focusedObject && focusedObject.userData && focusedObject.userData.plate) || null;

    if (next !== focusPlate) {
      if (focusPlate) { focusPlate.target = 0; wake(focusPlate); }
      focusPlate = next;
      if (focusPlate) {
        focusPlate.target = 1;
        // per-plate frame material, made once and kept, so two plates can fade
        // in opposite directions without sharing an emissive
        if (!focusPlate.hotMat) {
          focusPlate.hotMat = focusPlate.restMat.clone();
          materials.add(focusPlate.hotMat);
        }
        focusPlate.frame.material = focusPlate.hotMat;
        wake(focusPlate);
      }
    }

    if (!animating.length) return;

    const k = 1 - Math.exp(-FOCUS_RATE * Math.max(dt, 0));
    for (let i = animating.length - 1; i >= 0; i--) {
      const p = animating[i];
      p.t += (p.target - p.t) * k;
      const settled = Math.abs(p.target - p.t) < 0.002;
      if (settled) p.t = p.target;

      const e = p.t * p.t * (3 - 2 * p.t);           // smoothstep
      p.lift.position.set(0, p.liftY * e, p.liftZ * e);
      p.lift.scale.setScalar(1 + (LIFT_SCALE - 1) * e);
      p.lift.updateMatrix();
      p.lift.matrixWorldNeedsUpdate = true;

      p.faceMat.emissive.copy(_accent).multiplyScalar(FACE_GLOW * e);
      if (p.hotMat) p.hotMat.emissive.copy(_accent).multiplyScalar(FRAME_GLOW * e);

      if (settled) {
        p.active = false;
        if (p.t === 0) p.frame.material = p.restMat;  // back to the shared one
        animating[i] = animating[animating.length - 1];
        animating.pop();
      }
    }
  }

  // --- teardown --------------------------------------------------------------

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const plate of plates) {
      plate.disposed = true;
      plate.lift.clear();
      if (plate.pivot.parent) plate.pivot.parent.remove(plate.pivot);
      plate.pivot.clear();
    }
    for (const tex of textures) tex.dispose();
    for (const mat of materials) mat.dispose();
    frameGeo.dispose();
    faceGeo.dispose();
    buttonGeo.dispose();
    if (lecternBodyGeo) { lecternBodyGeo.dispose(); lecternBodyGeo = null; }
    textures.clear();
    materials.clear();
    plates.length = 0;
    targets.length = 0;
    colliders.length = 0;
    plateAnchors.length = 0;
    animating.length = 0;
    refresh.length = 0;
    focusPlate = null;
    group.clear();
    if (group.parent) group.parent.remove(group);
  }

  return { group, targets, colliders, plateAnchors, update, dispose };
}
