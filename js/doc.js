/* ==========================================================================
   doc.js — document model, history, selection, layers, live shapes
   ========================================================================== */

import {
  I, T, R, S, mmul, minv, mfrom, mstr, mapply, parseTransform, mIsIdentity,
  box, boxFromPts, boxUnion, boxTransform, num, round, clamp, TAU, D2R,
  normalize, segsToD, segsBBox, polyToCurves, transformSegs
} from './geom.js';

export const SVGNS = 'http://www.w3.org/2000/svg';
export const XLINK = 'http://www.w3.org/1999/xlink';
export const INK = 'http://www.inkscape.org/namespaces/inkscape';
export const SODI = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd';

export const UNITS = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16, em: 16, '%': 1 };
export const toPx = (v, u) => v * (UNITS[u] || 1);
export const fromPx = (v, u) => v / (UNITS[u] || 1);

/* ── tiny event bus ───────────────────────────────────────────────────── */
const handlers = new Map();
export const bus = {
  on(ev, fn) { (handlers.get(ev) || handlers.set(ev, []).get(ev)).push(fn); return fn; },
  off(ev, fn) { const a = handlers.get(ev); if (a) a.splice(a.indexOf(fn), 1); },
  emit(ev, arg) { (handlers.get(ev) || []).forEach(f => { try { f(arg); } catch (e) { console.error(ev, e); } }); }
};

/* ── global application state ─────────────────────────────────────────── */
export const App = {
  doc: null,            // the document <svg>
  defs: null,
  scene: null,          // <g> holding page + doc
  viewport: null,       // outer <svg>
  sel: [],              // selected elements
  context: null,        // group currently "entered"
  tool: null,
  toolName: 'select',
  clipboard: [],
  filename: 'drawing.svg',
  dirty: false,
  style: {              // last-used style for new objects
    fill: '#3771c8', 'fill-opacity': 1, stroke: 'none', 'stroke-width': 1,
    'stroke-opacity': 1, 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter',
    'stroke-dasharray': 'none', opacity: 1
  },
  prefs: {
    unit: 'mm', theme: 'dark', rulers: true, bboxVisual: true,
    snapEnabled: true, snapDist: 14, gridVisible: false, guidesVisible: true,
    handleSize: 8, rotStep: 15, moveStep: 2, scaleStroke: true, transformPattern: true
  },
  snap: { bbox: true, node: true, grid: true, guide: true, page: true, center: true, path: true },
  grid: { type: 'xy', sx: 10, sy: 10, major: 5, origx: 0, origy: 0, color: '#3f88d8' },
  guides: []            // {x,y,angle} — position + orientation
};

/* ── helpers ──────────────────────────────────────────────────────────── */

let idc = 0;
export function uid(p = 'e') {
  let id;
  do { id = p + (++idc); } while (App.doc && App.doc.querySelector(`#${CSS.escape(id)}`));
  return id;
}
export function ensureId(n) { if (!n.getAttribute('id')) n.setAttribute('id', uid(n.tagName.slice(0, 4))); return n.getAttribute('id'); }

export function el(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) {
    if (attrs[k] === null || attrs[k] === undefined) continue;
    n.setAttribute(k, attrs[k]);
  }
  if (parent) parent.appendChild(n);
  return n;
}

/**
 * XML parsing puts `inkscape:label` etc. into a real namespace, while elements we
 * build in the HTML document carry the colon as part of a plain attribute name.
 * Everything downstream (layers, live shapes, guides) looks them up by qualified
 * name, so freshly parsed trees are flattened to the same shape.
 */
export function normalizeNS(node) {
  if (!node || node.nodeType !== 1) return node;
  for (const a of [...node.attributes]) {
    if (!a.namespaceURI || !a.prefix) continue;
    if (a.prefix === 'xml' || a.prefix === 'xmlns') continue;      // must keep their namespace
    if (a.prefix === 'xlink') {                                     // keep rendering working
      if (a.localName === 'href' && !node.hasAttribute('href')) node.setAttribute('href', a.value);
      continue;
    }
    node.removeAttributeNS(a.namespaceURI, a.localName);
    node.setAttribute(`${a.prefix}:${a.localName}`, a.value);
  }
  for (const c of node.children) normalizeNS(c);
  return node;
}

export const DRAWABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'image', 'g', 'use', 'switch', 'foreignObject']);
export const isDrawable = n => n && n.nodeType === 1 && DRAWABLE.has(n.tagName) && !isLayer(n);
export const isLayer = n => n && n.nodeType === 1 && n.tagName === 'g' && n.getAttribute('inkscape:groupmode') === 'layer';

export const layers = () => [...App.doc.children].filter(isLayer);
export function currentLayer() {
  let l = App.doc.querySelector('g[inkscape\\:groupmode="layer"].current');
  if (!l) { l = layers()[0] || addLayer('Layer 1'); setCurrentLayer(l); }
  return l;
}
export function setCurrentLayer(g) {
  layers().forEach(l => l.classList.remove('current'));
  if (g) g.classList.add('current');
  bus.emit('layers');
}
export function addLayer(name, ref, where = 'above') {
  const g = el('g', { id: uid('layer'), 'inkscape:groupmode': 'layer', 'inkscape:label': name || 'Layer', style: 'display:inline' });
  if (ref && where === 'below') App.doc.insertBefore(g, ref);
  else if (ref) ref.after(g);
  else App.doc.appendChild(g);
  bus.emit('layers');
  return g;
}
export const layerName = g => g.getAttribute('inkscape:label') || g.id;
export function layerOf(n) { while (n && n !== App.doc) { if (isLayer(n)) return n; n = n.parentNode; } return null; }
export const isLocked = n => { let c = n; while (c && c !== App.doc) { if (c.getAttribute && c.getAttribute('sodipodi:insensitive') === 'true') return true; c = c.parentNode; } return false; };
export const isHidden = n => { let c = n; while (c && c !== App.doc) { if (c.getAttribute && /display\s*:\s*none/.test(c.getAttribute('style') || '')) return true; c = c.parentNode; } return false; };

/** All selectable top-level objects, deepest layer first. */
export function allObjects(root) {
  const out = [];
  (function walk(p) {
    for (const c of p.children) {
      if (isLayer(c)) walk(c);
      else if (isDrawable(c)) out.push(c);
    }
  })(root || App.doc);
  return out;
}

/* ── styles ───────────────────────────────────────────────────────────── */

export function parseStyleAttr(s) {
  const o = {};
  (s || '').split(';').forEach(p => {
    const i = p.indexOf(':'); if (i < 0) return;
    o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}
export const styleAttrStr = o => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}:${v}`).join(';');

export function setStyle(node, props) {
  const o = parseStyleAttr(node.getAttribute('style'));
  for (const k in props) {
    if (props[k] === null) delete o[k]; else o[k] = props[k];
    if (node.hasAttribute(k)) node.removeAttribute(k);      // presentation attr would be shadowed anyway
  }
  const s = styleAttrStr(o);
  if (s) node.setAttribute('style', s); else node.removeAttribute('style');
}
export function getStyle(node, k, fallback) {
  const o = parseStyleAttr(node.getAttribute && node.getAttribute('style'));
  if (o[k] != null) return o[k];
  if (node.getAttribute && node.hasAttribute(k)) return node.getAttribute(k);
  try { const c = getComputedStyle(node)[k]; if (c) return c; } catch { /* detached */ }
  return fallback;
}
export const applyCurrentStyle = node => setStyle(node, App.style);

/* ── geometry of elements ─────────────────────────────────────────────── */

/** Matrix from an element's own coordinates to document user units. */
export function ctmOf(node) {
  let m = I(), n = node;
  while (n && n !== App.doc) {
    m = mmul(parseTransform(n.getAttribute('transform')), m);
    n = n.parentNode;
  }
  return m;
}
export const parentCTM = node => ctmOf(node.parentNode === App.doc ? App.doc : node.parentNode);

/** Geometric bbox in document user units. */
export function bboxUser(node) {
  let b;
  try { b = node.getBBox(); } catch { return null; }
  if (!b || (!b.width && !b.height && !b.x && !b.y)) {
    if (node.tagName !== 'g' && node.tagName !== 'text') return null;
  }
  return boxTransform(ctmOf(node), box(b.x, b.y, b.width, b.height));
}

/** Visual bbox (includes stroke, markers, filters) in user units. */
export function bboxVisual(node) {
  const r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
  if (!r || (!r.width && !r.height)) return bboxUser(node);
  const inv = minv(mfrom(App.doc.getScreenCTM()));
  const p1 = mapply(inv, r.left, r.top), p2 = mapply(inv, r.right, r.bottom);
  return box(Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]));
}
export const bboxOf = n => (App.prefs.bboxVisual ? bboxVisual(n) : bboxUser(n)) || bboxUser(n);

export function selBBox(nodes = App.sel) {
  let b = null;
  for (const n of nodes) b = boxUnion(b, bboxOf(n));
  return b;
}

/** Apply a matrix expressed in document user space to an element. */
export function applyMatrix(node, M) {
  const P = parentCTM(node);
  const local = mmul(minv(P), mmul(M, P));
  const cur = parseTransform(node.getAttribute('transform'));
  const next = mmul(local, cur);
  const s = mstr(next);
  if (s) node.setAttribute('transform', s); else node.removeAttribute('transform');
  // stroke-width is expressed in local units, so a transform scales it for free.
  // When "scale stroke width" is off we counter-scale to keep it visually constant.
  if (!App.prefs.scaleStroke) counterScaleStroke(node, local);
  rebuildShape(node);
}

function counterScaleStroke(node, m) {
  const f = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  if (!Number.isFinite(f) || f === 0 || Math.abs(f - 1) < 1e-6) return;
  (function walk(n) {
    if (n.nodeType !== 1) return;
    const st = getStyle(n, 'stroke', 'none');
    if (st && st !== 'none') setStyle(n, { 'stroke-width': round(num(getStyle(n, 'stroke-width', 1), 1) / f, 5) });
    for (const c of n.children) walk(c);
  })(node);
}

/* ── live shapes (Inkscape-compatible sodipodi types) ─────────────────── */

export function rebuildShape(node) {
  if (!node || node.nodeType !== 1) return;
  const t = node.getAttribute('sodipodi:type');
  if (t === 'star') return buildStar(node);
  if (t === 'spiral') return buildSpiral(node);
  if (t === 'arc') return buildArc(node);
  if (node.tagName === 'g') for (const c of node.children) rebuildShape(c);
}

export function buildStar(n) {
  const cx = num(n.getAttribute('sodipodi:cx')), cy = num(n.getAttribute('sodipodi:cy'));
  const r1 = num(n.getAttribute('sodipodi:r1'), 50), r2 = num(n.getAttribute('sodipodi:r2'), 25);
  const a1 = num(n.getAttribute('sodipodi:arg1'), -Math.PI / 2), a2 = num(n.getAttribute('sodipodi:arg2'), -Math.PI / 2 + Math.PI / 5);
  const sides = Math.max(2, Math.round(num(n.getAttribute('sodipodi:sides'), 5)));
  const flat = n.getAttribute('inkscape:flatsided') === 'true';
  const rounded = num(n.getAttribute('inkscape:rounded'), 0);
  const rnd = num(n.getAttribute('inkscape:randomized'), 0);
  const jitter = (i, r) => rnd ? r * (1 + (hash(i * 7 + 3) - .5) * rnd * 2) : r;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const t1 = a1 + i * TAU / sides;
    pts.push([cx + Math.cos(t1) * jitter(i, r1), cy + Math.sin(t1) * jitter(i, r1)]);
    if (!flat) {
      const t2 = a2 + i * TAU / sides;
      pts.push([cx + Math.cos(t2) * jitter(i + 100, r2), cy + Math.sin(t2) * jitter(i + 100, r2)]);
    }
  }
  let d;
  if (Math.abs(rounded) > 1e-4) {
    const segs = [{ c: 'M', p: pts[0] }];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
      const pm1 = pts[(i - 1 + pts.length) % pts.length], p2 = pts[(i + 2) % pts.length];
      const k = rounded * 1.4;
      segs.push({ c: 'C', p: [p0[0] + (p1[0] - pm1[0]) * k / 3, p0[1] + (p1[1] - pm1[1]) * k / 3,
                              p1[0] - (p2[0] - p0[0]) * k / 3, p1[1] - (p2[1] - p0[1]) * k / 3, p1[0], p1[1]] });
    }
    segs.push({ c: 'Z' });
    d = segsToD(segs);
  } else {
    d = 'M' + pts.map(p => `${round(p[0])},${round(p[1])}`).join(' L') + ' Z';
  }
  n.setAttribute('d', d);
}
const hash = i => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };

export function buildSpiral(n) {
  const cx = num(n.getAttribute('sodipodi:cx')), cy = num(n.getAttribute('sodipodi:cy'));
  const rad = num(n.getAttribute('sodipodi:radius'), 50);
  const exp = num(n.getAttribute('sodipodi:expansion'), 1);
  const rev = num(n.getAttribute('sodipodi:revolution'), 3);
  const arg = num(n.getAttribute('sodipodi:argument'), 0);
  const t0 = clamp(num(n.getAttribute('sodipodi:t0'), 0), 0, .999);
  const pts = [], steps = Math.max(24, Math.ceil(rev * 24));
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (1 - t0) * i / steps;
    const r = rad * Math.pow(t, exp);
    const a = arg + TAU * rev * t;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  n.setAttribute('d', segsToD(polyToCurves(pts, false, .35)));
}

export function buildArc(n) {
  const cx = num(n.getAttribute('sodipodi:cx')), cy = num(n.getAttribute('sodipodi:cy'));
  const rx = Math.abs(num(n.getAttribute('sodipodi:rx'), 50)), ry = Math.abs(num(n.getAttribute('sodipodi:ry'), 50));
  let s = num(n.getAttribute('sodipodi:start'), 0), e = num(n.getAttribute('sodipodi:end'), 0);
  const type = n.getAttribute('sodipodi:arc-type') || 'slice';
  const full = Math.abs(((e - s) % TAU + TAU) % TAU) < 1e-6;
  const P = a => [round(cx + Math.cos(a) * rx), round(cy + Math.sin(a) * ry)];
  if (full) {
    n.setAttribute('d', `M ${round(cx + rx)},${round(cy)} A ${round(rx)},${round(ry)} 0 1 1 ${round(cx - rx)},${round(cy)} A ${round(rx)},${round(ry)} 0 1 1 ${round(cx + rx)},${round(cy)} Z`);
    return;
  }
  let d = ((e - s) % TAU + TAU) % TAU;
  const large = d > Math.PI ? 1 : 0;
  const a = P(s), b = P(e);
  let path = `M ${a[0]},${a[1]} A ${round(rx)},${round(ry)} 0 ${large} 1 ${b[0]},${b[1]}`;
  if (type === 'slice') path += ` L ${round(cx)},${round(cy)} Z`;
  else if (type === 'chord') path += ' Z';
  n.setAttribute('d', path);
}

/* ── object creation ──────────────────────────────────────────────────── */

export function addObject(node, parent) {
  const p = parent || (App.context && App.doc.contains(App.context) ? App.context : currentLayer());
  p.appendChild(node);
  ensureId(node);
  bus.emit('objects');
  return node;
}

export function removeNodes(nodes) {
  nodes.forEach(n => n.remove());
  App.sel = App.sel.filter(n => App.doc.contains(n));
  bus.emit('selection'); bus.emit('objects');
}

/* ── selection ────────────────────────────────────────────────────────── */

export function select(nodes, mode = 'set') {
  const list = (Array.isArray(nodes) ? nodes : nodes ? [nodes] : []).filter(n => n && App.doc.contains(n) && !isLocked(n));
  if (mode === 'set') App.sel = [...new Set(list)];
  else if (mode === 'add') App.sel = [...new Set([...App.sel, ...list])];
  else if (mode === 'remove') App.sel = App.sel.filter(n => !list.includes(n));
  else if (mode === 'toggle') {
    for (const n of list) App.sel.includes(n) ? App.sel.splice(App.sel.indexOf(n), 1) : App.sel.push(n);
  }
  bus.emit('selection');
}
export const clearSel = () => select([], 'set');
export const selectAll = () => select(allObjects(App.context || currentLayer()).filter(n => !isLocked(n) && !isHidden(n)), 'set');
export const selectAllLayers = () => select(allObjects(App.doc).filter(n => !isLocked(n) && !isHidden(n)), 'set');
export function invertSelection() {
  const all = allObjects(App.doc).filter(n => !isLocked(n) && !isHidden(n));
  select(all.filter(n => !App.sel.includes(n)), 'set');
}

/* ── z-order ──────────────────────────────────────────────────────────── */

const sibs = n => [...n.parentNode.children].filter(isDrawable);
export function raise(nodes = App.sel) {
  [...nodes].sort((a, b) => cmpDoc(b, a)).forEach(n => { const s = sibs(n), i = s.indexOf(n); if (i < s.length - 1) s[i + 1].after(n); });
  bus.emit('objects'); bus.emit('selection');
}
export function lower(nodes = App.sel) {
  [...nodes].sort(cmpDoc).forEach(n => { const s = sibs(n), i = s.indexOf(n); if (i > 0) s[i - 1].before(n); });
  bus.emit('objects'); bus.emit('selection');
}
export function raiseTop(nodes = App.sel) { [...nodes].sort(cmpDoc).forEach(n => n.parentNode.appendChild(n)); bus.emit('objects'); bus.emit('selection'); }
export function lowerBottom(nodes = App.sel) { [...nodes].sort((a, b) => cmpDoc(b, a)).forEach(n => n.parentNode.prepend(n)); bus.emit('objects'); bus.emit('selection'); }
export const cmpDoc = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;

/* ── grouping ─────────────────────────────────────────────────────────── */

export function group(nodes = App.sel) {
  if (nodes.length < 1) return null;
  const sorted = [...nodes].sort(cmpDoc);
  const anchor = sorted[sorted.length - 1];
  const g = el('g', { id: uid('g') });
  anchor.after(g);
  const P = parentCTM(g);
  for (const n of sorted) {
    const M = mmul(minv(P), ctmOf(n));                    // preserve absolute placement
    g.appendChild(n);
    const s = mstr(M);
    if (s) n.setAttribute('transform', s); else n.removeAttribute('transform');
  }
  select([g]); bus.emit('objects');
  return g;
}

export function ungroup(nodes = App.sel) {
  const out = [];
  for (const g of [...nodes]) {
    if (g.tagName !== 'g' && g.tagName !== 'switch') { out.push(g); continue; }
    const M = parseTransform(g.getAttribute('transform'));
    const gStyle = parseStyleAttr(g.getAttribute('style'));
    delete gStyle.opacity;   // group opacity cannot be pushed down faithfully
    const kids = [...g.children].filter(c => c.tagName !== 'title' && c.tagName !== 'desc');
    for (const c of kids) {
      const cm = mmul(M, parseTransform(c.getAttribute('transform')));
      g.before(c);
      const s = mstr(cm);
      if (s) c.setAttribute('transform', s); else c.removeAttribute('transform');
      const cs = parseStyleAttr(c.getAttribute('style'));
      for (const k in gStyle) if (cs[k] === undefined && !c.hasAttribute(k)) cs[k] = gStyle[k];
      const str = styleAttrStr(cs); if (str) c.setAttribute('style', str);
      out.push(c);
    }
    g.remove();
  }
  select(out); bus.emit('objects');
  return out;
}

export function enterGroup(g) { App.context = g; bus.emit('context'); }
export function leaveGroup() {
  if (!App.context) return false;
  const p = App.context.parentNode;
  App.context = isLayer(p) || p === App.doc ? null : p;
  bus.emit('context');
  return true;
}

/* ── duplicate / clone ────────────────────────────────────────────────── */

export function duplicate(nodes = App.sel) {
  const copies = [];
  for (const n of [...nodes].sort(cmpDoc)) {
    const c = n.cloneNode(true);
    reId(c);
    n.after(c);
    copies.push(c);
  }
  select(copies); bus.emit('objects');
  return copies;
}
export function reId(node) {
  if (node.nodeType !== 1) return;
  if (node.hasAttribute('id')) node.setAttribute('id', uid(node.tagName.slice(0, 4)));
  for (const c of node.children) reId(c);
}
export function cloneLinked(nodes = App.sel) {
  const out = [];
  for (const n of nodes) {
    const id = ensureId(n);
    const u = el('use', { id: uid('use'), href: '#' + id, 'xlink:href': '#' + id });
    n.after(u); out.push(u);
  }
  select(out); bus.emit('objects');
  return out;
}
export function unlinkClone(nodes = App.sel) {
  const out = [];
  for (const n of nodes) {
    if (n.tagName !== 'use') { out.push(n); continue; }
    const href = (n.getAttribute('href') || n.getAttribute('xlink:href') || '').slice(1);
    const src = App.doc.querySelector(`#${CSS.escape(href)}`);
    if (!src) { out.push(n); continue; }
    const c = src.cloneNode(true); reId(c);
    const m = mmul(parseTransform(n.getAttribute('transform')), T(num(n.getAttribute('x')), num(n.getAttribute('y'))));
    const cm = mmul(m, parseTransform(c.getAttribute('transform')));
    const s = mstr(cm); if (s) c.setAttribute('transform', s); else c.removeAttribute('transform');
    n.after(c); n.remove(); out.push(c);
  }
  select(out); bus.emit('objects');
}

/* ── history (snapshot based) ─────────────────────────────────────────── */

const hist = { stack: [], idx: -1, max: 120, label: [] };

function snapshot() {
  return {
    xml: new XMLSerializer().serializeToString(App.doc),
    sel: App.sel.map(n => n.id).filter(Boolean),
    layer: (App.doc.querySelector('g[inkscape\\:groupmode="layer"].current') || {}).id || null
  };
}

function restore(st) {
  const parsed = new DOMParser().parseFromString(st.xml, 'image/svg+xml');
  const src = parsed.documentElement;
  if (src.tagName === 'parsererror' || parsed.querySelector('parsererror')) return;
  const fresh = normalizeNS(document.importNode(src, true));
  fresh.style.overflow = 'visible';
  App.doc.replaceWith(fresh);
  App.doc = fresh;
  App.defs = fresh.querySelector('defs') || el('defs', {}, fresh);
  App.sel = st.sel.map(id => fresh.querySelector(`#${CSS.escape(id)}`)).filter(Boolean);
  if (st.layer) { const l = fresh.querySelector(`#${CSS.escape(st.layer)}`); if (l) setCurrentLayer(l); }
  App.context = null;
  bus.emit('docreplaced'); bus.emit('objects'); bus.emit('layers'); bus.emit('selection');
}

export function historyInit() { hist.stack = [snapshot()]; hist.idx = 0; hist.label = ['New document']; bus.emit('history'); }

export function commit(label = 'Edit') {
  if (hist.idx < hist.stack.length - 1) {
    hist.stack.length = hist.idx + 1;
    hist.label.length = hist.idx + 1;
  }
  hist.stack.push(snapshot()); hist.label.push(label);
  if (hist.stack.length > hist.max) { hist.stack.shift(); hist.label.shift(); }
  hist.idx = hist.stack.length - 1;
  App.dirty = true;
  bus.emit('history'); bus.emit('changed');
}

export function undo() {
  if (hist.idx <= 0) return false;
  hist.idx--; restore(hist.stack[hist.idx]);
  bus.emit('history'); bus.emit('changed');
  return true;
}
export function redo() {
  if (hist.idx >= hist.stack.length - 1) return false;
  hist.idx++; restore(hist.stack[hist.idx]);
  bus.emit('history'); bus.emit('changed');
  return true;
}
export const historyState = () => ({
  canUndo: hist.idx > 0, canRedo: hist.idx < hist.stack.length - 1,
  undoLabel: hist.label[hist.idx], redoLabel: hist.label[hist.idx + 1],
  list: hist.label.map((l, i) => ({ label: l, i, cur: i === hist.idx }))
});
export function historyGoto(i) {
  if (i < 0 || i >= hist.stack.length || i === hist.idx) return;
  hist.idx = i; restore(hist.stack[i]); bus.emit('history'); bus.emit('changed');
}

/* ── document size ────────────────────────────────────────────────────── */

export function docSize() {
  const vb = (App.doc.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite)) return { w: vb[2], h: vb[3] };
  return { w: num(App.doc.getAttribute('width'), 800), h: num(App.doc.getAttribute('height'), 600) };
}
/**
 * CSS px per document user unit. 1 for documents authored at 1:1 (what we
 * create), but imported files may declare e.g. width="210mm" viewBox="0 0 210 297".
 */
export function docScaleFactor() {
  const vb = (App.doc.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !vb[2]) return 1;
  const wAttr = App.doc.getAttribute('width');
  if (!wAttr) return 1;
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(wAttr));
  if (!m || m[2] === '%') return 1;
  const px = parseFloat(m[1]) * (UNITS[(m[2] || 'px').toLowerCase()] || 1);
  const f = px / vb[2];
  return Number.isFinite(f) && f > 0 ? f : 1;
}

export function setDocSize(w, h, unit = 'px') {
  w = Math.max(1, w); h = Math.max(1, h);
  App.doc.setAttribute('viewBox', `0 0 ${round(w, 4)} ${round(h, 4)}`);
  App.doc.setAttribute('width', `${round(fromPx(w, unit), 5)}${unit === 'px' ? '' : unit}`);
  App.doc.setAttribute('height', `${round(fromPx(h, unit), 5)}${unit === 'px' ? '' : unit}`);
  bus.emit('docsize');
}

/* ── defs helpers ─────────────────────────────────────────────────────── */

export function defs() {
  if (!App.defs || !App.doc.contains(App.defs)) {
    App.defs = App.doc.querySelector('defs') || el('defs', {}, App.doc);
    if (App.defs.parentNode !== App.doc) App.doc.prepend(App.defs);
  }
  return App.defs;
}

export function namedview() {
  let nv = App.doc.querySelector('sodipodi\\:namedview, namedview');
  if (!nv) {
    nv = document.createElementNS(SODI, 'sodipodi:namedview');
    nv.setAttribute('id', 'namedview1');
    App.doc.prepend(nv);
  }
  return nv;
}

/** Turn any shape into a <path> with equivalent geometry. */
export function toPath(node) {
  if (node.tagName === 'path') { node.removeAttribute('sodipodi:type'); return node; }
  const d = shapeToD(node);
  if (!d) return node;
  const p = el('path', { d });
  for (const a of node.attributes) {
    if (['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'x1', 'y1', 'x2', 'y2', 'd'].includes(a.name)) continue;
    p.setAttribute(a.name, a.value);
  }
  p.setAttribute('id', node.getAttribute('id') || uid('path'));
  node.replaceWith(p);
  return p;
}

export function shapeToD(n) {
  const g = a => num(n.getAttribute(a));
  switch (n.tagName) {
    case 'path': return n.getAttribute('d');
    case 'rect': {
      const x = g('x'), y = g('y'), w = g('width'), h = g('height');
      let rx = n.hasAttribute('rx') ? g('rx') : (n.hasAttribute('ry') ? g('ry') : 0);
      let ry = n.hasAttribute('ry') ? g('ry') : rx;
      rx = clamp(rx, 0, w / 2); ry = clamp(ry, 0, h / 2);
      if (!rx && !ry) return `M ${x},${y} H ${x + w} V ${y + h} H ${x} Z`;
      return `M ${x + rx},${y} H ${x + w - rx} A ${rx},${ry} 0 0 1 ${x + w},${y + ry} V ${y + h - ry}` +
             ` A ${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H ${x + rx} A ${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
             ` V ${y + ry} A ${rx},${ry} 0 0 1 ${x + rx},${y} Z`;
    }
    case 'circle': { const r = g('r'); return `M ${g('cx') - r},${g('cy')} a ${r},${r} 0 1 0 ${r * 2},0 a ${r},${r} 0 1 0 ${-r * 2},0 Z`; }
    case 'ellipse': {
      const rx = n.hasAttribute('rx') ? g('rx') : g('r'), ry = n.hasAttribute('ry') ? g('ry') : g('r');
      return `M ${g('cx') - rx},${g('cy')} a ${rx},${ry} 0 1 0 ${rx * 2},0 a ${rx},${ry} 0 1 0 ${-rx * 2},0 Z`;
    }
    case 'line': return `M ${g('x1')},${g('y1')} L ${g('x2')},${g('y2')}`;
    case 'polyline': case 'polygon': {
      const p = (n.getAttribute('points') || '').trim();
      if (!p) return null;
      return 'M ' + p + (n.tagName === 'polygon' ? ' Z' : '');
    }
    default: return null;
  }
}

/** Path segments in document user units for any shape. */
export function segsOf(node) {
  const d = shapeToD(node);
  if (!d) return null;
  return transformSegs(normalize(d), ctmOf(node));
}

/** Write user-unit segments back onto a path element. */
export function setSegsUser(node, segs) {
  const inv = minv(ctmOf(node));
  node.setAttribute('d', segsToD(transformSegs(segs, inv)));
  node.removeAttribute('sodipodi:type');
}
