/* ==========================================================================
   tools-text.js — Text tool (with on-canvas editing) and Gradient tool
   ========================================================================== */

import {
  App, bus, el, commit, select, addObject, uid, applyCurrentStyle, setStyle, getStyle,
  currentLayer, ctmOf, bboxOf, defs, ensureId, parseStyleAttr
} from './doc.js';
import { View, toScreen, toUser, ov, hitTest, els, px2u, snapPoint, buildSnap, clearSnap } from './view.js';
import { registerTool, redraw, TOOLS, hot, hitHot, setTool } from './tools.js';
import { minv, mapply, mmul, round, clamp, num, TAU, dist, parseTransform } from './geom.js';

export const FONTS = [
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New',
  'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Palatino Linotype',
  'Segoe UI', 'Roboto', 'Noto Sans', 'Futura', 'Optima', 'Baskerville', 'Didot',
  'American Typewriter', 'Papyrus', 'Brush Script MT', 'Lucida Console'
];

const measureCtx = document.createElement('canvas').getContext('2d');

/* ══════════════════════════ TEXT ═════════════════════════════════════ */

registerTool({
  name: 'text', title: 'Text', key: 't', icon: 'text', cursor: 'text',
  hint: 'Click to place a text cursor, or drag to make a wrapped text frame. Esc or click away to finish.',
  family: 'sans-serif', size: 24, bold: false, italic: false, align: 'start',
  lineHeight: 1.25, letterSpacing: 0, editor: null, target: null, op: null,

  deactivate() { this.commitEdit(); },

  down(p) {
    const t = hitTest(p.e.clientX, p.e.clientY);
    if (t && t.tagName === 'text') { this.commitEdit(); this.editNode(t); return; }
    if (this.editor) { this.commitEdit(); return; }
    this.op = { x: p.x, y: p.y, sx: p.sx, sy: p.sy, node: null };
  },
  move(p) {
    const o = this.op; if (!o) return;
    if (Math.hypot(p.sx - o.sx, p.sy - o.sy) < 6) return;
    o.frame = [Math.min(o.x, p.x), Math.min(o.y, p.y), Math.abs(p.x - o.x), Math.abs(p.y - o.y)];
  },
  up(p) {
    const o = this.op; this.op = null; if (!o) return;
    const inv = minv(ctmOf(App.context || currentLayer()));
    const node = el('text', { id: uid('text') });
    const st = {
      'font-family': this.family, 'font-size': round(this.size, 3) + 'px',
      'font-weight': this.bold ? 'bold' : 'normal', 'font-style': this.italic ? 'italic' : 'normal',
      'text-anchor': this.align, 'line-height': this.lineHeight,
      'letter-spacing': this.letterSpacing ? this.letterSpacing + 'px' : null,
      fill: App.style.fill === 'none' ? '#000000' : App.style.fill, stroke: 'none',
      'white-space': 'pre'
    };
    if (o.frame) {
      const a = mapply(inv, o.frame[0], o.frame[1]);
      node.setAttribute('x', round(a[0], 3)); node.setAttribute('y', round(a[1] + this.size, 3));
      node.setAttribute('inkweb:flow-w', round(o.frame[2], 3));
      node.setAttribute('inkweb:flow-h', round(o.frame[3], 3));
    } else {
      const a = mapply(inv, o.x, o.y);
      node.setAttribute('x', round(a[0], 3)); node.setAttribute('y', round(a[1], 3));
    }
    setStyle(node, st);
    node.setAttribute('xml:space', 'preserve');
    addObject(node); select([node]);
    this.editNode(node, '');
  },

  /* — on-canvas editor — */
  editNode(node, initial) {
    this.commitEdit();
    this.target = node;
    const host = document.getElementById('edit-layer');
    const ta = document.createElement('textarea');
    ta.className = 'text-edit';
    ta.spellcheck = false; ta.autocapitalize = 'off'; ta.autocomplete = 'off';
    ta.value = initial !== undefined ? initial : textOf(node);

    const st = parseStyleAttr(node.getAttribute('style'));
    const cs = getComputedStyle(node);
    const size = num(st['font-size'] || cs.fontSize, 24);
    const fam = st['font-family'] || cs.fontFamily || 'sans-serif';
    const lh = num(st['line-height'], 1.25) || 1.25;
    const anchor = st['text-anchor'] || 'start';
    const x = num(node.getAttribute('x')), y = num(node.getAttribute('y'));
    const fw = num(node.getAttribute('inkweb:flow-w'), 0);

    const M = mmul({ a: View.zoom, b: 0, c: 0, d: View.zoom, e: View.tx, f: View.ty }, ctmOf(node));
    const wUser = fw || Math.max(140 / View.zoom, measureMax(ta.value, size, fam) + size);
    const rows = ta.value.split('\n').length;
    Object.assign(ta.style, {
      font: `${st['font-style'] === 'italic' ? 'italic ' : ''}${st['font-weight'] === 'bold' ? '700 ' : ''}${size}px ${fam}`,
      lineHeight: lh,
      width: wUser + 'px',
      height: Math.max(rows, 1) * size * lh + size * .5 + 'px',
      letterSpacing: st['letter-spacing'] || '0',
      color: st.fill && st.fill !== 'none' ? st.fill : '#000',
      textAlign: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
      transformOrigin: '0 0',
      transform: `matrix(${M.a},${M.b},${M.c},${M.d},${M.e},${M.f}) translate(${x - (anchor === 'middle' ? wUser / 2 : anchor === 'end' ? wUser : 0)}px, ${y - size * .82}px)`,
      whiteSpace: fw ? 'pre-wrap' : 'pre'
    });
    node.style.visibility = 'hidden';
    host.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { this.commitEdit(); redraw(); }
    });
    ta.addEventListener('input', () => {
      const r = ta.value.split('\n').length;
      ta.style.height = Math.max(r, 1) * size * lh + size * .5 + 'px';
    });
    ta.addEventListener('blur', () => setTimeout(() => this.commitEdit(), 60));
    this.editor = ta;
    bus.emit('status', 'Editing text — Esc to finish');
  },

  commitEdit() {
    const ta = this.editor, node = this.target;
    this.editor = null; this.target = null;
    if (!ta || !node) return;
    const val = ta.value;
    ta.remove();
    node.style.visibility = '';
    if (!App.doc.contains(node)) return;
    if (!val.trim()) { node.remove(); select([]); commit('Delete empty text'); return; }
    setTextContent(node, val);
    commit('Edit text');
    bus.emit('objects');
  },

  draw() {
    const o = this.op;
    if (o && o.frame) {
      const a = toScreen(o.frame[0], o.frame[1]), b = toScreen(o.frame[0] + o.frame[2], o.frame[1] + o.frame[3]);
      ov('rect', { x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1], fill: 'none', stroke: '#4a90d9', 'stroke-dasharray': '4 3' });
    }
    for (const n of App.sel) {
      if (n.tagName !== 'text') continue;
      const b = bboxOf(n); if (!b) continue;
      const a = toScreen(b.x, b.y), c = toScreen(b.x2, b.y2);
      ov('rect', { x: a[0] - 2, y: a[1] - 2, width: c[0] - a[0] + 4, height: c[1] - a[1] + 4, fill: 'none', stroke: '#4a90d9', 'stroke-opacity': .7, 'stroke-dasharray': '3 3' });
    }
  },

  apply(props) {
    const sel = App.sel.filter(n => n.tagName === 'text');
    sel.forEach(n => { setStyle(n, props); reflow(n); });
    if (sel.length) commit('Change text style');
    redraw();
  },

  options() {
    const sel = App.sel.filter(n => n.tagName === 'text');
    const cur = k => sel.length ? (parseStyleAttr(sel[0].getAttribute('style'))[k] ?? '') : null;
    return [
      { type: 'select', label: '', value: cur('font-family') || this.family, options: FONTS.map(f => [f, f]), wide: true, set: v => { this.family = v; this.apply({ 'font-family': v }); } },
      { type: 'number', label: 'Size', value: num(cur('font-size'), this.size), min: 1, max: 2000, step: 1, set: v => { this.size = v; this.apply({ 'font-size': v + 'px' }); } },
      { type: 'sep' },
      { type: 'toggle', icon: 'bold', title: 'Bold', get: () => (cur('font-weight') || (this.bold ? 'bold' : 'normal')) === 'bold', set: v => { this.bold = v; this.apply({ 'font-weight': v ? 'bold' : 'normal' }); } },
      { type: 'toggle', icon: 'italic', title: 'Italic', get: () => (cur('font-style') || (this.italic ? 'italic' : 'normal')) === 'italic', set: v => { this.italic = v; this.apply({ 'font-style': v ? 'italic' : 'normal' }); } },
      { type: 'sep' },
      {
        type: 'radio', value: cur('text-anchor') || this.align, set: v => { this.align = v; this.apply({ 'text-anchor': v }); },
        options: [['start', 'align-left', 'Align left'], ['middle', 'align-center', 'Centre'], ['end', 'align-right', 'Align right']]
      },
      { type: 'sep' },
      { type: 'number', label: 'Line', value: num(cur('line-height'), this.lineHeight), min: .5, max: 5, step: .05, set: v => { this.lineHeight = v; this.apply({ 'line-height': v }); } },
      { type: 'number', label: 'Spacing', value: num(cur('letter-spacing'), this.letterSpacing), min: -20, max: 100, step: .5, set: v => { this.letterSpacing = v; this.apply({ 'letter-spacing': v + 'px' }); } },
      { type: 'sep' },
      { type: 'button', icon: 'to-path', title: 'Convert text to path (Shift+Ctrl+C)', cmd: 'path.objectToPath' }
    ];
  }
});

export function textOf(node) {
  const lines = [];
  for (const c of node.children) if (c.tagName === 'tspan' && !c.getAttribute('inkweb:cont')) lines.push(c.textContent);
  if (!lines.length) return node.textContent || '';
  // re-join soft-wrapped continuation spans
  const out = [];
  let buf = null;
  for (const c of node.children) {
    if (c.tagName !== 'tspan') continue;
    if (c.getAttribute('inkweb:cont')) { buf += ' ' + c.textContent.trim(); }
    else { if (buf !== null) out.push(buf); buf = c.textContent; }
  }
  if (buf !== null) out.push(buf);
  return out.join('\n');
}

export function setTextContent(node, text) {
  const st = parseStyleAttr(node.getAttribute('style'));
  const size = num(st['font-size'], 24);
  const lh = (num(st['line-height'], 1.25) || 1.25) * size;
  const x = num(node.getAttribute('x')), fw = num(node.getAttribute('inkweb:flow-w'), 0);
  node.replaceChildren();
  const lines = fw ? wrapLines(text, fw, st) : text.split('\n');
  lines.forEach((ln, i) => {
    const t = el('tspan', { x: round(x, 3), dy: i === 0 ? 0 : round(lh, 3), 'xml:space': 'preserve' }, node);
    if (ln.cont) t.setAttribute('inkweb:cont', '1');
    t.textContent = (ln.text !== undefined ? ln.text : ln) || ' ';
  });
  node.setAttribute('inkweb:text', '1');
}

function wrapLines(text, width, st) {
  const size = num(st['font-size'], 24);
  measureCtx.font = `${st['font-style'] === 'italic' ? 'italic ' : ''}${st['font-weight'] === 'bold' ? '700 ' : ''}${size}px ${st['font-family'] || 'sans-serif'}`;
  const out = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '', first = true;
    for (const w of words) {
      const test = line + w;
      if (measureCtx.measureText(test).width > width && line.trim()) {
        out.push({ text: line.replace(/\s+$/, ''), cont: !first });
        first = false; line = w.replace(/^\s+/, '');
      } else line = test;
    }
    out.push({ text: line, cont: !first });
  }
  return out;
}
function measureMax(text, size, fam) {
  measureCtx.font = `${size}px ${fam}`;
  return Math.max(...text.split('\n').map(l => measureCtx.measureText(l).width), 40);
}
export function reflow(node) {
  if (node.tagName !== 'text') return;
  const t = textOf(node);
  setTextContent(node, t);
}

/* ══════════════════════════ GRADIENT ═════════════════════════════════ */

registerTool({
  name: 'gradient', title: 'Gradient', key: 'g', icon: 'gradient', cursor: 'crosshair',
  hint: 'Drag across the selection to apply a gradient. Click a square/diamond handle to edit that stop.',
  gtype: 'linear', target: 'fill', stopIndex: 0, op: null,

  activate() { this.stopIndex = 0; },

  down(p) {
    const h = hitHot(p.sx, p.sy);
    if (h && h.t === 'stop') { this.stopIndex = h.i; App.gradStop = { node: h.node, index: h.i }; bus.emit('style'); return; }
    if (h && h.t === 'gh') { this.op = { kind: 'handle', h, node: h.node }; buildSnap(); return; }
    if (!App.sel.length) { bus.emit('toast', 'Select an object first'); return; }
    this.op = { kind: 'create', a: [p.x, p.y], b: [p.x, p.y] };
  },
  move(p) {
    const o = this.op; if (!o) return;
    if (o.kind === 'create') {
      o.b = [p.x, p.y];
      if (p.ctrl) {
        const a = Math.round(Math.atan2(o.b[1] - o.a[1], o.b[0] - o.a[0]) / (Math.PI / 12)) * (Math.PI / 12);
        const r = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
        o.b = [o.a[0] + Math.cos(a) * r, o.a[1] + Math.sin(a) * r];
      }
      this.applyVector(o.a, o.b);
      return;
    }
    if (o.kind === 'handle') {
      const g = o.h.grad, e = o.h.el;
      const inv = minv(ctmOf(e));
      const l = mapply(inv, p.x, p.y);
      if (g.tagName === 'linearGradient') {
        if (o.h.k === 'start') { g.setAttribute('x1', round(l[0], 3)); g.setAttribute('y1', round(l[1], 3)); }
        else { g.setAttribute('x2', round(l[0], 3)); g.setAttribute('y2', round(l[1], 3)); }
      } else {
        if (o.h.k === 'center') { g.setAttribute('cx', round(l[0], 3)); g.setAttribute('cy', round(l[1], 3)); g.setAttribute('fx', round(l[0], 3)); g.setAttribute('fy', round(l[1], 3)); }
        else if (o.h.k === 'rx') g.setAttribute('r', round(Math.abs(l[0] - num(g.getAttribute('cx'))), 3));
        else g.setAttribute('r', round(Math.abs(l[1] - num(g.getAttribute('cy'))), 3));
      }
    }
  },
  up() {
    const o = this.op; this.op = null; clearSnap();
    if (o) commit('Edit gradient');
  },

  applyVector(a, b) {
    for (const n of App.sel) {
      let g = this.gradientOf(n);
      if (!g) g = this.makeGradient(n);
      const inv = minv(ctmOf(n));
      const la = mapply(inv, a[0], a[1]), lb = mapply(inv, b[0], b[1]);
      if (g.tagName === 'linearGradient') {
        g.setAttribute('x1', round(la[0], 3)); g.setAttribute('y1', round(la[1], 3));
        g.setAttribute('x2', round(lb[0], 3)); g.setAttribute('y2', round(lb[1], 3));
      } else {
        g.setAttribute('cx', round(la[0], 3)); g.setAttribute('cy', round(la[1], 3));
        g.setAttribute('fx', round(la[0], 3)); g.setAttribute('fy', round(la[1], 3));
        g.setAttribute('r', round(Math.hypot(lb[0] - la[0], lb[1] - la[1]), 3));
      }
    }
  },

  gradientOf(n) {
    const v = getStyle(n, this.target, '');
    const m = /url\(["']?#([^)"']+)/.exec(v || '');
    if (!m) return null;
    const g = App.doc.querySelector(`#${CSS.escape(m[1])}`);
    if (!g) return null;
    if (g.tagName.toLowerCase().includes('gradient') && g.tagName.toLowerCase().startsWith(this.gtype.slice(0, 3))) return g;
    return g;
  },

  makeGradient(n) {
    const base = getStyle(n, this.target, '#3771c8');
    const color = /^url/.test(base) || base === 'none' ? '#3771c8' : base;
    const id = uid('grad');
    const tag = this.gtype === 'radial' ? 'radialGradient' : 'linearGradient';
    const g = el(tag, { id, gradientUnits: 'userSpaceOnUse' }, defs());
    el('stop', { offset: 0, style: `stop-color:${color};stop-opacity:1` }, g);
    el('stop', { offset: 1, style: `stop-color:${color};stop-opacity:0` }, g);
    setStyle(n, { [this.target]: `url(#${id})` });
    return g;
  },

  stopsOf(g) { return [...g.querySelectorAll('stop')]; },

  addStopAt(g, offset) {
    const stops = this.stopsOf(g);
    const before = stops.filter(s => num(s.getAttribute('offset')) <= offset).pop() || stops[0];
    const after = stops.find(s => num(s.getAttribute('offset')) > offset) || stops[stops.length - 1];
    const mix = (a, b, t) => a + (b - a) * t;
    const t = (offset - num(before.getAttribute('offset'))) / Math.max(1e-6, num(after.getAttribute('offset')) - num(before.getAttribute('offset')));
    const s = el('stop', { offset: round(offset, 4) });
    const sc = stopColor(before), ec = stopColor(after);
    s.setAttribute('style', `stop-color:${sc.color};stop-opacity:${round(mix(sc.opacity, ec.opacity, t), 3)}`);
    after.before(s);
    commit('Add gradient stop');
    return s;
  },

  dbl(p) {
    for (const n of App.sel) {
      const g = this.gradientOf(n); if (!g) continue;
      const info = gradGeom(g, n);
      if (!info) continue;
      const t = projectT(info, p.x, p.y);
      if (t > .02 && t < .98) { this.addStopAt(g, t); redraw(); return; }
    }
  },

  keydown(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace')) {
      for (const n of App.sel) {
        const g = this.gradientOf(n); if (!g) continue;
        const stops = this.stopsOf(g);
        if (stops.length > 2 && stops[this.stopIndex]) { stops[this.stopIndex].remove(); this.stopIndex = 0; commit('Delete gradient stop'); redraw(); return true; }
      }
    }
    return false;
  },

  draw() {
    const o = this.op;
    if (o && o.kind === 'create') {
      const a = toScreen(o.a[0], o.a[1]), b = toScreen(o.b[0], o.b[1]);
      ov('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#fff', 'stroke-width': 2 });
    }
    for (const n of App.sel) {
      const g = this.gradientOf(n); if (!g) continue;
      const info = gradGeom(g, n); if (!info) continue;
      const A = toScreen(info.a[0], info.a[1]), B = toScreen(info.b[0], info.b[1]);
      ov('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: '#000', 'stroke-opacity': .55, 'stroke-width': 3 });
      ov('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: '#fff', 'stroke-width': 1.4, 'stroke-dasharray': '4 3' });
      const stops = this.stopsOf(g);
      stops.forEach((s, i) => {
        const t = num(s.getAttribute('offset'));
        const px = info.a[0] + (info.b[0] - info.a[0]) * t, py = info.a[1] + (info.b[1] - info.a[1]) * t;
        const sp = toScreen(px, py);
        const c = stopColor(s);
        const shape = (i === 0) ? 'rect' : (i === stops.length - 1) ? 'diamond' : 'circle';
        drawStopHandle(sp, c.color, shape, i === this.stopIndex);
        hot(sp[0], sp[1], { t: 'stop', i, node: s, grad: g, el: n }, 10);
      });
      hot(A[0], A[1], { t: 'gh', k: 'start', grad: g, el: n }, 11);
      hot(B[0], B[1], { t: 'gh', k: g.tagName === 'linearGradient' ? 'end' : 'rx', grad: g, el: n }, 11);
    }
  },

  options() {
    const t = this;
    return [
      { type: 'radio', value: t.gtype, options: [['linear', 'grad-linear', 'Linear gradient'], ['radial', 'grad-radial', 'Radial gradient']], set: v => { t.gtype = v; t.convertAll(v); } },
      { type: 'sep' },
      { type: 'radio', value: t.target, options: [['fill', 'fill', 'Apply to fill'], ['stroke', 'stroke', 'Apply to stroke']], set: v => { t.target = v; redraw(); } },
      { type: 'sep' },
      {
        type: 'select', label: 'Repeat', value: (() => { const g = App.sel.map(n => t.gradientOf(n)).find(Boolean); return g ? (g.getAttribute('spreadMethod') || 'pad') : 'pad'; })(),
        options: [['pad', 'None'], ['reflect', 'Reflected'], ['repeat', 'Direct']],
        set: v => { App.sel.forEach(n => { const g = t.gradientOf(n); if (g) g.setAttribute('spreadMethod', v); }); commit('Gradient repeat'); redraw(); }
      },
      { type: 'button', icon: 'swap', title: 'Reverse gradient', fn: () => { App.sel.forEach(n => { const g = t.gradientOf(n); if (g) reverseGradient(g); }); commit('Reverse gradient'); redraw(); } },
      { type: 'button', icon: 'node-add', title: 'Insert stop in the middle', fn: () => { App.sel.forEach(n => { const g = t.gradientOf(n); if (g) t.addStopAt(g, .5); }); redraw(); } }
    ];
  },

  convertAll(type) {
    for (const n of App.sel) {
      const g = this.gradientOf(n); if (!g) continue;
      const want = type === 'radial' ? 'radialGradient' : 'linearGradient';
      if (g.tagName === want) continue;
      const info = gradGeom(g, n);
      const ng = el(want, { id: uid('grad'), gradientUnits: 'userSpaceOnUse' }, defs());
      [...g.querySelectorAll('stop')].forEach(s => ng.appendChild(s.cloneNode(true)));
      const inv = minv(ctmOf(n));
      const a = mapply(inv, info.a[0], info.a[1]), b = mapply(inv, info.b[0], info.b[1]);
      if (want === 'radialGradient') {
        ng.setAttribute('cx', round(a[0], 3)); ng.setAttribute('cy', round(a[1], 3));
        ng.setAttribute('fx', round(a[0], 3)); ng.setAttribute('fy', round(a[1], 3));
        ng.setAttribute('r', round(Math.hypot(b[0] - a[0], b[1] - a[1]), 3));
      } else {
        ng.setAttribute('x1', round(a[0], 3)); ng.setAttribute('y1', round(a[1], 3));
        ng.setAttribute('x2', round(b[0], 3)); ng.setAttribute('y2', round(b[1], 3));
      }
      setStyle(n, { [this.target]: `url(#${ng.id})` });
      if (!App.doc.querySelector(`[style*="${g.id}"]`)) g.remove();
    }
    commit('Change gradient type'); redraw();
  }
});

function drawStopHandle(p, color, shape, active) {
  const attrs = { fill: color, stroke: active ? '#fff' : '#111', 'stroke-width': active ? 2 : 1.2 };
  if (shape === 'rect') ov('rect', { x: p[0] - 5, y: p[1] - 5, width: 10, height: 10, ...attrs });
  else if (shape === 'diamond') ov('path', { d: `M${p[0]},${p[1] - 6.5}L${p[0] + 6.5},${p[1]}L${p[0]},${p[1] + 6.5}L${p[0] - 6.5},${p[1]}Z`, ...attrs });
  else ov('circle', { cx: p[0], cy: p[1], r: 5, ...attrs });
}

export function stopColor(s) {
  const st = parseStyleAttr(s.getAttribute('style'));
  return {
    color: st['stop-color'] || s.getAttribute('stop-color') || '#000000',
    opacity: num(st['stop-opacity'] ?? s.getAttribute('stop-opacity'), 1)
  };
}
export function setStopColor(s, color, opacity) {
  const st = parseStyleAttr(s.getAttribute('style'));
  if (color != null) st['stop-color'] = color;
  if (opacity != null) st['stop-opacity'] = round(opacity, 3);
  s.setAttribute('style', Object.entries(st).map(([k, v]) => `${k}:${v}`).join(';'));
}
function reverseGradient(g) {
  const stops = [...g.querySelectorAll('stop')];
  const data = stops.map(s => ({ off: num(s.getAttribute('offset')), style: s.getAttribute('style') }));
  stops.forEach((s, i) => {
    const src = data[data.length - 1 - i];
    s.setAttribute('offset', round(1 - src.off, 4));
    s.setAttribute('style', src.style);
  });
  [...g.querySelectorAll('stop')].sort((a, b) => num(a.getAttribute('offset')) - num(b.getAttribute('offset'))).forEach(s => g.appendChild(s));
}

/** Gradient endpoints in document user units. */
export function gradGeom(g, node) {
  const m = ctmOf(node);
  const gm = g.getAttribute('gradientTransform');
  const full = gm ? mmul(m, parseTransform(gm)) : m;
  if (g.tagName === 'linearGradient') {
    const a = mapply(full, num(g.getAttribute('x1')), num(g.getAttribute('y1')));
    const b = mapply(full, num(g.getAttribute('x2'), 1), num(g.getAttribute('y2')));
    return { a, b, radial: false };
  }
  if (g.tagName === 'radialGradient') {
    const cx = num(g.getAttribute('cx')), cy = num(g.getAttribute('cy')), r = num(g.getAttribute('r'), 1);
    return { a: mapply(full, cx, cy), b: mapply(full, cx + r, cy), radial: true };
  }
  return null;
}
function projectT(info, x, y) {
  const dx = info.b[0] - info.a[0], dy = info.b[1] - info.a[1];
  const L = dx * dx + dy * dy;
  return L ? clamp(((x - info.a[0]) * dx + (y - info.a[1]) * dy) / L, 0, 1) : 0;
}
