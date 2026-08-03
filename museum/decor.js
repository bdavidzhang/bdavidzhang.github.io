// decor.js — the prop layer that gives each room its character.
//
// Architecture builds the shell (walls, floor, ceiling, doorways); this builds
// everything inside it. Each theme contributes a builder that receives a
// context object and returns meshes plus optional colliders, so a theme never
// touches three.js boilerplate, material caching or the room's coordinate frame.
//
// Performance contract for theme authors:
//   * repeated props MUST go through ctx.instanced() — a hedge is one draw call,
//     not forty
//   * materials come from ctx.mat() so they are shared and disposed once
//   * everything is parented into the room group, so per-room culling still
//     applies and a prop in room 5 costs nothing while you stand in room 0
//   * builders run once at load; update() is optional and must not allocate

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS, roomZRange, themeFor } from './config.js';

import { garden } from './themes/garden.js';
import { study } from './themes/study.js';
import { lab } from './themes/lab.js';
import { chalk } from './themes/chalk.js';
import { studio } from './themes/studio.js';
import { library } from './themes/library.js';

const BUILDERS = { garden, study, lab, chalk, studio, library };

const EDGE_ANGLE = 15;   // matches architecture.js so outlines read consistently

/** Deterministic PRNG. Props must land in the same place on every load. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDecor(rooms, world) {
  const group = new THREE.Group();
  group.name = 'decor';

  const materials = new Map();
  const geometries = new Set();
  const colliders = [];
  const updaters = [];

  /** Shared Lambert material, keyed by colour + extras. */
  function mat(color, extra) {
    const key = `${color}|${extra ? JSON.stringify(extra) : ''}`;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial(Object.assign({ color }, extra));
      materials.set(key, m);
    }
    return m;
  }

  /** Unlit material, for anything that should read as emitting light. */
  function glowMat(color, extra) {
    const key = `basic|${color}|${extra ? JSON.stringify(extra) : ''}`;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial(Object.assign({ color }, extra));
      materials.set(key, m);
    }
    return m;
  }

  /** Outline material, cached like the rest — otherwise it escapes dispose(). */
  function lineMat(color) {
    const key = `line|${color}`;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color });
      materials.set(key, m);
    }
    return m;
  }

  function track(geo) { geometries.add(geo); return geo; }

  function place(mesh, { x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.scale.set(sx, sy, sz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  const built = [];

  rooms.forEach((room, index) => {
    const theme = themeFor(index);
    const build = BUILDERS[theme.decor];
    if (!build) return;

    const [far, near] = roomZRange(index);
    const parent = world.roomGroups[index] || group;
    const rng = mulberry(0x9e3779b9 ^ (index * 2654435761));

    // Everything a theme is allowed to know about its room.
    const ctx = {
      THREE,
      room,
      index,
      theme,
      rng,
      // interior bounds, already inset by the wall thickness
      bounds: {
        minX: -DIMS.roomW / 2 + DIMS.wallT,
        maxX: DIMS.roomW / 2 - DIMS.wallT,
        minZ: far + DIMS.wallT,
        maxZ: near - DIMS.wallT,
        centerZ: (far + near) / 2,
        height: DIMS.roomH,
        doorW: DIMS.doorW,
        doorH: DIMS.doorH,
      },
      // Where this room's exhibit plates actually land, so a theme can place
      // shelving and panels around them instead of hardcoding coordinates that
      // silently go stale the moment an essay is added.
      anchors: (world.anchors.get(room.id) || []).slice(0, room.exhibits ? room.exhibits.length : 0),

      mat,
      glowMat,

      box(w, h, d, color, opts) {
        return place(new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)),
          typeof color === 'number' ? mat(color) : color), opts);
      },

      cylinder(rTop, rBottom, h, color, opts, segments = 10) {
        return place(new THREE.Mesh(track(new THREE.CylinderGeometry(rTop, rBottom, h, segments)),
          typeof color === 'number' ? mat(color) : color), opts);
      },

      sphere(r, color, opts, seg = 8) {
        return place(new THREE.Mesh(track(new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1))),
          typeof color === 'number' ? mat(color) : color), opts);
      },

      cone(r, h, color, opts, seg = 8) {
        return place(new THREE.Mesh(track(new THREE.ConeGeometry(r, h, seg)),
          typeof color === 'number' ? mat(color) : color), opts);
      },

      plane(w, h, color, opts) {
        return place(new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)),
          typeof color === 'number' ? mat(color) : color), opts);
      },

      /**
       * One draw call for many copies of the same shape.
       * @param {THREE.BufferGeometry} geo
       * @param {THREE.Material} material
       * @param {Array<object>} transforms - {x,y,z,ry,rx,rz,sx,sy,sz, col?}
       *   `col` (a hex int) tints that instance. Because per-instance colour
       *   MULTIPLIES the material colour, pass a white material when using it.
       */
      instanced(geo, material, transforms) {
        track(geo);
        const mesh = new THREE.InstancedMesh(geo, material, transforms.length);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        const col = new THREE.Color();
        const tinted = transforms.some((t) => t.col !== undefined);
        transforms.forEach((t, i) => {
          pos.set(t.x || 0, t.y || 0, t.z || 0);
          e.set(t.rx || 0, t.ry || 0, t.rz || 0);
          q.setFromEuler(e);
          scl.set(t.sx || 1, t.sy || 1, t.sz || 1);
          mesh.setMatrixAt(i, m.compose(pos, q, scl));
          if (tinted) mesh.setColorAt(i, col.set(t.col ?? 0xffffff));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.frustumCulled = true;
        return mesh;
      },

      /** Merge many one-off geometries sharing a material into one mesh. */
      merged(geos, material) {
        const list = geos.filter(Boolean);
        if (!list.length) return null;
        const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
        // mergeGeometries returns null when attribute sets disagree — e.g.
        // mixing indexed BoxGeometry with non-indexed PolyhedronGeometry. Fail
        // loudly here rather than handing `new THREE.Mesh(null, …)` downstream.
        if (!geo) {
          console.error('[museum] ctx.merged(): geometries have mismatched attributes '
            + '(indexed vs non-indexed?) — merge skipped');
          return null;
        }
        list.forEach(track);
        track(geo);
        const mesh = new THREE.Mesh(geo, material);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        return mesh;
      },

      /** Sketchbook-style edge outline for a prop, matching the architecture. */
      outline(source, color) {
        const geo = source.isBufferGeometry ? source : source.geometry;
        if (!geo) return null;
        const edges = track(new THREE.EdgesGeometry(geo, EDGE_ANGLE));
        const lines = new THREE.LineSegments(edges, lineMat(color ?? theme.ink));
        if (source.isMesh) {
          lines.position.copy(source.position);
          lines.rotation.copy(source.rotation);
          lines.scale.copy(source.scale);
        }
        lines.matrixAutoUpdate = false;
        lines.updateMatrix();
        return lines;
      },

      /** Mark a footprint as solid so the player walks around it. */
      collide(minX, maxX, minZ, maxZ) {
        colliders.push({ minX, maxX, minZ, maxZ });
      },

      place,
    };

    let result;
    try {
      result = build(ctx);
    } catch (err) {
      console.error(`[museum] decor "${theme.decor}" failed for room ${room.id}`, err);
      return;   // a broken theme must not take the whole museum down
    }
    if (!result) return;

    for (const node of result.meshes || []) if (node) parent.add(node);
    if (typeof result.update === 'function') updaters.push(result.update);
    built.push({ room: room.id, theme: theme.decor, meshes: (result.meshes || []).length });
  });

  return {
    group,
    colliders,
    built,
    update(dt, elapsed) {
      for (let i = 0; i < updaters.length; i++) updaters[i](dt, elapsed);
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials.values()) m.dispose();
      geometries.clear();
      materials.clear();
      updaters.length = 0;
    },
  };
}
