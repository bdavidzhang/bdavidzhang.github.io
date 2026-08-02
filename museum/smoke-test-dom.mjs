// smoke-test-dom.mjs — the minimum DOM/canvas surface the museum modules touch,
// so they can execute in Node. Importing this for its side effects installs the
// globals. Nothing here is used by the site itself.

export function stubCanvas(w = 300, h = 150) {
  const ctx = {
    canvas: null,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    textAlign: '', textBaseline: '', globalAlpha: 1, filter: '',
    shadowBlur: 0, shadowColor: '', lineJoin: '', lineCap: '', globalCompositeOperation: '',
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {}, rect() {}, roundRect() {},
    quadraticCurveTo() {}, bezierCurveTo() {},
    fill() {}, stroke() {}, clip() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    clearRect() {}, fillRect() {}, strokeRect() {}, drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getImageData: (x, y, gw = 1, gh = 1) => ({ data: new Uint8ClampedArray(gw * gh * 4), width: gw, height: gh }),
    createImageData: (gw = 1, gh = 1) => ({
      data: new Uint8ClampedArray((gw.width || gw) * (gh.height || gh) * 4),
      width: gw.width || gw, height: gh.height || gh,
    }),
    putImageData() {},
    measureText: (t) => ({ width: String(t).length * 9, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 }),
    fillText() {}, strokeText() {},
  };
  const el = {
    width: w, height: h, style: {}, nodeType: 1, tagName: 'CANVAS',
    getContext: (kind) => (kind === '2d' ? ctx : null),
    toDataURL: () => 'data:,',
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { return c; },
    parentElement: null,
  };
  ctx.canvas = el;
  return el;
}

function stubElement(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(), style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [], childNodes: [],
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    prepend(...cs) { this.children.unshift(...cs); },
    insertBefore(c) { this.children.push(c); return c; },
    removeChild(c) { return c; },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, contains: () => false,
    remove() {}, focus() {}, blur() {}, click() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 }),
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
  };
}

globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? stubCanvas() : stubElement(tag)),
  createElementNS: () => stubCanvas(),
  createDocumentFragment: () => stubElement('fragment'),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  createRange: () => ({ createContextualFragment: () => stubElement('fragment'), selectNode() {} }),
  implementation: {
    createHTMLDocument: () => ({
      body: stubElement('body'),
      createElement: (tag) => stubElement(tag),
      querySelectorAll: () => [],
    }),
  },
  body: stubElement('body'),
  head: stubElement('head'),
  documentElement: stubElement('html'),
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  activeElement: null,
  hidden: false,
  exitPointerLock() {},
  pointerLockElement: null,
};

globalThis.window = globalThis;
globalThis.matchMedia = () => ({
  matches: false, media: '',
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
});
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.location = { hash: '', href: 'http://localhost/museum.html', replace() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.setTimeout = globalThis.setTimeout;
globalThis.Image = class { constructor() { this.width = 1; this.height = 1; } set src(v) { this._src = v; } addEventListener() {} };
globalThis.Element = class {};
globalThis.HTMLElement = class {};
globalThis.performance = globalThis.performance || { now: () => 0 };
