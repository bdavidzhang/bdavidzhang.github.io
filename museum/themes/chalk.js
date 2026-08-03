// chalk.js — Mathematics. Slate and chalk: two large blackboards flanking the
// end doorway, a chalk rail with sticks and erasers, a lectern, a demonstration
// table of Platonic solids, and one dodecahedron turning slowly on a plinth.
//
// Draw calls added: 8 — 4 merged meshes, 2 instanced meshes, 1 hero solid,
// 1 outline. The chalk marks (a Galois subgroup lattice on one board, working
// notes on the other) are ~40 boxes in a single InstancedMesh.

const CHALK_STICKS = 7;

// bounds is inset from the true wall faces; the cross wall's interior face
// sits this far outside bounds.minZ / bounds.maxZ.
const WALL_INSET_Z = 0.18;

// radians per second — one revolution roughly every 20s, slow enough to read
// as considered rather than spinning.
const SPIN = 0.31;

export function chalk(ctx) {
  const T = ctx.THREE;
  const b = ctx.bounds;
  const th = ctx.theme;
  const rng = ctx.rng;
  const cz = b.centerZ;
  const wallZ = b.minZ - WALL_INSET_Z;   // interior face of the far wall

  // --- palette ------------------------------------------------------------
  const _c1 = new T.Color();
  const _c2 = new T.Color();
  const mix = (a, c, t) => _c1.set(a).lerp(_c2.set(c), t).getHex();

  // A blackboard must stay dark in both modes — it is the one prop that should
  // NOT invert with theme.frame — so it is the wall's own hue, driven down.
  _c1.set(th.wall);
  const night = (_c1.r * 0.2126 + _c1.g * 0.7152 + _c1.b * 0.0722) < 0.4;

  const slateC = mix(th.wall, 0x000000, night ? 0.55 : 0.94);
  const woodC  = mix(th.rail, th.frame, 0.35);   // frames, lectern, table
  const chalkC = mix(th.glow, 0xffffff, 0.35);
  const solidC = mix(th.matte, th.accent, 0.28); // demonstration solids
  const heroC  = mix(th.glow, th.accent, 0.22);

  // --- geometry helpers (baked into world space, ready to merge) -----------
  const box = (w, h, d, x, y, z, rx) => {
    const g = new T.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    return g.translate(x, y, z);
  };
  const cyl = (rTop, rBot, h, x, y, z, seg = 10) =>
    new T.CylinderGeometry(rTop, rBot, h, seg).translate(x, y, z);

  const slate = [];
  const wood = [];
  const glow = [];

  // --- blackboards --------------------------------------------------------
  // On the end wall, either side of the doorway, so they never touch the
  // y=0.9..2.6 band the side-wall exhibit plates own.
  const BOARD_W = 3.8;
  const BOARD_H = 1.95;
  const boardY = 1.95;
  const boardX = [-3.85, 3.85];
  const faceZ = wallZ + 0.05;            // front surface of the slate
  const markZ = faceZ + 0.014;
  const bottomY = boardY - BOARD_H / 2;

  const ledgeY = bottomY - 0.10;
  const ledgeTop = ledgeY + 0.028;
  const ledgeZ = faceZ + 0.07;

  for (const bx of boardX) {
    slate.push(box(BOARD_W, BOARD_H, 0.16, bx, boardY, faceZ - 0.08));
    // frame
    wood.push(box(BOARD_W + 0.18, 0.09, 0.20, bx, boardY + BOARD_H / 2 + 0.045, faceZ - 0.06));
    wood.push(box(BOARD_W + 0.18, 0.09, 0.20, bx, bottomY - 0.045, faceZ - 0.06));
    wood.push(box(0.09, BOARD_H + 0.18, 0.20, bx - BOARD_W / 2 - 0.045, boardY, faceZ - 0.06));
    wood.push(box(0.09, BOARD_H + 0.18, 0.20, bx + BOARD_W / 2 + 0.045, boardY, faceZ - 0.06));
    // chalk rail
    wood.push(box(BOARD_W + 0.18, 0.055, 0.20, bx, ledgeY, ledgeZ));
  }

  // erasers, felt side up, resting on the rails
  slate.push(box(0.17, 0.06, 0.10, boardX[0] - 1.15, ledgeTop + 0.03, ledgeZ + 0.01));
  slate.push(box(0.17, 0.06, 0.10, boardX[0] + 1.42, ledgeTop + 0.03, ledgeZ + 0.01));
  slate.push(box(0.17, 0.06, 0.10, boardX[1] - 0.62, ledgeTop + 0.03, ledgeZ + 0.01));

  // chalk sticks, lying along the rail with a little yaw
  const stickXf = [];
  for (let i = 0; i < CHALK_STICKS; i++) {
    const bx = boardX[i % 2];
    stickXf.push({
      x: bx + (rng() - 0.5) * 3.4,
      y: ledgeTop + 0.017,
      z: ledgeZ + 0.02,
      rz: Math.PI / 2,
      ry: (rng() - 0.5) * 0.35,
    });
  }

  // --- chalk marks --------------------------------------------------------
  const markXf = [];
  function stroke(x1, y1, x2, y2, w) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    markXf.push({
      x: (x1 + x2) / 2, y: (y1 + y2) / 2, z: markZ,
      rz: Math.atan2(dy, dx), sx: len, sy: w,
    });
  }
  function dot(x, y, s) {
    markXf.push({ x, y, z: markZ, rz: 0, sx: s, sy: s });
  }

  // Left board: a subgroup lattice, the shape every Galois-theory lecture ends
  // up drawing. Fixed coordinates in board-local (u, v), so it is identical on
  // every load and legible from the corridor.
  const LU = 1.15;
  const LV = 0.72;
  const lx = (u) => boardX[0] + u * LU;
  const ly = (v) => boardY + v * LV;
  const nodes = [
    [0, 0.80], [-0.62, 0.15], [-0.21, 0.15], [0.21, 0.15], [0.62, 0.15], [0, -0.72],
  ];
  const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [2, 5], [3, 5], [4, 5]];
  for (const [a, c] of edges) {
    stroke(lx(nodes[a][0]), ly(nodes[a][1]), lx(nodes[c][0]), ly(nodes[c][1]), 0.018);
  }
  for (const [u, v] of nodes) dot(lx(u), ly(v), 0.075);
  // little labels hung off the nodes
  stroke(lx(0.10), ly(0.86), lx(0.32), ly(0.86), 0.020);
  for (let i = 1; i <= 4; i++) {
    const u = nodes[i][0];
    stroke(lx(u + 0.06), ly(0.05), lx(u + 0.20), ly(0.05), 0.020);
  }

  // Right board: working notes — rows of chalk with one rule underneath.
  const RU = 1.72;
  const RV = 0.74;
  for (let row = 0; row < 5; row++) {
    const y = boardY + (0.78 - row * 0.39) * RV;
    let x = boardX[1] - RU + (row === 2 ? 0.34 : 0);
    while (x < boardX[1] + RU - 0.12) {
      const len = 0.14 + rng() * 0.34;
      stroke(x, y, Math.min(x + len, boardX[1] + RU), y, 0.024);
      x += len + 0.09;
    }
    if (row === 1) {
      const yr = y - 0.13;
      stroke(boardX[1] - RU, yr, boardX[1] - RU + 1.05, yr, 0.016);
    }
  }

  // --- lectern ------------------------------------------------------------
  const lecX = -2.90;
  const lecZ = b.minZ + 2.40;
  wood.push(box(0.62, 0.07, 0.46, lecX, 0.035, lecZ));
  wood.push(box(0.17, 1.00, 0.17, lecX, 0.57, lecZ));
  wood.push(box(0.68, 0.05, 0.44, lecX, 1.14, lecZ, 0.30));           // sloped desk
  wood.push(box(0.68, 0.06, 0.05, lecX, 1.11, lecZ + 0.21, 0.30));    // page lip
  ctx.collide(lecX - 0.35, lecX + 0.35, lecZ - 0.28, lecZ + 0.28);

  // --- demonstration table ------------------------------------------------
  const tabX = 3.40;
  const tabZ = cz - 0.60;
  const TOP_Y = 0.90;
  wood.push(box(2.30, 0.08, 1.05, tabX, TOP_Y - 0.04, tabZ));
  for (const dx of [-1.03, 1.03]) {
    for (const dz of [-0.44, 0.44]) {
      wood.push(box(0.09, TOP_Y - 0.08, 0.09, tabX + dx, (TOP_Y - 0.08) / 2, tabZ + dz));
    }
  }
  ctx.collide(tabX - 1.20, tabX + 1.20, tabZ - 0.58, tabZ + 0.58);

  // Platonic solids. Different shapes cannot be instanced, but they share a
  // material and never move, so one merged mesh covers all three.
  const mountTop = TOP_Y + 0.02;
  // `lift` is each solid's own lowest-vertex distance, so they sit on the
  // mounts rather than sinking through the table top.
  const solids = [
    { g: new T.TetrahedronGeometry(0.22), x: tabX - 0.78, z: tabZ + 0.06, lift: 0.127 },
    { g: new T.OctahedronGeometry(0.21).rotateZ(Math.PI / 4), x: tabX, z: tabZ - 0.14, lift: 0.149 },
    { g: new T.IcosahedronGeometry(0.20), x: tabX + 0.75, z: tabZ + 0.10, lift: 0.170 },
  ];
  const solidGeos = [];
  for (const s of solids) {
    solidGeos.push(s.g.translate(s.x, mountTop + s.lift, s.z));
    wood.push(cyl(0.10, 0.10, 0.02, s.x, TOP_Y + 0.01, s.z));   // mount disc
  }

  // --- hero plinth: a dodecahedron, turning ------------------------------
  const heroX = -3.40;
  const heroZ = cz - 0.60;
  wood.push(box(0.80, 1.00, 0.80, heroX, 0.50, heroZ));
  wood.push(box(0.92, 0.07, 0.92, heroX, 1.035, heroZ));
  // the spindle reaches past the solid's inradius so no gap opens as it turns
  wood.push(cyl(0.02, 0.02, 0.21, heroX, 1.175, heroZ, 8));
  ctx.collide(heroX - 0.50, heroX + 0.50, heroZ - 0.50, heroZ + 0.50);

  // The solid and its outline ride in a Group so the parent's automatic matrix
  // update carries both; nothing is allocated per frame.
  const spinner = new T.Group();
  spinner.position.set(heroX, 1.50, heroZ);
  spinner.rotation.x = 0.35;
  const hero = ctx.merged([new T.DodecahedronGeometry(0.30)], ctx.mat(heroC));
  spinner.add(hero);
  const heroEdges = ctx.outline(hero);
  if (heroEdges) spinner.add(heroEdges);

  // --- pendant lamps ------------------------------------------------------
  // One over each display; the rod stops just short of the ceiling plane.
  const lampZ = cz - 0.60;
  const rodBase = 2.89;
  const rodTop = b.height - 0.02;
  for (const px of [heroX, tabX]) {
    glow.push(cyl(0.09, 0.24, 0.18, px, 2.80, lampZ, 12));
    wood.push(cyl(0.016, 0.016, rodTop - rodBase, px, (rodBase + rodTop) / 2, lampZ, 6));
  }

  // --- assemble -----------------------------------------------------------
  const meshes = [
    ctx.merged(slate, ctx.mat(slateC)),
    ctx.merged(wood, ctx.mat(woodC)),
    ctx.merged(glow, ctx.glowMat(th.glow)),
    ctx.merged(solidGeos, ctx.mat(solidC)),
    spinner,
    ctx.instanced(new T.BoxGeometry(1, 1, 0.012), ctx.mat(chalkC), markXf),
    ctx.instanced(new T.CylinderGeometry(0.016, 0.016, 0.085, 8), ctx.mat(chalkC), stickXf),
  ];

  function update(dt) {
    spinner.rotation.y += dt * SPIN;
  }

  return { meshes: meshes.filter(Boolean), update };
}
