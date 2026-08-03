// engine.js — renderer, scene, camera and the render loop.
//
// Lighting lives in lighting.js; this file owns the frame. The split is worth
// it because the rig is per-room state with its own transitions, while
// everything here is global and stateless between frames.
//
// Performance strategy:
//   * no shadow maps at all; depth comes from fog + baked-ish vertex tinting
//   * adaptive device-pixel-ratio: if frames run long we scale resolution down
//     before we ever start dropping frames
//   * per-room visibility culling — only current room ± TUNING.cullRadius is
//     ever submitted, so draw calls stay flat no matter how many rooms exist
//   * fog far plane sits well inside the camera far plane so culled rooms are
//     invisible rather than popping

import * as THREE from 'three';
import { PALETTE, TUNING, DIMS, roomIndexAtZ, roomCenterZ } from './config.js';
import { createLighting } from './lighting.js';

export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(PALETTE.bg, 1);
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  // Neutral starting values; the lighting rig owns these colours from its first
  // frame and re-lerps them per room. The distances stay here — they are the
  // engine's contract with the cull radius, not a per-room look.
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.Fog(PALETTE.fog, TUNING.fogNear, TUNING.fogFar);

  const isMobile = matchMedia('(pointer: coarse)').matches;
  const camera = new THREE.PerspectiveCamera(
    isMobile ? TUNING.fovMobile : TUNING.fovDesktop,
    1,
    TUNING.near,
    TUNING.far,
  );
  camera.position.set(0, DIMS.eyeH, -1.8);
  camera.rotation.order = 'YXZ';

  // --- lighting --------------------------------------------------------------
  // A fixed rig of four shadowless lights, retinted per room. The engine's only
  // jobs are to hand it the camera each frame and to tell it when the room
  // changes; the values, the tints and the cross-fade are lighting.js's.
  const lighting = createLighting(scene, camera, renderer);

  // --- adaptive resolution ---------------------------------------------------
  const maxDPR = Math.min(devicePixelRatio || 1, TUNING.maxDPR);
  let dpr = maxDPR;
  let frameAvg = 16;
  let sinceAdjust = 0;

  function applySize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
  }

  function adapt(dtMs) {
    frameAvg += (dtMs - frameAvg) * 0.08;
    sinceAdjust += dtMs;
    if (sinceAdjust < 700) return;
    sinceAdjust = 0;
    const prev = dpr;
    if (frameAvg > TUNING.targetFrameMs * 1.25 && dpr > TUNING.minDPR) {
      dpr = Math.max(TUNING.minDPR, dpr - 0.2);
    } else if (frameAvg < TUNING.targetFrameMs * 0.72 && dpr < maxDPR) {
      dpr = Math.min(maxDPR, dpr + 0.12);
    }
    if (dpr !== prev) applySize();
  }

  const onResize = () => applySize();
  addEventListener('resize', onResize, { passive: true });
  applySize();

  // --- per-room culling ------------------------------------------------------
  let roomGroups = [];
  let lastRoom = -1;

  function setRoomGroups(groups) {
    roomGroups = groups || [];
    lastRoom = -1;
  }

  function cull(force = false) {
    if (!roomGroups.length) return;
    const idx = roomIndexAtZ(camera.position.z);
    if (idx === lastRoom && !force) return;
    lastRoom = idx;
    const r = TUNING.cullRadius;
    for (let i = 0; i < roomGroups.length; i++) {
      const g = roomGroups[i];
      if (g) g.visible = Math.abs(i - idx) <= r;
    }
    // Retint on exactly the frames the visible set changes — including the
    // forced cull after a teleport, which the loop below would never see.
    // setRoom() is a no-op when the room is unchanged.
    lighting.setRoom(idx);
    return idx;
  }

  // --- loop ------------------------------------------------------------------
  const updaters = new Set();
  /** Register a per-frame callback: fn(dtSeconds, elapsedSeconds). */
  function onFrame(fn) {
    updaters.add(fn);
    return () => updaters.delete(fn);
  }

  let raf = 0;
  let last = performance.now();
  let elapsed = 0;
  let running = false;
  const stats = { fps: 0, dpr, drawCalls: 0, triangles: 0, room: 0 };

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dtMs = Math.min(now - last, 66); // clamp after tab-out
    last = now;
    const dt = dtMs / 1000;
    elapsed += dt;

    for (const fn of updaters) fn(dt, elapsed);

    // cull first so a room change starts its cross-fade on the same frame
    stats.room = cull() ?? stats.room;
    lighting.update(dt, camera);

    renderer.render(scene, camera);

    adapt(dtMs);
    stats.fps = 1000 / Math.max(frameAvg, 0.001);
    stats.dpr = dpr;
    stats.drawCalls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    renderer.info.reset();
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  // pause when the tab is hidden — saves battery and avoids a huge dt spike
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  function dispose() {
    stop();
    removeEventListener('resize', onResize);
    lighting.dispose();
    renderer.dispose();
  }

  return {
    renderer, scene, camera, stats, isMobile,
    onFrame, start, stop, dispose,
    setRoomGroups, cull, applySize,
    roomCenterZ,
  };
}
