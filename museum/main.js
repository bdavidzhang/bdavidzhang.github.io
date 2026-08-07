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
import { ROOMS, TUNING, DIMS, roomCenterZ, roomIndexAtZ, themeFor } from './config.js';

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
  // controls: { update(dt), lock(), unlock(), get isLocked, teleportTo(x,z,yaw), setEnabled(b), dispose() }
  const controls = createControls({
    camera: engine.camera,
    domElement: canvas,
    // props are solid too, so the player walks around planters and desks — and
    // around the link lecterns, which stand on the floor rather than on a wall
    colliders: world.colliders.concat(decor.colliders, exhibits.colliders, portal.colliders),
    isMobile: engine.isMobile,
  });

  // The ring a tapped destination stands on. It lives at the scene root rather
  // than in a room group: it is chrome, it is visible only while someone is
  // walking to it, and it must not blink out with the room it happens to be in.
  engine.scene.add(controls.marker);

  // --- interaction: raycast forward, offer the nearest exhibit --------------
  const ray = new THREE.Raycaster();
  ray.far = TUNING.interactDist;
  const centre = new THREE.Vector2(0, 0);
  const tapNdc = new THREE.Vector2();
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
   * The exhibit under a point on the screen, or null. Same raycaster and so the
   * same TUNING.interactDist reach as the centre-screen focus: tap a plate you
   * could already read and you read it, tap one across the room and the tap
   * falls through to walking you over to it.
   */
  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    tapNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    ray.setFromCamera(tapNdc, engine.camera);
    const hits = ray.intersectObjects(exhibits.targets, false);
    for (const h of hits) {
      const ex = h.object.userData.exhibit;
      if (ex) return ex;
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
  function openExhibit(ex) {
    if (!ex) return;

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

    controls.unlock();
    ui.openReader(ex);
  }

  function openFocused() {
    if (focused) openExhibit(focused.exhibit);
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

  canvas.addEventListener('click', (e) => {
    if (ui.isReaderOpen()) return;

    if (engine.isMobile) {
      // Only a real tap counts. The click a browser sends at the end of a
      // look-drag or a shove on the walk pad is not a request to go anywhere.
      if (!controls.consumeTap()) return;
      // Tap something close enough to read and you read it; tap anywhere else
      // and you walk there. Both halves of the screen, so the gesture does not
      // depend on knowing where the invisible walk pad lives.
      const ex = pickAt(e.clientX, e.clientY);
      if (ex) openExhibit(ex);
      else controls.walkToScreen(e.clientX, e.clientY);
      return;
    }

    if (controls.isLocked && focused) openFocused();
    else controls.lock();
  });

  // --- per-frame -------------------------------------------------------------
  let lastRoomIdx = -1;
  let focusTimer = 0;

  engine.onFrame((dt, elapsed) => {
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
      location.replace(`#${ROOMS[idx].id}`);
    }
  });

  // --- deep link: #roomId ----------------------------------------------------
  const wanted = ROOMS.findIndex((r) => `#${r.id}` === location.hash);
  if (wanted > 0) controls.teleportTo(0, roomCenterZ(wanted) + DIMS.roomD * 0.32, Math.PI);

  ui.setProgress(1, 'Ready');
  engine.start();
  ui.hideLoader();

  ui.onEnter(() => { if (!engine.isMobile) controls.lock(); });

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
