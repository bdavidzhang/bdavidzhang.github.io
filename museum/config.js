// config.js — single source of truth for world layout, palette and tuning.
// Every other museum module imports from here. Nothing here touches the DOM
// except the one prefers-color-scheme query used to pick a palette.

export const isDark =
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-color-scheme: dark)').matches;

const LIGHT = {
  bg:      0xede9e1,
  fog:     0xede9e1,
  wall:    0xf5f2ea,
  wallAlt: 0xebe6db,
  ceiling: 0xfaf8f3,
  floor:   0xd9d3c6,
  rail:    0xc9c0ad,
  frame:   0x2b2620,
  ink:     0x231f1a,   // outline colour
  matte:   0xfbf9f4,   // exhibit card face
  accent:  0x0070f3,
  glow:    0xfff6e2,
};

const DARK = {
  bg:      0x0d0d0f,
  fog:     0x0d0d0f,
  wall:    0x1b1b1f,
  wallAlt: 0x232328,
  ceiling: 0x141417,
  floor:   0x0f0f11,
  rail:    0x35353c,
  frame:   0xe6e1d6,
  ink:     0x5c5c66,
  matte:   0x26262c,
  accent:  0x3291ff,
  glow:    0xffe9bd,
};

export const PALETTE = isDark ? DARK : LIGHT;

// CSS-side equivalents, handy for canvas-texture text and the DOM overlay.
export const CSS = {
  ink:     isDark ? '#e8e4da' : '#23201b',
  inkSoft: isDark ? '#9a958a' : '#5d564a',
  matte:   isDark ? '#26262c' : '#fbf9f4',
  accent:  isDark ? '#3291ff' : '#0070f3',
  rule:    isDark ? '#3a3a42' : '#cfc7b6',
};

// ---------------------------------------------------------------------------
// World layout. Rooms form an enfilade running along -Z, joined by doorways.
// Room i occupies z from -(i+1)*roomD to -i*roomD.
// ---------------------------------------------------------------------------

export const DIMS = {
  roomW:  13,
  roomH:  4.4,
  roomD:  15,
  wallT:  0.35,
  doorW:  2.8,
  doorH:  3.0,
  eyeH:   1.62,
  bodyR:  0.42,   // player collision radius
};

/** World-space Z of the centre of room `i`. */
export function roomCenterZ(i) {
  return -(i + 0.5) * DIMS.roomD;
}

/** Inclusive z-range [far, near] that room `i` spans. */
export function roomZRange(i) {
  return [-(i + 1) * DIMS.roomD, -i * DIMS.roomD];
}

/** Which room index a world Z falls in (clamped to the building). */
export function roomIndexAtZ(z) {
  const i = Math.floor(-z / DIMS.roomD);
  return Math.max(0, Math.min(ROOMS.length - 1, i));
}

// ---------------------------------------------------------------------------
// The rooms themselves. `source` names the key that content.js fills in.
// ---------------------------------------------------------------------------

export const ROOMS = [
  {
    id: 'atrium',
    title: 'Atrium',
    subtitle: 'David Zhang · 张博诚',
    source: 'about',
    accentHue: 38,
  },
  {
    id: 'research',
    title: 'Research Hall',
    subtitle: 'Publications & collaborations',
    source: 'publications',
    accentHue: 212,
  },
  {
    id: 'writing',
    title: 'Writing Wing',
    subtitle: 'Essays, poetry, commentary',
    source: 'essays',
    accentHue: 12,
  },
  {
    id: 'mathematics',
    title: 'Mathematics',
    subtitle: 'Notes & structures',
    source: 'math',
    accentHue: 268,
  },
  {
    id: 'podcast',
    title: 'Podcast Studio',
    subtitle: 'David Talks With…',
    source: 'podcast',
    accentHue: 150,
  },
  {
    id: 'contact',
    title: 'Reading Room',
    subtitle: 'Get in touch',
    source: 'contact',
    accentHue: 200,
  },
];

// ---------------------------------------------------------------------------
// Tunables. Movement is metres/second; the loop is delta-time driven so these
// stay honest at any frame rate.
// ---------------------------------------------------------------------------

export const TUNING = {
  moveSpeed:    3.4,
  sprintMult:   1.85,
  accel:        22,
  damping:      11,
  mouseSens:    0.0022,
  touchLookSens:0.005,

  fovDesktop:   62,
  fovMobile:    72,
  near:         0.1,
  far:          140,
  fogNear:      14,
  fogFar:       46,

  maxDPR:       1.75,
  minDPR:       0.7,
  targetFrameMs:15.5,   // adaptive DPR aims to stay under this
  cullRadius:   1,      // render current room ± this many

  interactDist: 4.2,    // metres within which an exhibit can be opened
  headBobAmp:   0.028,
  headBobFreq:  8.5,
};

export const ROOM_COUNT = ROOMS.length;

/** Total building depth, used for fog/far-plane sanity and the map UI. */
export const BUILDING_DEPTH = ROOM_COUNT * DIMS.roomD;
