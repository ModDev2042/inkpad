/* ==========================================================================
   view.js — canvas viewport, rulers, grid, guides, snapping, hit testing
   ========================================================================== */

import {
  App, bus, el, SVGNS, docSize, allObjects, isLocked, isHidden, isLayer,
  bboxOf, selBBox, ctmOf, segsOf, namedview, UNITS, fromPx, isDrawable, docScaleFactor
} from './doc.js';
import { box, boxUnion, boxFromPts, clamp, num, round, mapply, nearestOnPoly, flatten, dist } from './geom.js';

export const View = { zoom: 1, tx: 0, ty: 0, w: 0, h: 0 };

let wrap, viewport, overlay, scene, pageShadow, pageBg, pageFrame, gridG, ovGroups = {};
let rulerH, rulerV, rulerHCtx, rulerVCtx;

export const els = () => ({ wrap, viewport, overlay, scene });

export function initView() {
  wrap = document.getElementById('canvas-wrap');
  viewport = document.getElementById('viewport');
  overlay = document.getElementById('overlay');
  rulerH = document.getElementById('ruler-h');
  rulerV = document.getElementById('ruler-v');
  rulerHCtx = rulerH.getContext('2d');
  rulerVCtx = rulerV.getContext('2d');

  scene = el('g', { id: 'scene' }, viewport);
  pageShadow = el('rect', { id: 'page-shadow', fill: 'rgba(0,0,0,.35)' }, scene);
  pageBg = el('rect', { id: 'page-bg', fill: '#fff' }, scene);
  gridG = el('g', { id: 'grid-g', 'pointer-events': 'none' }, scene);
  scene.appendChild(App.doc);
  pageFrame = el('rect', { id: 'page-frame', fill: 'none', stroke: '#000', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, scene);

  for (const k of ['guides', 'sel', 'tool', 'snap']) ovGroups[k] = el('g', { id: 'ov-' + k }, overlay);

  App.viewport = viewport; App.scene = scene;

  new ResizeObserver(() => { resize(); }).observe(wrap);
  bus.on('docreplaced', () => { scene.insertBefore(App.doc, pageFrame); update(); });
  bus.on('docsize', () => { update(); });
  resize();
  return { wrap, viewport, overlay };
}

export function resize() {
  const r = wrap.getBoundingClientRect();
  View.w = r.width; View.h = r.height;
  if (!View.everSized && View.w > 1 && View.h > 1) { View.everSized = true; setTimeout(() => bus.emit('firstsize'), 0); }
  const dpr = Math.min(devicePixelRatio || 1, 2.5);
  for (const [c, w, h] of [[rulerH, r.width, 16], [rulerV, 16, r.height]]) {
    c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
    c.style.width = w + 'px'; c.style.height = h + 'px';
  }
  update();
}

/* ── coordinate conversion ────────────────────────────────────────────── */

export const toScreen = (x, y) => [x * View.zoom + View.tx, y * View.zoom + View.ty];
export const toUser = (sx, sy) => [(sx - View.tx) / View.zoom, (sy - View.ty) / View.zoom];
export function evtScreen(e) {
  const r = wrap.getBoundingClientRect();
  return [(e.clientX ?? 0) - r.left, (e.clientY ?? 0) - r.top];
}
export function evtUser(e) { const s = evtScreen(e); return toUser(s[0], s[1]); }
export const px2u = p => p / View.zoom;

/* ── view transform ───────────────────────────────────────────────────── */

export function update() {
  scene.setAttribute('transform', `translate(${round(View.tx, 3)},${round(View.ty, 3)}) scale(${round(View.zoom, 8)})`);
  const { w, h } = docSize();
  const nv = namedview();
  const pc = nv.getAttribute('pagecolor') || '#ffffff';
  const border = nv.getAttribute('bordercolor') || '#666666';
  pageBg.setAttribute('width', w); pageBg.setAttribute('height', h); pageBg.setAttribute('fill', pc);
  pageFrame.setAttribute('width', w); pageFrame.setAttribute('height', h); pageFrame.setAttribute('stroke', border);
  const so = 2 / View.zoom;
  pageShadow.setAttribute('x', so); pageShadow.setAttribute('y', so);
  pageShadow.setAttribute('width', w); pageShadow.setAttribute('height', h);
  App.doc.setAttribute('width', App.doc.getAttribute('width') || w);
  drawGrid(); drawRulers(); drawGuides(); updateScrollbars();
  bus.emit('view');
}

export function setZoom(z, cx, cy) {
  z = clamp(z, 0.01, 256);
  if (cx === undefined) { cx = View.w / 2; cy = View.h / 2; }
  const [ux, uy] = toUser(cx, cy);
  View.zoom = z;
  View.tx = cx - ux * z; View.ty = cy - uy * z;
  update();
}
export function zoomBy(f, cx, cy) { setZoom(View.zoom * f, cx, cy); }
export function panBy(dx, dy) { View.tx += dx; View.ty += dy; update(); }

export function zoomToBox(b, pad = 0.06) {
  if (!b || !(b.w > 0 || b.h > 0)) return;
  const z = clamp(Math.min(View.w / (b.w || 1), View.h / (b.h || 1)) * (1 - pad), 0.01, 256);
  View.zoom = z;
  View.tx = View.w / 2 - b.cx * z; View.ty = View.h / 2 - b.cy * z;
  update();
}
export const zoomPage = () => { const { w, h } = docSize(); zoomToBox(box(0, 0, w, h)); };
export const zoomWidth = () => { const { w, h } = docSize(); const z = View.w / w * .96; View.zoom = z; View.tx = (View.w - w * z) / 2; View.ty = View.h / 2 - (h / 2) * z; update(); };
export function zoomDrawing() { const b = drawingBBox(); b ? zoomToBox(b) : zoomPage(); }
export function zoomSelection() { const b = selBBox(); b ? zoomToBox(b, .18) : zoomDrawing(); }
export function drawingBBox() {
  let b = null;
  for (const n of allObjects(App.doc)) if (!isHidden(n)) b = boxUnion(b, bboxOf(n));
  return b;
}

/* ── overlay ──────────────────────────────────────────────────────────── */

export const ovg = k => ovGroups[k];
export function ov(tag, attrs, group = 'tool') {
  return el(tag, attrs, ovGroups[group]);
}
export function clearOv(group) {
  if (group) ovGroups[group].replaceChildren();
  else for (const k in ovGroups) if (k !== 'guides') ovGroups[k].replaceChildren();
}

/** Handle rectangle in screen space. */
export function handle(x, y, kind = 'node', group = 'tool', extra = {}) {
  const s = App.prefs.handleSize;
  const styles = {
    node: { fill: '#fff', stroke: '#2b7fd4' }, nodeSel: { fill: '#2b7fd4', stroke: '#fff' },
    scale: { fill: '#fff', stroke: '#111' }, rot: { fill: '#fff', stroke: '#111' },
    ctrl: { fill: '#e8f0ff', stroke: '#2b7fd4' }, warn: { fill: '#ffd54a', stroke: '#946b00' },
    grad: { fill: 'none', stroke: '#fff' }
  };
  const st = styles[kind] || styles.node;
  const shape = (kind === 'rot' || kind === 'ctrl' || kind === 'grad')
    ? el('circle', { cx: round(x, 2), cy: round(y, 2), r: s / 2 })
    : el('rect', { x: round(x - s / 2, 2), y: round(y - s / 2, 2), width: s, height: s });
  shape.setAttribute('fill', st.fill); shape.setAttribute('stroke', st.stroke);
  shape.setAttribute('stroke-width', 1.2);
  shape.setAttribute('vector-effect', 'non-scaling-stroke');
  for (const k in extra) shape.setAttribute(k, extra[k]);
  ovGroups[group].appendChild(shape);
  return shape;
}

/* ── rulers ───────────────────────────────────────────────────────────── */

const NICE = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
function tickStep(unitPx, minPx = 62) {
  for (const n of NICE) if (n * unitPx * View.zoom >= minPx) return n;
  return NICE[NICE.length - 1];
}

function drawRulers() {
  if (!App.prefs.rulers) return;
  const dpr = Math.min(devicePixelRatio || 1, 2.5);
  const u = App.prefs.unit;
  const upx = (UNITS[u] || 1) / docScaleFactor();   // user units per display unit
  const step = tickStep(upx);
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--fg2').trim() || '#aaa';
  const line = css.getPropertyValue('--line2').trim() || '#555';
  const bg = css.getPropertyValue('--bg2').trim() || '#2e3235';

  for (const [ctx, horiz] of [[rulerHCtx, true], [rulerVCtx, false]]) {
    const W = horiz ? View.w : 16, H = horiz ? 16 : View.h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = fg; ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.textBaseline = horiz ? 'top' : 'alphabetic';

    const len = horiz ? View.w : View.h;
    const off = horiz ? View.tx : View.ty;
    const u0 = -off / View.zoom / upx, u1 = (len - off) / View.zoom / upx;
    const sub = step / 5;
    ctx.beginPath();
    for (let v = Math.floor(u0 / sub) * sub; v <= u1; v += sub) {
      const p = Math.round(v * upx * View.zoom + off) + .5;
      if (p < -1 || p > len + 1) continue;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const t = major ? 0 : 11;
      if (horiz) { ctx.moveTo(p, t); ctx.lineTo(p, 16); }
      else { ctx.moveTo(t, p); ctx.lineTo(16, p); }
      if (major) {
        const lbl = String(round(v, 4));
        if (horiz) ctx.fillText(lbl, p + 2, 2);
        else { ctx.save(); ctx.translate(10, p - 2); ctx.rotate(-Math.PI / 2); ctx.fillText(lbl, 0, 0); ctx.restore(); }
      }
    }
    ctx.stroke();
  }
  // pointer marker
  if (lastPointer) {
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a90d9';
    rulerHCtx.fillStyle = acc; rulerHCtx.fillRect(lastPointer[0] - 1, 0, 2, 16);
    rulerVCtx.fillStyle = acc; rulerVCtx.fillRect(0, lastPointer[1] - 1, 16, 2);
  }
}
let lastPointer = null;
export function setPointer(sx, sy) { lastPointer = (sx == null) ? null : [sx, sy]; if (App.prefs.rulers) drawRulers(); }

/* ── grid ─────────────────────────────────────────────────────────────── */

function drawGrid() {
  gridG.replaceChildren();
  if (!App.prefs.gridVisible) return;
  const g = App.grid, { w, h } = docSize();
  const sx = Math.max(.05, g.sx), sy = Math.max(.05, g.sy);
  if (sx * View.zoom < 3 && sy * View.zoom < 3) return;
  const x0 = toUser(0, 0)[0], y0 = toUser(0, 0)[1];
  const x1 = toUser(View.w, View.h)[0], y1 = toUser(View.w, View.h)[1];
  const lo = (a, s, o) => Math.floor((a - o) / s) * s + o;
  const minor = [], major = [];
  if (g.type === 'xy') {
    for (let x = lo(x0, sx, g.origx); x <= x1; x += sx) {
      const isM = Math.abs(Math.round((x - g.origx) / sx) % g.major) < 1e-9;
      (isM ? major : minor).push(`M${round(x, 3)},${round(y0, 3)}V${round(y1, 3)}`);
      if (major.length + minor.length > 4000) break;
    }
    for (let y = lo(y0, sy, g.origy); y <= y1; y += sy) {
      const isM = Math.abs(Math.round((y - g.origy) / sy) % g.major) < 1e-9;
      (isM ? major : minor).push(`M${round(x0, 3)},${round(y, 3)}H${round(x1, 3)}`);
      if (major.length + minor.length > 8000) break;
    }
  } else {                                            // axonometric
    const ang = 30 * Math.PI / 180, tanA = Math.tan(ang);
    for (let x = lo(x0 - (y1 - y0) / tanA, sx, g.origx); x <= x1 + (y1 - y0) / tanA; x += sx) {
      minor.push(`M${round(x, 3)},${round(y0, 3)}L${round(x + (y1 - y0) / tanA, 3)},${round(y1, 3)}`);
      minor.push(`M${round(x, 3)},${round(y0, 3)}L${round(x - (y1 - y0) / tanA, 3)},${round(y1, 3)}`);
      if (minor.length > 4000) break;
    }
    for (let y = lo(y0, sy, g.origy); y <= y1; y += sy) minor.push(`M${round(x0, 3)},${round(y, 3)}H${round(x1, 3)}`);
  }
  const mk = (d, op, wpx) => el('path', {
    d, fill: 'none', stroke: g.color, 'stroke-opacity': op,
    'stroke-width': wpx / View.zoom, 'shape-rendering': 'crispEdges'
  }, gridG);
  if (minor.length) mk(minor.join(''), .28, 1);
  if (major.length) mk(major.join(''), .55, 1);
}

/* ── guides ───────────────────────────────────────────────────────────── */

export function loadGuides() {
  App.guides = [];
  const nv = namedview();
  for (const g of nv.children) {
    if (!/guide$/.test(g.tagName)) continue;
    const p = (g.getAttribute('position') || '0,0').split(',').map(Number);
    const o = (g.getAttribute('orientation') || '0,1').split(',').map(Number);
    App.guides.push({ x: p[0] || 0, y: p[1] || 0, nx: o[0] || 0, ny: o[1] || 0, id: g.id, node: g });
  }
  drawGuides();
}
export function saveGuides() {
  const nv = namedview();
  [...nv.children].forEach(c => { if (/guide$/.test(c.tagName)) c.remove(); });
  for (const g of App.guides) {
    const n = document.createElementNS('http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd', 'sodipodi:guide');
    n.setAttribute('position', `${round(g.x, 4)},${round(g.y, 4)}`);
    n.setAttribute('orientation', `${round(g.nx, 6)},${round(g.ny, 6)}`);
    nv.appendChild(n);
  }
}
export function addGuide(x, y, horizontal) {
  App.guides.push(horizontal ? { x: 0, y, nx: 0, ny: 1 } : { x, y: 0, nx: 1, ny: 0 });
  saveGuides(); drawGuides();
}
export function drawGuides() {
  const g = ovGroups.guides; if (!g) return;
  g.replaceChildren();
  if (!App.prefs.guidesVisible) return;
  App.guides.forEach((gd, i) => {
    const p = toScreen(gd.x, gd.y);
    let d;
    if (Math.abs(gd.nx) < 1e-6) d = `M-10,${round(p[1], 2)}H${View.w + 10}`;
    else if (Math.abs(gd.ny) < 1e-6) d = `M${round(p[0], 2)},-10V${View.h + 10}`;
    else {
      const k = 4000;
      d = `M${round(p[0] - gd.ny * k, 2)},${round(p[1] + gd.nx * k, 2)}L${round(p[0] + gd.ny * k, 2)},${round(p[1] - gd.nx * k, 2)}`;
    }
    el('path', { d, stroke: '#2b7fd4', 'stroke-opacity': .75, 'stroke-width': 1, fill: 'none', 'data-guide': i }, g);
  });
}
export function guideAt(sx, sy, tol = 6) {
  for (let i = 0; i < App.guides.length; i++) {
    const gd = App.guides[i], p = toScreen(gd.x, gd.y);
    const d = Math.abs(gd.nx) < 1e-6 ? Math.abs(sy - p[1]) : Math.abs(gd.ny) < 1e-6 ? Math.abs(sx - p[0])
      : Math.abs((sx - p[0]) * gd.nx + (sy - p[1]) * gd.ny);
    if (d <= tol) return i;
  }
  return -1;
}

/* ── scrollbars ───────────────────────────────────────────────────────── */

function updateScrollbars() {
  const { w, h } = docSize();
  const draw = drawingBBox() || box(0, 0, w, h);
  const ext = boxUnion(box(0, 0, w, h), draw);
  const pad = 200 / View.zoom;
  const total = box(ext.x - pad, ext.y - pad, ext.w + pad * 2, ext.h + pad * 2);
  const [vx0, vy0] = toUser(0, 0), [vx1, vy1] = toUser(View.w, View.h);
  const setThumb = (id, a0, a1, t0, t1, size, horiz) => {
    const th = document.querySelector(`#${id} .thumb`); if (!th) return;
    const span = Math.max(t1 - t0, a1 - a0, 1e-6);
    const s = clamp((Math.min(a0, t0) === t0 ? (a0 - t0) : 0) / span, 0, 1);
    const l = clamp((a1 - a0) / span, .05, 1);
    if (horiz) { th.style.left = (s * size) + 'px'; th.style.width = (l * size) + 'px'; }
    else { th.style.top = (s * size) + 'px'; th.style.height = (l * size) + 'px'; }
  };
  setThumb('scroll-h', vx0, vx1, total.x, total.x2, View.w, true);
  setThumb('scroll-v', vy0, vy1, total.y, total.y2, View.h, false);
}

/* ── hit testing ──────────────────────────────────────────────────────── */

export function selectableAncestor(node) {
  if (!node || !App.doc.contains(node)) return null;
  const stop = (App.context && App.doc.contains(App.context)) ? App.context : null;
  let n = node;
  while (n && n.parentNode && n.parentNode !== App.doc) {
    const p = n.parentNode;
    if (p === stop || isLayer(p)) break;
    if (p === App.doc) break;
    n = p;
  }
  return isDrawable(n) ? n : null;
}

export function hitTest(clientX, clientY, deep = false) {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const e of stack) {
    if (e === overlay || overlay.contains(e)) continue;
    if (!App.doc.contains(e) || e === App.doc) continue;
    if (e.tagName === 'defs' || e.closest('defs')) continue;
    const target = deep ? (isDrawable(e) ? e : selectableAncestor(e)) : selectableAncestor(e);
    if (!target) continue;
    if (isLocked(target) || isHidden(target)) continue;
    return target;
  }
  return null;
}

/** Proximity hit for thin/unfilled paths — helps a lot on touch screens. */
export function hitNear(ux, uy, tolPx = 12) {
  const tol = tolPx / View.zoom;
  let best = null;
  for (const n of allObjects(App.doc)) {
    if (isLocked(n) || isHidden(n)) continue;
    const b = bboxOf(n);
    if (!b || ux < b.x - tol || ux > b.x2 + tol || uy < b.y - tol || uy > b.y2 + tol) continue;
    const segs = segsOf(n);
    if (!segs) { best = best || { n, d: tol }; continue; }
    for (const sp of flatten(segs, .4)) {
      const q = nearestOnPoly(sp.pts, ux, uy, sp.closed);
      if (q && q.d < tol && (!best || q.d < best.d)) best = { n, d: q.d };
    }
  }
  return best ? best.n : null;
}

export function pickInBox(b, touch = false) {
  const out = [];
  for (const n of allObjects(App.context || App.doc)) {
    if (isLocked(n) || isHidden(n)) continue;
    const nb = bboxOf(n); if (!nb) continue;
    const hit = touch ? (nb.x < b.x2 && nb.x2 > b.x && nb.y < b.y2 && nb.y2 > b.y)
      : (nb.x >= b.x && nb.x2 <= b.x2 && nb.y >= b.y && nb.y2 <= b.y2);
    if (hit) out.push(n);
  }
  return out;
}

/* ── snapping ─────────────────────────────────────────────────────────── */

let snapCache = null;

export function buildSnap(exclude = []) {
  const ex = new Set(exclude);
  const pts = [], vx = [], hy = [];
  const { w, h } = docSize();
  if (App.snap.page) {
    pts.push([0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]);
    vx.push(0, w, w / 2); hy.push(0, h, h / 2);
  }
  if (App.snap.guide) for (const g of App.guides) {
    if (Math.abs(g.nx) < 1e-6) hy.push(g.y); else if (Math.abs(g.ny) < 1e-6) vx.push(g.x);
  }
  let budget = 3000;
  for (const n of allObjects(App.doc)) {
    if (ex.has(n) || isHidden(n)) continue;
    if (App.snap.bbox) {
      const b = bboxOf(n); if (!b) continue;
      pts.push([b.x, b.y], [b.x2, b.y], [b.x, b.y2], [b.x2, b.y2]);
      if (App.snap.center) pts.push([b.cx, b.cy], [b.cx, b.y], [b.cx, b.y2], [b.x, b.cy], [b.x2, b.cy]);
      vx.push(b.x, b.x2, b.cx); hy.push(b.y, b.y2, b.cy);
    }
    if (App.snap.node && budget > 0) {
      const segs = segsOf(n);
      if (segs) for (const s of segs) {
        if (s.c === 'Z' || budget-- < 0) continue;
        pts.push([s.p[s.p.length - 2], s.p[s.p.length - 1]]);
      }
    }
  }
  snapCache = { pts, vx: [...new Set(vx)], hy: [...new Set(hy)] };
  return snapCache;
}
export const clearSnap = () => { snapCache = null; };

/**
 * Snap a point. Returns {x,y,dx,dy,hitX,hitY}.
 * `extra` allows callers to add temporary targets (e.g. path nodes being edited).
 */
export function snapPoint(x, y, extra) {
  const res = { x, y, dx: 0, dy: 0, hitX: null, hitY: null };
  if (!App.prefs.snapEnabled) return res;
  const tol = App.prefs.snapDist / View.zoom;
  const c = snapCache || buildSnap();
  let bx = tol, by = tol;

  const tryPt = (px, py) => {
    const ddx = Math.abs(px - x), ddy = Math.abs(py - y);
    if (ddx < bx && ddy < tol) { bx = ddx; res.x = px; res.hitX = [px, py]; }
    if (ddy < by && ddx < tol) { by = ddy; res.y = py; res.hitY = [px, py]; }
  };
  for (const p of c.pts) tryPt(p[0], p[1]);
  if (extra) for (const p of extra) tryPt(p[0], p[1]);

  for (const v of c.vx) { const d = Math.abs(v - x); if (d < bx) { bx = d; res.x = v; res.hitX = [v, y]; } }
  for (const v of c.hy) { const d = Math.abs(v - y); if (d < by) { by = d; res.y = v; res.hitY = [x, v]; } }

  if (App.snap.grid && App.prefs.gridVisible) {
    const g = App.grid;
    const gx = Math.round((x - g.origx) / g.sx) * g.sx + g.origx;
    const gy = Math.round((y - g.origy) / g.sy) * g.sy + g.origy;
    if (Math.abs(gx - x) < bx) { bx = Math.abs(gx - x); res.x = gx; res.hitX = [gx, y]; }
    if (Math.abs(gy - y) < by) { by = Math.abs(gy - y); res.y = gy; res.hitY = [x, gy]; }
  }
  res.dx = res.x - x; res.dy = res.y - y;
  showSnapMarks(res);
  return res;
}

function showSnapMarks(r) {
  const g = ovGroups.snap; g.replaceChildren();
  const mark = p => {
    const s = toScreen(p[0], p[1]);
    el('path', {
      d: `M${round(s[0] - 6, 1)},${round(s[1], 1)}h12M${round(s[0], 1)},${round(s[1] - 6, 1)}v12`,
      stroke: '#00c2ff', 'stroke-width': 1.4, fill: 'none'
    }, g);
  };
  if (r.hitX) mark(r.hitX);
  if (r.hitY && (!r.hitX || r.hitY[0] !== r.hitX[0] || r.hitY[1] !== r.hitX[1])) mark(r.hitY);
}

/** Snap a whole bbox by testing its salient points; returns {dx,dy}. */
export function snapBox(b, extraPts = []) {
  if (!App.prefs.snapEnabled || !b) return { dx: 0, dy: 0 };
  const cands = [[b.x, b.y], [b.x2, b.y], [b.x, b.y2], [b.x2, b.y2], [b.cx, b.cy], ...extraPts];
  let best = { dx: 0, dy: 0, sx: Infinity, sy: Infinity };
  for (const p of cands) {
    const r = snapPoint(p[0], p[1]);
    if (r.hitX && Math.abs(r.dx) < Math.abs(best.sx)) { best.sx = r.dx; best.dx = r.dx; }
    if (r.hitY && Math.abs(r.dy) < Math.abs(best.sy)) { best.sy = r.dy; best.dy = r.dy; }
  }
  return { dx: Number.isFinite(best.dx) ? best.dx : 0, dy: Number.isFinite(best.dy) ? best.dy : 0 };
}
