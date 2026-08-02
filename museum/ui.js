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
// Keys consumed here: M (room map), ` (perf readout), Esc (close reader/map).
// E / Enter deliberately belong to main.js.

import { ROOMS } from './config.js';

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
  loaderInner.appendChild(enterBtn);

  const foot = el('p', 'mus-loader-foot');
  const plainLink = el('a', null, 'or read the plain site instead');
  plainLink.href = resolveHref('index.html');
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
  promptCue.append(el('kbd', null, 'E'), document.createTextNode(' read'));
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
  exitLink.href = resolveHref('index.html');
  hud.append(mapBtn, exitLink);
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
  let mapOpen = false;
  let perfOpen = false;
  let entered = false;
  let loaderGone = false;
  let currentRoom = -1;
  let lastFocus = null;
  let readerHideTimer = 0;
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
    if (e.target instanceof Element && e.target.closest('a')) return;
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
    if (mapOpen || readerOpen) return;
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

  function focusables() {
    return Array.from(panel.querySelectorAll(FOCUSABLE)).filter(
      (node) => !node.hidden && node.offsetParent !== null,
    );
  }

  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
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
  reader.addEventListener('keydown', trapTab);

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
      if (readerOpen) {
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
      if (readerOpen || !loaderGone) return;
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
    isReaderOpen: () => readerOpen,
    onActivate: (cb) => activateSignal.add(cb),
    onTeleport: (cb) => teleportSignal.add(cb),
    onReaderClose: (cb) => readerCloseSignal.add(cb),
    onEnter: (cb) => {
      enterSignal.add(cb);
      if (entered && typeof cb === 'function') cb();
    },
  };
}
