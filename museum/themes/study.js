// themes/study.js — the Writing Wing: a warm, quiet room for reading.
//
// The wall band from y=0.9 to y=2.6 belongs to the exhibit plates, so nothing
// tall goes against the side walls. Instead the two full-height bookcases stand
// on the far cross wall either side of the doorway, where no plates hang, and
// the side walls get a low credenza and a desk that both stop below waist
// height. A rug pulls the middle of the room together without blocking it.
//
// 11 draw calls: joinery · joinery outline · books · paper · lamp hardware ·
// lampshade · lamplight · rug · rug border · wastebasket · crumpled drafts.

export function study(ctx) {
  const { THREE, bounds: b, rng, theme } = ctx;
  const { Color } = THREE;
  const meshes = [];

  // --- colour ---------------------------------------------------------------
  const probe = new Color();
  const lum = (hex) => { probe.set(hex); return 0.299 * probe.r + 0.587 * probe.g + 0.114 * probe.b; };
  const shade = (hex, k) => new Color(hex).multiplyScalar(k).getHex();
  const mix = (a, c, t) => new Color(a).lerp(new Color(c), t).getHex();

  // Same mode signal as the other themes: how far the wall sits below the glow.
  // Intrinsic colours (book cloth, wool) ride on it so night mode dims them.
  const level = Math.min(1, Math.max(0.12, lum(theme.wall) / lum(theme.glow)));
  const organic = (hex, k = 1) => shade(hex, (0.32 + 0.68 * level) * k);

  const woodMat = ctx.mat(shade(theme.rail, 0.70));
  const metalMat = ctx.mat(shade(theme.rail, 0.48));
  // Paper has to stay the brightest matte surface in the room. `matte` alone
  // goes dark at night, so it is pulled toward the glow colour instead.
  const paperMat = ctx.mat(mix(theme.matte, theme.glow, 0.42));
  const rugMat = ctx.mat(mix(organic(0x8a5a42), theme.rail, 0.28));
  const rugTrimMat = ctx.mat(mix(theme.rail, theme.wall, 0.30));
  const shadeMat = ctx.glowMat(theme.glow);
  const spillMat = ctx.glowMat(mix(theme.glow, theme.matte, 0.55));
  // Books carry their colour per instance, so the shared material is a plain
  // multiplier; every visible hue below is theme-derived.
  const bookMat = ctx.mat(0xffffff);

  // --- geometry helpers -----------------------------------------------------
  const boxGeo = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const jitter = (n) => (rng() - 0.5) * n;

  const zN = b.maxZ;          // doorway you came in by
  const zF = b.minZ;          // doorway onward
  const cz = b.centerZ;

  const joinery = [];         // every wooden piece, merged into one mesh
  const books = [];
  const papers = [];

  // Muted binding cloths, pulled toward the room's own rail colour so they
  // never fight the palette, then dimmed with the mode.
  const cloths = [0x8c4a3c, 0x6d7248, 0x3f5a74, 0xa8813c, 0x44614d, 0x7a4a5e, 0x5a5560]
    .map((c) => new Color(organic(mix(c, theme.rail, 0.18), 1.2)));
  cloths.push(new Color(shade(mix(theme.matte, theme.glow, 0.30), 0.9)));   // vellum spines

  /**
   * A packed run of standing spines. `axis` is the direction the run travels;
   * `cross` is the fixed coordinate on the other horizontal axis.
   */
  function bookRun(axis, from, to, cross, baseY, maxH, depth) {
    let p = from;
    while (p < to - 0.09) {
      if (rng() < 0.10) { p += 0.09 + rng() * 0.16; continue; }   // a gap
      const t = 0.042 + rng() * 0.05;                            // spine thickness
      const h = maxH * (0.66 + rng() * 0.34);
      const d = depth * (0.84 + rng() * 0.16);
      const lean = rng() < 0.09 ? jitter(0.18) : 0;
      const y = baseY + h / 2 + Math.abs(lean) * 0.05;
      books.push(axis === 'x'
        ? { x: p + t / 2, y, z: cross, sx: t, sy: h, sz: d, rz: lean, col: cloths[(rng() * cloths.length) | 0] }
        : { x: cross, y, z: p + t / 2, sx: d, sy: h, sz: t, rx: lean, col: cloths[(rng() * cloths.length) | 0] });
      p += t + 0.006;
    }
  }

  /** A short pile of volumes lying flat. */
  function bookStack(x, z, y, n) {
    let top = y;
    for (let i = 0; i < n; i++) {
      const h = 0.035 + rng() * 0.025;
      books.push({
        x: x + jitter(0.05), y: top + h / 2, z: z + jitter(0.05),
        sx: 0.19 + rng() * 0.05, sy: h, sz: 0.26 + rng() * 0.05,
        ry: jitter(0.3), col: cloths[(rng() * cloths.length) | 0],
      });
      top += h;
    }
    return top;
  }

  // ---------------------------------------------------------------------------
  // 1. bookcases — full height, on the blank far wall either side of the door
  // ---------------------------------------------------------------------------
  const caseD = 0.42;
  const caseH = 2.30;
  const caseZ = zF + caseD / 2;

  function bookcase(x0, x1) {
    const w = x1 - x0;
    const mx = (x0 + x1) / 2;
    joinery.push(
      boxGeo(0.05, caseH, caseD, x0 + 0.025, caseH / 2, caseZ),
      boxGeo(0.05, caseH, caseD, x1 - 0.025, caseH / 2, caseZ),
      boxGeo(w, 0.06, caseD, mx, caseH - 0.03, caseZ),
      boxGeo(w, 0.14, caseD, mx, 0.07, caseZ),                       // plinth
      boxGeo(w - 0.1, caseH - 0.22, 0.03, mx, caseH / 2, zF + 0.015), // back
    );
    const boards = [0.62, 1.16, 1.70];
    for (const y of boards) joinery.push(boxGeo(w - 0.1, 0.04, caseD - 0.04, mx, y, caseZ));

    const levels = [0.14, 0.64, 1.18, 1.72];
    const tops = [0.62, 1.16, 1.70, caseH - 0.06];
    for (let i = 0; i < levels.length; i++) {
      bookRun('x', x0 + 0.07, x1 - 0.07, caseZ + 0.05, levels[i], tops[i] - levels[i] - 0.05, 0.24);
    }
    ctx.collide(x0 - 0.05, x1 + 0.05, zF - 0.4, caseZ + caseD / 2 + 0.05);
  }

  // 1.3m of clearance either side of the 2.8m doorway
  bookcase(-5.9, -2.7);
  bookcase(2.7, 5.9);

  // ---------------------------------------------------------------------------
  // 2. low credenza along the right wall — stops at 0.8m, well under the plates
  // ---------------------------------------------------------------------------
  const credX1 = b.maxX;
  const credX0 = credX1 - 0.95;
  const credH = 0.80;
  const credZ0 = cz - 3.3;
  const credZ1 = cz + 3.3;
  const credMx = (credX0 + credX1) / 2;
  const credMz = (credZ0 + credZ1) / 2;
  joinery.push(
    boxGeo(0.95, credH, 0.05, credMx, credH / 2, credZ0 + 0.025),
    boxGeo(0.95, credH, 0.05, credMx, credH / 2, credZ1 - 0.025),
    boxGeo(0.95, 0.06, credZ1 - credZ0, credMx, credH - 0.03, credMz),
    boxGeo(0.95, 0.14, credZ1 - credZ0, credMx, 0.07, credMz),
    boxGeo(0.03, credH - 0.22, credZ1 - credZ0 - 0.1, credX1 - 0.015, credH / 2, credMz),
  );
  bookRun('z', credZ0 + 0.12, credZ1 - 0.12, credMx - 0.06, 0.14, 0.52, 0.26);
  bookRun('z', cz - 1.6, cz + 0.3, credMx + 0.05, credH - 0.03, 0.30, 0.22);   // a run on top
  bookStack(credMx, cz + 1.6, credH - 0.03, 4);
  ctx.collide(credX0 - 0.05, credX1 + 0.6, credZ0 - 0.05, credZ1 + 0.05);

  // ---------------------------------------------------------------------------
  // 3. writing desk, chair and side table on the left
  // ---------------------------------------------------------------------------
  const deskX = -4.2;
  const deskZ = cz + 2.6;
  const deskTop = 0.75;
  joinery.push(
    boxGeo(0.88, 0.07, 1.95, deskX, deskTop - 0.035, deskZ),
    boxGeo(0.72, 0.15, 0.55, deskX, 0.60, deskZ - 0.45),                 // drawer
    boxGeo(0.04, 0.34, 1.70, deskX - 0.42, 0.52, deskZ),                 // modesty panel
  );
  for (const dx of [-0.36, 0.36]) {
    for (const dz of [-0.89, 0.89]) {
      joinery.push(boxGeo(0.07, 0.68, 0.07, deskX + dx, 0.34, deskZ + dz));
    }
  }
  ctx.collide(deskX - 0.55, deskX + 0.55, deskZ - 1.1, deskZ + 1.1);

  // chair, drawn up to the desk and facing it
  const chairX = deskX + 1.05;
  joinery.push(
    boxGeo(0.48, 0.06, 0.48, chairX, 0.44, deskZ),
    boxGeo(0.06, 0.52, 0.44, chairX + 0.21, 0.72, deskZ),
  );
  for (const dx of [-0.2, 0.2]) {
    for (const dz of [-0.2, 0.2]) {
      joinery.push(boxGeo(0.05, 0.41, 0.05, chairX + dx, 0.205, deskZ + dz));
    }
  }
  ctx.collide(chairX - 0.3, chairX + 0.3, deskZ - 0.3, deskZ + 0.3);

  // side table with a pile of things half-read
  const sideX = b.minX + 1.05;
  const sideZ = zN - 2.2;
  joinery.push(boxGeo(0.62, 0.05, 0.62, sideX, 0.525, sideZ));
  for (const dx of [-0.26, 0.26]) {
    for (const dz of [-0.26, 0.26]) {
      joinery.push(boxGeo(0.05, 0.50, 0.05, sideX + dx, 0.25, sideZ + dz));
    }
  }
  const stackTop = bookStack(sideX, sideZ, 0.55, 3);
  papers.push({ x: sideX + 0.04, y: stackTop + 0.005, z: sideZ - 0.02, ry: jitter(0.5) });
  ctx.collide(sideX - 0.36, sideX + 0.36, sideZ - 0.36, sideZ + 0.36);

  // desk clutter
  bookStack(deskX + 0.1, deskZ + 0.62, deskTop, 3);
  for (let i = 0; i < 3; i++) {
    papers.push({ x: deskX + 0.06 + jitter(0.16), y: deskTop + 0.004 + i * 0.004, z: deskZ + jitter(0.3), ry: jitter(0.45) });
  }
  papers.push({ x: credMx - 0.1, y: credH + 0.004, z: cz + 2.5, ry: jitter(0.5) });

  const joineryMesh = ctx.merged(joinery, woodMat);
  meshes.push(joineryMesh);
  meshes.push(ctx.outline(joineryMesh, theme.ink));   // the one hero outline

  // ---------------------------------------------------------------------------
  // 4. the lamp — the only real light source the room admits to
  // ---------------------------------------------------------------------------
  const lampX = deskX - 0.14;
  const lampZ = deskZ - 0.6;
  meshes.push(ctx.merged([
    new THREE.CylinderGeometry(0.13, 0.145, 0.035, 12).translate(lampX, deskTop + 0.017, lampZ),
    boxGeo(0.045, 0.52, 0.045, lampX, deskTop + 0.30, lampZ),
  ], metalMat));
  meshes.push(ctx.cone(0.21, 0.26, shadeMat, { x: lampX, y: deskTop + 0.61, z: lampZ }, 14));

  // the pool of light it throws on the desktop
  const spillY = deskTop + 0.008;
  const spill = ctx.cylinder(0.44, 0.44, 0.004, spillMat, { x: deskX, y: spillY, z: lampZ + 0.1 }, 18);
  meshes.push(spill);

  // ---------------------------------------------------------------------------
  // 5. rug, laid down the centre — flat, so it dresses the corridor without
  //    narrowing it
  // ---------------------------------------------------------------------------
  const rugW = 3.8;
  const rugD = 5.8;
  const rugZ = cz - 0.2;
  meshes.push(ctx.plane(rugW, rugD, rugMat, { y: 0.012, z: rugZ, rx: -Math.PI / 2 }));
  const trim = 0.16;
  meshes.push(ctx.merged([
    boxGeo(rugW - 0.5, 0.004, trim, 0, 0.018, rugZ - rugD / 2 + 0.32),
    boxGeo(rugW - 0.5, 0.004, trim, 0, 0.018, rugZ + rugD / 2 - 0.32),
    boxGeo(trim, 0.004, rugD - 0.5, -rugW / 2 + 0.32, 0.018, rugZ),
    boxGeo(trim, 0.004, rugD - 0.5, rugW / 2 - 0.32, 0.018, rugZ),
  ], rugTrimMat));

  // ---------------------------------------------------------------------------
  // 6. wastebasket of abandoned drafts
  // ---------------------------------------------------------------------------
  const binX = deskX - 0.02;
  const binZ = deskZ - 1.45;
  meshes.push(ctx.cylinder(0.19, 0.15, 0.42, woodMat, { x: binX, y: 0.21, z: binZ }, 12));
  ctx.collide(binX - 0.2, binX + 0.2, binZ - 0.2, binZ + 0.2);

  const crumples = [];
  for (let i = 0; i < 3; i++) {
    crumples.push({
      x: binX + jitter(0.16), y: 0.40 + rng() * 0.05, z: binZ + jitter(0.16),
      sx: 0.8 + rng() * 0.4, sy: 0.8 + rng() * 0.4, sz: 0.8 + rng() * 0.4,
      ry: rng() * Math.PI,
    });
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.35 + rng() * 0.45;
    crumples.push({
      x: binX + Math.cos(a) * r, y: 0.06, z: binZ + Math.sin(a) * r,
      sx: 0.7 + rng() * 0.3, sy: 0.7 + rng() * 0.3, sz: 0.7 + rng() * 0.3,
      ry: rng() * Math.PI,
    });
  }
  meshes.push(ctx.instanced(new THREE.SphereGeometry(0.075, 5, 3), paperMat, crumples));

  // ---------------------------------------------------------------------------
  // 7. the instanced sets — every book in the room is one draw call, tinted per
  //    instance; every loose sheet is another
  // ---------------------------------------------------------------------------
  const bookMesh = ctx.instanced(new THREE.BoxGeometry(1, 1, 1), bookMat, books);
  for (let i = 0; i < books.length; i++) bookMesh.setColorAt(i, books[i].col);
  if (bookMesh.instanceColor) bookMesh.instanceColor.needsUpdate = true;
  meshes.push(bookMesh);

  meshes.push(ctx.instanced(new THREE.BoxGeometry(0.21, 0.005, 0.29), paperMat, papers));

  // A barely-there flicker on the lamplight; the room is meant to be quiet.
  let clock = 0;
  return {
    meshes,
    update(dt, elapsed) {
      clock = typeof elapsed === 'number' ? elapsed : clock + (dt || 0);
      const k = 1 + Math.sin(clock * 1.7) * 0.012 + Math.sin(clock * 0.53) * 0.008;
      spill.scale.set(k, 1, k);
      spill.updateMatrix();
    },
  };
}
