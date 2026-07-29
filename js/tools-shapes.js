/* ==========================================================================
   tools-shapes.js — Rectangle, Ellipse/Arc, Star, Spiral, 3D Box
   ========================================================================== */

import {
  App, bus, el, commit, select, addObject, uid, applyCurrentStyle, setStyle,
  rebuildShape, buildStar, buildSpiral, buildArc, currentLayer, ctmOf, parentCTM
} from './doc.js';
import { toScreen, snapPoint, buildSnap, clearSnap, ov } from './view.js';
import { registerTool, redraw, TOOLS } from './tools.js';
import { minv, mapply, round, clamp, num, TAU, D2R, R2D } from './geom.js';

/** Convert a document-space point into the coordinates of the target parent. */
function local(p) {
  const parent = (App.context || currentLayer());
  const inv = minv(ctmOf(parent));
  return mapply(inv, p[0], p[1]);
}

function beginShape(tool, p, make) {
  buildSnap();
  const s = snapPoint(p.x, p.y);
  const a = local([s.x, s.y]);
  const node = make(a);
  applyCurrentStyle(node);
  addObject(node);
  tool.op = { node, a, start: [s.x, s.y] };
  select([node]);
  return tool.op;
}

/* ══════════════════════════ RECTANGLE ═════════════════════════════════ */

registerTool({
  name: 'rect', title: 'Rectangle', key: 'r', icon: 'rect', cursor: 'crosshair',
  hint: 'Drag to draw a rectangle. Ctrl = square / integer ratio, Shift = draw from centre.',
  rx: 0, ry: 0, op: null,

  down(p) { beginShape(this, p, () => el('rect', { id: uid('rect'), x: 0, y: 0, width: 1, height: 1 })); },
  move(p) {
    const o = this.op; if (!o) return;
    const s = snapPoint(p.x, p.y);
    let b = local([s.x, s.y]);
    let x0 = o.a[0], y0 = o.a[1], x1 = b[0], y1 = b[1];
    let w = x1 - x0, h = y1 - y0;
    if (p.ctrl) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
    if (p.shift) { x0 = o.a[0] - w; y0 = o.a[1] - h; w *= 2; h *= 2; }
    const n = o.node;
    n.setAttribute('x', round(Math.min(x0, x0 + w), 4));
    n.setAttribute('y', round(Math.min(y0, y0 + h), 4));
    n.setAttribute('width', round(Math.abs(w), 4));
    n.setAttribute('height', round(Math.abs(h), 4));
    if (this.rx) n.setAttribute('rx', round(this.rx, 4));
    if (this.ry) n.setAttribute('ry', round(this.ry, 4));
    bus.emit('status', `W ${round(Math.abs(w), 2)}  H ${round(Math.abs(h), 2)}`);
  },
  up() {
    const o = this.op; this.op = null; clearSnap();
    if (!o) return;
    if (num(o.node.getAttribute('width')) < .4 || num(o.node.getAttribute('height')) < .4) { o.node.remove(); select([]); return; }
    commit('Draw rectangle');
  },
  cancel() { if (this.op) { this.op.node.remove(); this.op = null; select([]); } },

  options() {
    const sel = App.sel.filter(n => n.tagName === 'rect');
    const setAll = (k, v) => { sel.forEach(n => n.setAttribute(k, round(v, 4))); if (sel.length) commit('Change rectangle'); redraw(); };
    const get = k => sel.length ? num(sel[0].getAttribute(k)) : this[k];
    return [
      { type: 'number', label: 'W', value: sel.length ? round(num(sel[0].getAttribute('width')), 3) : '', step: 1, set: v => setAll('width', Math.max(0, v)), disabled: !sel.length },
      { type: 'number', label: 'H', value: sel.length ? round(num(sel[0].getAttribute('height')), 3) : '', step: 1, set: v => setAll('height', Math.max(0, v)), disabled: !sel.length },
      { type: 'number', label: 'Rx', value: sel.length ? round(get('rx'), 3) : this.rx, step: 1, set: v => { this.rx = v; setAll('rx', v); } },
      { type: 'number', label: 'Ry', value: sel.length ? round(get('ry'), 3) : this.ry, step: 1, set: v => { this.ry = v; setAll('ry', v); } },
      { type: 'button', icon: 'sharp', title: 'Make corners sharp', fn: () => { this.rx = this.ry = 0; sel.forEach(n => { n.removeAttribute('rx'); n.removeAttribute('ry'); }); if (sel.length) commit('Sharp corners'); redraw(); } }
    ];
  }
});

/* ══════════════════════════ ELLIPSE / ARC ═════════════════════════════ */

registerTool({
  name: 'ellipse', title: 'Ellipse / Arc', key: 'e', icon: 'ellipse', cursor: 'crosshair',
  hint: 'Drag to draw an ellipse. Ctrl = circle, Shift = draw from centre. Drag arc handles with the node tool.',
  arcType: 'slice', start: 0, end: 0, op: null,

  down(p) {
    beginShape(this, p, () => el('path', {
      id: uid('ell'), 'sodipodi:type': 'arc', 'sodipodi:cx': 0, 'sodipodi:cy': 0,
      'sodipodi:rx': 1, 'sodipodi:ry': 1, 'sodipodi:start': this.start, 'sodipodi:end': this.end,
      'sodipodi:arc-type': this.arcType, d: ''
    }));
  },
  move(p) {
    const o = this.op; if (!o) return;
    const s = snapPoint(p.x, p.y);
    const b = local([s.x, s.y]);
    let rx = Math.abs(b[0] - o.a[0]) / (p.shift ? 1 : 2);
    let ry = Math.abs(b[1] - o.a[1]) / (p.shift ? 1 : 2);
    if (p.ctrl) rx = ry = Math.max(rx, ry);
    const cx = p.shift ? o.a[0] : (o.a[0] + b[0]) / 2;
    const cy = p.shift ? o.a[1] : (o.a[1] + b[1]) / 2;
    const n = o.node;
    n.setAttribute('sodipodi:cx', round(cx, 4)); n.setAttribute('sodipodi:cy', round(cy, 4));
    n.setAttribute('sodipodi:rx', round(rx, 4)); n.setAttribute('sodipodi:ry', round(ry, 4));
    buildArc(n);
    bus.emit('status', `Rx ${round(rx, 2)}  Ry ${round(ry, 2)}`);
  },
  up() {
    const o = this.op; this.op = null; clearSnap();
    if (!o) return;
    if (num(o.node.getAttribute('sodipodi:rx')) < .3 && num(o.node.getAttribute('sodipodi:ry')) < .3) { o.node.remove(); select([]); return; }
    commit('Draw ellipse');
  },
  cancel() { if (this.op) { this.op.node.remove(); this.op = null; select([]); } },

  options() {
    const sel = App.sel.filter(n => n.getAttribute('sodipodi:type') === 'arc');
    const app = (k, v) => { sel.forEach(n => { n.setAttribute(k, v); buildArc(n); }); if (sel.length) commit('Change arc'); redraw(); };
    const deg = k => sel.length ? round(num(sel[0].getAttribute('sodipodi:' + k)) * R2D, 2) : round(this[k] * R2D, 2);
    return [
      { type: 'number', label: 'Rx', value: sel.length ? round(num(sel[0].getAttribute('sodipodi:rx')), 3) : '', set: v => app('sodipodi:rx', Math.max(0, v)), disabled: !sel.length },
      { type: 'number', label: 'Ry', value: sel.length ? round(num(sel[0].getAttribute('sodipodi:ry')), 3) : '', set: v => app('sodipodi:ry', Math.max(0, v)), disabled: !sel.length },
      { type: 'sep' },
      { type: 'number', label: 'Start', value: deg('start'), step: 5, set: v => { this.start = v * D2R; app('sodipodi:start', v * D2R); } },
      { type: 'number', label: 'End', value: deg('end'), step: 5, set: v => { this.end = v * D2R; app('sodipodi:end', v * D2R); } },
      { type: 'sep' },
      { type: 'radio', value: sel.length ? (sel[0].getAttribute('sodipodi:arc-type') || 'slice') : this.arcType, options: [['slice', 'pie', 'Slice'], ['arc', 'arc', 'Open arc'], ['chord', 'chord', 'Chord']], set: v => { this.arcType = v; app('sodipodi:arc-type', v); } },
      { type: 'button', icon: 'circle-full', title: 'Make whole ellipse', fn: () => { this.start = this.end = 0; sel.forEach(n => { n.setAttribute('sodipodi:start', 0); n.setAttribute('sodipodi:end', 0); buildArc(n); }); if (sel.length) commit('Whole ellipse'); redraw(); } }
    ];
  }
});

/* ══════════════════════════ STAR / POLYGON ════════════════════════════ */

registerTool({
  name: 'star', title: 'Star / Polygon', key: '*', icon: 'star', cursor: 'crosshair',
  hint: 'Drag from the centre. Ctrl snaps the angle. Use the toolbar for corners, spoke ratio and rounding.',
  sides: 5, flat: false, ratio: .5, rounded: 0, randomized: 0, op: null,

  down(p) {
    const t = this;
    beginShape(this, p, a => el('path', {
      id: uid('star'), 'sodipodi:type': 'star', 'sodipodi:sides': t.sides,
      'sodipodi:cx': round(a[0], 4), 'sodipodi:cy': round(a[1], 4),
      'sodipodi:r1': 1, 'sodipodi:r2': t.ratio, 'sodipodi:arg1': -Math.PI / 2,
      'sodipodi:arg2': -Math.PI / 2 + Math.PI / t.sides,
      'inkscape:flatsided': String(t.flat), 'inkscape:rounded': t.rounded,
      'inkscape:randomized': t.randomized, d: ''
    }));
  },
  move(p) {
    const o = this.op; if (!o) return;
    const dx = p.x - o.start[0], dy = p.y - o.start[1];
    const r = Math.hypot(dx, dy);
    let a = Math.atan2(dy, dx);
    if (p.ctrl) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    const n = o.node;
    n.setAttribute('sodipodi:r1', round(r, 4));
    n.setAttribute('sodipodi:r2', round(r * this.ratio, 4));
    n.setAttribute('sodipodi:arg1', round(a, 6));
    n.setAttribute('sodipodi:arg2', round(a + Math.PI / this.sides, 6));
    buildStar(n);
    bus.emit('status', `R ${round(r, 2)}  ${this.sides} corners`);
  },
  up() {
    const o = this.op; this.op = null; clearSnap();
    if (!o) return;
    if (num(o.node.getAttribute('sodipodi:r1')) < .5) { o.node.remove(); select([]); return; }
    commit('Draw star');
  },
  cancel() { if (this.op) { this.op.node.remove(); this.op = null; select([]); } },

  options() {
    const sel = App.sel.filter(n => n.getAttribute('sodipodi:type') === 'star');
    const app = (k, v) => { sel.forEach(n => { n.setAttribute(k, v); buildStar(n); }); if (sel.length) commit('Change star'); redraw(); };
    const t = this;
    return [
      {
        type: 'radio', value: String(t.flat), options: [['false', 'star', 'Star'], ['true', 'polygon', 'Regular polygon']],
        set: v => { t.flat = v === 'true'; app('inkscape:flatsided', v); }
      },
      { type: 'sep' },
      { type: 'number', label: 'Corners', value: t.sides, min: 2, max: 200, step: 1, set: v => { t.sides = clamp(Math.round(v), 2, 200); sel.forEach(n => { n.setAttribute('sodipodi:sides', t.sides); n.setAttribute('sodipodi:arg2', num(n.getAttribute('sodipodi:arg1')) + Math.PI / t.sides); buildStar(n); }); if (sel.length) commit('Change star'); redraw(); } },
      { type: 'number', label: 'Spoke ratio', value: t.ratio, min: 0, max: 1, step: .05, set: v => { t.ratio = clamp(v, 0, 1); sel.forEach(n => { n.setAttribute('sodipodi:r2', round(num(n.getAttribute('sodipodi:r1')) * t.ratio, 4)); buildStar(n); }); if (sel.length) commit('Change star'); redraw(); }, hidden: t.flat },
      { type: 'number', label: 'Rounded', value: t.rounded, min: -1, max: 1, step: .05, set: v => { t.rounded = v; app('inkscape:rounded', v); } },
      { type: 'number', label: 'Randomised', value: t.randomized, min: 0, max: 1, step: .02, set: v => { t.randomized = v; app('inkscape:randomized', v); } },
      { type: 'button', icon: 'reset', title: 'Reset shape parameters', fn: () => { t.rounded = 0; t.randomized = 0; t.ratio = .5; sel.forEach(n => { n.setAttribute('inkscape:rounded', 0); n.setAttribute('inkscape:randomized', 0); buildStar(n); }); if (sel.length) commit('Reset star'); redraw(); } }
    ];
  }
});

/* ══════════════════════════ SPIRAL ════════════════════════════════════ */

registerTool({
  name: 'spiral', title: 'Spiral', key: 'i', icon: 'spiral', cursor: 'crosshair',
  hint: 'Drag from the centre outwards. Ctrl snaps the angle.',
  revolution: 3, expansion: 1, t0: 0, op: null,

  down(p) {
    const t = this;
    beginShape(this, p, a => el('path', {
      id: uid('spiral'), 'sodipodi:type': 'spiral',
      'sodipodi:cx': round(a[0], 4), 'sodipodi:cy': round(a[1], 4),
      'sodipodi:radius': 1, 'sodipodi:revolution': t.revolution,
      'sodipodi:expansion': t.expansion, 'sodipodi:t0': t.t0, 'sodipodi:argument': 0,
      style: 'fill:none;stroke:#000;stroke-width:1', d: ''
    }));
    setStyle(this.op.node, { fill: 'none', stroke: App.style.stroke === 'none' ? '#000000' : App.style.stroke, 'stroke-width': App.style['stroke-width'] || 1 });
  },
  move(p) {
    const o = this.op; if (!o) return;
    const dx = p.x - o.start[0], dy = p.y - o.start[1];
    let a = Math.atan2(dy, dx);
    if (p.ctrl) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    const n = o.node;
    n.setAttribute('sodipodi:radius', round(Math.hypot(dx, dy), 4));
    n.setAttribute('sodipodi:argument', round(a - TAU * this.revolution, 6));
    buildSpiral(n);
    bus.emit('status', `R ${round(Math.hypot(dx, dy), 2)}  ${this.revolution} turns`);
  },
  up() {
    const o = this.op; this.op = null; clearSnap();
    if (!o) return;
    if (num(o.node.getAttribute('sodipodi:radius')) < .5) { o.node.remove(); select([]); return; }
    commit('Draw spiral');
  },
  cancel() { if (this.op) { this.op.node.remove(); this.op = null; select([]); } },

  options() {
    const sel = App.sel.filter(n => n.getAttribute('sodipodi:type') === 'spiral');
    const app = (k, v) => { sel.forEach(n => { n.setAttribute(k, v); buildSpiral(n); }); if (sel.length) commit('Change spiral'); redraw(); };
    return [
      { type: 'number', label: 'Turns', value: this.revolution, min: .01, max: 1024, step: .5, set: v => { this.revolution = Math.max(.01, v); app('sodipodi:revolution', this.revolution); } },
      { type: 'number', label: 'Divergence', value: this.expansion, min: 0, max: 10, step: .1, set: v => { this.expansion = Math.max(0, v); app('sodipodi:expansion', this.expansion); } },
      { type: 'number', label: 'Inner radius', value: this.t0, min: 0, max: .95, step: .05, set: v => { this.t0 = clamp(v, 0, .95); app('sodipodi:t0', this.t0); } },
      { type: 'button', icon: 'reset', title: 'Reset', fn: () => { this.revolution = 3; this.expansion = 1; this.t0 = 0; sel.forEach(n => { n.setAttribute('sodipodi:revolution', 3); n.setAttribute('sodipodi:expansion', 1); n.setAttribute('sodipodi:t0', 0); buildSpiral(n); }); if (sel.length) commit('Reset spiral'); redraw(); } }
    ];
  }
});

/* ══════════════════════════ 3D BOX ════════════════════════════════════ */

const V_INF = 1e7;

registerTool({
  name: 'box3d', title: '3D Box', key: 'x', icon: 'box3d', cursor: 'crosshair',
  hint: 'Drag to draw a box in perspective. Angles and vanishing points are set in the toolbar.',
  angX: 0, angY: 90, angZ: 60, vpX: Infinity, vpY: Infinity, vpZ: 1000, depth: .55, op: null,

  down(p) {
    const g = el('g', { id: uid('box3d'), 'inkscape:label': '3D box' });
    for (let i = 0; i < 6; i++) el('path', { id: uid('face'), d: '' }, g);
    addObject(g);
    this.op = { g, a: local([p.x, p.y]) };
    select([g]);
    this.build(p);
  },
  move(p) { if (this.op) this.build(p); },
  up() {
    const o = this.op; this.op = null;
    if (!o) return;
    const bb = o.g.getBBox();
    if (bb.width < 2 && bb.height < 2) { o.g.remove(); select([]); return; }
    commit('Draw 3D box');
  },
  cancel() { if (this.op) { this.op.g.remove(); this.op = null; select([]); } },

  build(p) {
    const o = this.op, b = local([p.x, p.y]);
    const w = b[0] - o.a[0], h = b[1] - o.a[1];
    const dz = Math.hypot(w, h) * this.depth;
    const az = this.angZ * D2R;
    const dx = Math.cos(az) * dz, dy = -Math.sin(az) * dz;
    const P = (i, j, k) => [o.a[0] + w * i + dx * k, o.a[1] + h * j + dy * k];
    const V = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)];
    const faces = [[4, 5, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5], [0, 1, 5, 4], [3, 2, 6, 7], [0, 1, 2, 3]];
    const base = App.style.fill && App.style.fill !== 'none' ? App.style.fill : '#3771c8';
    const shades = [.55, .7, .85, .78, .62, 1];
    [...o.g.children].forEach((f, i) => {
      const q = faces[i].map(n => `${round(V[n][0], 3)},${round(V[n][1], 3)}`);
      f.setAttribute('d', `M${q.join(' L')} Z`);
      f.setAttribute('style', `fill:${shade(base, shades[i])};stroke:none`);
    });
    bus.emit('status', `Box ${round(Math.abs(w), 1)} × ${round(Math.abs(h), 1)} × ${round(dz, 1)}`);
  },

  options() {
    return [
      { type: 'number', label: 'Angle Z', value: this.angZ, min: -180, max: 180, step: 5, set: v => { this.angZ = v; } },
      { type: 'number', label: 'Depth', value: this.depth, min: .05, max: 3, step: .05, set: v => { this.depth = v; } },
      { type: 'label', text: 'Drag to draw; faces are grouped and individually editable.' }
    ];
  }
});

function shade(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => clamp(Math.round(x * f), 0, 255));
  return '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
}
