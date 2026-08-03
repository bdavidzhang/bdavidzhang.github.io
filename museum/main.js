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
import { ROOMS, TUNING, DIMS, roomCenterZ, roomIndexAtZ } from './config.js';

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

  ui.setProgress(0.85, 'Calibrating');
  // controls: { update(dt), lock(), unlock(), get isLocked, teleportTo(x,z,yaw), setEnabled(b), dispose() }
  const controls = createControls({
    camera: engine.camera,
    domElement: canvas,
    // props are solid too, so the player walks around planters and desks
    colliders: world.colliders.concat(decor.colliders),
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

  function openFocused() {
    if (!focused) return;
    controls.unlock();
    ui.openReader(focused.exhibit);
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

  engine.onFrame((dt, elapsed) => {
    controls.update(dt);
    decor.update(dt, elapsed);
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
  window.__museum = { engine, world, decor, exhibits, controls, ui, rooms };
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
