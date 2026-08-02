// engine.js — renderer, scene, camera, lights and the render loop.
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

  // --- lighting: three cheap lights, no shadows -----------------------------
  const hemi = new THREE.HemisphereLight(PALETTE.ceiling, PALETTE.floor, 2.15);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(PALETTE.wall, 0.55);
  scene.add(ambient);

  // A single directional light that follows the player, so every room reads the
  // same without needing per-room lights.
  const key = new THREE.DirectionalLight(PALETTE.glow, 1.05);
  key.position.set(3, 8, 2);
  key.castShadow = false;
  scene.add(key);
  scene.add(key.target);

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

    // key light rides along with the camera so lighting is room-independent
    key.position.set(camera.position.x + 3, 8, camera.position.z + 3);
    key.target.position.set(camera.position.x, 0, camera.position.z - 4);
    key.target.updateMatrixWorld();

    stats.room = cull() ?? stats.room;

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
    renderer.dispose();
  }

  return {
    renderer, scene, camera, stats, isMobile,
    onFrame, start, stop, dispose,
    setRoomGroups, cull, applySize,
    roomCenterZ,
  };
}
