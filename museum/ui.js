// ui.js — every readable word in the museum lives here.
//
// This module is pure DOM. It never imports three.js, never touches WebGL and
// never reads the scene graph; main.js pushes state in through the small object
// createUI() returns. The 3D layer handles *navigation*, this layer handles
// *reading*, and the seam between them is exactly the methods below.
//
// It creates all of its own markup — museum.html only has to supply
// <canvas id="scene">. Exactly one element is appended to the document
// (.mus-root); everything else lives inside it. Styling is museum.css.
//
// It also stamps the museum's day/night mode onto <html> as data-museum-mode
// (and onto .mus-root as .is-night), which is the one thing it touches outside
// its own subtree — the page background and the boot screens are painted by
// museum.html and have to follow the same choice.
//
// Keys consumed here: M (room map), ` (perf readout), Esc (close the reader, the
// map or the portal prompt). E / Enter deliberately belong to main.js.

import { ROOMS, MODE, isNight, setMode, themeFor } from './config.js';

// museum.html sits at the site root, but resolving through import.meta.url means
// the reader's links keep working even if it is ever moved into /museum/.
const BASE = new URL('../', import.meta.url);

const ANIM_MS = 300;

// Spelled out up to a sensible ceiling; past that the numeral reads better anyway.
const ROOM_WORDS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve',
];

const KIND_LABEL = {
  about: 'About',
  essay: 'Essay',
  publication: 'Publication',
  math: 'Note',
  podcast: 'Episode',
  log: 'Logbook',
  link: 'Elsewhere',
};

const LEGEND_DESKTOP = [
  ['W A S D', 'walk — hold Shift to hurry'],
  ['Mouse', 'look around'],
  ['↑ ↓ ← →', 'walk and turn, no mouse needed'],
  ['E', 'read whatever you are facing'],
  ['M', 'room map — jump anywhere'],
  ['Esc', 'release the cursor'],
];

// The day/night switch names the mode you are *in*, not the one you would get:
// after a reload the visitor needs to be told where they landed. The sentence
// pressing it triggers lives in the aria-label instead.
const MODE_FACE = {
  day: { glyph: '☀', label: 'Day' },
  night: { glyph: '☾', label: 'Night' },
};

const LEGEND_TOUCH = [
  ['Stick', 'the pad at bottom-left walks you'],
  ['Drag', 'anywhere else to look around'],
  ['Read', 'tap the button on an exhibit'],
  ['Map', 'jump between rooms'],
];

// --- tiny helpers ------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function pad2(n) {
  return String(n + 1).padStart(2, '0');
}

/** A minimal multicast callback slot. Handlers are isolated from each other. */
function signal() {
  const listeners = [];
  return {
    add(fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },
    emit(...args) {
      for (const fn of listeners.slice()) {
        try {
          fn(...args);
        } catch (err) {
          console.error('[museum ui] listener failed', err);
        }
      }
    },
    get size() {
      return listeners.length;
    },
  };
}

/** Resolve a content-relative href against the site root. Absolute URLs pass through. */
function resolveHref(href) {
  const raw = String(href || '').trim();
  if (!raw || raw.startsWith('#')) return raw;
  try {
    return new URL(raw, BASE).href;
  } catch {
    return raw;
  }
}

const isExternalUrl = (href) => /^(https?:|mailto:|tel:)/i.test(String(href || '').trim());

// --- sanitiser ---------------------------------------------------------------
// Essay bodies are first-party HTML out of the site's own JSON, so this is a
// seatbelt rather than a security boundary: drop anything executable, drop
// inline event handlers, neutralise javascript: URLs, then hand back a fragment.

const BLOCKED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED',
  'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT',
]);

function sanitizeToFragment(html) {
  const frag = document.createDocumentFragment();
  const source = String(html || '').trim();
  if (!source) return frag;

  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const body = parsed.body;

  const doomed = [];
  const walker = parsed.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (BLOCKED_TAGS.has(node.tagName)) {
      doomed.push(node);
    } else {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on') || name === 'srcdoc') {
          node.removeAttribute(attr.name);
        } else if (
          (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') &&
          /^\s*(javascript|data:text\/html|vbscript)/i.test(value)
        ) {
          node.removeAttribute(attr.name);
        }
      }
    }
    node = walker.nextNode();
  }
  for (const dead of doomed) dead.remove();

  for (const link of Array.from(body.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#')) continue;
    link.setAttribute('href', resolveHref(href));
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  for (const img of Array.from(body.querySelectorAll('img[src]'))) {
    img.setAttribute('src', resolveHref(img.getAttribute('src')));
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  }

  for (const child of Array.from(body.childNodes)) {
    frag.appendChild(document.importNode(child, true));
  }
  return frag;
}

// -----------------------------------------------------------------------------

export function createUI({ isMobile = false } = {}) {
  const touch = Boolean(isMobile);

  const root = el('div', 'mus-root');
  root.id = 'museum-ui';
  if (touch) root.classList.add('is-touch');

  // The mode is the visitor's explicit, remembered choice (config.js), never the
  // OS's. Stamp it twice: the class drives every --mus-* token in this overlay,
  // the attribute lets the page-level styles museum.html owns follow along, so
  // the chrome can never end up dark over a daylit room.
  if (isNight) root.classList.add('is-night');
  document.documentElement.setAttribute('data-museum-mode', MODE);

  // ==========================================================================
  // 0 — day / night switch
  // ==========================================================================
  // Two of these exist: one on the loader, so the lighting can be chosen before
  // walking in, and one in the HUD next to the room map.

  const modeButtons = [];

  function makeModeToggle(className, withHint) {
    const btn = el('button', className);
    btn.type = 'button';

    const face = MODE_FACE[MODE] || MODE_FACE.day;
    const glyph = el('span', 'mus-mode-glyph', face.glyph);
    glyph.setAttribute('aria-hidden', 'true'); // decorative — the label carries it
    btn.append(glyph, el('span', 'mus-mode-label', face.label));
    if (withHint) btn.appendChild(el('span', 'mus-mode-hint', 'reloads'));

    btn.setAttribute('aria-pressed', isNight ? 'true' : 'false');
    // A control that throws the page away has to say so before it is pressed.
    btn.setAttribute(
      'aria-label',
      `Lighting: ${MODE}. Switch to ${isNight ? 'day' : 'night'} — the museum reloads.`,
    );
    btn.title = `Switch to ${isNight ? 'day' : 'night'} lighting (reloads the museum)`;
    btn.addEventListener('click', switchMode);

    modeButtons.push(btn);
    return btn;
  }

  function switchMode(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation(); // the loader treats a bare click as "enter"
    }
    const next = isNight ? 'day' : 'night';
    setMode(next);
    // Walls, lights and fog are baked out of the palette when the world is
    // built, so restarting is the honest way to apply the choice — cheaper than
    // rebuilding every three.js material for a preference toggled once.
    for (const btn of modeButtons) {
      btn.setAttribute('aria-pressed', next === 'night' ? 'true' : 'false');
      btn.setAttribute('aria-busy', 'true');
    }
    location.reload();
  }

  // ==========================================================================
  // 1 — loader
  // ==========================================================================
  const loader = el('div', 'mus-loader');
  loader.setAttribute('role', 'dialog');
  loader.setAttribute('aria-label', 'Museum loading');

  const loaderInner = el('div', 'mus-loader-inner');
  loaderInner.append(
    el('p', 'mus-eyebrow', 'A walkable index'),
    el('h1', 'mus-loader-title', 'David Zhang · 张博诚'),
    el(
      'p',
      'mus-loader-sub',
      `Essays, research, mathematics and conversations — hung on the walls of ${ROOM_WORDS[ROOMS.length] || ROOMS.length} rooms. Walk through them, or take the map and jump.`,
    ),
  );

  const bar = el('div', 'mus-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  const barFill = el('div', 'mus-bar-fill');
  bar.appendChild(barFill);
  const barLabel = el('p', 'mus-bar-label', 'Waking the building');
  loaderInner.append(bar, barLabel);

  const legend = el('dl', 'mus-legend');
  for (const [keys, meaning] of touch ? LEGEND_TOUCH : LEGEND_DESKTOP) {
    const dt = el('dt', 'mus-legend-key');
    for (const key of keys.split(' ')) dt.appendChild(el('kbd', null, key));
    legend.append(dt, el('dd', 'mus-legend-val', meaning));
  }
  loaderInner.appendChild(legend);

  const enterBtn = el('button', 'mus-enter', 'Enter the museum');
  enterBtn.type = 'button';
  enterBtn.disabled = true;
  const loaderActions = el('div', 'mus-loader-actions');
  loaderActions.append(enterBtn, makeModeToggle('mus-mode mus-mode-loader', true));
  loaderInner.appendChild(loaderActions);

  const foot = el('p', 'mus-loader-foot');
  const plainLink = el('a', null, 'or read the plain site instead');
  plainLink.href = resolveHref('home.html');
  foot.appendChild(plainLink);
  loaderInner.appendChild(foot);

  loader.appendChild(loaderInner);
  root.appendChild(loader);

  // ==========================================================================
  // 2 — reticle + focus prompt
  // ==========================================================================
  const reticle = el('div', 'mus-reticle');
  reticle.setAttribute('aria-hidden', 'true');
  reticle.appendChild(el('span', 'mus-reticle-dot'));
  root.appendChild(reticle);

  const prompt = el('div', 'mus-prompt');
  prompt.hidden = true;
  const promptKind = el('span', 'mus-prompt-kind');
  const promptTitle = el('span', 'mus-prompt-title');
  const promptCue = el('span', 'mus-prompt-cue');
  // the verb is swapped per exhibit kind in setFocus — a link is opened, not read
  const promptVerb = document.createTextNode(' read');
  promptCue.append(el('kbd', null, 'E'), promptVerb);
  const promptBtn = el('button', 'mus-prompt-btn', 'Read');
  promptBtn.type = 'button';
  prompt.append(promptKind, promptTitle, touch ? promptBtn : promptCue);
  root.appendChild(prompt);

  // ==========================================================================
  // 3 — room nameplate
  // ==========================================================================
  const plate = el('div', 'mus-plate');
  plate.setAttribute('aria-live', 'polite');
  const plateIndex = el('span', 'mus-plate-index', `01 / ${pad2(ROOMS.length - 1)}`);
  const plateTitle = el('h2', 'mus-plate-title', '');
  const plateSub = el('p', 'mus-plate-sub', '');
  plate.append(plateIndex, plateTitle, plateSub);
  root.appendChild(plate);

  // ==========================================================================
  // 4 — HUD buttons
  // ==========================================================================
  const hud = el('div', 'mus-hud');
  const mapBtn = el('button', 'mus-hud-btn');
  mapBtn.type = 'button';
  mapBtn.setAttribute('aria-expanded', 'false');
  mapBtn.append(document.createTextNode('Rooms'), el('kbd', null, 'M'));
  const exitLink = el('a', 'mus-hud-btn mus-hud-exit', 'Plain site');
  exitLink.href = resolveHref('home.html');
  hud.append(mapBtn, makeModeToggle('mus-hud-btn mus-mode', false), exitLink);
  root.appendChild(hud);

  // ==========================================================================
  // 5 — room map / teleport
  // ==========================================================================
  const map = el('div', 'mus-map');
  map.hidden = true;
  map.setAttribute('aria-label', 'Room map');
  const mapHead = el('div', 'mus-map-head');
  mapHead.appendChild(el('h2', 'mus-map-heading', 'Rooms'));
  const mapClose = el('button', 'mus-map-close', '×');
  mapClose.type = 'button';
  mapClose.setAttribute('aria-label', 'Close the room map');
  mapHead.appendChild(mapClose);
  map.appendChild(mapHead);

  const mapList = el('ul', 'mus-map-list');
  const mapItems = ROOMS.map((room, index) => {
    const li = el('li', 'mus-map-li');
    const btn = el('button', 'mus-map-item');
    btn.type = 'button';
    btn.dataset.index = String(index);
    btn.append(
      el('span', 'mus-map-num', pad2(index)),
      el('span', 'mus-map-name', room.title),
      el('span', 'mus-map-sub', room.subtitle || ''),
    );
    btn.addEventListener('click', () => {
      teleportSignal.emit(index);
      closeMap();
    });
    li.appendChild(btn);
    mapList.appendChild(li);
    return btn;
  });
  map.appendChild(mapList);
  map.appendChild(el('p', 'mus-map-hint', 'Pick a room to be put down inside it.'));
  root.appendChild(map);

  // ==========================================================================
  // 6 — reader
  // ==========================================================================
  const reader = el('div', 'mus-reader');
  reader.hidden = true;
  reader.setAttribute('role', 'dialog');
  reader.setAttribute('aria-modal', 'true');
  reader.setAttribute('aria-labelledby', 'mus-reader-title');

  const scrim = el('div', 'mus-reader-scrim');
  const panel = el('article', 'mus-reader-panel');
  panel.tabIndex = -1;

  const readerClose = el('button', 'mus-reader-close', '×');
  readerClose.type = 'button';
  readerClose.setAttribute('aria-label', 'Close and go back to the room');

  const scroll = el('div', 'mus-reader-scroll');
  const head = el('header', 'mus-reader-head');
  const readerKind = el('p', 'mus-reader-kind', '');
  const readerTitle = el('h1', 'mus-reader-title', '');
  readerTitle.id = 'mus-reader-title';
  const readerMeta = el('p', 'mus-reader-meta', '');
  const readerTags = el('ul', 'mus-reader-tags');
  head.append(readerKind, readerTitle, readerMeta, readerTags);

  const readerFigure = el('div', 'mus-reader-figure');
  const readerImg = el('img', 'mus-reader-img');
  readerImg.alt = '';
  readerImg.loading = 'lazy';
  readerImg.decoding = 'async';
  readerFigure.appendChild(readerImg);

  const readerBody = el('div', 'mus-reader-body');
  const readerLinks = el('ul', 'mus-reader-links');
  const readerFoot = el('footer', 'mus-reader-foot');
  const readerLink = el('a', 'mus-reader-link');
  const readerEsc = el('span', 'mus-reader-esc');
  readerEsc.append(el('kbd', null, 'Esc'), document.createTextNode(' to close'));
  readerFoot.append(readerLink, readerEsc);

  scroll.append(head, readerFigure, readerBody, readerLinks, readerFoot);
  panel.append(readerClose, scroll);
  reader.append(scrim, panel);
  root.appendChild(reader);

  // ==========================================================================
  // 6b — portal prompt
  // ==========================================================================
  // The popup fallback for museum/portal.js. Walking up to the Open Reality
  // installation on the Atrium's entrance wall tries window.open() straight away
  // — walking is keydown, which grants transient activation, so it usually just
  // works. When a popup blocker eats it there is no second chance from that
  // gesture, so this panel takes over: the visitor's click (or Enter on the
  // auto-focused link) is itself a fresh gesture, and a gesture-driven open is
  // never blocked.

  const portal = el('div', 'mus-portal');
  portal.hidden = true;
  portal.setAttribute('role', 'dialog');
  portal.setAttribute('aria-modal', 'true');
  portal.setAttribute('aria-labelledby', 'mus-portal-title');

  const portalScrim = el('div', 'mus-portal-scrim');
  const portalCard = el('div', 'mus-portal-card');
  portalCard.tabIndex = -1;

  const portalClose = el('button', 'mus-portal-close', '×');
  portalClose.type = 'button';
  portalClose.setAttribute('aria-label', 'Stay in the museum');

  const portalKind = el('p', 'mus-portal-kind', 'Leaving the museum');
  const portalTitle = el('h2', 'mus-portal-title', '');
  portalTitle.id = 'mus-portal-title';
  const portalTagline = el('p', 'mus-portal-tagline', '');
  // First person, the same line the wall itself carries — see PORTAL_BRAND.
  const portalNote = el('p', 'mus-portal-note',
    "I'm currently the founder of Open Reality, working on it full time.");

  // An anchor, not a button: a plain link with target=_blank is the one control
  // every browser lets through, and rel carries the opener protection outright.
  const portalGo = el('a', 'mus-portal-go');
  portalGo.target = '_blank';
  portalGo.rel = 'noopener noreferrer';
  portalGo.append(document.createTextNode('Enter '), el('span', 'mus-portal-arrow', '→'));

  const portalEsc = el('p', 'mus-portal-esc');
  portalEsc.append(el('kbd', null, 'Esc'), document.createTextNode(' to stay in the museum'));

  portalCard.append(
    portalClose, portalKind, portalTitle, portalTagline, portalNote, portalGo, portalEsc,
  );
  portal.append(portalScrim, portalCard);
  root.appendChild(portal);

  // ==========================================================================
  // 7 — perf readout
  // ==========================================================================
  const perf = el('aside', 'mus-perf');
  perf.hidden = true;
  perf.setAttribute('aria-hidden', 'true');
  perf.appendChild(el('h3', 'mus-perf-title', 'engine'));
  const perfGrid = el('dl', 'mus-perf-grid');
  const perfFields = {};
  for (const [key, label] of [
    ['fps', 'fps'],
    ['dpr', 'dpr'],
    ['drawCalls', 'draws'],
    ['triangles', 'tris'],
    ['room', 'room'],
  ]) {
    const dd = el('dd', 'mus-perf-val', '—');
    perfGrid.append(el('dt', 'mus-perf-key', label), dd);
    perfFields[key] = dd;
  }
  perf.appendChild(perfGrid);
  perf.appendChild(el('p', 'mus-perf-hint', '` to hide'));
  root.appendChild(perf);

  document.body.appendChild(root);

  // ==========================================================================
  // state + signals
  // ==========================================================================
  const activateSignal = signal();
  const teleportSignal = signal();
  const readerCloseSignal = signal();
  const enterSignal = signal();

  let readerOpen = false;
  let portalOpen = false;
  let mapOpen = false;
  let perfOpen = false;
  let entered = false;
  let loaderGone = false;
  let currentRoom = -1;
  let lastFocus = null;
  let portalLastFocus = null;
  let readerHideTimer = 0;
  let portalHideTimer = 0;
  let perfTimer = 0;

  // --- loader ---------------------------------------------------------------

  function setProgress(frac, label) {
    const pct = Math.max(0, Math.min(1, Number(frac) || 0)) * 100;
    barFill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (label != null) barLabel.textContent = String(label);
    if (pct >= 100) {
      enterBtn.disabled = false;
      loader.classList.add('is-complete');
    }
  }

  /** Loading is done: fade the loading chrome out and leave the way in. */
  function hideLoader() {
    enterBtn.disabled = false;
    loader.classList.add('is-complete', 'is-ready');
    barLabel.textContent = 'Ready';
    if (!entered) {
      // Pointer lock needs a real gesture, so we wait for the click rather than
      // tearing the loader down here.
      try {
        enterBtn.focus({ preventScroll: true });
      } catch {
        enterBtn.focus();
      }
    } else {
      dismissLoader();
    }
  }

  function dismissLoader() {
    if (loaderGone) return;
    loaderGone = true;
    loader.classList.add('is-gone');
    setTimeout(() => {
      loader.hidden = true;
    }, ANIM_MS);
  }

  function enterMuseum() {
    if (entered) return;
    entered = true;
    dismissLoader();
    root.classList.add('is-entered');
    enterSignal.emit();
  }

  enterBtn.addEventListener('click', enterMuseum);
  loader.addEventListener('click', (e) => {
    if (enterBtn.disabled) return;
    // links and the day/night switch are their own actions, not "enter"
    if (e.target instanceof Element && e.target.closest('a, .mus-mode')) return;
    enterMuseum();
  });

  // --- focus prompt ---------------------------------------------------------

  function setFocus(exhibit) {
    if (!exhibit || readerOpen) {
      prompt.classList.remove('is-on');
      prompt.hidden = true;
      return;
    }
    promptKind.textContent = KIND_LABEL[exhibit.kind] || 'Exhibit';
    promptTitle.textContent = exhibit.title || 'Untitled';
    // a lectern leaves the museum, so say so rather than promising a read
    const leaves = exhibit.kind === 'link';
    promptVerb.nodeValue = leaves ? ' open ↗' : ' read';
    promptBtn.textContent = leaves ? 'Open ↗' : 'Read';
    prompt.hidden = false;
    // restart the entrance transition
    prompt.classList.remove('is-on');
    void prompt.offsetWidth;
    prompt.classList.add('is-on');
  }

  promptBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    activateSignal.emit();
  });

  // --- nameplate ------------------------------------------------------------

  function setRoom(index, room) {
    const idx = Number.isFinite(index) ? index : 0;
    const info = room || ROOMS[idx] || {};
    currentRoom = idx;
    // Every room carries an accentHue, so the nameplate, the focus prompt and
    // the map's "you are here" belong to the room you are standing in. Only the
    // hue moves; museum.css registers it with @property, so it slides between
    // rooms instead of snapping (and stops sliding under reduced motion).
    const hue = themeFor(idx).accentHue;
    if (Number.isFinite(hue)) root.style.setProperty('--mus-accent-h', String(hue));

    plateIndex.textContent = `${pad2(idx)} / ${pad2(ROOMS.length - 1)}`;
    plateTitle.textContent = info.title || '';
    plateSub.textContent = info.subtitle || '';
    plate.classList.remove('is-in');
    void plate.offsetWidth;
    plate.classList.add('is-in');
    mapItems.forEach((btn, i) => {
      const here = i === idx;
      btn.classList.toggle('is-current', here);
      if (here) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  // --- map ------------------------------------------------------------------

  function openMap() {
    if (mapOpen || readerOpen || portalOpen) return;
    mapOpen = true;
    map.hidden = false;
    void map.offsetWidth;
    map.classList.add('is-open');
    // swallow clicks that would otherwise reach the canvas and re-lock the
    // pointer out from under the list
    root.classList.add('is-mapping');
    mapBtn.setAttribute('aria-expanded', 'true');
    // the cursor is captured while walking; let it go so the list is clickable
    if (document.pointerLockElement) document.exitPointerLock?.();
    const target = mapItems[currentRoom >= 0 ? currentRoom : 0] || mapItems[0];
    if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }

  function closeMap() {
    if (!mapOpen) return;
    mapOpen = false;
    map.classList.remove('is-open');
    root.classList.remove('is-mapping');
    mapBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      if (!mapOpen) map.hidden = true;
    }, ANIM_MS);
  }

  function toggleMap() {
    if (mapOpen) closeMap();
    else openMap();
  }

  mapBtn.addEventListener('click', toggleMap);
  mapClose.addEventListener('click', closeMap);
  root.addEventListener('click', (e) => {
    if (!mapOpen) return;
    if (e.target instanceof Element && e.target.closest('.mus-map, .mus-hud')) return;
    closeMap();
  });

  // --- reader ---------------------------------------------------------------

  function renderReader(exhibit) {
    readerKind.textContent = KIND_LABEL[exhibit.kind] || 'Exhibit';
    readerTitle.textContent = exhibit.title || 'Untitled';
    readerMeta.textContent = exhibit.meta || '';
    readerMeta.hidden = !exhibit.meta;

    readerTags.replaceChildren();
    const tags = Array.isArray(exhibit.tags) ? exhibit.tags.filter(Boolean) : [];
    for (const tag of tags) readerTags.appendChild(el('li', 'mus-reader-tag', String(tag)));
    readerTags.hidden = tags.length === 0;

    if (exhibit.image) {
      readerImg.src = resolveHref(exhibit.image);
      readerImg.alt = exhibit.title || '';
      readerFigure.hidden = false;
    } else {
      readerImg.removeAttribute('src');
      readerFigure.hidden = true;
    }

    readerBody.replaceChildren();
    if (exhibit.bodyHtml) {
      readerBody.appendChild(sanitizeToFragment(exhibit.bodyHtml));
    } else if (exhibit.blurb) {
      readerBody.appendChild(el('p', null, exhibit.blurb));
    } else {
      readerBody.appendChild(el('p', 'mus-reader-empty', 'Nothing written up yet.'));
    }

    // math notes carry a `links` array; render whatever shape they are in
    readerLinks.replaceChildren();
    const extras = Array.isArray(exhibit.links) ? exhibit.links : [];
    for (const item of extras) {
      const href = typeof item === 'string' ? item : item && (item.url || item.href || item.link);
      if (!href) continue;
      const label =
        (item && (item.title || item.label || item.name || item.text)) || String(href);
      const li = el('li', null);
      const a = el('a', 'mus-reader-extra', label);
      a.href = resolveHref(href);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
      readerLinks.appendChild(li);
    }
    readerLinks.hidden = readerLinks.childElementCount === 0;

    const href = exhibit.href ? resolveHref(exhibit.href) : '';
    if (href) {
      readerLink.href = href;
      const outside = exhibit.external === true || isExternalUrl(exhibit.href);
      if (outside) {
        readerLink.target = '_blank';
        readerLink.rel = 'noopener noreferrer';
        readerLink.textContent =
          exhibit.kind === 'link' ? `Open ${exhibit.title || 'link'} ↗` : 'Open in a new tab ↗';
      } else {
        readerLink.removeAttribute('target');
        readerLink.removeAttribute('rel');
        readerLink.textContent = 'Read the full page →';
      }
      readerLink.hidden = false;
    } else {
      readerLink.removeAttribute('href');
      readerLink.hidden = true;
    }
  }

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusables(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
      (node) => !node.hidden && node.offsetParent !== null,
    );
  }

  /** Tab-cycle handler bound to one modal container. Both dialogs share it. */
  function makeTrap(container) {
    return function trapTab(e) {
      if (e.key !== 'Tab') return;
      const items = focusables(container);
      if (!items.length) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === container || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
  }

  function openReader(exhibit) {
    if (!exhibit) return;
    closeMap();
    setFocus(null);
    lastFocus = document.activeElement;
    renderReader(exhibit);

    clearTimeout(readerHideTimer);
    readerOpen = true;
    root.classList.add('is-reading');
    reader.hidden = false;
    scroll.scrollTop = 0;
    void reader.offsetWidth;
    reader.classList.add('is-open');
    requestAnimationFrame(() => {
      try {
        panel.focus({ preventScroll: true });
      } catch {
        panel.focus();
      }
    });
  }

  function closeReader() {
    if (!readerOpen) return;
    readerOpen = false;
    reader.classList.remove('is-open');
    root.classList.remove('is-reading');
    clearTimeout(readerHideTimer);
    readerHideTimer = setTimeout(() => {
      if (!readerOpen) reader.hidden = true;
    }, ANIM_MS);

    if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch {
        lastFocus.focus();
      }
    }
    lastFocus = null;
    readerCloseSignal.emit();
  }

  readerClose.addEventListener('click', closeReader);
  scrim.addEventListener('click', closeReader);
  reader.addEventListener('keydown', makeTrap(panel));

  // --- portal prompt --------------------------------------------------------

  /**
   * Show the "you stepped through the gateway" panel. Called by portal.js only
   * when the direct window.open() was blocked, so by the time this is on screen
   * the only way out to the site is a control the visitor operates themselves.
   */
  function showPortalPrompt({ title, tagline, url } = {}) {
    const href = String(url || '').trim();
    if (!href) return;

    closeMap();
    setFocus(null);
    portalLastFocus = document.activeElement;

    portalTitle.textContent = title || 'Open Reality';
    portalTagline.textContent = tagline || '';
    portalTagline.hidden = !tagline;
    portalGo.href = href;
    // belt and braces: these are set at build time too, but a stale DOM node
    // must never end up pointing a new tab back at window.opener
    portalGo.target = '_blank';
    portalGo.rel = 'noopener noreferrer';

    clearTimeout(portalHideTimer);
    portalOpen = true;
    root.classList.add('is-porting');
    portal.hidden = false;
    void portal.offsetWidth;
    portal.classList.add('is-open');

    // The cursor is captured while walking; let it go so the link is clickable.
    if (document.pointerLockElement) document.exitPointerLock?.();

    // Focus now, not on the next frame. The reader can afford requestAnimationFrame
    // because nothing depends on where focus lands; here the focused link IS the
    // feature — it is the only way out to the site once a popup blocker has eaten
    // the direct attempt — and rAF is throttled to nothing in a background or
    // hidden tab. The offsetWidth read above has already forced layout, so the
    // element is focusable this instant; the rAF pass is only a second chance in
    // case something else stole focus while the panel was animating in.
    focusPortalGo();
    requestAnimationFrame(focusPortalGo);
  }

  function focusPortalGo() {
    if (!portalOpen || document.activeElement === portalGo) return;
    try {
      portalGo.focus({ preventScroll: true });
    } catch {
      portalGo.focus();
    }
  }

  function closePortalPrompt() {
    if (!portalOpen) return;
    portalOpen = false;
    portal.classList.remove('is-open');
    root.classList.remove('is-porting');
    clearTimeout(portalHideTimer);
    portalHideTimer = setTimeout(() => {
      if (!portalOpen) portal.hidden = true;
    }, ANIM_MS);

    if (
      portalLastFocus &&
      portalLastFocus.isConnected &&
      typeof portalLastFocus.focus === 'function'
    ) {
      try {
        portalLastFocus.focus({ preventScroll: true });
      } catch {
        portalLastFocus.focus();
      }
    }
    portalLastFocus = null;
  }

  portalClose.addEventListener('click', closePortalPrompt);
  portalScrim.addEventListener('click', closePortalPrompt);
  // Following the link is the whole point; get the panel out of the way after.
  portalGo.addEventListener('click', () => setTimeout(closePortalPrompt, 0));
  portal.addEventListener('keydown', makeTrap(portalCard));

  // --- perf readout ---------------------------------------------------------

  function samplePerf() {
    const stats =
      typeof window !== 'undefined' &&
      window.__museum &&
      window.__museum.engine &&
      window.__museum.engine.stats;
    if (!stats) {
      perfFields.fps.textContent = '—';
      return;
    }
    perfFields.fps.textContent = Math.round(stats.fps || 0);
    perfFields.dpr.textContent = (stats.dpr || 0).toFixed(2);
    perfFields.drawCalls.textContent = stats.drawCalls || 0;
    perfFields.triangles.textContent = (stats.triangles || 0).toLocaleString();
    const room = ROOMS[stats.room];
    perfFields.room.textContent = room ? room.title : String(stats.room ?? '—');
  }

  function togglePerf() {
    perfOpen = !perfOpen;
    perf.hidden = !perfOpen;
    clearInterval(perfTimer);
    if (perfOpen) {
      samplePerf();
      perfTimer = setInterval(samplePerf, 500);
    }
  }

  // --- keyboard -------------------------------------------------------------

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }

    if (e.code === 'Escape' || e.key === 'Escape') {
      if (portalOpen) {
        e.preventDefault();
        closePortalPrompt();
      } else if (readerOpen) {
        e.preventDefault();
        closeReader();
      } else if (mapOpen) {
        e.preventDefault();
        closeMap();
      }
      return;
    }

    if (e.code === 'Backquote') {
      e.preventDefault();
      togglePerf();
      return;
    }

    if (e.code === 'KeyM') {
      if (readerOpen || portalOpen || !loaderGone) return;
      e.preventDefault();
      toggleMap();
    }
  }

  addEventListener('keydown', onKeyDown);

  // first paint of the nameplate so the corner is never blank
  setRoom(0, ROOMS[0]);

  // ==========================================================================
  return {
    setProgress,
    hideLoader,
    setFocus,
    setRoom,
    openReader,
    closeReader,
    showPortalPrompt,
    closePortalPrompt,
    isPortalOpen: () => portalOpen,
    // Deliberately true while the portal panel is up as well. main.js reads this
    // as "a DOM panel has the floor, keep world input out of it" — which is what
    // stops E/Enter from opening an exhibit behind the prompt at the exact
    // moment Enter is meant to be activating the prompt's own link.
    isReaderOpen: () => readerOpen || portalOpen,
    onActivate: (cb) => activateSignal.add(cb),
    onTeleport: (cb) => teleportSignal.add(cb),
    onReaderClose: (cb) => readerCloseSignal.add(cb),
    onEnter: (cb) => {
      enterSignal.add(cb);
      if (entered && typeof cb === 'function') cb();
    },
  };
}
