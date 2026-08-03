// lighting.js — the museum's lighting rig.
//
// Rooms do not own lights. They own *values*: themeFor(i).light gives three
// multipliers and the theme's ceiling/floor/glow give the tints. This module
// keeps ONE fixed set of lights and lerps it toward the current room, so the
// shader sees the same light counts everywhere — one program permutation, one
// light loop, no matter how many rooms exist. Per-room lights would multiply
// both.
//
// Why the intensities are what they are. MeshLambertMaterial in three r155+
// shades as
//
//     out = albedo * ( ambient + hemisphere + Σ NdotL·directional ) / PI
//
// (the legacy PI scale factor on light intensity is gone, the RECIPROCAL_PI in
// BRDF_Lambert is not). So the useful quantity is the bracket over PI — call it
// the exposure. The rig is tuned to land the exposure near 0.9 on the wall you
// are walking toward. That is bright and open, and it deliberately stops short
// of 1.0: at 1.0 a near-white wall, a paper plate and a pale frame all clip to
// the same flat white and the sketch outlines stop reading against them.
//
// The gloom this replaces was never a light problem — it was albedo. Dark-mode
// walls at #1b1b1f multiply everything down to nothing. config.js fixed that
// half; this half flatters the bright palette instead of fighting it.

import * as THREE from 'three';
import { themeFor, isNight } from './config.js';

// Base intensities, before per-room `theme.light` multipliers. Tuned so the
// exposure on the wall you are facing is ~0.92 and nothing in any room exceeds
// 0.92 lit-linear: bright, with 8% of headroom left before anything clips.
const BASE = {
  hemi:    1.62,   // the room's own bounce: ceiling above, floor below
  ambient: 0.58,   // flat term under everything, so no face is ever unlit
  key:     1.15,   // the skylight, high and to the player's right
  fill:    0.60,   // low bounce from behind-left, keeps back walls alive
};

// Night runs the same rig hotter — its walls are mid-grey, not white, so equal
// irradiance reads far darker. 1.3 is the most the night palette will take: its
// trim is nearly white (frames #e6e1d6, linear 0.79) and clips past an exposure
// of ~1.26. Getting night walls brighter than ~30% needs darker trim in
// config.js, not more light here.
const NIGHT = 1.3;

/** Effective base intensities for the active mode. Exported so the brightness
 *  numbers can be verified outside a browser. */
export const RIG = isNight
  ? { hemi: BASE.hemi * NIGHT, ambient: BASE.ambient * NIGHT,
      key: BASE.key * NIGHT, fill: BASE.fill * NIGHT }
  : { ...BASE };

// theme.light multipliers describe character, not exposure, and they compound
// with the palette: the atrium has both the brightest colours and the highest
// numbers, which pushed its walls to clipping while the studio sagged. Applying
// them at 60% keeps the ordering and the feel and loses the double-count.
const SPREAD = 0.6;
const spread = (m) => 1 + (m - 1) * SPREAD;

// The floor half of the hemisphere, relative to the sky half. This is what puts
// a vertical gradient in the room — bright above, dimmer below — and it is a rig
// decision rather than a palette accident, so ceilings stay readable in every
// theme instead of tracking however dark that theme's floor happens to be.
const GROUND = 0.68;

// How far each tint is pulled back toward white. The lights carry the room's
// hue; the walls carry its colour. Ambient is the flattest term so it is the
// most neutral, the key the least — it is the room's light source.
const WHITEN = { sky: 0.30, ground: 0.30, ambient: 0.45, key: 0.20, fill: 0.30 };

const FADE = 0.4;   // seconds to cross-fade a room change

// Rig geometry, as offsets from the player. A shadowless DirectionalLight uses
// nothing but its direction, so these are really two directions written as
// positions: key from high front-right, fill low from behind-left. Every wall of
// a room therefore catches some direct light, and the one you are facing catches
// the most — that gradient is what makes a room read as lit rather than as an
// evenly painted box.
const KEY_OFF  = { x:  3.0, y: 6.5, z:  3.0 };
const KEY_AIM  = { x:  0.0, y: 0.6, z: -4.0 };
const FILL_OFF = { x: -3.5, y: 3.2, z: -5.0 };
const FILL_AIM = { x:  0.0, y: 1.4, z:  1.0 };

/** Mutable snapshot of everything a room contributes to the rig. */
function makeState() {
  return {
    sky:  new THREE.Color(),
    grd:  new THREE.Color(),
    amb:  new THREE.Color(),
    key:  new THREE.Color(),
    fill: new THREE.Color(),
    fog:  new THREE.Color(),
    hemiI: 0, ambI: 0, keyI: 0, fillI: 0,
  };
}

/**
 * Take the hue of a theme colour and nothing else.
 *
 * This is the whole gloom bug in miniature. Tinting a light with theme.ceiling
 * multiplies its intensity by that colour's lightness, and night ceilings sit
 * near 0.04 in linear — so a hemisphere light "at 2.0" would deliver almost
 * nothing, exactly the way dark walls ate the light before. Normalising to the
 * brightest channel strips lightness out; `white` then damps the chroma, which
 * matters because sRGB→linear exaggerates the ratios in dark colours and a raw
 * normalised night ceiling comes out lurid green.
 */
function tint(dst, hex, white) {
  dst.set(hex);
  const m = Math.max(dst.r, dst.g, dst.b) || 1;
  const k = (1 - white) / m;
  dst.r = dst.r * k + white;
  dst.g = dst.g * k + white;
  dst.b = dst.b * k + white;
  return dst;
}

function readTheme(dst, theme) {
  const L = theme.light || { hemi: 1, ambient: 1, key: 1 };
  tint(dst.sky, theme.ceiling, WHITEN.sky);
  tint(dst.grd, theme.floor, WHITEN.ground).multiplyScalar(GROUND);
  tint(dst.amb, theme.wall, WHITEN.ambient);    // the flat term reads as the room
  tint(dst.key, theme.glow, WHITEN.key);        // bouncing off its own walls
  tint(dst.fill, theme.floor, WHITEN.fill);     // and off its own floor
  dst.fog.set(theme.fog);
  dst.hemiI = RIG.hemi    * spread(L.hemi);
  dst.ambI  = RIG.ambient * spread(L.ambient);
  dst.keyI  = RIG.key     * spread(L.key);
  dst.fillI = RIG.fill    * spread(L.key);   // the bounce tracks the light that made it
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {THREE.WebGLRenderer} [renderer] - optional, only to keep the clear
 *        colour in step with the fog.
 */
export function createLighting(scene, camera, renderer) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x808080, 0);
  const ambient = new THREE.AmbientLight(0xffffff, 0);

  const key = new THREE.DirectionalLight(0xffffff, 0);
  key.castShadow = false;
  const fill = new THREE.DirectionalLight(0xffffff, 0);
  fill.castShadow = false;

  scene.add(hemi, ambient, key, key.target, fill, fill.target);

  // Fog is part of the rig, not a separate concern: it is the colour the far end
  // of the enfilade dissolves into, so if it lags a room change you get a grey
  // curtain hanging in the doorway. It fades on exactly the same clock.
  if (!scene.fog) scene.fog = new THREE.Fog(0x000000, 14, 46);
  const fogColor = scene.fog.color;
  const bg = scene.background instanceof THREE.Color
    ? scene.background
    : (scene.background = new THREE.Color());

  const from = makeState();
  const to = makeState();

  let room = -1;
  let t = 1;   // fade progress; 1 == settled

  /** Write the rig at blend factor k (0 = `from`, 1 = `to`). Allocation-free. */
  function blend(k) {
    hemi.color.lerpColors(from.sky, to.sky, k);
    hemi.groundColor.lerpColors(from.grd, to.grd, k);
    ambient.color.lerpColors(from.amb, to.amb, k);
    key.color.lerpColors(from.key, to.key, k);
    fill.color.lerpColors(from.fill, to.fill, k);

    hemi.intensity    = from.hemiI + (to.hemiI - from.hemiI) * k;
    ambient.intensity = from.ambI  + (to.ambI  - from.ambI)  * k;
    key.intensity     = from.keyI  + (to.keyI  - from.keyI)  * k;
    fill.intensity    = from.fillI + (to.fillI - from.fillI) * k;

    fogColor.lerpColors(from.fog, to.fog, k);
    bg.copy(fogColor);
    if (renderer) renderer.setClearColor(fogColor, 1);
  }

  function setRoom(index) {
    const i = index | 0;
    if (i === room) return;          // idempotent: a no-op on every frame but one
    const first = room < 0;
    room = i;

    // Freeze wherever the rig currently is, so a room change mid-fade continues
    // from what the player is looking at rather than snapping back.
    from.sky.copy(hemi.color);
    from.grd.copy(hemi.groundColor);
    from.amb.copy(ambient.color);
    from.key.copy(key.color);
    from.fill.copy(fill.color);
    from.fog.copy(fogColor);
    from.hemiI = hemi.intensity;
    from.ambI = ambient.intensity;
    from.keyI = key.intensity;
    from.fillI = fill.intensity;

    readTheme(to, themeFor(i));
    t = first ? 1 : 0;               // no fade-up on the first frame of the museum
    blend(t);
  }

  function update(dt, cam) {
    if (t < 1) {
      t = Math.min(1, t + dt / FADE);
      // smoothstep so the change eases in and out; a linear ramp reads as a
      // light switch being turned, not as walking into another room
      blend(t * t * (3 - 2 * t));
    }

    // The rig rides with the player. For shadowless directionals this only fixes
    // the direction (which never changes), but it keeps the lights inside any
    // future frustum/shadow bounds and matches what the engine used to do.
    const c = cam || camera;
    const { x, z } = c.position;
    key.position.set(x + KEY_OFF.x, KEY_OFF.y, z + KEY_OFF.z);
    key.target.position.set(x + KEY_AIM.x, KEY_AIM.y, z + KEY_AIM.z);
    fill.position.set(x + FILL_OFF.x, FILL_OFF.y, z + FILL_OFF.z);
    fill.target.position.set(x + FILL_AIM.x, FILL_AIM.y, z + FILL_AIM.z);
    key.target.updateMatrixWorld();
    fill.target.updateMatrixWorld();
  }

  function dispose() {
    scene.remove(hemi, ambient, key, key.target, fill, fill.target);
    hemi.dispose();
    ambient.dispose();
    key.dispose();
    fill.dispose();
  }

  setRoom(0);
  update(0, camera);

  return { update, setRoom, dispose };
}
