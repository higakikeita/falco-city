/* Headless environment for the regression harness.
   ------------------------------------------------------------------
   The model, the campaign evaluation and the particle simulation are pure
   logic, but today they live in modules that also reach for the DOM and for
   a WebGL renderer at import time. Rather than wait for that to be untangled,
   this file gives them a fake window to talk to so Node can import them.

   It MUST be imported first: ES modules evaluate imports in order, so the
   globals below have to be installed before src/* is pulled in.

   It also pins Math.random. A regression harness that reads a different
   number every run is not a regression harness. */

/* ---- deterministic RNG (mulberry32) ---------------------------------- */
let seed = 0x9E3779B9;
function mulberry32(){
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = mulberry32;
/* let a case restart the stream so cases cannot influence each other */
export function reseed(s = 0x9E3779B9){ seed = s | 0; }

/* ---- clock ----------------------------------------------------------- */
let clock = 0;
export function advanceClock(ms){ clock += ms; }
export function nowMs(){ return clock; }

/* ---- the smallest DOM the app will accept ---------------------------- */
const noop = () => {};
/* src/ui.js polyfills roundRect onto this prototype at import time */
class CanvasRenderingContext2D {}
class HTMLCanvasElement {}
class HTMLElement {}
const ctx2d = new Proxy(new CanvasRenderingContext2D(), {
  get: (_, k) => (k === 'canvas' ? {width:0, height:0}
                : k === 'measureText' ? (() => ({width:0}))
                : k === 'createLinearGradient' ? (() => ({addColorStop:noop}))
                : noop)
});

class FakeEl {
  constructor(tag = 'div', id = ''){
    this.tagName = tag.toUpperCase(); this.id = id;
    this.children = []; this.style = {}; this.dataset = {};
    this.textContent = ''; this.innerHTML = '';
    this.width = 320; this.height = 200; this.checked = false; this.value = '0';
    this.disabled = false; this.className = '';
    this.classList = {
      _s:new Set(),
      add(...c){ c.forEach(x=>this._s.add(x)); },
      remove(...c){ c.forEach(x=>this._s.delete(x)); },
      toggle(c, on){ const v = on === undefined ? !this._s.has(c) : !!on;
                     v ? this._s.add(c) : this._s.delete(c); return v; },
      contains(c){ return this._s.has(c); }
    };
  }
  appendChild(c){ this.children.push(c); return c; }
  removeChild(c){ this.children = this.children.filter(x=>x!==c); return c; }
  insertBefore(c){ this.children.unshift(c); return c; }
  replaceChildren(...c){ this.children = c; }
  append(...c){ this.children.push(...c); }
  prepend(...c){ this.children.unshift(...c); }
  remove(){ }
  cloneNode(){ return new FakeEl(this.tagName, this.id); }
  contains(){ return false; }
  closest(){ return null; }
  matches(){ return false; }
  insertAdjacentHTML(){ }
  addEventListener(){ }
  removeEventListener(){ }
  querySelector(){ return new FakeEl(); }
  querySelectorAll(){ return []; }
  getContext(){ return ctx2d; }
  getBoundingClientRect(){ return {left:0, top:0, width:320, height:200, right:320, bottom:200}; }
  setAttribute(){ }
  getAttribute(){ return null; }
  focus(){ }
  scrollTo(){ }
  get firstChild(){ return this.children[0] ?? null; }
  get lastChild(){ return this.children[this.children.length-1] ?? null; }
  get offsetWidth(){ return 320; }
  get offsetHeight(){ return 200; }
  get scrollHeight(){ return 200; }
  set scrollTop(_){ }
  get scrollTop(){ return 0; }
}

const byId = new Map();
const document = {
  getElementById(id){
    if(!byId.has(id)) byId.set(id, new FakeEl('div', id));
    return byId.get(id);
  },
  createElement(tag){ return new FakeEl(tag); },
  createElementNS(_, tag){ return new FakeEl(tag); },
  createTextNode(t){ const e = new FakeEl('#text'); e.textContent = String(t); return e; },
  createDocumentFragment(){ return new FakeEl('#fragment'); },
  querySelector(){ return new FakeEl(); },
  querySelectorAll(){ return []; },
  addEventListener(){ },
  body: new FakeEl('body'),
  documentElement: new FakeEl('html')
};

Object.assign(globalThis, {
  document,
  window: globalThis,
  CanvasRenderingContext2D, HTMLCanvasElement, HTMLElement,
  innerWidth: 1600, innerHeight: 1000, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
  matchMedia: () => ({matches:false, addEventListener:noop, addListener:noop}),
  getComputedStyle: () => ({getPropertyValue: () => ''}),
  location: {href:'http://harness.local/', search:''}
});
globalThis.performance = {now: nowMs};

/* the element the app hands to OrbitControls / pointer handlers */
export const fakeCanvas = new FakeEl('canvas');
export { FakeEl };
