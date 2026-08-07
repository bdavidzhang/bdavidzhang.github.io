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
//
// On a phone there is a third way to move, and it is the one most visitors
// reach for first: tap where you want to be, the way you would on Google Earth
// or in Street View. A tap is projected onto the floor plane, a ring is dropped
// there, and the same velocity/collision integrator walks you over — so a
// tapped walk slides along walls and around lecterns exactly like a driven one.

import * as THREE from 'three';
import { DIMS, TUNING, PALETTE, BUILDING_DEPTH } from './config.js';

// --- module-scope scratch. update() allocates nothing. -----------------------
const _wish = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

const PITCH_LIMIT = Math.PI / 2 - 0.05;
const SPIKE = 150;      // browsers emit one absurd movementX/Y right after lock
const KEY_TURN = 2.2;   // rad/s when turning with Q/E or , .
const BROAD_PAD = 3;    // metres of slop for the collider broadphase
const BOB_FADE = 9;     // how quickly the head bob blends in and out
const MAX_DT = 0.05;    // never integrate more than this in one step

const STICK_SIZE = 116;
const STICK_RADIUS = 46; // max knob travel, px
const KNOB_SIZE = 46;

// --- tap-to-walk -------------------------------------------------------------
const TAP_MS = 320;     // longer than this and the touch was a press, not a tap
const TAP_SLOP = 14;    // px a tap may wander before it counts as a drag
const STICK_HOLD = 0.16;// s a still thumb waits before the stick appears at all
const NAV_REACH = 16;   // m — the furthest one tap will carry you
const NAV_ARRIVE = 0.45;// m — close enough; stop
const NAV_SLOW = 1.8;   // m — start easing off the throttle
const NAV_TURN = 6;     // how briskly the view swings onto the walked bearing
const NAV_STALL = 0.5;  // s of getting nowhere before the walk is abandoned
const NAV_CRAWL = 0.3;  // m/s that counts as getting nowhere
const MARK_IN = 0.32;   // s the destination ring takes to settle
const MARK_OUT = 0.28;  // s it takes to fade once the walk ends

/**
 * The ring dropped on the floor where a tap landed: the whole feedback loop for
 * the gesture — that spot, on my way, arrived. One transparent mesh, hidden
 * whenever nobody is walking, so it costs a draw call only while it is saying
 * something.
 */
function buildMarker() {
  const geo = new THREE.RingGeometry(0.26, 0.4, 44);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: PALETTE.accent,
    transparent: true,
    opacity: 0,
    depthWrite: false,          // it lies on the floor; never carve into it
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.02;       // clear of the floor plane, so no z-fighting
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

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
  let stickOn = false;   // the stick is only drawn once a touch stops being a tap
  let holdT = 0;         // seconds a still thumb has been resting on the pad

  // tap-to-walk: a destination in world XZ, plus the ring standing on it
  const marker = buildMarker();
  let navOn = false;
  let navX = 0;
  let navZ = 0;
  let navFace = true;    // false once the visitor takes the view back by dragging
  let navStall = 0;
  let markT = 0;         // seconds since the ring landed
  let markOut = -1;      // >= 0 while it is fading out

  // one tap, one click: set at touchend, spent by main.js on the click that follows
  let tapOk = false;
  let tapX = 0;
  let tapY = 0;
  let tapAt = 0;

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
    tapOk = false;
    stopWalk();
    hideMarker();       // a ring left standing behind a reader panel is a bug
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
    stickOn = true;
    stick.style.left = x + 'px';
    stick.style.top = y + 'px';
    stick.style.opacity = '1';
    stick.classList.add('is-active');
    knob.style.transform = 'translate(0px, 0px)';
  }

  function hideStick() {
    stickOn = false;
    holdT = 0;
    stick.style.opacity = '0';
    stick.classList.remove('is-active');
    knob.style.transform = 'translate(0px, 0px)';
  }

  function onTouchStart(e) {
    if (!enabled) return;
    // A tap is one finger, briefly, going nowhere. A second finger on the glass
    // is a gesture — pinch, two-thumb walk — and never a destination.
    if (e.touches.length > 1) {
      tapOk = false;
    } else if (e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      tapOk = true;
      tapX = t.clientX;
      tapY = t.clientY;
      tapAt = performance.now();
    }

    const half = innerWidth * 0.5;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < half && moveId === null) {
        moveId = t.identifier;
        moveOx = t.clientX;
        moveOy = t.clientY;
        // Deliberately no showStick() here. The pad shares the left half of the
        // screen with tap-to-walk, and a stick that flashes up under every tap
        // reads as a misfire; update() reveals it after STICK_HOLD, or the first
        // real drag does, whichever comes first.
        holdT = 0;
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
      if (tapOk &&
          (Math.abs(t.clientX - tapX) > TAP_SLOP || Math.abs(t.clientY - tapY) > TAP_SLOP)) {
        tapOk = false;
      }

      if (t.identifier === moveId) {
        let dx = t.clientX - moveOx;
        let dy = t.clientY - moveOy;
        if (!stickOn) {
          // still inside the slop: this touch may yet turn out to be a tap
          if (Math.abs(dx) <= TAP_SLOP && Math.abs(dy) <= TAP_SLOP) continue;
          // Re-centre on where the thumb committed, so the stick starts from
          // zero instead of jumping to whatever the slop had accumulated.
          moveOx = t.clientX;
          moveOy = t.clientY;
          dx = 0;
          dy = 0;
          showStick(moveOx, moveOy);
        }
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > STICK_RADIUS) { const s = STICK_RADIUS / d; dx *= s; dy *= s; }
        joyX = dx / STICK_RADIUS;
        joyY = -dy / STICK_RADIUS; // screen-down is backwards
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      } else if (t.identifier === lookId) {
        // Looking around is the visitor taking the camera back. Keep walking to
        // the tapped spot, but stop swinging their head toward it.
        navFace = false;
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
    // A press that sat there is not a tap either — that is someone resting a
    // thumb on the pad, and lifting it must not fling them across the room.
    if (tapOk && (e.type === 'touchcancel' || performance.now() - tapAt > TAP_MS)) tapOk = false;
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
  // tap-to-walk — the Google Earth gesture, indoors
  // ---------------------------------------------------------------------------

  /** Give the destination up. The ring fades rather than blinking out. */
  function stopWalk() {
    if (!navOn) return;
    navOn = false;
    navStall = 0;
    if (marker.visible && markOut < 0) markOut = 0;
  }

  function hideMarker() {
    marker.visible = false;
    marker.material.opacity = 0;
    markOut = -1;
  }

  /**
   * Turn a point on the screen into a point on the floor and set off toward it.
   *
   * There is no path-finding, and deliberately so: you walk the straight line
   * and slide along whatever you meet, which in an enfilade of rectangular
   * rooms is the honest reading of "go over there" — tap a plate across the
   * room and you end up standing in front of it, tap through a doorway and you
   * walk the centre line into the next room. Anything cleverer would need a
   * navmesh, and rooms are data here: it would have to be rebuilt every time
   * someone adds an entry to ROOMS.
   *
   * A tap above the horizon has no floor under it. Rather than swallow it —
   * tapping a picture hung high is a perfectly clear request — walk a short way
   * along the bearing the visitor pointed at.
   *
   * Returns true when a destination was accepted.
   */
  function walkToScreen(clientX, clientY) {
    if (!enabled) return false;

    const rect = typeof domElement.getBoundingClientRect === 'function'
      ? domElement.getBoundingClientRect()
      : null;
    const left = rect ? rect.left : 0;
    const top = rect ? rect.top : 0;
    const w = (rect && rect.width) || innerWidth;
    const h = (rect && rect.height) || innerHeight;
    if (!(w > 0) || !(h > 0)) return false;

    _ndc.set(((clientX - left) / w) * 2 - 1, -(((clientY - top) / h) * 2 - 1));
    // The camera's world matrix is refreshed at render time and this runs
    // between frames, so bring it up to date or the ray leaves from last frame.
    camera.updateMatrixWorld();
    _ray.setFromCamera(_ndc, camera);

    const o = _ray.ray.origin;
    const d = _ray.ray.direction;
    let tx;
    let tz;
    if (d.y < -1e-3) {
      const t = -o.y / d.y;               // where the ray meets the floor, y = 0
      tx = o.x + d.x * t;
      tz = o.z + d.z * t;
    } else {
      const hl = Math.sqrt(d.x * d.x + d.z * d.z);
      if (hl < 1e-4) return false;        // straight up: no bearing to walk
      tx = posX + (d.x / hl) * NAV_REACH * 0.4;
      tz = posZ + (d.z / hl) * NAV_REACH * 0.4;
    }

    const dx = tx - posX;
    const dz = tz - posZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    // Tapping your own feet is how you stop, not a journey.
    if (dist < NAV_ARRIVE) { stopWalk(); return false; }
    // Shorten along the bearing first and clamp to the building second, never
    // the other way round: a near-horizon tap lands the floor point a hundred
    // metres off, and squaring it into the room before shortening it would
    // swing the walk round to face down the enfilade instead of where the
    // visitor actually pointed.
    if (dist > NAV_REACH) {
      const s = NAV_REACH / dist;
      tx = posX + dx * s;
      tz = posZ + dz * s;
    }
    // A tap on a wall lands on the floor plane *behind* it; pull the
    // destination back inside so it is somewhere a body could stand.
    const halfW = DIMS.roomW / 2 - DIMS.bodyR;
    if (tx > halfW) tx = halfW;
    else if (tx < -halfW) tx = -halfW;
    if (tz > zNear) tz = zNear;
    else if (tz < zFar) tz = zFar;

    navX = tx;
    navZ = tz;
    navOn = true;
    navFace = true;
    navStall = 0;
    markT = 0;
    markOut = -1;
    marker.position.set(tx, 0.02, tz);
    // Prime the first frame of the landing rather than inheriting whatever the
    // last fade-out left behind — update() would fix it, but only after a frame.
    marker.scale.set(1.7, 1, 1.7);
    marker.material.opacity = 0;
    marker.visible = true;
    return true;
  }

  /**
   * True exactly once per tap, for the click a browser synthesises after a
   * short, still touch. Drags, presses and multi-finger gestures never produce
   * one, which is how main.js tells "take me there" from "I was looking round".
   */
  function consumeTap() {
    const was = tapOk;
    tapOk = false;
    return was;
  }

  function updateMarker(dt) {
    if (!marker.visible) return;
    markT += dt;
    if (markOut >= 0) {
      markOut += dt;
      const t = markOut / MARK_OUT;
      if (t >= 1) { hideMarker(); return; }
      const s = 1 + t * 0.35;              // opens out as it goes
      marker.scale.set(s, 1, s);
      marker.material.opacity = 0.62 * (1 - t);
      return;
    }
    if (markT < MARK_IN) {
      // drops in wide and settles, so the eye is pulled to where it landed
      const e = 1 - (1 - markT / MARK_IN) * (1 - markT / MARK_IN);
      const s = 1.7 - 0.7 * e;
      marker.scale.set(s, 1, s);
      marker.material.opacity = 0.62 * e;
    } else {
      marker.scale.set(1, 1, 1);
      marker.material.opacity = 0.62 + Math.sin(markT * 3.2) * 0.08;
    }
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

    // A thumb parked on the pad without moving eventually means the stick, not
    // a tap — reveal it so there is something to push against.
    if (moveId !== null && !stickOn) {
      holdT += dt;
      if (holdT > STICK_HOLD) showStick(moveOx, moveOy);
    }

    // desired direction in the camera's local frame
    let fwd = 0;
    let strafe = 0;
    if (down('KeyW', 'ArrowUp')) fwd += 1;
    if (down('KeyS', 'ArrowDown')) fwd -= 1;
    if (down('KeyD')) strafe += 1;
    if (down('KeyA')) strafe -= 1;

    // Any deliberate steering takes the wheel back off a tapped destination.
    const stickMag2 = joyX * joyX + joyY * joyY;
    if (navOn && (fwd !== 0 || strafe !== 0 || turn !== 0 || stickMag2 > 0.02)) stopWalk();

    fwd += joyY;
    strafe += joyX;

    let speed = TUNING.moveSpeed;
    let moving;

    if (navOn) {
      const dx = navX - posX;
      const dz = navZ - posZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < NAV_ARRIVE) {
        stopWalk();
        _wish.set(0, 0, 0);
        moving = false;
      } else {
        _wish.set(dx / dist, 0, dz / dist);
        moving = true;
        // Ease off over the last stride or so: arriving should be a stop, not a
        // wall of damping applied at full tilt.
        if (dist < NAV_SLOW) speed *= Math.max(0.25, dist / NAV_SLOW);
        if (navFace) {
          // Swing the view onto the bearing being walked — the Street View
          // feel, where tapping something also brings it round in front of you.
          const want = Math.atan2(-_wish.x, -_wish.z);
          let off = want - yaw;
          off = Math.atan2(Math.sin(off), Math.cos(off)); // shortest way round
          yaw += off * (1 - Math.exp(-NAV_TURN * dt));
        }
      }
    } else {
      // Yaw basis: rotating about +Y sends (0,0,-1) -> (-sin, 0, -cos) and
      // (1,0,0) -> (cos, 0, -sin). Cheaper and steadier than reading the matrix.
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      _wish.set(-sy * fwd + cy * strafe, 0, -cy * fwd - sy * strafe);
      const wl = Math.sqrt(_wish.x * _wish.x + _wish.z * _wish.z);
      moving = wl > 0.001;
      if (wl > 1) { _wish.x /= wl; _wish.z /= wl; } // no diagonal speed bonus

      const sprint = down('ShiftLeft', 'ShiftRight') || stickMag2 > 0.85; // stick to the rim
      if (sprint) speed *= TUNING.sprintMult;
    }

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

    // A straight line can be beaten by geometry — an alcove, the outside of a
    // doorway. Sliding counts as progress; grinding in place does not, and
    // after half a second of it the walk is quietly abandoned rather than left
    // pressed into a wall forever.
    if (navOn) {
      navStall = spd < NAV_CRAWL ? navStall + dt : 0;
      if (navStall > NAV_STALL) stopWalk();
    }

    bobDist += spd * dt;
    const want = spd / TUNING.moveSpeed;
    bobBlend += ((want > 1 ? 1 : want) - bobBlend) * (1 - Math.exp(-BOB_FADE * dt));
    const bob = Math.sin(bobDist * TUNING.headBobFreq) * TUNING.headBobAmp * bobBlend;

    camera.position.set(posX, DIMS.eyeH + bob, posZ);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    updateMarker(dt);
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
    stopWalk();      // wherever you were walking to, you are not walking there
    hideMarker();
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
    if (marker.parent) marker.parent.remove(marker);
    marker.geometry.dispose();
    marker.material.dispose();
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

    // --- tap-to-walk. main.js decides what a tap *means* (an exhibit within
    // reach is opened, anything else is walked to); this end owns the walking.
    walkToScreen,
    stopWalk,
    consumeTap,
    get isWalking() { return navOn; },
    /** The destination ring. main.js parents it into the scene. */
    marker,
  };
}
