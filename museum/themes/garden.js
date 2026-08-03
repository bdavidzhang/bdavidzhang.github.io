// themes/garden.js — the Atrium: a planted courtyard under a glass roof.
//
// This is the first room, so it has to say "come in, and keep walking". Every
// prop is arranged around a flagstone path running the length of the centre:
// raised beds hug both side walls, four small trees stand in their own planters
// either side of the path, and a mullioned skylight fills the ceiling so the
// room reads as daylit from above rather than lit by the gallery strip.
//
// 12 draw calls: pavers · planter bodies · planter outline · soil · shrubs ·
// blossoms · trunks · canopy · skylight glass · mullions · pool · bench.

export function garden(ctx) {
  const { THREE, bounds: b, rng, theme } = ctx;
  const { Color } = THREE;
  const meshes = [];

  // --- colour ---------------------------------------------------------------
  const probe = new Color();
  const lum = (hex) => { probe.set(hex); return 0.299 * probe.r + 0.587 * probe.g + 0.114 * probe.b; };
  const shade = (hex, k) => new Color(hex).multiplyScalar(k).getHex();
  const mix = (a, c, t) => new Color(a).lerp(new Color(c), t).getHex();

  // Day walls sit just under the glow colour; night walls sit far below it, so
  // the ratio is a mode signal that comes straight from the theme. Intrinsic
  // colours (leaf, bark, soil) ride on it and dim with the palette instead of
  // needing a second set of hexes.
  const level = Math.min(1, Math.max(0.12, lum(theme.wall) / lum(theme.glow)));
  const organic = (hex, k = 1) => shade(hex, (0.32 + 0.68 * level) * k);

  const stoneMat = ctx.mat(mix(theme.rail, theme.wall, 0.35));
  const kerbMat = ctx.mat(shade(theme.rail, 0.72));   // darker than the paving
  const soilMat = ctx.mat(organic(0x54402f));
  const shrubMat = ctx.mat(organic(mix(0x5f8f4c, theme.rail, 0.14), 1.15));
  const leafMat = ctx.mat(organic(mix(0x74a35d, theme.rail, 0.10)));
  const barkMat = ctx.mat(organic(0x6d5238));
  const bloomMat = ctx.mat(mix(theme.glow, theme.wall, 0.50));
  const woodMat = ctx.mat(organic(0x8a6a48));
  const glassMat = ctx.glowMat(mix(theme.glow, theme.wall, 0.05));
  const waterMat = ctx.glowMat(mix(theme.glow, theme.rail, 0.45));

  // --- geometry helpers -----------------------------------------------------
  const boxGeo = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const jitter = (n) => (rng() - 0.5) * n;

  const zN = b.maxZ;          // entrance end
  const zF = b.minZ;          // far end, where the doorway is
  const cz = b.centerZ;

  // ---------------------------------------------------------------------------
  // 1. flagstone path — a change of floor material straight down the middle
  // ---------------------------------------------------------------------------
  const pavers = [];
  for (let z = zN - 0.85; z > zF + 0.4; z -= 1.06) {
    for (const px of [-1.06, 0, 1.06]) {
      pavers.push({
        x: px + jitter(0.05),
        y: 0.025,
        z: z + jitter(0.05),
        ry: jitter(0.05),
        sx: 0.96 + rng() * 0.08,
        sz: 0.96 + rng() * 0.08,
      });
    }
  }
  meshes.push(ctx.instanced(new THREE.BoxGeometry(0.94, 0.05, 0.94), stoneMat, pavers));

  // ---------------------------------------------------------------------------
  // 2. planters — the long wall beds, four tree boxes and the pool rim all share
  //    one material, so they merge into a single mesh (plus one outline).
  // ---------------------------------------------------------------------------
  const kerbs = [];
  const soils = [];
  const beds = [];            // {x0,x1,z0,z1,top} regions to plant into

  /** A raised bed: stone kerb, recessed soil, and a collider around it. */
  function planter(x0, x1, z0, z1, h) {
    const w = x1 - x0;
    const d = z1 - z0;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    kerbs.push(boxGeo(w, h, d, mx, h / 2, mz));
    soils.push(boxGeo(w - 0.28, 0.12, d - 0.28, mx, h - 0.10, mz));
    beds.push({ x0: x0 + 0.2, x1: x1 - 0.2, z0: z0 + 0.2, z1: z1 - 0.2, top: h - 0.04 });
  }

  // Long beds against the side walls. Nothing here climbs past 0.85m, so the
  // exhibit plates hanging at y≈1.75 stay clear. The collider runs on past the
  // bed into the wall so the player cannot squeeze into the gap behind it.
  const bedZ0 = zF + 0.9;
  const bedZ1 = zN - 2.4;
  const bedIn = 4.35;         // inner edge — sets the width of the corridor
  planter(b.minX, -bedIn, bedZ0, bedZ1, 0.50);
  planter(bedIn, b.maxX, bedZ0, bedZ1, 0.50);
  ctx.collide(b.minX - 0.6, -bedIn, bedZ0, bedZ1);
  ctx.collide(bedIn, b.maxX + 0.6, bedZ0, bedZ1);

  // Four tree boxes flanking the path.
  const treeX = 3.25;
  const trunks = [];
  const canopy = [];
  for (const tz of [cz + 3.2, cz - 3.2]) {
    for (const side of [-1, 1]) {
      const tx = side * treeX;
      planter(tx - 0.85, tx + 0.85, tz - 0.85, tz + 0.85, 0.44);
      ctx.collide(tx - 0.9, tx + 0.9, tz - 0.9, tz + 0.9);
      trunks.push({ x: tx, y: 1.58, z: tz, ry: rng() * Math.PI });

      // Three overlapping masses per tree, squashed so the canopy spreads
      // rather than balloons. The highest point stays under the skylight.
      const blob = (dx, y, dz, r) => canopy.push({
        x: tx + dx + jitter(0.08),
        y,
        z: tz + dz + jitter(0.08),
        sx: r, sy: r * 0.82, sz: r,
        ry: rng() * Math.PI,
        phase: rng() * Math.PI * 2,
      });
      blob(side * 0.18, 2.55, jitter(0.2), 0.95);
      blob(-side * 0.34, 3.02, 0.22, 0.78);
      blob(side * 0.05, 3.30, -0.26, 0.62);
    }
  }

  // Still pool, sunk into a matching kerb opposite the bench.
  const poolX = -treeX;
  const poolR = 1.1;
  const poolH = 0.36;
  kerbs.push(boxGeo(poolR * 2, poolH, poolR * 2, poolX, poolH / 2, cz));
  ctx.collide(poolX - poolR - 0.05, poolX + poolR + 0.05, cz - poolR - 0.05, cz + poolR + 0.05);

  const planterMesh = ctx.merged(kerbs, kerbMat);
  meshes.push(planterMesh);
  meshes.push(ctx.outline(planterMesh, theme.ink));   // the one hero outline
  meshes.push(ctx.merged(soils, soilMat));

  // ---------------------------------------------------------------------------
  // 3. massed planting — one instanced blob mesh for the whole room
  // ---------------------------------------------------------------------------
  const shrubs = [];
  const blooms = [];
  for (const bed of beds) {
    const n = Math.max(3, Math.round((bed.x1 - bed.x0) * (bed.z1 - bed.z0) * 1.5));
    for (let i = 0; i < n; i++) {
      const x = bed.x0 + rng() * (bed.x1 - bed.x0);
      const z = bed.z0 + rng() * (bed.z1 - bed.z0);
      const r = 0.17 + rng() * 0.16;
      const squash = 0.6 + rng() * 0.4;
      shrubs.push({ x, y: bed.top - 0.05, z, sx: r, sy: r * squash, sz: r, ry: rng() * Math.PI });
      if (rng() < 0.42) {
        blooms.push({
          x: x + jitter(r * 1.1),
          y: bed.top - 0.05 + r * squash * 0.8,
          z: z + jitter(r * 1.1),
        });
      }
    }
  }
  meshes.push(ctx.instanced(new THREE.SphereGeometry(1, 7, 5), shrubMat, shrubs));
  if (blooms.length) {
    meshes.push(ctx.instanced(new THREE.SphereGeometry(0.06, 5, 3), bloomMat, blooms));
  }

  // ---------------------------------------------------------------------------
  // 4. trees
  // ---------------------------------------------------------------------------
  meshes.push(ctx.instanced(new THREE.CylinderGeometry(0.13, 0.17, 2.4, 7), barkMat, trunks));
  const canopyMesh = ctx.instanced(new THREE.SphereGeometry(1, 7, 5), leafMat, canopy);
  meshes.push(canopyMesh);

  // ---------------------------------------------------------------------------
  // 5. skylight — one bright pane with a grid of glazing bars slung underneath,
  //    so the ceiling reads as glass for the price of two draw calls.
  // ---------------------------------------------------------------------------
  const glassW = (b.maxX - b.minX) - 1.5;
  const glassD = (zN - zF) - 2.6;
  const glassY = b.height - 0.12;
  const barY = glassY - 0.06;
  const halfW = glassW / 2;
  const halfD = glassD / 2;

  meshes.push(ctx.plane(glassW, glassD, glassMat, { y: glassY, z: cz, rx: Math.PI / 2 }));

  const bars = [
    boxGeo(glassW + 0.18, 0.12, 0.16, 0, barY, cz - halfD),
    boxGeo(glassW + 0.18, 0.12, 0.16, 0, barY, cz + halfD),
    boxGeo(0.16, 0.12, glassD + 0.18, -halfW, barY, cz),
    boxGeo(0.16, 0.12, glassD + 0.18, halfW, barY, cz),
  ];
  for (let i = 1; i < 5; i++) {
    bars.push(boxGeo(0.08, 0.10, glassD, -halfW + (glassW * i) / 5, barY, cz));
  }
  for (let j = 1; j < 6; j++) {
    bars.push(boxGeo(glassW, 0.10, 0.08, 0, barY, cz - halfD + (glassD * j) / 6));
  }
  meshes.push(ctx.merged(bars, stoneMat));

  // ---------------------------------------------------------------------------
  // 6. water and bench
  // ---------------------------------------------------------------------------
  const waterY = poolH - 0.05;
  const water = ctx.plane(poolR * 2 - 0.3, poolR * 2 - 0.3, waterMat,
    { x: poolX, y: waterY, z: cz, rx: -Math.PI / 2 });
  meshes.push(water);

  const benchX = treeX;
  const benchL = 1.7;
  meshes.push(ctx.merged([
    boxGeo(0.54, 0.07, benchL, benchX, 0.44, cz),                        // seat
    boxGeo(0.44, 0.42, 0.10, benchX - 0.02, 0.21, cz - benchL / 2 + 0.2),
    boxGeo(0.44, 0.42, 0.10, benchX - 0.02, 0.21, cz + benchL / 2 - 0.2),
    boxGeo(0.07, 0.46, benchL, benchX + 0.235, 0.70, cz),                // back
  ], woodMat));
  ctx.collide(benchX - 0.35, benchX + 0.35, cz - benchL / 2 - 0.1, cz + benchL / 2 + 0.1);

  // ---------------------------------------------------------------------------
  // update — a slow breeze through the canopy and a faint swell on the pool.
  // Temporaries are hoisted so the loop never allocates.
  // ---------------------------------------------------------------------------
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let clock = 0;

  return {
    meshes,
    update(dt, elapsed) {
      clock = typeof elapsed === 'number' ? elapsed : clock + (dt || 0);
      for (let i = 0; i < canopy.length; i++) {
        const t = canopy[i];
        const sway = Math.sin(clock * 0.62 + t.phase) * 0.045;
        pos.set(t.x + sway, t.y, t.z + Math.cos(clock * 0.47 + t.phase) * 0.03);
        euler.set(0, t.ry, sway * 0.5);
        quat.setFromEuler(euler);
        scl.set(t.sx, t.sy, t.sz);
        canopyMesh.setMatrixAt(i, m4.compose(pos, quat, scl));
      }
      canopyMesh.instanceMatrix.needsUpdate = true;

      water.position.y = waterY + Math.sin(clock * 0.8) * 0.004;
      water.updateMatrix();
    },
  };
}
