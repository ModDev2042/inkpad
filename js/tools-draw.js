/* ==========================================================================
   tools-draw.js — Pencil, Pen, Calligraphy, Eraser, Spray, Tweak,
                   Paint bucket, Dropper, Zoom, Measure, Connector
   ========================================================================== */

import {
  App, bus, el, commit, select, addObject, uid, applyCurrentStyle, setStyle, getStyle,
  currentLayer, ctmOf, bboxOf, allObjects, isHidden, isLocked, duplicate, removeNodes,
  segsOf, setSegsUser, toPath, shapeToD, ensureId, rebuildShape
} from './doc.js';
import {
  View, toScreen, toUser, evtUser, snapPoint, buildSnap, clearSnap, ov, ovg, hitTest,
  hitNear, zoomToBox, setZoom, zoomBy, els, px2u, update
} from './view.js';
import { registerTool, redraw, TOOLS, hot, hitHot, setTool } from './tools.js';
import {
  minv, mapply, mmul, round, clamp, num, dist, TAU, D2R, R2D, normalize, segsToD,
  flatten, rdp, polyToCurves, fitCurve, boxFromPts, box, nearestOnPoly, transformSegs
} from './geom.js';
import { segsToRings, ringsToSegs, boolOp, strokeOutline } from './bool.js';
import { renderScreenCanvas, invalidateRaster } from './raster.js';

const local = pt => {
  const parent = (App.context || currentLayer());
  return mapply(minv(ctmOf(parent)), pt[0], pt[1]);
};
const localAll = pts => { const inv = minv(ctmOf(App.context || currentLayer())); return pts.map(p => mapply(inv, p[0], p[1])); };

/* ══════════════════════════ PENCIL (freehand) ═════════════════════════ */

registerTool({
  name: 'pencil', title: 'Pencil', key: 'p', icon: 'pencil', cursor: 'crosshair',
  hint: 'Draw freehand. Click to place straight-line points; smoothing is set in the toolbar.',
  smooth: 20, mode: 'bezier', op: null,

  down(p) {
    const node = el('path', { id: uid('path'), d: '' });
    applyCurrentStyle(node);
    if (getStyle(node, 'stroke', 'none') === 'none') setStyle(node, { stroke: '#000000', 'stroke-width': App.style['stroke-width'] || 1 });
    setStyle(node, { fill: 'none' });
    addObject(node); select([node]);
    this.op = { node, pts: [[p.x, p.y]] };
  },
  move(p) {
    const o = this.op; if (!o) return;
    const l = o.pts[o.pts.length - 1];
    if (Math.hypot(p.x - l[0], p.y - l[1]) * View.zoom < 1.6) return;
    o.pts.push([p.x, p.y]);
    o.node.setAttribute('d', segsToD(this.makeSegs(o.pts, true)));
    bus.emit('status', `${o.pts.length} points`);
  },
  up() {
    const o = this.op; this.op = null;
    if (!o) return;
    if (o.pts.length < 2) { o.node.remove(); select([]); return; }
    o.node.setAttribute('d', segsToD(this.makeSegs(o.pts, false)));
    commit('Draw freehand');
  },
  cancel() { if (this.op) { this.op.node.remove(); this.op = null; } },

  makeSegs(ptsUser, live) {
    const pts = localAll(ptsUser);
    if (this.mode === 'polyline' || live && pts.length < 4) {
      return [{ c: 'M', p: pts[0] }, ...pts.slice(1).map(p => ({ c: 'L', p }))];
    }
    const tolPx = .3 + this.smooth / 100 * 6;
    const simplified = rdp(pts, px2u(tolPx));
    return polyToCurves(simplified, false, px2u(.6 + this.smooth / 100 * 8));
  },

  options() {
    return [
      { type: 'select', label: 'Mode', value: this.mode, options: [['bezier', 'Smooth curve'], ['polyline', 'Straight lines']], set: v => this.mode = v },
      { type: 'number', label: 'Smoothing', value: this.smooth, min: 0, max: 100, step: 5, set: v => this.smooth = clamp(v, 0, 100) }
    ];
  }
});

/* ══════════════════════════ PEN / BEZIER ═════════════════════════════ */

registerTool({
  name: 'pen', title: 'Pen (Bezier)', key: 'b', icon: 'pen', cursor: 'crosshair',
  hint: 'Click for corners, drag for curves. Enter or double-click finishes, Esc cancels, Backspace undoes a node.',
  nodes: [], node: null, drag: null, cursorPt: null, alwaysDraw: true,

  activate() { this.nodes = []; this.node = null; },
  deactivate() { this.finish(true); },

  down(p) {
    const s = snapPoint(p.x, p.y);
    if (!this.nodes.length) buildSnap();
    // close the path by clicking the first node
    if (this.nodes.length > 1) {
      const f = this.nodes[0], sc = toScreen(f.p[0], f.p[1]);
      if (Math.hypot(sc[0] - p.sx, sc[1] - p.sy) < 12) { this.finish(false, true); return; }
    }
    this.nodes.push({ p: [s.x, s.y], in: null, out: null });
    this.drag = { i: this.nodes.length - 1, from: [s.x, s.y] };
    this.preview();
  },
  move(p) {
    this.cursorPt = [p.x, p.y];
    if (this.drag) {
      const n = this.nodes[this.drag.i];
      let a = [p.x, p.y];
      if (p.ctrl) {
        const ang = Math.round(Math.atan2(p.y - n.p[1], p.x - n.p[0]) / (Math.PI / 12)) * (Math.PI / 12);
        const r = Math.hypot(p.x - n.p[0], p.y - n.p[1]);
        a = [n.p[0] + Math.cos(ang) * r, n.p[1] + Math.sin(ang) * r];
      }
      n.out = a;
      n.in = [2 * n.p[0] - a[0], 2 * n.p[1] - a[1]];
    }
    this.preview();
  },
  up() { this.drag = null; this.preview(); },

  preview() {
    if (!this.nodes.length) { if (this.node) { this.node.remove(); this.node = null; } return; }
    if (!this.node) {
      this.node = el('path', { id: uid('path'), d: '' });
      applyCurrentStyle(this.node);
      if (getStyle(this.node, 'stroke', 'none') === 'none') setStyle(this.node, { stroke: '#000000', 'stroke-width': App.style['stroke-width'] || 1 });
      addObject(this.node);
    }
    const list = this.nodes.slice();
    if (this.cursorPt && !this.drag) list.push({ p: this.cursorPt, in: null, out: null });
    this.node.setAttribute('d', segsToD(this.segsFrom(list, false)));
  },
  segsFrom(list, closed) {
    const pts = localAll(list.map(n => n.p));
    const inv = minv(ctmOf(App.context || currentLayer()));
    const cv = v => v ? mapply(inv, v[0], v[1]) : null;
    const out = [{ c: 'M', p: pts[0] }];
    const lim = closed ? list.length : list.length - 1;
    for (let i = 0; i < lim; i++) {
      const a = list[i], b = list[(i + 1) % list.length];
      const ao = cv(a.out), bi = cv(b.in);
      const pa = pts[i], pb = pts[(i + 1) % list.length];
      if (!ao && !bi) out.push({ c: 'L', p: pb });
      else out.push({ c: 'C', p: [...(ao || pa), ...(bi || pb), ...pb] });
    }
    if (closed) out.push({ c: 'Z' });
    return out;
  },

  finish(discard, closed) {
    clearSnap();
    if (!this.node) { this.nodes = []; return; }
    if (discard || this.nodes.length < 2) { this.node.remove(); this.node = null; this.nodes = []; select([]); return; }
    this.node.setAttribute('d', segsToD(this.segsFrom(this.nodes, !!closed)));
    if (closed) setStyle(this.node, { fill: App.style.fill });
    select([this.node]);
    this.node = null; this.nodes = []; this.cursorPt = null;
    commit('Draw path');
  },

  dbl() { this.finish(false); },
  keydown(e) {
    if (e.key === 'Enter') { this.finish(false); redraw(); return true; }
    if (e.key === 'Escape') { this.finish(true); redraw(); return true; }
    if (e.key === 'Backspace') {
      this.nodes.pop();
      if (!this.nodes.length) this.finish(true); else this.preview();
      redraw(); return true;
    }
    return false;
  },

  draw() {
    this.nodes.forEach((n, i) => {
      const s = toScreen(n.p[0], n.p[1]);
      ov('rect', { x: s[0] - 3.5, y: s[1] - 3.5, width: 7, height: 7, fill: i === 0 ? '#4a90d9' : '#fff', stroke: '#204a77' });
      if (n.out) {
        const h = toScreen(n.out[0], n.out[1]), h2 = toScreen(n.in[0], n.in[1]);
        ov('line', { x1: h2[0], y1: h2[1], x2: h[0], y2: h[1], stroke: '#4a90d9' });
        ov('circle', { cx: h[0], cy: h[1], r: 3, fill: '#e8f0ff', stroke: '#4a90d9' });
      }
    });
  },
  options() {
    return [{ type: 'label', text: 'Click = corner · drag = curve · Enter = finish · click first node = close' }];
  }
});

/* ══════════════════════════ CALLIGRAPHY ══════════════════════════════ */

registerTool({
  name: 'calligraphy', title: 'Calligraphy', key: 'c', icon: 'calligraphy', cursor: 'crosshair',
  hint: 'Draw with a pressure/velocity-sensitive nib. Width, angle and thinning are in the toolbar.',
  width: 6, thinning: .35, angle: 30, fixation: .9, tremor: 0, caps: 'round', op: null,

  down(p) {
    const node = el('path', { id: uid('calli'), d: '' });
    applyCurrentStyle(node);
    setStyle(node, { fill: App.style.stroke !== 'none' ? App.style.stroke : (App.style.fill !== 'none' ? App.style.fill : '#000000'), stroke: 'none' });
    addObject(node); select([node]);
    this.op = { node, pts: [[p.x, p.y, p.e.pressure || .5]], t: performance.now() };
  },
  move(p) {
    const o = this.op; if (!o) return;
    const l = o.pts[o.pts.length - 1];
    const d = Math.hypot(p.x - l[0], p.y - l[1]);
    if (d * View.zoom < 1.2) return;
    o.pts.push([p.x, p.y, p.e.pressure || .5]);
    o.node.setAttribute('d', segsToD(this.outline(o.pts)));
  },
  up() {
    const o = this.op; this.op = null;
    if (!o) return;
    if (o.pts.length < 2) { o.node.remove(); select([]); return; }
    o.node.setAttribute('d', segsToD(this.outline(o.pts, true)));
    commit('Calligraphic stroke');
  },
  cancel() { if (this.op) { this.op.node.remove(); this.op = null; } },

  outline(pts, final) {
    const w = px2u(this.width * 1.6);
    const ang = this.angle * D2R;
    const nib = [Math.cos(ang), Math.sin(ang)];
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      const speed = clamp(L * View.zoom / 14, 0, 1);
      const press = pts[i][2] ?? .5;
      let hw = w * .5 * (1 - this.thinning * speed) * (.55 + press * .9);
      hw = Math.max(hw, w * .06);
      // nib direction interpolates between the fixed pen angle and the path normal
      const nx = -dy, ny = dx;
      const fx = nib[0] * this.fixation + nx * (1 - this.fixation);
      const fy = nib[1] * this.fixation + ny * (1 - this.fixation);
      const fl = Math.hypot(fx, fy) || 1;
      const ox = fx / fl * hw, oy = fy / fl * hw;
      const tr = this.tremor ? (Math.random() - .5) * this.tremor * w : 0;
      left.push([pts[i][0] + ox + tr, pts[i][1] + oy + tr]);
      right.push([pts[i][0] - ox + tr, pts[i][1] - oy + tr]);
    }
    const ring = left.concat(right.reverse());
    const pl = localAll(ring);
    if (!final) return [{ c: 'M', p: pl[0] }, ...pl.slice(1).map(p => ({ c: 'L', p })), { c: 'Z' }];
    return polyToCurves(rdp(pl, px2u(.35)), true, px2u(.7));
  },

  options() {
    return [
      { type: 'number', label: 'Width', value: this.width, min: .5, max: 100, step: 1, set: v => this.width = v },
      { type: 'number', label: 'Thinning', value: this.thinning, min: 0, max: 1, step: .05, set: v => this.thinning = v },
      { type: 'number', label: 'Angle', value: this.angle, min: -90, max: 90, step: 5, set: v => this.angle = v },
      { type: 'number', label: 'Fixation', value: this.fixation, min: 0, max: 1, step: .05, set: v => this.fixation = v },
      { type: 'number', label: 'Tremor', value: this.tremor, min: 0, max: 1, step: .05, set: v => this.tremor = v }
    ];
  }
});

/* ══════════════════════════ ERASER ═══════════════════════════════════ */

registerTool({
  name: 'eraser', title: 'Eraser', key: 'k', icon: 'eraser', cursor: 'crosshair',
  hint: 'Drag over objects. "Delete" removes whole objects, "Cut out" subtracts the brush shape.',
  width: 18, mode: 'cut', op: null, alwaysDraw: true, cursorPt: null,

  down(p) { this.op = { pts: [[p.x, p.y]], hits: new Set() }; this.move(p); },
  move(p) {
    this.cursorPt = [p.x, p.y];
    const o = this.op; if (!o) return;
    const l = o.pts[o.pts.length - 1];
    if (Math.hypot(p.x - l[0], p.y - l[1]) * View.zoom > 1.5) o.pts.push([p.x, p.y]);
    if (this.mode === 'delete') {
      const t = hitTest(p.e.clientX, p.e.clientY) || hitNear(p.x, p.y, this.width / 2);
      if (t) o.hits.add(t);
    }
  },
  up() {
    const o = this.op; this.op = null;
    if (!o) return;
    if (this.mode === 'delete') {
      if (!o.hits.size) return;
      removeNodes([...o.hits]); commit('Erase objects'); return;
    }
    if (o.pts.length < 2) return;
    const brush = strokeOutline([{ c: 'M', p: o.pts[0] }, ...o.pts.slice(1).map(p => ({ c: 'L', p }))],
      px2u(this.width), 'round', 'round');
    if (!brush.length) return;
    const bb = boxFromPts(brush.flat());
    let changed = 0;
    for (const n of allObjects(App.doc)) {
      if (isHidden(n) || isLocked(n) || n.tagName === 'g' || n.tagName === 'image' || n.tagName === 'text') continue;
      const nb = bboxOf(n);
      if (!nb || nb.x > bb.x2 || nb.x2 < bb.x || nb.y > bb.y2 || nb.y2 < bb.y) continue;
      const segs = segsOf(n); if (!segs) continue;
      const res = boolOp(segsToRings(segs), brush, 'difference');
      const path = toPath(n);
      if (!res.length) { path.remove(); changed++; continue; }
      setSegsUser(path, ringsToSegs(res));
      path.setAttribute('fill-rule', 'evenodd');
      changed++;
    }
    if (changed) commit('Erase');
  },
  draw() {
    if (!this.cursorPt) return;
    const s = toScreen(this.cursorPt[0], this.cursorPt[1]);
    ov('circle', { cx: s[0], cy: s[1], r: this.width / 2 * (this.mode === 'cut' ? 1 : 1), fill: 'none', stroke: '#e05252', 'stroke-dasharray': '3 2' });
    const o = this.op;
    if (o && o.pts.length > 1) {
      const d = 'M' + o.pts.map(p => { const q = toScreen(p[0], p[1]); return `${round(q[0], 1)},${round(q[1], 1)}`; }).join('L');
      ov('path', { d, fill: 'none', stroke: '#e05252', 'stroke-opacity': .5, 'stroke-width': this.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    }
  },
  options() {
    return [
      { type: 'radio', value: this.mode, options: [['delete', 'trash', 'Delete objects'], ['cut', 'eraser', 'Cut out']], set: v => this.mode = v },
      { type: 'number', label: 'Width', value: this.width, min: 1, max: 200, step: 2, set: v => this.width = v }
    ];
  }
});

/* ══════════════════════════ SPRAY ════════════════════════════════════ */

registerTool({
  name: 'spray', title: 'Spray', key: 'a', icon: 'spray', cursor: 'crosshair',
  hint: 'Select an object first, then drag to spray copies of it. Tune amount, scatter, scale and rotation.',
  width: 60, amount: 8, scatter: .7, scaleVar: .3, rotVar: 30, op: null, alwaysDraw: true, cursorPt: null,

  down(p) {
    if (!App.sel.length) { bus.emit('toast', 'Select an object to spray first'); return; }
    this.op = { src: App.sel.slice(), made: [], last: 0 };
    this.move(p);
  },
  move(p) {
    this.cursorPt = [p.x, p.y];
    const o = this.op; if (!o) return;
    const now = performance.now();
    if (now - o.last < 45) return;
    o.last = now;
    const r = px2u(this.width) / 2;
    for (let i = 0; i < Math.max(1, Math.round(this.amount / 4)); i++) {
      const src = o.src[Math.floor(Math.random() * o.src.length)];
      const a = Math.random() * TAU, rad = Math.sqrt(Math.random()) * r * this.scatter;
      const c = src.cloneNode(true);
      c.setAttribute('id', uid('spray'));
      src.parentNode.appendChild(c);
      const b = bboxOf(src) || box(p.x, p.y, 1, 1);
      const sc = 1 + (Math.random() - .5) * 2 * this.scaleVar;
      const rot = (Math.random() - .5) * 2 * this.rotVar;
      const tx = p.x + Math.cos(a) * rad - b.cx, ty = p.y + Math.sin(a) * rad - b.cy;
      const M = mmul({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty },
        mmul({ a: 1, b: 0, c: 0, d: 1, e: b.cx, f: b.cy },
          mmul(rotM(rot), mmul({ a: sc, b: 0, c: 0, d: sc, e: 0, f: 0 }, { a: 1, b: 0, c: 0, d: 1, e: -b.cx, f: -b.cy }))));
      const cur = c.getAttribute('transform') || '';
      c.setAttribute('transform', `matrix(${[M.a, M.b, M.c, M.d, M.e, M.f].map(v => round(v, 5)).join(',')}) ${cur}`);
      o.made.push(c);
    }
    bus.emit('status', `${o.made.length} copies`);
  },
  up() { const o = this.op; this.op = null; if (o && o.made.length) commit('Spray'); },
  draw() {
    if (!this.cursorPt) return;
    const s = toScreen(this.cursorPt[0], this.cursorPt[1]);
    ov('circle', { cx: s[0], cy: s[1], r: this.width / 2, fill: 'none', stroke: '#5aab55', 'stroke-dasharray': '4 3' });
  },
  options() {
    return [
      { type: 'number', label: 'Width', value: this.width, min: 4, max: 400, step: 5, set: v => this.width = v },
      { type: 'number', label: 'Amount', value: this.amount, min: 1, max: 40, step: 1, set: v => this.amount = v },
      { type: 'number', label: 'Scatter', value: this.scatter, min: 0, max: 1, step: .05, set: v => this.scatter = v },
      { type: 'number', label: 'Scale ±', value: this.scaleVar, min: 0, max: 1, step: .05, set: v => this.scaleVar = v },
      { type: 'number', label: 'Rotate ±', value: this.rotVar, min: 0, max: 180, step: 5, set: v => this.rotVar = v }
    ];
  }
});
const rotM = deg => { const t = deg * D2R, s = Math.sin(t), c = Math.cos(t); return { a: c, b: s, c: -s, d: c, e: 0, f: 0 }; };

/* ══════════════════════════ TWEAK ════════════════════════════════════ */

registerTool({
  name: 'tweak', title: 'Tweak', key: 'w', icon: 'tweak', cursor: 'crosshair',
  hint: 'Push, jitter, grow, shrink, rotate or recolour objects under the brush.',
  width: 60, force: .4, mode: 'move', op: null, alwaysDraw: true, cursorPt: null,

  down(p) { this.op = { last: [p.x, p.y], touched: new Set(), t: 0 }; },
  move(p) {
    this.cursorPt = [p.x, p.y];
    const o = this.op; if (!o) return;
    const dx = p.x - o.last[0], dy = p.y - o.last[1];
    o.last = [p.x, p.y];
    const r = px2u(this.width) / 2;
    for (const n of allObjects(App.doc)) {
      if (isHidden(n) || isLocked(n)) continue;
      const b = bboxOf(n); if (!b) continue;
      const d = Math.hypot(b.cx - p.x, b.cy - p.y);
      if (d > r) continue;
      const f = this.force * (1 - d / r);
      o.touched.add(n);
      let M = null;
      if (this.mode === 'move') M = { a: 1, b: 0, c: 0, d: 1, e: dx * f * 2, f: dy * f * 2 };
      else if (this.mode === 'jitter') M = { a: 1, b: 0, c: 0, d: 1, e: (Math.random() - .5) * r * f * .3, f: (Math.random() - .5) * r * f * .3 };
      else if (this.mode === 'attract' || this.mode === 'repel') {
        const s = this.mode === 'attract' ? -1 : 1;
        const ux = (b.cx - p.x) / (d || 1), uy = (b.cy - p.y) / (d || 1);
        M = { a: 1, b: 0, c: 0, d: 1, e: ux * s * f * r * .08, f: uy * s * f * r * .08 };
      } else if (this.mode === 'grow' || this.mode === 'shrink') {
        const k = 1 + (this.mode === 'grow' ? 1 : -1) * f * .06;
        M = mmul({ a: 1, b: 0, c: 0, d: 1, e: b.cx, f: b.cy }, mmul({ a: k, b: 0, c: 0, d: k, e: 0, f: 0 }, { a: 1, b: 0, c: 0, d: 1, e: -b.cx, f: -b.cy }));
      } else if (this.mode === 'rotate') {
        M = mmul({ a: 1, b: 0, c: 0, d: 1, e: b.cx, f: b.cy }, mmul(rotM(f * 6), { a: 1, b: 0, c: 0, d: 1, e: -b.cx, f: -b.cy }));
      } else if (this.mode === 'color') {
        const cur = getStyle(n, 'fill', '#000');
        setStyle(n, { fill: mixColor(cur, App.style.fill, f * .25) });
      }
      if (M) {
        const cur = n.getAttribute('transform') || '';
        n.setAttribute('transform', `matrix(${[M.a, M.b, M.c, M.d, M.e, M.f].map(v => round(v, 5)).join(',')}) ${cur}`);
      }
    }
  },
  up() { const o = this.op; this.op = null; if (o && o.touched.size) commit('Tweak'); },
  draw() {
    if (!this.cursorPt) return;
    const s = toScreen(this.cursorPt[0], this.cursorPt[1]);
    ov('circle', { cx: s[0], cy: s[1], r: this.width / 2, fill: 'none', stroke: '#d8a34a', 'stroke-dasharray': '4 3' });
  },
  options() {
    return [
      {
        type: 'select', label: 'Mode', value: this.mode, set: v => this.mode = v,
        options: [['move', 'Move objects'], ['jitter', 'Jitter'], ['attract', 'Attract'], ['repel', 'Repel'],
                  ['grow', 'Grow'], ['shrink', 'Shrink'], ['rotate', 'Rotate'], ['color', 'Paint colour']]
      },
      { type: 'number', label: 'Width', value: this.width, min: 4, max: 400, step: 5, set: v => this.width = v },
      { type: 'number', label: 'Force', value: this.force, min: .02, max: 1, step: .02, set: v => this.force = v }
    ];
  }
});

function mixColor(a, b, t) {
  const pa = hex2rgb(a), pb = hex2rgb(b);
  if (!pa || !pb) return a;
  return rgb2hex(pa.map((v, i) => v + (pb[i] - v) * t));
}
export function hex2rgb(c) {
  if (!c) return null;
  c = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map(x => parseInt(x + x, 16));
  m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) { const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2]]; }
  return null;
}
export const rgb2hex = a => '#' + a.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/* ══════════════════════════ PAINT BUCKET ═════════════════════════════ */

registerTool({
  name: 'bucket', title: 'Paint bucket', key: 'u', icon: 'bucket', cursor: 'crosshair',
  hint: 'Click an enclosed area to fill it with a new object. Tolerance and grow are in the toolbar.',
  tolerance: 20, grow: 0,

  async down(p) {
    bus.emit('status', 'Tracing region…');
    const canvas = await renderScreenCanvas();
    if (!canvas) { bus.emit('toast', 'Could not rasterise the canvas'); return; }
    const path = traceFill(canvas, Math.round(p.sx), Math.round(p.sy), this.tolerance, this.grow);
    if (!path || path.length < 3) { bus.emit('toast', 'No enclosed region found here'); return; }
    const userPts = path.map(q => toUser(q[0], q[1]));
    const simplified = rdp(userPts, px2u(1.2));
    const segs = polyToCurves(simplified, true, px2u(1.6));
    const node = el('path', { id: uid('fill'), d: segsToD(localSegs(segs)) });
    applyCurrentStyle(node);
    setStyle(node, { stroke: 'none' });
    addObject(node); select([node]);
    commit('Paint bucket');
    bus.emit('status', 'Region filled');
  },
  options() {
    return [
      { type: 'number', label: 'Tolerance', value: this.tolerance, min: 0, max: 100, step: 5, set: v => this.tolerance = v },
      { type: 'number', label: 'Grow', value: this.grow, min: -10, max: 20, step: 1, set: v => this.grow = v }
    ];
  }
});

function localSegs(segs) {
  const inv = minv(ctmOf(App.context || currentLayer()));
  return transformSegs(segs, inv);
}

/** Flood fill on a rasterised snapshot, then trace the outer contour. */
function traceFill(canvas, x0, y0, tolPct, grow) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h).data;
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return null;
  const at = (x, y) => (y * w + x) * 4;
  const s = at(x0, y0);
  const ref = [img[s], img[s + 1], img[s + 2], img[s + 3]];
  const tol = (tolPct / 100) * 442;
  const match = i => {
    const d = Math.hypot(img[i] - ref[0], img[i + 1] - ref[1], img[i + 2] - ref[2], img[i + 3] - ref[3]);
    return d <= tol;
  };
  const mask = new Uint8Array(w * h);
  const stack = [[x0, y0]];
  mask[y0 * w + x0] = 1;
  let count = 0;
  while (stack.length) {
    const [x, y] = stack.pop();
    count++;
    if (count > w * h) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (mask[k]) continue;
      if (!match(at(nx, ny))) continue;
      mask[k] = 1; stack.push([nx, ny]);
    }
  }
  if (grow) dilate(mask, w, h, grow);
  return mooreTrace(mask, w, h);
}

function dilate(mask, w, h, n) {
  const erode = n < 0; n = Math.abs(n);
  for (let it = 0; it < n; it++) {
    const cp = mask.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const nb = cp[k - 1] + cp[k + 1] + cp[k - w] + cp[k + w];
      if (erode) { if (cp[k] && nb < 4) mask[k] = 0; }
      else if (!cp[k] && nb > 0) mask[k] = 1;
    }
  }
}

/** Moore-neighbour contour tracing with Jacob's stopping criterion. */
function mooreTrace(mask, w, h) {
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { sx = x; sy = y; break outer; }
  if (sx < 0) return null;
  const N = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x];
  const pts = [[sx, sy]];
  let cx = sx, cy = sy, dir = 6, guard = 0;
  do {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8;
      const nx = cx + N[d][0], ny = cy + N[d][1];
      if (at(nx, ny)) { cx = nx; cy = ny; dir = d; pts.push([cx, cy]); found = true; break; }
    }
    if (!found) break;
  } while ((cx !== sx || cy !== sy) && ++guard < w * h * 4);
  return pts.length > 8 ? pts : null;
}

/* ══════════════════════════ DROPPER ══════════════════════════════════ */

registerTool({
  name: 'dropper', title: 'Dropper', key: 'd', icon: 'dropper', cursor: 'crosshair',
  hint: 'Click to pick a colour into the fill. Shift+click sets the stroke.',
  async down(p) {
    let color = null, alpha = 1;
    const canvas = await renderScreenCanvas();
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const d = ctx.getImageData(clamp(Math.round(p.sx), 0, canvas.width - 1), clamp(Math.round(p.sy), 0, canvas.height - 1), 1, 1).data;
      color = rgb2hex([d[0], d[1], d[2]]); alpha = d[3] / 255;
    } else {
      const t = hitTest(p.e.clientX, p.e.clientY, true);
      if (t) color = getStyle(t, 'fill', '#000');
    }
    if (!color) return;
    const key = p.shift ? 'stroke' : 'fill';
    App.style[key] = color;
    App.style[key + '-opacity'] = round(alpha, 3);
    for (const n of App.sel) setStyle(n, { [key]: color, [key + '-opacity']: round(alpha, 3) });
    if (App.sel.length) commit('Pick colour');
    bus.emit('style'); bus.emit('status', `Picked ${color}`);
  },
  options() { return [{ type: 'label', text: 'Click picks fill · Shift+click picks stroke' }]; }
});

/* ══════════════════════════ ZOOM ═════════════════════════════════════ */

registerTool({
  name: 'zoom', title: 'Zoom', key: 'z', icon: 'zoom', cursor: 'zoom-in',
  hint: 'Click to zoom in, Shift+click to zoom out, drag a rectangle to zoom to it.',
  op: null,
  down(p) { this.op = { x0: p.x, y0: p.y, sx: p.sx, sy: p.sy }; },
  move(p) { const o = this.op; if (o) { o.x1 = p.x; o.y1 = p.y; } },
  up(p) {
    const o = this.op; this.op = null; if (!o) return;
    if (o.x1 !== undefined && Math.hypot(p.sx - o.sx, p.sy - o.sy) > 8) zoomToBox(boxFromPts([[o.x0, o.y0], [o.x1, o.y1]]), .02);
    else zoomBy(p.shift ? 1 / 1.5 : 1.5, p.sx, p.sy);
  },
  draw() {
    const o = this.op; if (!o || o.x1 === undefined) return;
    const a = toScreen(o.x0, o.y0), b = toScreen(o.x1, o.y1);
    ov('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), fill: 'none', stroke: '#4a90d9', 'stroke-dasharray': '4 3' });
  },
  options() {
    const z = v => ({ type: 'button', icon: v.icon, title: v.title, cmd: v.cmd });
    return [
      { type: 'number', label: 'Zoom %', value: round(View.zoom * 100, 1), min: 1, max: 25600, step: 10, set: v => setZoom(v / 100) },
      { type: 'sep' },
      z({ icon: 'zoom-page', title: 'Fit page (5)', cmd: 'view.zoomPage' }),
      z({ icon: 'zoom-draw', title: 'Fit drawing (4)', cmd: 'view.zoomDrawing' }),
      z({ icon: 'zoom-sel', title: 'Fit selection (3)', cmd: 'view.zoomSelection' }),
      z({ icon: 'zoom-1', title: 'Zoom 1:1 (1)', cmd: 'view.zoom1' })
    ];
  }
});

/* ══════════════════════════ MEASURE ══════════════════════════════════ */

registerTool({
  name: 'measure', title: 'Measure', key: 'm', icon: 'measure', cursor: 'crosshair',
  hint: 'Drag to measure length and angle. Ctrl constrains to 15° steps.',
  op: null, unitScale: 1,
  down(p) { buildSnap(); const s = snapPoint(p.x, p.y); this.op = { a: [s.x, s.y], b: [s.x, s.y] }; },
  move(p) {
    const o = this.op; if (!o) return;
    let x = p.x, y = p.y;
    if (p.ctrl) {
      const a = Math.round(Math.atan2(y - o.a[1], x - o.a[0]) / (Math.PI / 12)) * (Math.PI / 12);
      const r = Math.hypot(x - o.a[0], y - o.a[1]);
      x = o.a[0] + Math.cos(a) * r; y = o.a[1] + Math.sin(a) * r;
    }
    const s = snapPoint(x, y);
    o.b = [s.x, s.y];
  },
  up() { clearSnap(); },
  draw() {
    const o = this.op; if (!o) return;
    const A = toScreen(o.a[0], o.a[1]), B = toScreen(o.b[0], o.b[1]);
    ov('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: '#e05252', 'stroke-width': 1.4 });
    ov('circle', { cx: A[0], cy: A[1], r: 3, fill: '#e05252' });
    ov('circle', { cx: B[0], cy: B[1], r: 3, fill: '#e05252' });
    const len = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
    const ang = Math.atan2(-(o.b[1] - o.a[1]), o.b[0] - o.a[0]) * R2D;
    const unit = App.prefs.unit;
    const conv = len / ({ px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16 }[unit] || 1);
    const label = `${round(conv, 2)} ${unit}   ${round(ang, 1)}°`;
    const t = ov('text', { x: (A[0] + B[0]) / 2 + 8, y: (A[1] + B[1]) / 2 - 8, fill: '#fff', 'font-size': 12, 'font-family': 'system-ui', stroke: '#000', 'stroke-width': 3, 'paint-order': 'stroke' });
    t.textContent = label;
    bus.emit('status', label);
  },
  options() { return [{ type: 'label', text: 'Drag to measure · Ctrl snaps to 15°' }]; }
});

/* ══════════════════════════ CONNECTOR ════════════════════════════════ */

registerTool({
  name: 'connector', title: 'Connector', key: 'o', icon: 'connector', cursor: 'crosshair',
  hint: 'Click one object then another to link them. Connectors follow the objects when they move.',
  from: null, alwaysDraw: true, cursorPt: null, curvature: 0,

  down(p) {
    const t = hitTest(p.e.clientX, p.e.clientY);
    if (!t) { this.from = null; return; }
    if (!this.from) { this.from = t; bus.emit('status', 'Now click the target object'); return; }
    if (t === this.from) { this.from = null; return; }
    const c = el('path', {
      id: uid('conn'), 'inkscape:connector-type': 'polyline',
      'inkscape:connection-start': '#' + ensureId(this.from),
      'inkscape:connection-end': '#' + ensureId(t),
      'inkscape:connector-curvature': this.curvature,
      d: '', 'marker-end': arrowMarker()
    });
    setStyle(c, { fill: 'none', stroke: App.style.stroke !== 'none' ? App.style.stroke : '#000000', 'stroke-width': App.style['stroke-width'] || 1 });
    addObject(c);
    updateConnector(c);
    select([c]);
    this.from = null;
    commit('Draw connector');
  },
  move(p) { this.cursorPt = [p.x, p.y]; },
  draw() {
    if (!this.from || !this.cursorPt) return;
    const b = bboxOf(this.from); if (!b) return;
    const A = toScreen(b.cx, b.cy), B = toScreen(this.cursorPt[0], this.cursorPt[1]);
    ov('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: '#4a90d9', 'stroke-dasharray': '5 4' });
  },
  options() {
    return [
      { type: 'number', label: 'Curvature', value: this.curvature, min: 0, max: 100, step: 5, set: v => this.curvature = v },
      { type: 'label', text: 'Click object A, then object B' }
    ];
  }
});

function arrowMarker() {
  const id = 'InkWebArrow';
  let m = App.doc.querySelector('#' + id);
  if (!m) {
    const defs = App.doc.querySelector('defs') || el('defs', {}, App.doc);
    m = el('marker', { id, orient: 'auto', refX: 8, refY: 4, markerWidth: 9, markerHeight: 8, markerUnits: 'strokeWidth' }, defs);
    el('path', { d: 'M0,0 L9,4 L0,8 z', fill: 'context-stroke' }, m);
  }
  return `url(#${id})`;
}

export function updateConnector(c) {
  const q = a => App.doc.querySelector(`#${CSS.escape((c.getAttribute(a) || '').slice(1))}`);
  const A = q('inkscape:connection-start'), B = q('inkscape:connection-end');
  if (!A || !B) return;
  const ba = bboxOf(A), bb = bboxOf(B);
  if (!ba || !bb) return;
  const p1 = edgePoint(ba, bb.cx, bb.cy), p2 = edgePoint(bb, ba.cx, ba.cy);
  const inv = minv(ctmOf(c.parentNode));
  const a = mapply(inv, p1[0], p1[1]), b = mapply(inv, p2[0], p2[1]);
  const curv = num(c.getAttribute('inkscape:connector-curvature'), 0);
  if (curv > 0) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const L = Math.hypot(nx, ny) || 1;
    const k = curv / 100 * L * .5;
    c.setAttribute('d', `M ${round(a[0], 2)},${round(a[1], 2)} Q ${round(mx + nx / L * k, 2)},${round(my + ny / L * k, 2)} ${round(b[0], 2)},${round(b[1], 2)}`);
  } else {
    c.setAttribute('d', `M ${round(a[0], 2)},${round(a[1], 2)} L ${round(b[0], 2)},${round(b[1], 2)}`);
  }
}
function edgePoint(b, tx, ty) {
  const dx = tx - b.cx, dy = ty - b.cy;
  if (!dx && !dy) return [b.cx, b.cy];
  const sx = dx ? (b.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy ? (b.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [b.cx + dx * s, b.cy + dy * s];
}
export function refreshConnectors() {
  App.doc.querySelectorAll('[inkscape\\:connection-start]').forEach(updateConnector);
}
bus.on('changed', () => { try { refreshConnectors(); } catch { /* ignore */ } });

/* ══════════════════════════ MESH (informational) ═════════════════════ */

registerTool({
  name: 'mesh', title: 'Mesh gradient', key: 'g', icon: 'mesh', cursor: 'not-allowed',
  hint: 'SVG 2 mesh gradients are not rendered by any browser — use the gradient tool instead.',
  down() { bus.emit('toast', 'Mesh gradients are not supported by browsers. Use the gradient tool (G).'); setTool('gradient'); },
  options() { return [{ type: 'label', text: 'Browsers do not render SVG 2 mesh gradients; the gradient tool is used instead.' }]; }
});
