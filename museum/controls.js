// controls.js — the first-person rig: pointer-lock mouse look on desktop, a
// twin-stick touch scheme on mobile, and a keyboard-only fallback that works
// with no pointer lock at all so the museum stays navigable by keyboard.
//
// Written inline rather than using three's PointerLockControls addon: we want
// control over the feel (velocity + exponential damping, distance-driven head
// bob) and one fewer module fetch on a no-build site.
//
// The player is a circle of radius DIMS.bodyR in XZ; the world hands us a flat
// list of axis-aligned boxes to slide against.

import * as THREE from 'three';
import { DIMS, TUNING, BUILDING_DEPTH } from './config.js';

// --- module-scope scratch. update() allocates nothing. -----------------------
const _wish = new THREE.Vector3();

const PITCH_LIMIT = Math.PI / 2 - 0.05;
const SPIKE = 150;      // browsers emit one absurd movementX/Y right after lock
const KEY_TURN = 2.2;   // rad/s when turning with Q/E or , .
const BROAD_PAD = 3;    // metres of slop for the collider broadphase
const BOB_FADE = 9;     // how quickly the head bob blends in and out
const MAX_DT = 0.05;    // never integrate more than this in one step

const STICK_SIZE = 116;
const STICK_RADIUS = 46; // max knob travel, px
const KNOB_SIZE = 46;

export function createControls({ camera, domElement, colliders = [], isMobile = false }) {
  // --- state -----------------------------------------------------------------
  let yaw = camera.rotation.y;
  let pitch = camera.rotation.x;
  let posX = camera.position.x;
  let posZ = camera.position.z;
  let velX = 0;
  let velZ = 0;
  let bobDist = 0;   // metres travelled, drives the bob phase
  let bobBlend = 0;
  let locked = false;
  let enabled = true;

  const held = new Set();
  const down = (a, b) => held.has(a) || held.has(b);

  // touch state; identifiers are tracked so look + move work simultaneously
  let moveId = null;
  let lookId = null;
  let moveOx = 0;
  let moveOy = 0;
  let lookPx = 0;
  let lookPy = 0;
  let joyX = 0;
  let joyY = 0;

  // The building is a corridor of rooms running down -Z; these bounds keep the
  // player inside it even if a collider is missing somewhere.
  const zNear = -(DIMS.wallT + DIMS.bodyR);
  const zFar = -BUILDING_DEPTH + DIMS.wallT + DIMS.bodyR;

  // ---------------------------------------------------------------------------
  // keyboard
  // ---------------------------------------------------------------------------

  /** True when something else owns the keyboard: a text field or a modal. */
  function inputBusy() {
    const el = document.activeElement;
    if (!el || el === document.body || el === domElement) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
    return typeof el.closest === 'function' &&
      !!el.closest('[aria-modal="true"], dialog[open], [data-modal]');
  }

  function onKeyDown(e) {
    if (!enabled || e.metaKey || e.ctrlKey || e.altKey) return;
    if (inputBusy()) return;
    held.add(e.code);
    // arrows and space would scroll the page underneath the canvas
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }

  // Always release, even mid-typing, or the key sticks down forever.
  function onKeyUp(e) { held.delete(e.code); }

  function clearInput() {
    held.clear();
    joyX = 0;
    joyY = 0;
    velX = 0;
    velZ = 0;
    moveId = null;
    lookId = null;
    if (stick) hideStick();
  }

  function onBlur() { clearInput(); }

  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);

  // ---------------------------------------------------------------------------
  // pointer lock (desktop only)
  // ---------------------------------------------------------------------------

  function onMouseMove(e) {
    if (!enabled || !locked) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (dx > SPIKE || dx < -SPIKE || dy > SPIKE || dy < -SPIKE) return;
    yaw -= dx * TUNING.mouseSens;
    pitch -= dy * TUNING.mouseSens;
    if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
    else if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
  }

  function onLockChange() {
    const now = document.pointerLockElement === domElement;
    if (!now && locked) clearInput(); // Esc usually means the user walked away
    locked = now;
  }

  function onLockError() {
    locked = false;
    console.warn('[museum] pointer lock refused');
  }

  function lock() {
    if (isMobile || !enabled || locked) return;
    if (!domElement.requestPointerLock) return;
    const p = domElement.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => { locked = false; });
  }

  function unlock() {
    if (document.pointerLockElement === domElement) document.exitPointerLock();
  }

  if (!isMobile) {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockError);
  }

  // ---------------------------------------------------------------------------
  // touch: left half drives a virtual stick, right half drags the view
  // ---------------------------------------------------------------------------

  let stick = null;
  let knob = null;

  function buildStick() {
    const host = domElement.parentElement || document.body;
    stick = document.createElement('div');
    stick.className = 'mus-stick';
    stick.setAttribute('aria-hidden', 'true');
    // Inline styles are a fallback so the stick is usable even before museum.css
    // styles .mus-stick / .mus-stick-knob. pointer-events:none is deliberate —
    // every touch is handled on the canvas, the stick is purely a readout.
    Object.assign(stick.style, {
      position: 'fixed',
      left: '-999px',
      top: '-999px',
      width: STICK_SIZE + 'px',
      height: STICK_SIZE + 'px',
      marginLeft: -(STICK_SIZE / 2) + 'px',
      marginTop: -(STICK_SIZE / 2) + 'px',
      borderRadius: '50%',
      pointerEvents: 'none',
      touchAction: 'none',
      opacity: '0',
      transition: 'opacity 140ms ease',
      zIndex: '4',
    });

    knob = document.createElement('div');
    knob.className = 'mus-stick-knob';
    Object.assign(knob.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: KNOB_SIZE + 'px',
      height: KNOB_SIZE + 'px',
      marginLeft: -(KNOB_SIZE / 2) + 'px',
      marginTop: -(KNOB_SIZE / 2) + 'px',
      borderRadius: '50%',
      pointerEvents: 'none',
      transform: 'translate(0px, 0px)',
    });

    stick.appendChild(knob);
    host.appendChild(stick);
  }

  function showStick(x, y) {
    stick.style.left = x + 'px';
    stick.style.top = y + 'px';
    stick.style.opacity = '1';
    stick.classList.add('is-active');
    knob.style.transform = 'translate(0px, 0px)';
  }

  function hideStick() {
    stick.style.opacity = '0';
    stick.classList.remove('is-active');
    knob.style.transform = 'translate(0px, 0px)';
  }

  function onTouchStart(e) {
    if (!enabled) return;
    const half = innerWidth * 0.5;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < half && moveId === null) {
        moveId = t.identifier;
        moveOx = t.clientX;
        moveOy = t.clientY;
        showStick(moveOx, moveOy);
      } else if (lookId === null) {
        lookId = t.identifier;
        lookPx = t.clientX;
        lookPy = t.clientY;
      }
    }
  }

  function onTouchMove(e) {
    if (!enabled) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === moveId) {
        let dx = t.clientX - moveOx;
        let dy = t.clientY - moveOy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > STICK_RADIUS) { const s = STICK_RADIUS / d; dx *= s; dy *= s; }
        joyX = dx / STICK_RADIUS;
        joyY = -dy / STICK_RADIUS; // screen-down is backwards
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      } else if (t.identifier === lookId) {
        yaw -= (t.clientX - lookPx) * TUNING.touchLookSens;
        pitch -= (t.clientY - lookPy) * TUNING.touchLookSens;
        if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
        else if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
        lookPx = t.clientX;
        lookPy = t.clientY;
      }
    }
    e.preventDefault(); // stop rubber-band scroll while dragging
  }

  function onTouchEnd(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === moveId) {
        moveId = null;
        joyX = 0;
        joyY = 0;
        hideStick();
      } else if (t.identifier === lookId) {
        lookId = null;
      }
    }
  }

  if (isMobile) {
    buildStick();
    // touch-action instead of preventDefault on touchstart, so a stationary tap
    // still produces the click main.js uses to open an exhibit
    domElement.style.touchAction = 'none';
    domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    domElement.addEventListener('touchend', onTouchEnd, { passive: true });
    domElement.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }

  // ---------------------------------------------------------------------------
  // collision: circle vs. axis-aligned boxes
  // ---------------------------------------------------------------------------

  function resolveCollisions() {
    const r = DIMS.bodyR;
    const r2 = r * r;
    const pad = r + BROAD_PAD;
    // Two passes: one push can shove the player into a neighbouring box, which
    // is exactly what happens in every corner.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        // cheap broadphase — most of the building is nowhere near the player
        if (posX < c.minX - pad || posX > c.maxX + pad ||
            posZ < c.minZ - pad || posZ > c.maxZ + pad) continue;

        // closest point on the box to the player centre
        const cx = posX < c.minX ? c.minX : (posX > c.maxX ? c.maxX : posX);
        const cz = posZ < c.minZ ? c.minZ : (posZ > c.maxZ ? c.maxZ : posZ);
        const dx = posX - cx;
        const dz = posZ - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;

        if (d2 > 1e-8) {
          // outside the box but overlapping: push out along the contact normal
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const nz = dz / d;
          posX = cx + nx * r;
          posZ = cz + nz * r;
          // cancel only the velocity heading into the wall, so we slide along it
          const into = velX * nx + velZ * nz;
          if (into < 0) { velX -= nx * into; velZ -= nz * into; }
        } else {
          // centre is inside the box: eject along the shortest axis
          const left = posX - c.minX;
          const right = c.maxX - posX;
          const back = posZ - c.minZ;
          const front = c.maxZ - posZ;
          const m = Math.min(left, right, back, front);
          if (m === left) { posX = c.minX - r; if (velX > 0) velX = 0; }
          else if (m === right) { posX = c.maxX + r; if (velX < 0) velX = 0; }
          else if (m === back) { posZ = c.minZ - r; if (velZ > 0) velZ = 0; }
          else { posZ = c.maxZ + r; if (velZ < 0) velZ = 0; }
        }
      }
    }

    // hard rails: never leave the building down its long axis
    if (posZ > zNear) { posZ = zNear; if (velZ > 0) velZ = 0; }
    else if (posZ < zFar) { posZ = zFar; if (velZ < 0) velZ = 0; }
  }

  // ---------------------------------------------------------------------------
  // per-frame
  // ---------------------------------------------------------------------------

  function update(dt) {
    if (!enabled) return;
    if (dt > MAX_DT) dt = MAX_DT;

    // Keyboard turning — the whole museum is walkable without pointer lock.
    // Deliberately NOT Q/E: main.js binds E to "open exhibit", so sharing the
    // key would turn the camera and open a plate at the same time.
    let turn = 0;
    if (down('ArrowLeft', 'Comma')) turn += 1;
    if (down('ArrowRight', 'Period')) turn -= 1;
    if (turn !== 0) yaw += turn * KEY_TURN * dt;

    // desired direction in the camera's local frame
    let fwd = 0;
    let strafe = 0;
    if (down('KeyW', 'ArrowUp')) fwd += 1;
    if (down('KeyS', 'ArrowDown')) fwd -= 1;
    if (down('KeyD')) strafe += 1;
    if (down('KeyA')) strafe -= 1;
    fwd += joyY;
    strafe += joyX;

    // Yaw basis: rotating about +Y sends (0,0,-1) -> (-sin, 0, -cos) and
    // (1,0,0) -> (cos, 0, -sin). Cheaper and steadier than reading the matrix.
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    _wish.set(-sy * fwd + cy * strafe, 0, -cy * fwd - sy * strafe);
    const wl = Math.sqrt(_wish.x * _wish.x + _wish.z * _wish.z);
    const moving = wl > 0.001;
    if (wl > 1) { _wish.x /= wl; _wish.z /= wl; } // no diagonal speed bonus

    const stickSprint = joyX * joyX + joyY * joyY > 0.85; // stick to the rim
    const sprint = down('ShiftLeft', 'ShiftRight') || stickSprint;
    const speed = TUNING.moveSpeed * (sprint ? TUNING.sprintMult : 1);

    // Accelerate toward the target while pushing, coast down when not. The
    // exponential form keeps the feel identical at 30fps and 240fps, unlike a
    // per-frame `v *= 0.9`.
    const rate = moving ? TUNING.accel : TUNING.damping;
    const k = 1 - Math.exp(-rate * dt);
    velX += (_wish.x * speed - velX) * k;
    velZ += (_wish.z * speed - velZ) * k;
    if (velX * velX + velZ * velZ < 1e-6) { velX = 0; velZ = 0; }

    posX += velX * dt;
    posZ += velZ * dt;
    resolveCollisions();

    // Head bob is driven by distance travelled, not by time, so it stays in step
    // with the feet when sprinting and freezes the moment the player stops.
    const spd = Math.sqrt(velX * velX + velZ * velZ);
    bobDist += spd * dt;
    const want = spd / TUNING.moveSpeed;
    bobBlend += ((want > 1 ? 1 : want) - bobBlend) * (1 - Math.exp(-BOB_FADE * dt));
    const bob = Math.sin(bobDist * TUNING.headBobFreq) * TUNING.headBobAmp * bobBlend;

    camera.position.set(posX, DIMS.eyeH + bob, posZ);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  // ---------------------------------------------------------------------------
  // api
  // ---------------------------------------------------------------------------

  function teleportTo(x, z, newYaw) {
    posX = x;
    posZ = z;
    velX = 0;
    velZ = 0;
    bobBlend = 0;
    if (typeof newYaw === 'number') yaw = newYaw;
    resolveCollisions(); // never land inside a wall
    camera.position.set(posX, DIMS.eyeH, posZ);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) clearInput();
  }

  function dispose() {
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    if (!isMobile) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      unlock();
    } else {
      domElement.removeEventListener('touchstart', onTouchStart);
      domElement.removeEventListener('touchmove', onTouchMove);
      domElement.removeEventListener('touchend', onTouchEnd);
      domElement.removeEventListener('touchcancel', onTouchEnd);
      if (stick && stick.parentNode) stick.parentNode.removeChild(stick);
      stick = null;
      knob = null;
    }
    held.clear();
  }

  return {
    update,
    lock,
    unlock,
    // On touch there is no pointer to lock; the controls are always driving, and
    // callers use this to decide whether a tap means "look around" or "open".
    get isLocked() { return isMobile ? enabled : locked; },
    teleportTo,
    setEnabled,
    dispose,
  };
}
