// config.js — single source of truth for world layout, palette and tuning.
// Every other museum module imports from here. Nothing here touches the DOM
// except the one prefers-color-scheme query used to pick a palette.

// --- day / night -----------------------------------------------------------
// The museum does NOT simply follow prefers-color-scheme. A gallery wants to be
// lit; the first version inherited OS dark mode and rendered walls at #1b1b1f,
// and since Lambert shading multiplies incoming light by albedo, near-black
// walls cannot be rescued by turning the lights up — the room just reads as
// gloomy. So 'day' is the default for everyone and 'night' is an explicit
// choice, remembered per visitor. Night is a warm, low-lit evening gallery,
// never a black box: its walls sit around 40% grey.

const MODE_KEY = 'museum-mode';

export const prefersDark =
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-color-scheme: dark)').matches;

function storedMode() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'day' || v === 'night' ? v : null;
  } catch { return null; }          // private mode / blocked storage
}

export const MODE = storedMode() || 'day';
export const isNight = MODE === 'night';

/** Persist a mode. The caller reloads; rebuilding every material live is not
 *  worth the complexity for a preference toggled once. */
export function setMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode === 'night' ? 'night' : 'day'); } catch { /* ignore */ }
}

// Kept for modules that predate theming and just want sensible defaults.
export const isDark = isNight;

// ---------------------------------------------------------------------------
// Per-room themes. Each room picks one by name; architecture, lighting and
// decor all read from it, so a room's whole character lives in one entry.
//
// `decor` names the prop builder in decor.js. `accentHue` tints exhibit plates
// and the UI. `light` scales that room's rig — a garden under a skylight wants
// far more ambient than a study.
// ---------------------------------------------------------------------------

const THEME_DEFS = {
  // Atrium — a planted courtyard under a glass roof.
  garden: {
    decor: 'garden', accentHue: 124,
    day:   { wall: 0xf2f5ec, wallAlt: 0xe8efe0, ceiling: 0xfbfdf7, floor: 0xdfe3d4,
             rail: 0xc3cdb2, glow: 0xfbffef, fog: 0xeaf0e4 },
    night: { wall: 0x4a5447, wallAlt: 0x424c3f, ceiling: 0x3b4438, floor: 0x3e463a,
             rail: 0x5f6b59, glow: 0xd8f0c8, fog: 0x2b322a },
    light: { hemi: 1.25, ambient: 0.95, key: 1.15 },
  },
  // Research Hall — cool, clean, a little clinical.
  lab: {
    decor: 'lab', accentHue: 206,
    day:   { wall: 0xeef2f6, wallAlt: 0xe3e9f0, ceiling: 0xf8fbfe, floor: 0xd3d9e0,
             rail: 0xb8c2cd, glow: 0xf0f7ff, fog: 0xe6ecf3 },
    night: { wall: 0x464e58, wallAlt: 0x3e4650, ceiling: 0x373e47, floor: 0x3a424c,
             rail: 0x58626e, glow: 0xcfe2f7, fog: 0x2e343c },
    light: { hemi: 1.1, ambient: 0.85, key: 1.0 },
  },
  // Writing Wing — warm paper and wood, the quietest room.
  study: {
    decor: 'study', accentHue: 28,
    day:   { wall: 0xf6f0e4, wallAlt: 0xede5d6, ceiling: 0xfdf9f0, floor: 0xd9cdb6,
             rail: 0xc2ae8d, glow: 0xfff3dc, fog: 0xefe8da },
    night: { wall: 0x544b40, wallAlt: 0x4c4339, ceiling: 0x443c33, floor: 0x473e35,
             rail: 0x6b6052, glow: 0xf5d9a8, fog: 0x3a332b },
    light: { hemi: 1.0, ambient: 0.8, key: 1.1 },
  },
  // Mathematics — slate and chalk.
  chalk: {
    decor: 'chalk', accentHue: 168,
    day:   { wall: 0xe9eeec, wallAlt: 0xdde5e2, ceiling: 0xf6faf8, floor: 0xcbd4d1,
             rail: 0xaab6b2, glow: 0xf2fbf8, fog: 0xe1e8e6 },
    night: { wall: 0x434e4b, wallAlt: 0x3b4643, ceiling: 0x35403d, floor: 0x384340,
             rail: 0x556360, glow: 0xcdeae4, fog: 0x2c3634 },
    light: { hemi: 1.05, ambient: 0.82, key: 1.0 },
  },
  // Podcast Studio — walnut, felt, warm lamps.
  studio: {
    decor: 'studio', accentHue: 16,
    day:   { wall: 0xf3ece6, wallAlt: 0xe9dfd6, ceiling: 0xfbf6f1, floor: 0xd6c4b4,
             rail: 0xbda690, glow: 0xfff1e0, fog: 0xece2da },
    night: { wall: 0x524740, wallAlt: 0x4a3f38, ceiling: 0x423832, floor: 0x453b34,
             rail: 0x6a5a49, glow: 0xf7d7b0, fog: 0x38302b },
    light: { hemi: 0.95, ambient: 0.78, key: 1.15 },
  },
  // Reading Room — oak, parchment, the way out.
  library: {
    decor: 'library', accentHue: 42,
    day:   { wall: 0xf5efe2, wallAlt: 0xebe3d2, ceiling: 0xfcf8ee, floor: 0xd8ccb4,
             rail: 0xbfae90, glow: 0xfff4e2, fog: 0xeee7d8 },
    night: { wall: 0x51493c, wallAlt: 0x494135, ceiling: 0x40382e, floor: 0x433b31,
             rail: 0x685c48, glow: 0xf6e0b4, fog: 0x372f27 },
    light: { hemi: 1.0, ambient: 0.8, key: 1.05 },
  },
};

// Ink, frame and card colours are shared across themes so exhibits stay
// consistent as you walk from room to room.
const SHARED = {
  day:   { frame: 0x2b2620, ink: 0x231f1a, matte: 0xfbf9f4, accent: 0x0070f3 },
  night: { frame: 0xe6e1d6, ink: 0x8a8a94, matte: 0x3a3a42, accent: 0x5fa8ff },
};

/** Flatten a theme definition for the active mode. */
function resolve(def) {
  const tone = def[MODE];
  return {
    ...SHARED[MODE], ...tone,
    bg: tone.fog,
    accentHue: def.accentHue,
    decor: def.decor,
    light: def.light,
  };
}

export const THEMES = Object.fromEntries(
  Object.entries(THEME_DEFS).map(([name, def]) => [name, resolve(def)]),
);

/** The theme object for a room index, falling back to the first theme. */
export function themeFor(index) {
  const room = ROOMS[index];
  return (room && THEMES[room.theme]) || THEMES.garden;
}

// A neutral palette for anything not room-specific (exhibit plates, the engine's
// clear colour before the first room resolves).
export const PALETTE = {
  ...THEMES.library,
  wallAlt: THEMES.library.wallAlt,
  rail:    THEMES.library.rail,
};

// CSS-side equivalents, for canvas-texture text and the DOM overlay.
export const CSS = {
  ink:     isNight ? '#ece7dc' : '#23201b',
  inkSoft: isNight ? '#a9a397' : '#5d564a',
  matte:   isNight ? '#3a3a42' : '#fbf9f4',
  accent:  isNight ? '#5fa8ff' : '#0070f3',
  rule:    isNight ? '#565660' : '#cfc7b6',
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
    theme: 'garden',
    title: 'Atrium',
    subtitle: 'David Zhang · 张博诚',
    source: 'about',
  },
  {
    id: 'research',
    theme: 'lab',
    title: 'Research Hall',
    subtitle: 'Publications & collaborations',
    source: 'publications',
  },
  {
    id: 'writing',
    theme: 'study',
    title: 'Writing Wing',
    subtitle: 'Essays, poetry, commentary',
    source: 'essays',
  },
  {
    id: 'mathematics',
    theme: 'chalk',
    title: 'Mathematics',
    subtitle: 'Notes & structures',
    source: 'math',
  },
  {
    id: 'podcast',
    theme: 'studio',
    title: 'Podcast Studio',
    subtitle: 'David Talks With… · popularizing without compromising serious science',
    source: 'podcast',
  },
  {
    id: 'contact',
    theme: 'library',
    title: 'Reading Room',
    subtitle: 'Get in touch',
    source: 'contact',
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
