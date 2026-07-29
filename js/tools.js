/* ==========================================================================
   tools.js — tool framework, pointer plumbing, Selector + Node tools
   ========================================================================== */

import {
  App, bus, el, commit, select, clearSel, selBBox, bboxOf, allObjects, isLocked,
  isHidden, isLayer, ctmOf, parentCTM, applyMatrix, rebuildShape, toPath, shapeToD,
  segsOf, setSegsUser, duplicate, removeNodes, enterGroup, leaveGroup, uid, ensureId,
  getStyle, setStyle, currentLayer, docSize, cmpDoc
} from './doc.js';
import {
  View, toScreen, toUser, evtScreen, evtUser, update, setZoom, zoomBy, panBy, ov, ovg,
  clearOv, handle, hitTest, hitNear, pickInBox, snapPoint, snapBox, buildSnap, clearSnap,
  setPointer, guideAt, addGuide, saveGuides, drawGuides, els, px2u, zoomToBox
} from './view.js';
import {
  I, T, R, S, mmul, minv, mstr, mapply, parseTransform, num, round, clamp, dist,
  normalize, segsToD, box, boxFromPts, D2R, R2D, TAU, flatten, nearestOnPoly, cubicAt, cubicSplit
} from './geom.js';

/* ── registry ─────────────────────────────────────────────────────────── */

export const TOOLS = {};
export const registerTool = t => { TOOLS[t.name] = t; return t; };

export function setTool(name) {
  if (!TOOLS[name]) return;
  if (App.tool && App.tool.deactivate) try { App.tool.deactivate(); } catch (e) { console.error(e); }
  clearOv();
  App.tool = TOOLS[name]; App.toolName = name;
  els().wrap.style.cursor = App.tool.cursor || 'default';
  if (App.tool.activate) App.tool.activate();
  bus.emit('tool'); bus.emit('status', App.tool.hint || App.tool.title);
  redraw();
}

export function redraw() {
  hotspots.length = 0;
  clearOv('sel'); clearOv('tool');
  if (App.tool && App.tool.draw) App.tool.draw();
}

/* ── hotspots (screen-space interactive handles) ──────────────────────── */

export const hotspots = [];
export function hot(sx, sy, data, r = 9) { hotspots.push({ x: sx, y: sy, r, data }); return data; }
export function hitHot(sx, sy) {
  let best = null;
  for (const h of hotspots) {
    const d = Math.hypot(h.x - sx, h.y - sy);
    if (d <= h.r && (!best || d < best.d)) best = { d, h };
  }
  return best ? best.h.data : null;
}

/* ── pointer plumbing ─────────────────────────────────────────────────── */

const pointers = new Map();
let gesture = null, panning = null, spaceDown = false, activeOp = false;

export function initTools() {
  const { wrap } = els();

  wrap.addEventListener('pointerdown', onDown);
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerup', onUp);
  wrap.addEventListener('pointercancel', onUp);
  wrap.addEventListener('dblclick', e => {
    if (App.tool && App.tool.dbl) { App.tool.dbl(mk(e)); redraw(); }
  });
  wrap.addEventListener('wheel', onWheel, { passive: false });
  wrap.addEventListener('contextmenu', e => { e.preventDefault(); bus.emit('contextmenu', e); });

  // rulers → drag out guides
  for (const [rid, horiz] of [['ruler-h', true], ['ruler-v', false]]) {
    const r = document.getElementById(rid);
    r.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { r.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      const mv = ev => {
        const [ux, uy] = evtUser(ev);
        drawGuides();
        const p = toScreen(ux, uy);
        el('path', { d: horiz ? `M-10,${p[1]}H${View.w + 10}` : `M${p[0]},-10V${View.h + 10}`, stroke: '#2b7fd4', 'stroke-dasharray': '4 3', fill: 'none' }, ovg('guides'));
      };
      const up = ev => {
        r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', up);
        const [ux, uy] = evtUser(ev);
        if (horiz ? uy > -1e6 : ux > -1e6) { addGuide(ux, uy, horiz); commit('Create guide'); }
        drawGuides();
      };
      r.addEventListener('pointermove', mv); r.addEventListener('pointerup', up);
    });
  }
  document.getElementById('ruler-corner').addEventListener('click', () => {
    App.prefs.rulers = !App.prefs.rulers;
    document.documentElement.dataset.rulers = App.prefs.rulers ? 'on' : 'off';
    update();
  });

  addEventListener('keydown', e => {
    if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; els().wrap.style.cursor = 'grab'; }
  });
  addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceDown = false; els().wrap.style.cursor = App.tool?.cursor || 'default'; }
  });
}

export const isTyping = e => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

function mk(e) {
  const [sx, sy] = evtScreen(e);
  const [x, y] = toUser(sx, sy);
  return { e, sx, sy, x, y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, button: e.button, id: e.pointerId };
}

function onDown(e) {
  const { wrap } = els();
  if (e.pointerType === 'mouse' && e.button === 2) return;
  // capture is a nice-to-have; it legitimately fails for already-released or
  // synthesised pointers and must never abort the rest of the handler
  try { wrap.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  pointers.set(e.pointerId, mk(e));

  if (pointers.size === 2) { cancelOp(); startGesture(); return; }
  if (pointers.size > 2) return;

  const p = mk(e);
  if (e.button === 1 || spaceDown) { panning = { sx: p.sx, sy: p.sy, tx: View.tx, ty: View.ty }; wrap.style.cursor = 'grabbing'; return; }

  // guide dragging (selector-ish behaviour, any tool)
  const gi = guideAt(p.sx, p.sy, 6);
  if (gi >= 0 && !App.tool.ignoreGuides) { startGuideDrag(gi, p); return; }

  activeOp = true;
  clearSnap();
  if (App.tool.down) App.tool.down(p);
  redraw();
}

function onMove(e) {
  const p = mk(e);
  setPointer(p.sx, p.sy);
  bus.emit('coords', p);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

  if (gesture) { updateGesture(); return; }
  if (panning) {
    View.tx = panning.tx + (p.sx - panning.sx);
    View.ty = panning.ty + (p.sy - panning.sy);
    update(); return;
  }
  if (guideDrag) { moveGuide(p); return; }
  if (App.tool.move) App.tool.move(p, activeOp);
  if (activeOp || App.tool.alwaysDraw) redraw();
}

function onUp(e) {
  const p = mk(e);
  pointers.delete(e.pointerId);
  if (gesture) { if (pointers.size < 2) gesture = null; return; }
  if (panning) { panning = null; els().wrap.style.cursor = spaceDown ? 'grab' : (App.tool.cursor || 'default'); return; }
  if (guideDrag) { endGuide(p); return; }
  if (activeOp && App.tool.up) App.tool.up(p);
  activeOp = false;
  clearOv('snap');
  redraw();
}

export function cancelOp() {
  if (activeOp && App.tool.cancel) App.tool.cancel();
  activeOp = false;
  redraw();
}

/* multi-touch pinch / pan */
function startGesture() {
  const [a, b] = [...pointers.values()];
  gesture = {
    d0: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1,
    c0: [(a.sx + b.sx) / 2, (a.sy + b.sy) / 2],
    z0: View.zoom, tx: View.tx, ty: View.ty
  };
}
function updateGesture() {
  if (pointers.size < 2) return;
  const [a, b] = [...pointers.values()];
  const d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
  const c = [(a.sx + b.sx) / 2, (a.sy + b.sy) / 2];
  const z = clamp(gesture.z0 * (d / gesture.d0), .01, 256);
  const ux = (gesture.c0[0] - gesture.tx) / gesture.z0, uy = (gesture.c0[1] - gesture.ty) / gesture.z0;
  View.zoom = z;
  View.tx = c[0] - ux * z; View.ty = c[1] - uy * z;
  update();
}

function onWheel(e) {
  e.preventDefault();
  const [sx, sy] = evtScreen(e);
  if (e.ctrlKey || e.metaKey) { zoomBy(Math.exp(-e.deltaY * 0.0022), sx, sy); return; }
  const k = e.deltaMode === 1 ? 18 : 1;
  if (e.shiftKey) panBy(-e.deltaY * k - e.deltaX * k, 0);
  else panBy(-e.deltaX * k, -e.deltaY * k);
}

/* guide drag */
let guideDrag = null;
function startGuideDrag(i, p) { guideDrag = { i, p0: p, g: { ...App.guides[i] } }; }
function moveGuide(p) {
  const g = App.guides[guideDrag.i];
  const s = snapPoint(p.x, p.y);
  if (Math.abs(g.nx) < 1e-6) g.y = s.y; else if (Math.abs(g.ny) < 1e-6) g.x = s.x;
  else { g.x = s.x; g.y = s.y; }
  saveGuides(); drawGuides();
}
function endGuide(p) {
  const g = App.guides[guideDrag.i];
  const outside = p.sx < 0 || p.sy < 0 || p.sx > View.w || p.sy > View.h;
  if (outside) { App.guides.splice(guideDrag.i, 1); bus.emit('status', 'Guide deleted'); }
  guideDrag = null;
  saveGuides(); drawGuides(); commit('Move guide');
}

/* ── live transform helper ────────────────────────────────────────────── */

export function grabTransforms(nodes) {
  return nodes.map(n => {
    const P = parentCTM(n);
    return { n, P, Pi: minv(P), orig: parseTransform(n.getAttribute('transform')), origStr: n.getAttribute('transform') };
  });
}
export function liveTransform(items, M) {
  for (const it of items) {
    const local = mmul(it.Pi, mmul(M, it.P));
    const s = mstr(mmul(local, it.orig));
    if (s) it.n.setAttribute('transform', s); else it.n.removeAttribute('transform');
  }
}
export function finishTransform(items, M, label) {
  for (const it of items) {
    if (it.origStr) it.n.setAttribute('transform', it.origStr); else it.n.removeAttribute('transform');
    applyMatrix(it.n, M);
  }
  commit(label);
}

/* ══════════════════════════════════════════════════════════════════════
   SELECTOR
   ══════════════════════════════════════════════════════════════════════ */

const HKIND = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

registerTool({
  name: 'select', title: 'Selector', key: 's', icon: 'select', cursor: 'default',
  hint: 'Click to select. Drag to move. Click again for rotate handles. Shift = add, Alt = pick under.',
  mode: 'scale', rotCenter: null, op: null, alwaysDraw: false,

  activate() { this.op = null; },
  deactivate() { this.op = null; },

  down(p) {
    const hotd = hitHot(p.sx, p.sy);
    if (hotd && hotd.t === 'scale') return this.startScale(p, hotd);
    if (hotd && hotd.t === 'rot') return this.startRotate(p, hotd);
    if (hotd && hotd.t === 'skew') return this.startSkew(p, hotd);
    if (hotd && hotd.t === 'rotc') { this.op = { kind: 'rotc' }; return; }

    let target = hitTest(p.e.clientX, p.e.clientY, p.alt);
    if (!target) target = hitNear(p.x, p.y, p.e.pointerType === 'touch' ? 16 : 9);

    if (!target) {
      if (!p.shift) clearSel();
      this.op = { kind: 'rubber', x0: p.x, y0: p.y, add: p.shift };
      return;
    }
    if (p.shift) { select([target], 'toggle'); this.op = null; return; }
    if (!App.sel.includes(target)) { select([target]); this.mode = 'scale'; this.rotCenter = null; }
    else if (!this.moved) { /* second click toggles mode on pointerup */ }
    this.op = { kind: 'maybemove', x0: p.x, y0: p.y, sx0: p.sx, sy0: p.sy, target, moved: false };
  },

  move(p) {
    const o = this.op;
    if (!o) { this.hover(p); return; }
    if (o.kind === 'rubber') { o.x1 = p.x; o.y1 = p.y; return; }
    if (o.kind === 'maybemove') {
      if (Math.hypot(p.sx - o.sx0, p.sy - o.sy0) < 4) return;
      o.kind = 'move'; o.moved = true;
      o.items = grabTransforms(App.sel);
      o.bbox = selBBox();
      buildSnap(App.sel);
      bus.emit('status', 'Move — Ctrl constrains to axis');
    }
    if (o.kind === 'move') {
      let dx = p.x - o.x0, dy = p.y - o.y0;
      if (p.ctrl) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (o.bbox && !p.ctrl) {
        const moved = box(o.bbox.x + dx, o.bbox.y + dy, o.bbox.w, o.bbox.h);
        const s = snapBox(moved);
        dx += s.dx; dy += s.dy;
      }
      o.M = T(dx, dy);
      liveTransform(o.items, o.M);
      bus.emit('status', `Move ${round(dx, 2)}, ${round(dy, 2)}`);
      return;
    }
    if (o.kind === 'scale') return this.doScale(p);
    if (o.kind === 'rotate') return this.doRotate(p);
    if (o.kind === 'skew') return this.doSkew(p);
    if (o.kind === 'rotc') { this.rotCenter = [p.x, p.y]; return; }
  },

  up(p) {
    const o = this.op; this.op = null;
    if (!o) return;
    clearSnap();
    if (o.kind === 'rubber') {
      if (o.x1 === undefined) return;
      const b = boxFromPts([[o.x0, o.y0], [o.x1, o.y1]]);
      const found = pickInBox(b, p.alt);
      select(found, o.add ? 'add' : 'set');
      return;
    }
    if (o.kind === 'maybemove') {                        // plain click on a selected object
      if (App.sel.length && App.sel.includes(o.target)) this.mode = this.mode === 'scale' ? 'rotate' : 'scale';
      return;
    }
    if (o.kind === 'rotc') { commit('Move rotation centre'); return; }
    if (o.items && o.M) finishTransform(o.items, o.M, o.label || 'Transform');
  },

  cancel() {
    const o = this.op;
    if (o && o.items) o.items.forEach(it => { if (it.origStr) it.n.setAttribute('transform', it.origStr); else it.n.removeAttribute('transform'); });
    this.op = null;
  },

  hover(p) {
    const h = hitHot(p.sx, p.sy);
    const w = els().wrap;
    if (h && h.t === 'scale') w.style.cursor = CURSORS[h.k] || 'move';
    else if (h && h.t === 'rot') w.style.cursor = 'crosshair';
    else if (h && h.t === 'skew') w.style.cursor = h.k === 'n' || h.k === 's' ? 'ew-resize' : 'ns-resize';
    else w.style.cursor = 'default';
  },

  dbl(p) {
    const t = hitTest(p.e.clientX, p.e.clientY);
    if (!t) { if (leaveGroup()) bus.emit('status', 'Left group'); return; }
    if (t.tagName === 'g') { enterGroup(t); const inner = hitTest(p.e.clientX, p.e.clientY); select(inner ? [inner] : []); bus.emit('status', 'Entered group'); return; }
    if (t.tagName === 'text') { select([t]); setTool('text'); TOOLS.text.editNode(t, p); return; }
    select([t]); setTool('node');
  },

  /* — transform starts — */
  startScale(p, h) {
    const b = selBBox(); if (!b) return;
    this.op = {
      kind: 'scale', k: h.k, b, items: grabTransforms(App.sel), label: 'Scale',
      anchor: anchorFor(h.k, b), p0: [p.x, p.y]
    };
    buildSnap(App.sel);
  },
  doScale(p) {
    const o = this.op, b = o.b, k = o.k;
    let ax = o.anchor[0], ay = o.anchor[1];
    if (p.shift) { ax = b.cx; ay = b.cy; }
    let sx = 1, sy = 1;
    const denomX = (k.includes('w') ? b.x : b.x2) - ax;
    const denomY = (k.includes('n') ? b.y : b.y2) - ay;
    if (k.includes('e') || k.includes('w')) sx = denomX ? (p.x - ax) / denomX : 1;
    if (k.includes('n') || k.includes('s')) sy = denomY ? (p.y - ay) / denomY : 1;
    if (k.length === 1) { if (k === 'n' || k === 's') sx = 1; else sy = 1; }
    if (p.ctrl && k.length === 2) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
    if (!Number.isFinite(sx) || Math.abs(sx) < 1e-4) sx = Math.sign(sx) * 1e-4 || 1e-4;
    if (!Number.isFinite(sy) || Math.abs(sy) < 1e-4) sy = Math.sign(sy) * 1e-4 || 1e-4;
    o.M = mmul(T(ax, ay), mmul(S(sx, sy), T(-ax, -ay)));
    liveTransform(o.items, o.M);
    bus.emit('status', `Scale ${round(sx * 100, 1)}% × ${round(sy * 100, 1)}%   W ${round(b.w * Math.abs(sx), 2)}  H ${round(b.h * Math.abs(sy), 2)}`);
  },

  startRotate(p, h) {
    const b = selBBox(); if (!b) return;
    const c = this.rotCenter || [b.cx, b.cy];
    this.op = { kind: 'rotate', b, c, items: grabTransforms(App.sel), label: 'Rotate', a0: Math.atan2(p.y - c[1], p.x - c[0]) };
  },
  doRotate(p) {
    const o = this.op;
    let a = (Math.atan2(p.y - o.c[1], p.x - o.c[0]) - o.a0) * R2D;
    if (p.ctrl) a = Math.round(a / App.prefs.rotStep) * App.prefs.rotStep;
    o.M = R(a, o.c[0], o.c[1]);
    liveTransform(o.items, o.M);
    bus.emit('status', `Rotate ${round(a, 2)}°`);
  },

  startSkew(p, h) {
    const b = selBBox(); if (!b) return;
    const c = this.rotCenter || [b.cx, b.cy];
    this.op = { kind: 'skew', k: h.k, b, c, items: grabTransforms(App.sel), label: 'Skew', p0: [p.x, p.y] };
  },
  doSkew(p) {
    const o = this.op, b = o.b, c = o.c;
    let m;
    if (o.k === 'n' || o.k === 's') {
      let t = (p.x - o.p0[0]) / (b.h || 1) * (o.k === 'n' ? -1 : 1);
      if (p.ctrl) t = Math.tan(Math.round(Math.atan(t) * R2D / App.prefs.rotStep) * App.prefs.rotStep * D2R);
      m = { a: 1, b: 0, c: t, d: 1, e: 0, f: 0 };
    } else {
      let t = (p.y - o.p0[1]) / (b.w || 1) * (o.k === 'w' ? -1 : 1);
      if (p.ctrl) t = Math.tan(Math.round(Math.atan(t) * R2D / App.prefs.rotStep) * App.prefs.rotStep * D2R);
      m = { a: 1, b: t, c: 0, d: 1, e: 0, f: 0 };
    }
    o.M = mmul(T(c[0], c[1]), mmul(m, T(-c[0], -c[1])));
    liveTransform(o.items, o.M);
    bus.emit('status', 'Skew — Ctrl snaps angle');
  },

  draw() {
    const o = this.op;
    if (o && o.kind === 'rubber' && o.x1 !== undefined) {
      const a = toScreen(o.x0, o.y0), b = toScreen(o.x1, o.y1);
      ov('rect', {
        x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
        width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]),
        fill: 'rgba(74,144,217,.14)', stroke: '#4a90d9', 'stroke-dasharray': '4 3'
      });
    }
    if (!App.sel.length) return;
    // per-object dashed outlines
    for (const n of App.sel) {
      const b = bboxOf(n); if (!b) continue;
      const a = toScreen(b.x, b.y), c = toScreen(b.x2, b.y2);
      ov('rect', {
        x: round(a[0], 1), y: round(a[1], 1), width: round(c[0] - a[0], 1), height: round(c[1] - a[1], 1),
        fill: 'none', stroke: '#4a90d9', 'stroke-opacity': .55, 'stroke-dasharray': '3 3'
      }, 'sel');
    }
    const b = selBBox(); if (!b) return;
    const a = toScreen(b.x, b.y), c = toScreen(b.x2, b.y2);
    const x0 = a[0], y0 = a[1], x1 = c[0], y1 = c[1], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    ov('rect', { x: round(x0, 1), y: round(y0, 1), width: round(x1 - x0, 1), height: round(y1 - y0, 1), fill: 'none', stroke: '#1b1b1b', 'stroke-opacity': .6, 'stroke-dasharray': '5 4' }, 'sel');

    const pos = { nw: [x0, y0], n: [mx, y0], ne: [x1, y0], e: [x1, my], se: [x1, y1], s: [mx, y1], sw: [x0, y1], w: [x0, my] };
    if (this.mode === 'scale') {
      for (const k of HKIND) { handle(pos[k][0], pos[k][1], 'scale', 'sel'); hot(pos[k][0], pos[k][1], { t: 'scale', k }); }
    } else {
      for (const k of ['nw', 'ne', 'se', 'sw']) { handle(pos[k][0], pos[k][1], 'rot', 'sel'); hot(pos[k][0], pos[k][1], { t: 'rot', k }); }
      for (const k of ['n', 'e', 's', 'w']) { handle(pos[k][0], pos[k][1], 'warn', 'sel'); hot(pos[k][0], pos[k][1], { t: 'skew', k }); }
      const rc = this.rotCenter || [b.cx, b.cy];
      const s = toScreen(rc[0], rc[1]);
      ov('path', { d: `M${s[0] - 7},${s[1]}h14M${s[0]},${s[1] - 7}v14`, stroke: '#111', 'stroke-width': 1.4 }, 'sel');
      ov('circle', { cx: s[0], cy: s[1], r: 4.5, fill: 'none', stroke: '#111', 'stroke-width': 1.4 }, 'sel');
      hot(s[0], s[1], { t: 'rotc' });
    }
  },

  options() {
    return [
      { type: 'button', icon: 'select-all', title: 'Select all (Ctrl+A)', cmd: 'edit.selectAll' },
      { type: 'button', icon: 'deselect', title: 'Deselect (Esc)', cmd: 'edit.deselect' },
      { type: 'sep' },
      { type: 'button', icon: 'rot-ccw', title: 'Rotate 90° counter-clockwise', cmd: 'object.rot90ccw' },
      { type: 'button', icon: 'rot-cw', title: 'Rotate 90° clockwise', cmd: 'object.rot90cw' },
      { type: 'button', icon: 'flip-h', title: 'Flip horizontal (H)', cmd: 'object.flipH' },
      { type: 'button', icon: 'flip-v', title: 'Flip vertical (V)', cmd: 'object.flipV' },
      { type: 'sep' },
      { type: 'button', icon: 'top', title: 'Raise to top (Home)', cmd: 'object.raiseTop' },
      { type: 'button', icon: 'raise', title: 'Raise (Page Up)', cmd: 'object.raise' },
      { type: 'button', icon: 'lower', title: 'Lower (Page Down)', cmd: 'object.lower' },
      { type: 'button', icon: 'bottom', title: 'Lower to bottom (End)', cmd: 'object.lowerBottom' },
      { type: 'sep' },
      { type: 'xywh' },
      { type: 'sep' },
      { type: 'toggle', label: 'Scale stroke', get: () => App.prefs.scaleStroke, set: v => App.prefs.scaleStroke = v, icon: 'stroke-scale' }
    ];
  }
});

function anchorFor(k, b) {
  return [k.includes('w') ? b.x2 : k.includes('e') ? b.x : b.cx,
          k.includes('n') ? b.y2 : k.includes('s') ? b.y : b.cy];
}

/* ══════════════════════════════════════════════════════════════════════
   NODE EDITOR
   ══════════════════════════════════════════════════════════════════════ */

/** Convert normalised segments into an editable node model. */
export function segsToNodes(segs) {
  const subs = []; let cur = null, prev = null;
  for (const s of segs) {
    if (s.c === 'M') {
      cur = { closed: false, nodes: [{ p: [s.p[0], s.p[1]], in: null, out: null, type: 'c' }] };
      subs.push(cur); prev = cur.nodes[0];
    } else if (!cur) continue;
    else if (s.c === 'L') {
      const n = { p: [s.p[0], s.p[1]], in: null, out: null, type: 'c' };
      cur.nodes.push(n); prev = n;
    } else if (s.c === 'C') {
      prev.out = [s.p[0], s.p[1]];
      const n = { p: [s.p[4], s.p[5]], in: [s.p[2], s.p[3]], out: null, type: 'c' };
      cur.nodes.push(n); prev = n;
    } else if (s.c === 'Z') {
      cur.closed = true;
      const f = cur.nodes[0], l = cur.nodes[cur.nodes.length - 1];
      if (cur.nodes.length > 1 && Math.hypot(f.p[0] - l.p[0], f.p[1] - l.p[1]) < 1e-7) {
        f.in = l.in; cur.nodes.pop();
      }
      prev = null;
    }
  }
  for (const sp of subs) for (const n of sp.nodes) n.type = classify(n);
  return subs;
}
function classify(n) {
  if (!n.in || !n.out) return 'c';
  const a = [n.p[0] - n.in[0], n.p[1] - n.in[1]], b = [n.out[0] - n.p[0], n.out[1] - n.p[1]];
  const la = Math.hypot(...a), lb = Math.hypot(...b);
  if (la < 1e-9 || lb < 1e-9) return 'c';
  const cosang = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
  if (cosang < 0.999) return 'c';
  return Math.abs(la - lb) < 1e-6 ? 'y' : 's';
}

export function nodesToSegs(subs) {
  const segs = [];
  for (const sp of subs) {
    const N = sp.nodes; if (!N.length) continue;
    segs.push({ c: 'M', p: [N[0].p[0], N[0].p[1]] });
    const lim = sp.closed ? N.length : N.length - 1;
    for (let i = 0; i < lim; i++) {
      const a = N[i], b = N[(i + 1) % N.length];
      if (!a.out && !b.in) segs.push({ c: 'L', p: [b.p[0], b.p[1]] });
      else segs.push({ c: 'C', p: [...(a.out || a.p), ...(b.in || b.p), b.p[0], b.p[1]] });
    }
    if (sp.closed) segs.push({ c: 'Z' });
  }
  return segs;
}

registerTool({
  name: 'node', title: 'Node editor', key: 'n', icon: 'node', cursor: 'default',
  hint: 'Drag nodes and handles. Double-click a path to insert a node. Del removes, Ins adds.',
  paths: [], selNodes: new Set(), op: null, showHandles: true,

  activate() { this.rebuild(); this._sel = bus.on('selection', () => { this.rebuild(); redraw(); }); },
  deactivate() { bus.off('selection', this._sel); this.paths = []; this.selNodes.clear(); },

  rebuild() {
    this.paths = [];
    for (const n of App.sel) {
      const t = n.getAttribute('sodipodi:type');
      if (t) { this.paths.push({ el: n, shape: t }); continue; }
      if (n.tagName === 'rect' || n.tagName === 'ellipse' || n.tagName === 'circle') { this.paths.push({ el: n, shape: n.tagName }); continue; }
      const d = shapeToD(n);
      if (!d) continue;
      this.paths.push({ el: n, subs: segsToNodes(normalize(d)), ctm: ctmOf(n) });
    }
    this.selNodes = new Set([...this.selNodes].filter(k => this.nodeByKey(k)));
  },
  nodeByKey(k) {
    const [pi, si, ni] = k.split(':').map(Number);
    return this.paths[pi] && this.paths[pi].subs && this.paths[pi].subs[si] && this.paths[pi].subs[si].nodes[ni] || null;
  },
  eachNode(fn) {
    this.paths.forEach((P, pi) => (P.subs || []).forEach((sp, si) => sp.nodes.forEach((n, ni) => fn(n, `${pi}:${si}:${ni}`, P, sp, ni))));
  },
  writeBack(P) {
    if (!P.subs) return;
    P.el.setAttribute('d', segsToD(nodesToSegs(P.subs)));
    P.el.removeAttribute('sodipodi:type');
  },

  down(p) {
    const h = hitHot(p.sx, p.sy);
    if (h && h.t === 'shape') { this.op = { kind: 'shape', h, p0: p, P: h.P, snap: shapeSnapshot(h.P.el) }; return; }
    if (h && h.t === 'node') {
      if (p.shift) { this.selNodes.has(h.key) ? this.selNodes.delete(h.key) : this.selNodes.add(h.key); this.op = null; return; }
      if (!this.selNodes.has(h.key)) this.selNodes = new Set([h.key]);
      this.op = { kind: 'movenode', p0: [p.x, p.y], keys: [...this.selNodes], orig: this.snapshotNodes() };
      buildSnap(App.sel);
      return;
    }
    if (h && h.t === 'handle') {
      this.op = { kind: 'movehandle', h, p0: [p.x, p.y], orig: this.snapshotNodes() };
      return;
    }
    // click on a path → select it, else rubber-band nodes
    const t = hitTest(p.e.clientX, p.e.clientY) || hitNear(p.x, p.y, 12);
    if (t && !App.sel.includes(t)) { select([t]); this.selNodes.clear(); this.rebuild(); return; }
    this.op = { kind: 'rubber', x0: p.x, y0: p.y, add: p.shift };
    if (!p.shift) this.selNodes.clear();
  },

  snapshotNodes() {
    const m = new Map();
    this.eachNode((n, k) => m.set(k, { p: [...n.p], in: n.in ? [...n.in] : null, out: n.out ? [...n.out] : null }));
    return m;
  },

  move(p) {
    const o = this.op; if (!o) return;
    if (o.kind === 'rubber') { o.x1 = p.x; o.y1 = p.y; return; }
    if (o.kind === 'shape') return this.dragShape(p);
    if (o.kind === 'movenode') {
      let dx = p.x - o.p0[0], dy = p.y - o.p0[1];
      if (p.ctrl) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (o.keys.length === 1) {
        const key = o.keys[0], P = this.paths[Number(key.split(':')[0])];
        const src = o.orig.get(key);
        const u = mapply(P.ctm, src.p[0] + dx, src.p[1] + dy);
        const s = snapPoint(u[0], u[1]);
        const back = mapply(minv(P.ctm), s.x, s.y);
        dx = back[0] - src.p[0]; dy = back[1] - src.p[1];
      }
      for (const key of o.keys) {
        const n = this.nodeByKey(key), src = o.orig.get(key);
        if (!n || !src) continue;
        n.p = [src.p[0] + dx, src.p[1] + dy];
        if (src.in) n.in = [src.in[0] + dx, src.in[1] + dy];
        if (src.out) n.out = [src.out[0] + dx, src.out[1] + dy];
      }
      this.paths.forEach(P => this.writeBack(P));
      bus.emit('status', `Move nodes ${round(dx, 2)}, ${round(dy, 2)}`);
      return;
    }
    if (o.kind === 'movehandle') {
      const { key, side } = o.h;
      const n = this.nodeByKey(key), src = o.orig.get(key);
      if (!n) return;
      const P = this.paths[Number(key.split(':')[0])];
      const loc = mapply(minv(P.ctm), ...toUserArr(p));
      n[side] = [loc[0], loc[1]];
      const other = side === 'in' ? 'out' : 'in';
      if (n.type !== 'c' && n[other]) {
        const vx = n.p[0] - n[side][0], vy = n.p[1] - n[side][1];
        const L = Math.hypot(vx, vy) || 1;
        const oL = n.type === 'y' ? L : Math.hypot(n[other][0] - n.p[0], n[other][1] - n.p[1]);
        n[other] = [n.p[0] + vx / L * oL, n.p[1] + vy / L * oL];
      }
      this.writeBack(P);
      const ang = Math.atan2(n[side][1] - n.p[1], n[side][0] - n.p[0]) * R2D;
      bus.emit('status', `Handle ${round(Math.hypot(n[side][0] - n.p[0], n[side][1] - n.p[1]), 2)} @ ${round(ang, 1)}°`);
      return;
    }
  },

  up(p) {
    const o = this.op; this.op = null;
    if (!o) return;
    clearSnap();
    if (o.kind === 'rubber') {
      if (o.x1 === undefined) { if (!o.add) this.selNodes.clear(); return; }
      const b = boxFromPts([[o.x0, o.y0], [o.x1, o.y1]]);
      this.eachNode((n, k, P) => {
        const u = mapply(P.ctm, n.p[0], n.p[1]);
        if (u[0] >= b.x && u[0] <= b.x2 && u[1] >= b.y && u[1] <= b.y2) this.selNodes.add(k);
      });
      bus.emit('status', `${this.selNodes.size} of ${this.countNodes()} nodes selected`);
      return;
    }
    if (o.kind === 'shape') { commit('Edit shape'); return; }
    if (o.kind === 'movenode' || o.kind === 'movehandle') { this.rebuild(); commit('Edit path'); }
  },

  countNodes() { let c = 0; this.eachNode(() => c++); return c; },

  dbl(p) {
    // insert a node where the path was double-clicked
    for (let pi = 0; pi < this.paths.length; pi++) {
      const P = this.paths[pi]; if (!P.subs) continue;
      const loc = mapply(minv(P.ctm), p.x, p.y);
      const hit = this.locateSegment(P, loc[0], loc[1], px2u(10));
      if (hit) { this.insertAt(P, hit); this.rebuild(); commit('Insert node'); return; }
    }
    const t = hitTest(p.e.clientX, p.e.clientY);
    if (t) { select([t]); this.rebuild(); }
  },

  locateSegment(P, x, y, tol) {
    let best = null;
    P.subs.forEach((sp, si) => {
      const lim = sp.closed ? sp.nodes.length : sp.nodes.length - 1;
      for (let i = 0; i < lim; i++) {
        const a = sp.nodes[i], b = sp.nodes[(i + 1) % sp.nodes.length];
        const cp = [a.p[0], a.p[1], ...(a.out || a.p), ...(b.in || b.p), b.p[0], b.p[1]];
        for (let s = 0; s <= 24; s++) {
          const t = s / 24, q = cubicAt(cp, t);
          const d = Math.hypot(q[0] - x, q[1] - y);
          if (d < tol && (!best || d < best.d)) best = { d, si, i, t, cp };
        }
      }
    });
    return best;
  },

  insertAt(P, hit) {
    const sp = P.subs[hit.si];
    const a = sp.nodes[hit.i], b = sp.nodes[(hit.i + 1) % sp.nodes.length];
    if (!a.out && !b.in) {                       // straight segment stays straight
      const t = hit.t;
      sp.nodes.splice(hit.i + 1, 0, {
        p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t],
        in: null, out: null, type: 'c'
      });
    } else {
      const [c1, c2] = cubicSplit(hit.cp, hit.t);
      a.out = [c1[2], c1[3]];
      sp.nodes.splice(hit.i + 1, 0, { p: [c1[6], c1[7]], in: [c1[4], c1[5]], out: [c2[2], c2[3]], type: 's' });
      b.in = [c2[4], c2[5]];
    }
    this.writeBack(P);
  },

  /* — node commands — */
  cmd(what) {
    const keys = [...this.selNodes];
    const touched = new Set();
    const get = k => ({ n: this.nodeByKey(k), P: this.paths[Number(k.split(':')[0])], si: Number(k.split(':')[1]), ni: Number(k.split(':')[2]) });
    if (what === 'insert') {
      for (const P of this.paths) {
        if (!P.subs) continue;
        const adds = [];
        P.subs.forEach((sp, si) => {
          const lim = sp.closed ? sp.nodes.length : sp.nodes.length - 1;
          for (let i = 0; i < lim; i++) {
            const k1 = `${this.paths.indexOf(P)}:${si}:${i}`, k2 = `${this.paths.indexOf(P)}:${si}:${(i + 1) % sp.nodes.length}`;
            if (this.selNodes.has(k1) && this.selNodes.has(k2)) adds.push({ si, i });
          }
        });
        adds.reverse().forEach(a => {
          const sp = P.subs[a.si], n1 = sp.nodes[a.i], n2 = sp.nodes[(a.i + 1) % sp.nodes.length];
          const cp = [n1.p[0], n1.p[1], ...(n1.out || n1.p), ...(n2.in || n2.p), n2.p[0], n2.p[1]];
          this.insertAt(P, { si: a.si, i: a.i, t: .5, cp });
        });
        touched.add(P);
      }
    } else if (what === 'delete') {
      const byPath = new Map();
      for (const k of keys) { const { P, si, ni } = get(k); if (!P.subs) continue; if (!byPath.has(P)) byPath.set(P, []); byPath.get(P).push([si, ni]); }
      for (const [P, list] of byPath) {
        list.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        for (const [si, ni] of list) P.subs[si].nodes.splice(ni, 1);
        P.subs = P.subs.filter(sp => sp.nodes.length > 1);
        touched.add(P);
      }
      this.selNodes.clear();
    } else if (['c', 's', 'y', 'a'].includes(what)) {
      for (const k of keys) {
        const { n, P, si, ni } = get(k); if (!n || !P.subs) continue;
        if (what === 'c') n.type = 'c';
        else {
          const sp = P.subs[si], N = sp.nodes, len = N.length;
          const prev = sp.closed || ni > 0 ? N[(ni - 1 + len) % len] : null;
          const next = sp.closed || ni < len - 1 ? N[(ni + 1) % len] : null;
          // tangent runs between the neighbours; handle length is 1/3 of each span
          let vx = (next ? next.p[0] : n.p[0]) - (prev ? prev.p[0] : n.p[0]);
          let vy = (next ? next.p[1] : n.p[1]) - (prev ? prev.p[1] : n.p[1]);
          if (Math.hypot(vx, vy) < 1e-9) { vx = n.out ? n.out[0] - n.p[0] : 1; vy = n.out ? n.out[1] - n.p[1] : 0; }
          const L = Math.hypot(vx, vy) || 1;
          const li = n.in ? Math.hypot(n.in[0] - n.p[0], n.in[1] - n.p[1])
            : prev ? Math.hypot(prev.p[0] - n.p[0], prev.p[1] - n.p[1]) / 3 : L / 3;
          const lo = n.out ? Math.hypot(n.out[0] - n.p[0], n.out[1] - n.p[1])
            : next ? Math.hypot(next.p[0] - n.p[0], next.p[1] - n.p[1]) / 3 : L / 3;
          n.type = what === 'a' ? 's' : what;
          const both = n.type === 'y' ? (li + lo) / 2 : null;
          if (prev || sp.closed) n.in = [n.p[0] - vx / L * (both ?? li), n.p[1] - vy / L * (both ?? li)];
          if (next || sp.closed) n.out = [n.p[0] + vx / L * (both ?? lo), n.p[1] + vy / L * (both ?? lo)];
        }
        touched.add(P);
      }
    } else if (what === 'line' || what === 'curve') {
      for (const k of keys) {
        const { n, P, si, ni } = get(k); if (!n || !P.subs) continue;
        const sp = P.subs[si], nx = sp.nodes[(ni + 1) % sp.nodes.length];
        if (!nx || (!sp.closed && ni === sp.nodes.length - 1)) continue;
        if (!this.selNodes.has(`${this.paths.indexOf(P)}:${si}:${(ni + 1) % sp.nodes.length}`)) continue;
        if (what === 'line') { n.out = null; nx.in = null; }
        else {
          n.out = [n.p[0] + (nx.p[0] - n.p[0]) / 3, n.p[1] + (nx.p[1] - n.p[1]) / 3];
          nx.in = [n.p[0] + (nx.p[0] - n.p[0]) * 2 / 3, n.p[1] + (nx.p[1] - n.p[1]) * 2 / 3];
        }
        touched.add(P);
      }
    } else if (what === 'break') {
      for (const k of keys) {
        const { P, si, ni } = get(k); if (!P.subs) continue;
        const sp = P.subs[si];
        if (sp.closed) { sp.closed = false; sp.nodes = sp.nodes.slice(ni).concat(sp.nodes.slice(0, ni + 1).map(n => ({ ...n }))); }
        else if (ni > 0 && ni < sp.nodes.length - 1) {
          const tail = sp.nodes.slice(ni).map(n => ({ ...n }));
          sp.nodes = sp.nodes.slice(0, ni + 1);
          P.subs.splice(si + 1, 0, { closed: false, nodes: tail });
        }
        touched.add(P);
      }
      this.selNodes.clear();
    } else if (what === 'join') {
      if (keys.length === 2) {
        const A = get(keys[0]), B = get(keys[1]);
        if (A.P === B.P && A.P.subs) {
          const P = A.P;
          if (A.si === B.si) { P.subs[A.si].closed = true; }
          else {
            const sa = P.subs[A.si], sb = P.subs[B.si];
            if (A.ni === 0) sa.nodes.reverse();
            if (B.ni !== 0) sb.nodes.reverse();
            const mid = [(sa.nodes[sa.nodes.length - 1].p[0] + sb.nodes[0].p[0]) / 2,
                         (sa.nodes[sa.nodes.length - 1].p[1] + sb.nodes[0].p[1]) / 2];
            sa.nodes[sa.nodes.length - 1].p = mid; sb.nodes.shift();
            sa.nodes.push(...sb.nodes);
            P.subs.splice(P.subs.indexOf(sb), 1);
          }
          touched.add(P);
        }
      }
      this.selNodes.clear();
    } else if (what === 'selectAll') {
      this.selNodes.clear(); this.eachNode((n, k) => this.selNodes.add(k)); redraw(); return;
    }
    for (const P of touched) this.writeBack(P);
    if (touched.size) { this.rebuild(); commit('Edit nodes'); }
    redraw();
  },

  keydown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') { this.cmd('delete'); return true; }
    if (e.key === 'Insert') { this.cmd('insert'); return true; }
    if (e.key === 'a' && !e.ctrlKey && !e.metaKey) { this.cmd('selectAll'); return true; }
    if (e.shiftKey) {
      const m = { C: 'c', S: 's', Y: 'y', A: 'a', L: 'line', U: 'curve', B: 'break', J: 'join' }[e.key.toUpperCase()];
      if (m && 'CSYALUBJ'.includes(e.key.toUpperCase())) { this.cmd(m); return true; }
    }
    const step = e.shiftKey ? App.prefs.moveStep * 10 : App.prefs.moveStep;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && this.selNodes.size) {
      for (const k of this.selNodes) {
        const n = this.nodeByKey(k); if (!n) continue;
        n.p = [n.p[0] + d[0], n.p[1] + d[1]];
        if (n.in) n.in = [n.in[0] + d[0], n.in[1] + d[1]];
        if (n.out) n.out = [n.out[0] + d[0], n.out[1] + d[1]];
      }
      this.paths.forEach(P => this.writeBack(P));
      commit('Move nodes'); redraw(); return true;
    }
    return false;
  },

  draw() {
    const o = this.op;
    if (o && o.kind === 'rubber' && o.x1 !== undefined) {
      const a = toScreen(o.x0, o.y0), b = toScreen(o.x1, o.y1);
      ov('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), fill: 'rgba(74,144,217,.14)', stroke: '#4a90d9', 'stroke-dasharray': '4 3' });
    }
    for (const P of this.paths) {
      if (P.shape) { drawShapeHandles(P); continue; }
      // path outline
      const d = P.el.getAttribute('d');
      if (d) {
        const m = ctmOf(P.el);
        const sm = mmul({ a: View.zoom, b: 0, c: 0, d: View.zoom, e: View.tx, f: View.ty }, m);
        ov('path', { d, transform: mstr(sm) || undefined, fill: 'none', stroke: '#4a90d9', 'stroke-opacity': .8, 'stroke-width': 1 });
      }
      P.subs.forEach((sp, si) => sp.nodes.forEach((n, ni) => {
        const key = `${this.paths.indexOf(P)}:${si}:${ni}`;
        const sel = this.selNodes.has(key);
        const s = toScreen(...mapply(P.ctm, n.p[0], n.p[1]));
        if (this.showHandles && (sel || this.selNodes.size === 0)) {
          for (const side of ['in', 'out']) {
            if (!n[side]) continue;
            const h = toScreen(...mapply(P.ctm, n[side][0], n[side][1]));
            ov('line', { x1: s[0], y1: s[1], x2: h[0], y2: h[1], stroke: '#4a90d9', 'stroke-opacity': .8 });
            handle(h[0], h[1], 'ctrl');
            hot(h[0], h[1], { t: 'handle', key, side }, 8);
          }
        }
        const kind = n.type === 'c' ? (sel ? 'nodeSel' : 'node') : (sel ? 'nodeSel' : 'node');
        const el2 = handle(s[0], s[1], kind);
        if (n.type !== 'c') el2.setAttribute('rx', App.prefs.handleSize / 2);
        hot(s[0], s[1], { t: 'node', key }, 9);
      }));
    }
  },

  options() {
    const c = w => ({ type: 'button', icon: w.icon, title: w.title, fn: () => this.cmd(w.k) });
    return [
      c({ k: 'insert', icon: 'node-add', title: 'Insert node (Ins)' }),
      c({ k: 'delete', icon: 'node-del', title: 'Delete node (Del)' }),
      { type: 'sep' },
      c({ k: 'break', icon: 'node-break', title: 'Break path at node (Shift+B)' }),
      c({ k: 'join', icon: 'node-join', title: 'Join two nodes (Shift+J)' }),
      { type: 'sep' },
      c({ k: 'c', icon: 'node-corner', title: 'Make corner (Shift+C)' }),
      c({ k: 's', icon: 'node-smooth', title: 'Make smooth (Shift+S)' }),
      c({ k: 'y', icon: 'node-sym', title: 'Make symmetric (Shift+Y)' }),
      { type: 'sep' },
      c({ k: 'line', icon: 'seg-line', title: 'Make segment a line (Shift+L)' }),
      c({ k: 'curve', icon: 'seg-curve', title: 'Make segment a curve (Shift+U)' }),
      { type: 'sep' },
      { type: 'button', icon: 'to-path', title: 'Object to path (Shift+Ctrl+C)', cmd: 'path.objectToPath' },
      { type: 'toggle', label: 'Handles', icon: 'handles', get: () => this.showHandles, set: v => { this.showHandles = v; redraw(); } }
    ];
  }
});

const toUserArr = p => [p.x, p.y];

/* — live-shape handles shown by the node tool — */
function shapeSnapshot(e) {
  const o = {};
  for (const a of e.attributes) o[a.name] = a.value;
  return o;
}

function drawShapeHandles(P) {
  const e = P.el, m = ctmOf(e), S2 = (x, y) => toScreen(...mapply(m, x, y));
  const g = n => num(e.getAttribute(n));
  const add = (x, y, data, kind = 'warn') => { const s = S2(x, y); handle(s[0], s[1], kind); hot(s[0], s[1], { t: 'shape', P, ...data }); };
  if (P.shape === 'rect') {
    const x = g('x'), y = g('y'), w = g('width'), h = g('height');
    const rx = e.hasAttribute('rx') ? g('rx') : g('ry'), ry = e.hasAttribute('ry') ? g('ry') : rx;
    add(x + w - clamp(rx, 0, w / 2), y, { k: 'rx' });
    add(x + w, y + clamp(ry, 0, h / 2), { k: 'ry' });
  } else if (P.shape === 'ellipse' || P.shape === 'circle' || P.shape === 'arc') {
    const cx = g(P.shape === 'arc' ? 'sodipodi:cx' : 'cx'), cy = g(P.shape === 'arc' ? 'sodipodi:cy' : 'cy');
    const rx = P.shape === 'arc' ? g('sodipodi:rx') : (e.hasAttribute('rx') ? g('rx') : g('r'));
    const ry = P.shape === 'arc' ? g('sodipodi:ry') : (e.hasAttribute('ry') ? g('ry') : g('r'));
    add(cx + rx, cy, { k: 'rx' }); add(cx, cy + ry, { k: 'ry' });
    if (P.shape === 'arc') {
      const s = g('sodipodi:start'), en = g('sodipodi:end');
      add(cx + Math.cos(s) * rx, cy + Math.sin(s) * ry, { k: 'start' }, 'ctrl');
      add(cx + Math.cos(en) * rx, cy + Math.sin(en) * ry, { k: 'end' }, 'ctrl');
    }
  } else if (P.shape === 'star') {
    const cx = g('sodipodi:cx'), cy = g('sodipodi:cy');
    const r1 = g('sodipodi:r1'), r2 = g('sodipodi:r2');
    const a1 = num(e.getAttribute('sodipodi:arg1'), 0), a2 = num(e.getAttribute('sodipodi:arg2'), 0);
    add(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, { k: 'r1' });
    if (e.getAttribute('inkscape:flatsided') !== 'true') add(cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2, { k: 'r2' }, 'ctrl');
  } else if (P.shape === 'spiral') {
    const cx = g('sodipodi:cx'), cy = g('sodipodi:cy'), r = g('sodipodi:radius');
    const arg = num(e.getAttribute('sodipodi:argument'), 0), rev = num(e.getAttribute('sodipodi:revolution'), 3);
    const a = arg + TAU * rev;
    add(cx + Math.cos(a) * r, cy + Math.sin(a) * r, { k: 'outer' });
    add(cx, cy, { k: 'inner' }, 'ctrl');
  }
}

TOOLS.node.dragShape = function (p) {
  const o = this.op, e = o.P.el, m = minv(ctmOf(e));
  const loc = mapply(m, p.x, p.y);
  const g = n => num(e.getAttribute(n));
  const set = (n, v) => e.setAttribute(n, round(v, 4));
  switch (o.h.k) {
    case 'rx':
      if (e.tagName === 'rect') set('rx', clamp(g('x') + g('width') - loc[0], 0, g('width') / 2));
      else if (e.getAttribute('sodipodi:type') === 'arc') set('sodipodi:rx', Math.abs(loc[0] - g('sodipodi:cx')));
      else { set('rx', Math.abs(loc[0] - g('cx'))); if (e.tagName === 'circle') set('r', Math.abs(loc[0] - g('cx'))); }
      break;
    case 'ry':
      if (e.tagName === 'rect') set('ry', clamp(loc[1] - g('y'), 0, g('height') / 2));
      else if (e.getAttribute('sodipodi:type') === 'arc') set('sodipodi:ry', Math.abs(loc[1] - g('sodipodi:cy')));
      else { set('ry', Math.abs(loc[1] - g('cy'))); if (e.tagName === 'circle') set('r', Math.abs(loc[1] - g('cy'))); }
      break;
    case 'start': case 'end': {
      const a = Math.atan2(loc[1] - g('sodipodi:cy'), loc[0] - g('sodipodi:cx'));
      set('sodipodi:' + o.h.k, p.ctrl ? Math.round(a / (Math.PI / 12)) * (Math.PI / 12) : a);
      break;
    }
    case 'r1': case 'r2': {
      const dx = loc[0] - g('sodipodi:cx'), dy = loc[1] - g('sodipodi:cy');
      set('sodipodi:' + o.h.k, Math.hypot(dx, dy));
      let a = Math.atan2(dy, dx);
      if (p.ctrl) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      set('sodipodi:' + (o.h.k === 'r1' ? 'arg1' : 'arg2'), a);
      if (o.h.k === 'r1' && !p.shift) {
        const sides = num(e.getAttribute('sodipodi:sides'), 5);
        set('sodipodi:arg2', a + Math.PI / sides);
      }
      break;
    }
    case 'outer': {
      const dx = loc[0] - g('sodipodi:cx'), dy = loc[1] - g('sodipodi:cy');
      set('sodipodi:radius', Math.hypot(dx, dy));
      break;
    }
    case 'inner': {
      const dx = loc[0] - g('sodipodi:cx'), dy = loc[1] - g('sodipodi:cy');
      const r = g('sodipodi:radius') || 1;
      set('sodipodi:t0', clamp(Math.hypot(dx, dy) / r, 0, .95));
      break;
    }
  }
  rebuildShape(e);
  bus.emit('objects');
};
