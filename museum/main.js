// main.js — integrator. Owns the module contract; every other file implements
// exactly the signatures called here.

import * as THREE from 'three';
import { createEngine } from './engine.js';
import { loadContent } from './content.js';
import { buildWorld } from './architecture.js';
import { buildExhibits } from './exhibits.js';
import { buildDecor } from './decor.js';
import { createControls } from './controls.js';
import { createUI } from './ui.js';
import { createPortal } from './portal.js';
import { ROOMS, TUNING, DIMS, roomCenterZ, roomIndexAtZ, themeFor, standSpot } from './config.js';

// --- arriving at a free-standing exhibit (`#story`, `#open-reality-story`) ----
// The visitor is walked up to the lectern from a few metres out in front of it
// and the reader opens on its own; closing it leaves them standing there, free to roam.
const READ_DIST = 1.6;      // metres back from the lectern the visitor ends up
const READ_PITCH = -0.26;   // looking down at the tilted label, radians
const ARRIVE_HOLD = 0.45;   // seconds of stillness while the loader fades
const ARRIVE_GLIDE = 2.0;   // seconds for the walk itself
const ARRIVE_RUN = 4.0;     // metres of walk, where the room has that much to give

const canvas = document.getElementById('scene');

async function boot() {
  const engine = createEngine(canvas);
  const ui = createUI({ isMobile: engine.isMobile });

  ui.setProgress(0.05, 'Loading collection');
  const rooms = await loadContent();

  ui.setProgress(0.35, 'Building rooms');
  // world: { group, colliders[], anchors: Map<roomId, Anchor[]>, roomGroups[], dispose() }
  const world = buildWorld(rooms);
  engine.scene.add(world.group);
  engine.setRoomGroups(world.roomGroups);

  ui.setProgress(0.6, 'Furnishing rooms');
  // decor: { group, colliders[], built[], update(dt, elapsed), dispose() }
  // Props are parented into the room groups, so per-room culling still applies.
  const decor = buildDecor(rooms, world);
  engine.scene.add(decor.group);

  ui.setProgress(0.75, 'Hanging exhibits');
  // exhibits: { group, targets[], update(dt, camera), dispose() }
  const exhibits = buildExhibits(rooms, world);
  engine.scene.add(exhibits.group);

  // The Open Reality gateway in the atrium. Proximity-triggered, never an
  // exhibit and never a raycast target — walking through it is the interaction.
  // Built before createControls so its legs make it into the collider list.
  // portal: { group, colliders[], update(dt, playerPosition), dispose() }
  const portal = createPortal({
    THREE,
    room: rooms[0],
    roomGroup: world.roomGroups[0],
    theme: themeFor(0),
    ui,
  });

  ui.setProgress(0.85, 'Calibrating');
  // controls: { update(dt), lock(), unlock(), get isLocked, teleportTo(x,z,yaw,pitch), setEnabled(b), dispose() }
  const controls = createControls({
    camera: engine.camera,
    domElement: canvas,
    // props are solid too, so the player walks around planters and desks — and
    // around the link lecterns, which stand on the floor rather than on a wall
    colliders: world.colliders.concat(decor.colliders, exhibits.colliders, portal.colliders),
    isMobile: engine.isMobile,
  });

  // --- interaction: raycast forward, offer the nearest exhibit --------------
  const ray = new THREE.Raycaster();
  ray.far = TUNING.interactDist;
  const centre = new THREE.Vector2(0, 0);
  let focused = null;

  function pickFocus() {
    if (ui.isReaderOpen()) return null;
    ray.setFromCamera(centre, engine.camera);
    const hits = ray.intersectObjects(exhibits.targets, false);
    for (const h of hits) {
      const ex = h.object.userData.exhibit;
      if (ex) return { exhibit: ex, object: h.object, distance: h.distance };
    }
    return null;
  }

  /**
   * A `link` exhibit is a door, not a page: it leaves for its URL instead of
   * opening the reader.
   *
   * This runs synchronously inside the keydown/click handler on purpose.
   * `window.open` is only permitted during the browser's user-activation window,
   * so calling it any later — from the frame loop, a timeout, a promise — is
   * silently blocked. If it is blocked anyway, fall through to the reader panel,
   * which already renders `href` as a real target="_blank" anchor the visitor
   * can click themselves.
   */
  function openFocused() {
    if (!focused) return;
    const ex = focused.exhibit;

    if (ex.kind === 'link' && ex.href) {
      // mailto:/tel: hand off to an external handler; opening them in a tab
      // strands an about:blank behind the mail client
      if (/^(mailto|tel):/i.test(ex.href)) { location.href = ex.href; return; }
      let win = null;
      // Deliberately NOT the 'noopener' feature string: with it the spec says
      // window.open returns null even when it succeeded, so there is no way left
      // to tell "opened" from "blocked". Open normally and sever `opener` on the
      // next statement instead — synchronous, long before the new document can
      // run any script of its own.
      try {
        win = window.open(ex.href, '_blank');
        if (win) win.opener = null;
      } catch { /* blocked — fall through to the reader */ }
      if (win) return;
    }

    read(ex);
  }

  function read(ex) {
    controls.unlock();
    ui.openReader(ex);
  }

  ui.onActivate(openFocused);
  ui.onTeleport((roomIndex) => {
    controls.teleportTo(0, roomCenterZ(roomIndex) + DIMS.roomD * 0.32, Math.PI);
    engine.cull(true);
  });
  ui.onReaderClose(() => {
    if (!engine.isMobile) controls.lock();
  });

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' || e.code === 'Enter') {
      if (!ui.isReaderOpen() && focused) { e.preventDefault(); openFocused(); }
    }
  });

  canvas.addEventListener('click', () => {
    if (ui.isReaderOpen()) return;
    if (controls.isLocked && focused) openFocused();
    else if (!engine.isMobile) controls.lock();
  });

  // --- per-frame -------------------------------------------------------------
  let lastRoomIdx = -1;
  let focusTimer = 0;
  let arrival = null;       // { exhibit, x0, z0, x1, z1, yaw0, yaw1, t } while gliding in
  let keepHash = false;     // an arrival's `#id` survives until the room changes

  /** Advance the glide. Plain numbers only — this runs every frame. */
  function stepArrival(dt) {
    arrival.t += dt;
    let k = (arrival.t - ARRIVE_HOLD) / ARRIVE_GLIDE;
    k = k < 0 ? 0 : (k > 1 ? 1 : k);
    const e = k * k * (3 - 2 * k);                  // smoothstep
    controls.teleportTo(
      arrival.x0 + (arrival.x1 - arrival.x0) * e,
      arrival.z0 + (arrival.z1 - arrival.z0) * e,
      arrival.yaw0 + (arrival.yaw1 - arrival.yaw0) * e,
      READ_PITCH * e,
    );
    if (k < 1) return;
    const { exhibit } = arrival;
    arrival = null;
    controls.setEnabled(true);
    read(exhibit);
  }

  engine.onFrame((dt, elapsed) => {
    if (arrival) stepArrival(dt);
    controls.update(dt);
    decor.update(dt, elapsed);
    portal.update(dt, engine.camera.position);
    exhibits.update(dt, engine.camera, focused && focused.object);

    // raycast at ~20Hz rather than every frame; it is never the bottleneck but
    // there is no reason to pay for it 120 times a second either
    focusTimer += dt;
    if (focusTimer > 0.05) {
      focusTimer = 0;
      const next = pickFocus();
      const changed = (next && next.exhibit.id) !== (focused && focused.exhibit.id);
      focused = next;
      if (changed) ui.setFocus(focused ? focused.exhibit : null);
    }

    const idx = roomIndexAtZ(engine.camera.position.z);
    if (idx !== lastRoomIdx) {
      lastRoomIdx = idx;
      ui.setRoom(idx, rooms[idx]);
      if (keepHash) keepHash = false;
      else location.replace(`#${ROOMS[idx].id}`);
    }
  });

  // --- deep link: #roomId, or the #id of a free-standing exhibit --------------
  const wanted = ROOMS.findIndex((r) => `#${r.id}` === location.hash);
  if (wanted > 0) controls.teleportTo(0, roomCenterZ(wanted) + DIMS.roomD * 0.32, Math.PI);

  let stand = null;
  for (let i = 0; i < rooms.length && !stand; i++) {
    const exhibit = rooms[i].exhibits.find((e) => e.stand && `#${e.id}` === location.hash);
    if (exhibit) stand = { exhibit, room: i, spot: standSpot(i, exhibit.stand) };
  }
  if (stand) {
    const { spot } = stand;
    // The lectern faces (sin, cos) of its yaw; the visitor stands that way out
    // from it. A camera with the same yaw looks straight back down that line.
    const x1 = spot.x + Math.sin(spot.rotationY) * READ_DIST;
    const z1 = spot.z + Math.cos(spot.rotationY) * READ_DIST;
    // The reader panel covers the right of the screen, so looking straight at
    // the lectern would hide it. Turn right by exactly enough to centre it in
    // the strip the panel leaves. The width mirrors `.mus-reader-panel` in
    // museum.css (min(44rem, 56vw), never under 23rem); on a narrow screen the
    // panel takes everything and there is nothing to frame, so no turn.
    const vw = innerWidth || 1;
    const panel = Math.max(Math.min(704, vw * 0.56), Math.min(vw, 368));
    const tanHalf = Math.tan((engine.camera.fov * Math.PI) / 360) * engine.camera.aspect;
    const yaw1 = spot.rotationY - (panel < vw * 0.8 ? Math.atan((panel / vw) * tanHalf) : 0);
    keepHash = true;
    controls.setEnabled(false);       // the glide owns the camera until it lands
    const still = typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      controls.teleportTo(x1, z1, yaw1, READ_PITCH);
      arrival = { exhibit: stand.exhibit, x0: x1, z0: z1, x1, z1, yaw0: yaw1, yaw1, t: ARRIVE_HOLD + ARRIVE_GLIDE };
    } else {
      // Start straight out in front of the lectern, looking at it, and walk in.
      // The run is cut short so the start stays inside this room and never
      // nearer its entrance wall than the 1.8 m spawn line — in the atrium that
      // wall is the Open Reality portal, and standing in its zone opens a tab.
      const fx = Math.sin(spot.rotationY);
      const fz = Math.cos(spot.rotationY);
      const zNearLim = -stand.room * DIMS.roomD - 1.8;
      const zFarLim = -(stand.room + 1) * DIMS.roomD + 1.0;
      let run = ARRIVE_RUN;
      if (fz > 1e-3) run = Math.min(run, (zNearLim - z1) / fz);
      else if (fz < -1e-3) run = Math.min(run, (zFarLim - z1) / fz);
      run = Math.max(0, run);
      const x0 = x1 + fx * run;
      const z0 = z1 + fz * run;
      controls.teleportTo(x0, z0, spot.rotationY, 0);
      arrival = { exhibit: stand.exhibit, x0, z0, x1, z1, yaw0: spot.rotationY, yaw1, t: 0 };
    }
  }

  ui.setProgress(1, 'Ready');
  engine.start();
  ui.hideLoader();

  // An arrival opens the reader by itself, so it skips the entry gate; pointer
  // lock is taken later, on the gesture that closes the reader.
  ui.onEnter(() => { if (!engine.isMobile && !arrival) controls.lock(); });
  if (arrival) ui.enter();

  // expose for debugging / the perf overlay
  window.__museum = { engine, world, decor, exhibits, portal, controls, ui, rooms };
}

boot().catch((err) => {
  console.error('[museum] boot failed', err);
  const box = document.getElementById('boot-error');
  const reason = document.getElementById('boot-reason');
  const detail = document.getElementById('boot-detail');
  if (reason) reason.textContent = 'The museum started but failed while building the rooms.';
  if (detail) {
    detail.hidden = false;
    detail.textContent = (err && (err.stack || err.message) || String(err)).slice(0, 900);
  }
  if (box) box.hidden = false;
});
