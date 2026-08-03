// architecture.js — the building. Rooms form an enfilade running along -Z,
// joined by doorways cut into the shared walls.
//
// Performance strategy:
//   * every static surface in a room is baked into world space and merged, so a
//     room is 6 draw calls total: walls, floor, ceiling, skirting, light strip,
//     outlines. Adding rooms costs draw calls linearly, not per surface.
//   * materials are shared per THEME, not per room: the six themes in config.js
//     cost six material sets however many rooms use them, and two rooms with the
//     same theme render from the same materials.
//   * the drei-style <Edges threshold={15}> look is reproduced with
//     EdgesGeometry, merged per room into a single LineSegments.
//
// Cull-safety note: the engine only shows the current room ± 1. A wall shared by
// two rooms is therefore split down its middle, each room owning the half slab
// on its own side. That way the *visible face* of every wall you can possibly
// see always belongs to a room that is currently drawn — no holes when you look
// through two doorways at once — and no two coplanar meshes ever z-fight.
//
// Now that adjacent rooms carry different themes, each half of a divider is
// coloured by the room that owns it, so the threshold is where the material
// changes. The halves meet at the boundary plane but do not overlap: the two
// faces that touch there are back to back, one of them is always the far side of
// a solid slab, and both materials cull back faces — so the seam is a colour
// change, never z-fighting. The two halves do emit coincident *outline* segments
// on that plane; harmless while every theme shares one ink, but give themes
// distinct ink colours and those lines will need one side suppressed.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS, THEMES, themeFor, roomZRange, roomCenterZ } from './config.js';

const EDGE_ANGLE = 15;        // matches drei's <Edges threshold={15}>
const FACE_OFFSET = 0.02;     // anchors float this far proud of the wall face,
                              // i.e. wallT/2 + 0.02 out from the wall centreline
const RAIL_H = 0.14;          // skirting height
const RAIL_D = 0.05;          // how far the skirting stands proud of the wall
const STRIP_W = 1.2;          // ceiling light strip width
const STRIP_INSET = 2.2;      // gap between the strip and each end wall

const ANCHOR_Y = 1.75;        // nominal centre height of a display slot
const WALL_MARGIN = 1.15;     // clearance between a hanging run and the corners
const MIN_PITCH = 1.55;       // tightest spacing along a wall before we stack rows
const MAX_SLOT_W = 2.15;
const MAX_SLOT_H = 1.5;
const ROW_PITCH = 1.25;
const COLLIDER_PAD = 0.06;    // colliders are a touch fatter than the visual wall

// ---------------------------------------------------------------------------
// geometry helpers — everything is pre-baked into world space so it can merge
// ---------------------------------------------------------------------------

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Horizontal plane. `up` picks which way the single face points. */
function slab(w, d, y, z, up) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, y, z);
  return g;
}

/** 256px of white noise; the material colour does the actual tinting. */
function makeGrainTexture() {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 229 + ((Math.random() * 27) | 0);
    d[i] = n;
    d[i + 1] = n;
    d[i + 2] = n;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(DIMS.roomW / 2, DIMS.roomD / 2); // roughly 2m tiles
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The seven shell materials for one theme. `grain` is shared by every theme —
 *  the noise is white and each floor material tints it, so themes cost no VRAM. */
function createThemeMaterials(theme, grain) {
  const lambert = (color, extra) =>
    new THREE.MeshLambertMaterial(Object.assign({ color }, extra));

  return {
    wall:    lambert(theme.wall),
    wallAlt: lambert(theme.wallAlt),
    ceiling: lambert(theme.ceiling),
    floor:   lambert(theme.floor, grain ? { map: grain } : null),
    rail:    lambert(theme.rail),
    glow:    new THREE.MeshBasicMaterial({ color: theme.glow }),
    // outlines are keyed to the room's own ink so they stay legible against its
    // walls whether the museum is in day or night mode
    ink:     new THREE.LineBasicMaterial({ color: theme.ink }),
  };
}

/**
 * Lazily builds one material set per theme name. Six themes therefore produce
 * six sets no matter how many rooms exist, and rooms sharing a theme share
 * materials — which is what keeps the renderer batching them together.
 */
function createMaterialCache() {
  const grain = makeGrainTexture();
  const sets = new Map();

  return {
    get(name, theme) {
      let set = sets.get(name);
      if (!set) {
        set = createThemeMaterials(theme, grain);
        sets.set(name, set);
      }
      return set;
    },
    dispose() {
      for (const set of sets.values()) {
        for (const mat of Object.values(set)) mat.dispose();
      }
      if (grain) grain.dispose();   // one texture behind every floor material
      sets.clear();
    },
  };
}

// Reverse lookup so a theme object resolved by any route still hits the cache
// under a stable key.
const THEME_NAMES = new Map(Object.entries(THEMES).map(([name, theme]) => [theme, name]));

/**
 * A room's theme. The room object wins over the index so buildWorld keeps
 * working on room lists that didn't come straight out of config.ROOMS (the
 * tests build their own).
 */
function themeOf(room, index) {
  const theme = (room && THEMES[room.theme]) || themeFor(index);
  return { name: THEME_NAMES.get(theme) || `room-${index}`, theme };
}

/** Merge a bucket of geometries into one static mesh, or null if empty. */
function mergedMesh(geos, material, name) {
  if (!geos.length) return null;
  let geo;
  if (geos.length === 1) {
    geo = geos[0];
  } else {
    geo = mergeGeometries(geos, false);
    if (!geo) return null;
    for (const g of geos) g.dispose();
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

function mergedOutline(geos, material, name) {
  if (!geos.length) return null;
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!geo) return null;
  if (geos.length > 1) for (const g of geos) g.dispose();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const lines = new THREE.LineSegments(geo, material);
  lines.name = name;
  lines.matrixAutoUpdate = false;
  lines.updateMatrix();
  return lines;
}

// ---------------------------------------------------------------------------
// anchors — where exhibits hang
// ---------------------------------------------------------------------------

/**
 * How many rows of slots a room needs, and at what heights. Worked out once per
 * room from the busiest wall so every wall in the room hangs at the same
 * heights. One row at eye level is the normal case; extra rows only appear when
 * slots would otherwise get tighter than MIN_PITCH along the run.
 */
function rowPlan(maxCount, minRun) {
  const maxCols = Math.max(1, Math.floor(minRun / MIN_PITCH));
  const rows = Math.max(1, Math.ceil(maxCount / maxCols));

  // vertical: 0.5m clear at the floor, 0.45m at the ceiling
  const usableH = DIMS.roomH - 0.95;
  const rowPitch = rows > 1 ? Math.min(ROW_PITCH, usableH / rows) : 0;
  const height = Math.max(0.5, Math.min(MAX_SLOT_H, rows > 1 ? rowPitch - 0.22 : MAX_SLOT_H));

  // centre the stack on ANCHOR_Y, then slide it back inside the room if needed
  const half = ((rows - 1) / 2) * rowPitch;
  let shift = 0;
  if (ANCHOR_Y - half - height / 2 < 0.5) shift = 0.5 - (ANCHOR_Y - half - height / 2);
  const top = ANCHOR_Y + half + height / 2;
  if (top + shift > DIMS.roomH - 0.45) shift = DIMS.roomH - 0.45 - top;

  const ys = [];
  for (let r = 0; r < rows; r++) ys.push(ANCHOR_Y + half - r * rowPitch + shift);

  return { rows, height, ys };
}

/**
 * Anchors for one room. Side walls always; the last room also dresses its back
 * wall. Returns them interleaved left/right/back and ordered from the entrance
 * inwards, so exhibits[0] lands on the first thing you walk past.
 */
function layoutAnchors(room, index, isLast) {
  const [zFar, zNear] = roomZRange(index);
  const halfW = DIMS.roomW / 2;
  const exhibits = Array.isArray(room.exhibits) ? room.exhibits.length : 0;
  const need = Math.max(4, exhibits);

  const walls = isLast ? ['left', 'right', 'back'] : ['left', 'right'];
  const per = walls.map((_, k) =>
    Math.floor(need / walls.length) + (k < need % walls.length ? 1 : 0));

  const runOf = (wall) => (wall === 'back' ? DIMS.roomW : DIMS.roomD) - 2 * WALL_MARGIN;
  const plan = rowPlan(Math.max(...per), Math.min(...walls.map(runOf)));

  const lists = walls.map((wall, k) => {
    const count = per[k];
    if (count <= 0) return [];
    const runLen = runOf(wall);
    // rows are fixed for the whole room, so the columns fall out of the count
    const cols = Math.max(1, Math.ceil(count / plan.rows));
    const pitch = runLen / cols;
    const width = Math.max(0.6, Math.min(MAX_SLOT_W, pitch - 0.35));
    const out = [];

    for (let c = 0; c < cols && out.length < count; c++) {
      // side walls run from the entrance (zNear) inwards; the back wall runs +X
      const along = (c + 0.5) * pitch;
      for (let r = 0; r < plan.rows && out.length < count; r++) {
        let x;
        let z;
        let rotationY;
        if (wall === 'left') {
          x = -halfW + FACE_OFFSET;
          z = zNear - WALL_MARGIN - along;
          rotationY = Math.PI / 2;        // a plane's +Z now points at +X
        } else if (wall === 'right') {
          x = halfW - FACE_OFFSET;
          z = zNear - WALL_MARGIN - along;
          rotationY = -Math.PI / 2;
        } else {
          x = -halfW + WALL_MARGIN + along;
          z = zFar + FACE_OFFSET;
          rotationY = 0;
        }
        out.push({
          position: new THREE.Vector3(x, plan.ys[r], z),
          rotationY,
          width,
          height: plan.height,
          wall,
        });
      }
    }
    return out;
  });

  const ordered = [];
  const longest = lists.reduce((n, l) => Math.max(n, l.length), 0);
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (list[i]) ordered.push(list[i]);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// colliders — axis-aligned XZ boxes, one per solid wall segment
// ---------------------------------------------------------------------------

function buildColliders(count) {
  const { roomW, roomD, wallT, doorW } = DIMS;
  const halfW = roomW / 2;
  const out = [];

  for (let i = 0; i < count; i++) {
    const [zFar, zNear] = roomZRange(i);
    // side walls, padded inward so the near plane never pokes through
    out.push({ minX: -halfW - wallT, maxX: -halfW + COLLIDER_PAD, minZ: zFar, maxZ: zNear });
    out.push({ minX: halfW - COLLIDER_PAD, maxX: halfW + wallT, minZ: zFar, maxZ: zNear });
  }

  // cross walls: one pass over the boundaries so shared walls are emitted once
  for (let k = 0; k <= count; k++) {
    const z = -k * roomD;
    const solid = k === 0 || k === count;
    // end walls sit just outside the building; dividers straddle the boundary
    let minZ;
    let maxZ;
    if (k === 0) { minZ = -COLLIDER_PAD; maxZ = wallT; }
    else if (k === count) { minZ = z - wallT; maxZ = z + COLLIDER_PAD; }
    else { minZ = z - wallT / 2 - COLLIDER_PAD; maxZ = z + wallT / 2 + COLLIDER_PAD; }

    if (solid) {
      out.push({ minX: -halfW - wallT, maxX: halfW + wallT, minZ, maxZ });
    } else {
      // two panels; the doorway gap deliberately gets no collider
      out.push({ minX: -halfW - wallT, maxX: -doorW / 2, minZ, maxZ });
      out.push({ minX: doorW / 2, maxX: halfW + wallT, minZ, maxZ });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// main build
// ---------------------------------------------------------------------------

/**
 * @param {Array<{id: string, theme: string, exhibits: Array}>} rooms
 * @returns {{group: THREE.Group, colliders: Array, anchors: Map, roomGroups: Array, dispose: Function}}
 */
export function buildWorld(rooms) {
  const list = Array.isArray(rooms) ? rooms : [];
  const count = list.length;
  const cache = createMaterialCache();

  const group = new THREE.Group();
  group.name = 'museum-architecture';
  group.matrixAutoUpdate = false;
  group.updateMatrix();

  const roomGroups = [];
  const anchors = new Map();

  const { roomW, roomH, roomD, wallT, doorW, doorH } = DIMS;
  const halfW = roomW / 2;

  for (let i = 0; i < count; i++) {
    const room = list[i];
    const isLast = i === count - 1;
    const [zFar, zNear] = roomZRange(i);
    const cz = roomCenterZ(i);
    const { name: themeName, theme } = themeOf(room, i);
    const mats = cache.get(themeName, theme);

    const wallGeos = [];
    const floorGeos = [];
    const ceilGeos = [];
    const railGeos = [];
    const glowGeos = [];
    const edgeGeos = [];

    const put = (bucket, geo, outline) => {
      bucket.push(geo);
      if (outline !== false) edgeGeos.push(new THREE.EdgesGeometry(geo, EDGE_ANGLE));
    };

    // --- floor + ceiling ---------------------------------------------------
    put(floorGeos, slab(roomW, roomD, 0, cz, true));
    put(ceilGeos, slab(roomW, roomD, roomH, cz, false));

    // --- side walls: bodies sit outside the room so the interior is exactly
    //     roomW wide and the anchor maths stays honest ------------------------
    put(wallGeos, box(wallT, roomH, roomD, -(roomW + wallT) / 2, roomH / 2, cz));
    put(wallGeos, box(wallT, roomH, roomD, (roomW + wallT) / 2, roomH / 2, cz));

    // --- skirting ----------------------------------------------------------
    put(railGeos, box(RAIL_D, RAIL_H, roomD, -halfW + RAIL_D / 2, RAIL_H / 2, cz));
    put(railGeos, box(RAIL_D, RAIL_H, roomD, halfW - RAIL_D / 2, RAIL_H / 2, cz));

    // --- cross walls -------------------------------------------------------
    // A doorway is built from a left panel, a right panel and a lintel; no CSG.
    const panelW = halfW + wallT - doorW / 2;
    const panelX = (halfW + wallT + doorW / 2) / 2;

    const doorway = (centreZ, depth) => {
      put(wallGeos, box(panelW, roomH, depth, -panelX, roomH / 2, centreZ));
      put(wallGeos, box(panelW, roomH, depth, panelX, roomH / 2, centreZ));
      put(wallGeos, box(doorW, roomH - doorH, depth, 0, (roomH + doorH) / 2, centreZ));
    };
    const solidEnd = (centreZ) => {
      put(wallGeos, box(roomW + 2 * wallT, roomH, wallT, 0, roomH / 2, centreZ));
    };

    // near side (towards the entrance)
    if (i === 0) solidEnd(zNear + wallT / 2);
    else doorway(zNear - wallT / 4, wallT / 2); // this room's half of the shared wall
    // far side
    if (isLast) solidEnd(zFar - wallT / 2);
    else doorway(zFar + wallT / 4, wallT / 2);

    // --- recessed ceiling strip -------------------------------------------
    put(glowGeos, slab(STRIP_W, roomD - 2 * STRIP_INSET, roomH - 0.02, cz, false));

    // --- merge -------------------------------------------------------------
    // Both wall tones come from this room's own theme. They alternate by room so
    // that two neighbours sharing a theme still read as separate spaces; the
    // alternative — splitting side walls from cross walls inside one room — would
    // want a second wall mesh, and 6 draw calls per room is the budget.
    const wallMat = i % 2 === 0 ? mats.wall : mats.wallAlt;
    const meshes = [
      mergedMesh(wallGeos, wallMat, 'walls'),
      mergedMesh(floorGeos, mats.floor, 'floor'),
      mergedMesh(ceilGeos, mats.ceiling, 'ceiling'),
      mergedMesh(railGeos, mats.rail, 'skirting'),
      mergedMesh(glowGeos, mats.glow, 'light'),
      mergedOutline(edgeGeos, mats.ink, 'outline'),
    ];

    const roomGroup = new THREE.Group();
    roomGroup.name = `room-${room.id || i}`;
    roomGroup.userData.roomIndex = i;
    roomGroup.userData.theme = theme;
    roomGroup.userData.themeName = themeName;
    roomGroup.matrixAutoUpdate = false;
    roomGroup.updateMatrix();

    const bounds = new THREE.Box3();
    for (const mesh of meshes) {
      if (!mesh) continue;
      roomGroup.add(mesh);
      if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox);
    }
    // meshes are frustum-culled individually (default); this is for the map UI
    // and anything else that wants to reason about a room's extent
    roomGroup.userData.bounds = bounds;

    group.add(roomGroup);
    roomGroups.push(roomGroup);
    anchors.set(String(room.id != null ? room.id : i), layoutAnchors(room, i, isLast));
  }

  group.updateMatrixWorld(true);

  function dispose() {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
    cache.dispose();
    for (const rg of roomGroups) rg.clear();
    group.clear();
    if (group.parent) group.parent.remove(group);
  }

  return {
    group,
    colliders: buildColliders(count),
    anchors,
    roomGroups,
    dispose,
  };
}
