/* ==========================================================================
   dialogs.js — docked panels
   ========================================================================== */

import {
  App, bus, el, commit, select, clearSel, layers, currentLayer, setCurrentLayer,
  layerName, isLayer, layerOf, allObjects, isDrawable, uid, ensureId, getStyle,
  setStyle, parseStyleAttr, styleAttrStr, bboxOf, selBBox, applyMatrix, defs,
  docSize, setDocSize, namedview, UNITS, fromPx, toPx, historyState, historyGoto,
  addLayer, cmpDoc, reId, ctmOf, addObject, removeNodes, isLocked, isHidden
} from './doc.js';
import { View, update, drawGuides, saveGuides, drawingBBox, zoomToBox } from './view.js';
import { redraw, setTool, TOOLS } from './tools.js';
import { CMD, runCmd, alignSel, distributeSel, FILTER_LIST, hexToRgb, rgbToHex, rgb2hsl, hsl2rgb, moveToLayer } from './commands.js';
import { h, clear, icon, modal, toast } from './dom.js';
import { round, num, clamp, T, R, S, mmul, minv, mstr, parseTransform, decompose, mapply, box } from './geom.js';
import { FONTS, stopColor, setStopColor } from './tools-text.js';
import { imageToCanvas, traceCanvas } from './trace.js';
import { exportDialogBody } from './io.js';

export const PANELS = {};
const P = (name, title, icon, render, opts = {}) => { PANELS[name] = { name, title, icon, render, ...opts }; };

let open = [];              // names of open panel tabs
let active = null;

export function openPanel(name) {
  if (!PANELS[name]) return;
  if (!open.includes(name)) open.push(name);
  active = name;
  document.getElementById('panels').classList.add('open');
  renderTabs(); renderBody();
}
export function closePanel(name) {
  open = open.filter(n => n !== name);
  if (active === name) active = open[open.length - 1] || null;
  if (!open.length) document.getElementById('panels').classList.remove('open');
  renderTabs(); renderBody();
}
export const togglePanel = name => (open.includes(name) && active === name) ? closePanel(name) : openPanel(name);
export const isPanelOpen = name => open.includes(name);

function renderTabs() {
  const t = clear(document.getElementById('panel-tabs'));
  for (const n of open) {
    const p = PANELS[n];
    t.appendChild(h('div', { class: 'ptab' + (n === active ? ' on' : ''), onclick: () => { active = n; renderTabs(); renderBody(); } },
      icon(p.icon), h('span', p.title),
      h('span', { class: 'x', onclick: e => { e.stopPropagation(); closePanel(n); } }, '×')));
  }
}
function renderBody() {
  const b = clear(document.getElementById('panel-body'));
  if (!active) return;
  try { PANELS[active].render(b); } catch (e) { console.error(e); b.appendChild(h('p', 'Panel error: ' + e.message)); }
}
export const refreshPanels = () => { if (active) renderBody(); };

let raf = 0;
const scheduleRefresh = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; refreshPanels(); }); };
['selection', 'objects', 'layers', 'changed', 'docreplaced', 'style', 'tool', 'history'].forEach(ev => bus.on(ev, scheduleRefresh));

/* ── shared widgets ───────────────────────────────────────────────────── */

const grp = (title, ...kids) => h('div', { class: 'pgroup' }, title ? h('h4', title) : null, ...kids);
const row = (...kids) => h('div', { class: 'row' }, ...kids);

function numField(label, value, onchange, opts = {}) {
  const inp = h('input', {
    type: 'number', value: Number.isFinite(value) ? round(value, 4) : '',
    step: opts.step ?? 1, min: opts.min, max: opts.max,
    onchange: e => onchange(parseFloat(e.target.value)),
    style: opts.width ? { width: opts.width } : null
  });
  return h('label', { class: 'field' }, label ? h('span', label) : null, inp);
}
function slider(label, value, min, max, step, onInput, onDone) {
  const r = h('input', { type: 'range', min, max, step, value });
  const n = h('input', { type: 'number', min, max, step, value: round(value, 3), style: { width: '58px' } });
  r.addEventListener('input', () => { n.value = r.value; onInput(parseFloat(r.value)); });
  r.addEventListener('change', () => onDone && onDone(parseFloat(r.value)));
  n.addEventListener('change', () => { r.value = n.value; onInput(parseFloat(n.value)); onDone && onDone(parseFloat(n.value)); });
  return h('div', { class: 'chan' }, h('span', label), r, n);
}

/* ══════════════════════════ FILL & STROKE ════════════════════════════ */

const FS = { tab: 'fill' };

P('fill', 'Fill & Stroke', 'fill', host => {
  const sel = App.sel;
  host.appendChild(h('div', { class: 'fs-tabs' },
    ...[['fill', 'Fill'], ['stroke', 'Stroke paint'], ['strokestyle', 'Stroke style']].map(([k, l]) =>
      h('button', { class: 'btn' + (FS.tab === k ? ' on' : ''), onclick: () => { FS.tab = k; refreshPanels(); } }, l))));

  if (FS.tab === 'strokestyle') return strokeStylePanel(host);

  const key = FS.tab;                                   // 'fill' | 'stroke'
  const editingStop = App.toolName === 'gradient' && App.gradStop && App.doc.contains(App.gradStop.node);

  const readPaint = () => {
    if (editingStop) { const c = stopColor(App.gradStop.node); return { mode: 'flat', color: c.color, alpha: c.opacity }; }
    if (!sel.length) return { mode: App.style[key] === 'none' ? 'none' : 'flat', color: App.style[key] === 'none' ? '#000000' : App.style[key], alpha: num(App.style[key + '-opacity'], 1) };
    const v = getStyle(sel[0], key, 'none');
    const a = num(getStyle(sel[0], key + '-opacity', 1), 1);
    if (!v || v === 'none') return { mode: 'none', color: '#000000', alpha: a };
    const m = /url\(["']?#([^)"']+)/.exec(v);
    if (m) {
      const g = App.doc.querySelector(`#${CSS.escape(m[1])}`);
      return { mode: g && g.tagName === 'radialGradient' ? 'radial' : g && g.tagName === 'linearGradient' ? 'linear' : 'pattern', color: '#808080', alpha: a, grad: g };
    }
    return { mode: 'flat', color: normHex(v), alpha: a };
  };

  const paint = readPaint();

  const applyFlat = (color, alpha, doCommit) => {
    if (editingStop) {
      setStopColor(App.gradStop.node, color, alpha);
      if (doCommit) commit('Change gradient stop');
      return;
    }
    App.style[key] = color; App.style[key + '-opacity'] = alpha;
    sel.forEach(n => setStyle(n, { [key]: color, [key + '-opacity']: round(alpha, 3) }));
    if (doCommit && sel.length) commit('Change ' + key);
    bus.emit('style');
  };

  /* paint mode buttons */
  const modes = [['none', '✕', 'No paint'], ['flat', '■', 'Flat colour'],
                 ['linear', '▤', 'Linear gradient'], ['radial', '◉', 'Radial gradient']];
  host.appendChild(h('div', { class: 'paint-modes' }, modes.map(([m, glyph, title]) =>
    h('button', {
      class: 'btn' + (paint.mode === m ? ' on' : ''), title,
      onclick: () => {
        if (m === 'none') { App.style[key] = 'none'; sel.forEach(n => setStyle(n, { [key]: 'none' })); if (sel.length) commit('No ' + key); }
        else if (m === 'flat') applyFlat(paint.color === '#808080' ? '#3771c8' : paint.color, paint.alpha, true);
        else {
          if (!sel.length) { toast('Select an object first'); return; }
          const gt = TOOLS.gradient;
          gt.target = key; gt.gtype = m;
          sel.forEach(n => { const g = gt.gradientOf(n); if (!g) { const b = bboxOf(n); gt.makeGradient(n); gt.applyVector([b.x, b.cy], [b.x2, b.cy]); } });
          gt.convertAll(m);
          setTool('gradient');
        }
        refreshPanels(); redraw();
      }
    }, glyph))));

  if (paint.mode === 'none') { host.appendChild(h('p', { class: 'tiny' }, 'No paint. Choose a mode above.')); return; }

  if (paint.mode === 'linear' || paint.mode === 'radial') {
    const g = paint.grad;
    if (g) {
      const stops = [...g.querySelectorAll('stop')];
      host.appendChild(grp('Gradient stops',
        h('div', { class: 'stop-list' }, stops.map((s, i) => {
          const c = stopColor(s);
          return h('div', {
            class: 'stop-chip' + (App.gradStop && App.gradStop.node === s ? ' on' : ''),
            style: { background: c.color, opacity: .25 + c.opacity * .75 },
            title: `offset ${round(num(s.getAttribute('offset')), 3)}`,
            onclick: () => { App.gradStop = { node: s, index: i }; TOOLS.gradient.stopIndex = i; setTool('gradient'); refreshPanels(); redraw(); }
          });
        })),
        row(h('button', { class: 'btn ghost', onclick: () => { TOOLS.gradient.addStopAt(g, .5); refreshPanels(); redraw(); } }, 'Add stop'),
          h('button', { class: 'btn ghost', onclick: () => { setTool('gradient'); } }, 'Edit on canvas'))));
      if (App.gradStop && App.doc.contains(App.gradStop.node)) {
        host.appendChild(grp('Selected stop', numField('Offset', num(App.gradStop.node.getAttribute('offset')), v => {
          App.gradStop.node.setAttribute('offset', clamp(v, 0, 1)); commit('Move stop'); redraw();
        }, { step: .05, min: 0, max: 1 })));
      }
    }
  }

  host.appendChild(colorEditor(paint.color, paint.alpha, applyFlat));

  /* blur + opacity */
  const obj = sel[0];
  const blurVal = obj ? currentBlur(obj) : 0;
  host.appendChild(grp('Object',
    slider('Blur %', blurVal, 0, 100, 1, v => setBlur(sel, v), () => commit('Blur')),
    slider('Opacity %', obj ? num(getStyle(obj, 'opacity', 1), 1) * 100 : 100, 0, 100, 1,
      v => sel.forEach(n => setStyle(n, { opacity: round(v / 100, 3) })), () => { if (sel.length) commit('Opacity'); bus.emit('style'); }),
    row(h('label', 'Blend'), h('select', {
      onchange: e => { sel.forEach(n => setStyle(n, { 'mix-blend-mode': e.target.value === 'normal' ? null : e.target.value })); commit('Blend mode'); },
      value: obj ? getStyle(obj, 'mix-blend-mode', 'normal') : 'normal'
    }, ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
        'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']
      .map(m => h('option', { value: m, selected: obj && getStyle(obj, 'mix-blend-mode', 'normal') === m }, m))))));
});

function currentBlur(n) {
  const f = getStyle(n, 'filter', '');
  const m = /url\(["']?#([^)"']+)/.exec(f || '');
  if (!m) return 0;
  const fl = App.doc.querySelector(`#${CSS.escape(m[1])}`);
  const gb = fl && fl.querySelector('feGaussianBlur');
  if (!gb) return 0;
  const b = bboxOf(n);
  const perim = b ? (b.w + b.h) / 4 : 100;
  return clamp(num(gb.getAttribute('stdDeviation')) / (perim || 1) * 100 * 2, 0, 100);
}
function setBlur(sel, pct) {
  for (const n of sel) {
    const b = bboxOf(n); const perim = b ? (b.w + b.h) / 4 : 100;
    const std = pct / 100 * perim / 2;
    let f = getStyle(n, 'filter', ''), id = (/url\(["']?#([^)"']+)/.exec(f || '') || [])[1];
    let fl = id && App.doc.querySelector(`#${CSS.escape(id)}`);
    if (pct <= 0) { if (fl && fl.querySelector('feGaussianBlur') && fl.children.length === 1) { setStyle(n, { filter: null }); fl.remove(); } continue; }
    if (!fl || !fl.querySelector('feGaussianBlur')) {
      fl = el('filter', { id: uid('blur'), x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs());
      el('feGaussianBlur', { stdDeviation: round(std, 3) }, fl);
      setStyle(n, { filter: `url(#${fl.id})` });
    } else fl.querySelector('feGaussianBlur').setAttribute('stdDeviation', round(std, 3));
  }
}

function normHex(v) {
  const rgb = hexToRgb(v);
  return rgb ? rgbToHex(rgb) : (String(v).startsWith('#') ? v : '#000000');
}

function colorEditor(color, alpha, apply) {
  const wrap = h('div', { class: 'pgroup' });
  let rgb = hexToRgb(color) || [0, 0, 0];
  let hsl = rgb2hsl(rgb);
  let a = clamp(alpha, 0, 1);

  const preview = h('div', { class: 'swatch-big' }, h('i'));
  const plane = h('div', { id: 'sv-plane' }, h('div', { id: 'sv-cursor' }));
  const hueR = h('input', { type: 'range', min: 0, max: 360, step: 1, value: Math.round(hsl[0] * 360) });
  const hex = h('input', { type: 'text', value: rgbToHex(rgb), style: { width: '86px', fontFamily: 'var(--mono)' } });
  const chans = {};

  const paint = (live) => {
    const hexv = rgbToHex(rgb);
    preview.firstChild.style.background = hexv;
    preview.firstChild.style.opacity = a;
    plane.style.background =
      `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${Math.round(hsl[0] * 360)},100%,50%))`;
    const c = plane.querySelector('#sv-cursor');
    const sv = rgb2hsv(rgb);
    c.style.left = (sv[1] * 100) + '%';
    c.style.top = ((1 - sv[2]) * 100) + '%';
    hex.value = hexv;
    for (const k in chans) {
      const v = k === 'A' ? Math.round(a * 100) : rgb['RGB'.indexOf(k)];
      chans[k][0].value = v; chans[k][1].value = Math.round(v);
    }
    apply(hexv, a, !live);
  };

  const setRGB = (r, g, b, live) => { rgb = [r, g, b]; hsl = rgb2hsl(rgb); hueR.value = Math.round(hsl[0] * 360); paint(live); };

  hueR.addEventListener('input', () => {
    const sv = rgb2hsv(rgb);
    rgb = hsv2rgb([parseInt(hueR.value, 10) / 360, sv[1], sv[2]]);
    hsl = rgb2hsl(rgb); paint(true);
  });
  hueR.addEventListener('change', () => paint(false));

  const planeSet = e => {
    const r = plane.getBoundingClientRect();
    const s = clamp((e.clientX - r.left) / r.width, 0, 1);
    const v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    rgb = hsv2rgb([parseInt(hueR.value, 10) / 360, s, v]);
    hsl = rgb2hsl(rgb); paint(true);
  };
  plane.addEventListener('pointerdown', e => {
    try { plane.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    planeSet(e);
    const mv = ev => planeSet(ev);
    const up = () => { plane.removeEventListener('pointermove', mv); plane.removeEventListener('pointerup', up); paint(false); };
    plane.addEventListener('pointermove', mv); plane.addEventListener('pointerup', up);
  });

  hex.addEventListener('change', () => { const c = hexToRgb(hex.value.trim()); if (c) setRGB(c[0], c[1], c[2], false); });

  const chanRow = (name, value, max) => {
    const r = h('input', { type: 'range', min: 0, max, step: 1, value });
    const n = h('input', { type: 'number', min: 0, max, step: 1, value: Math.round(value) });
    const upd = (v, live) => {
      if (name === 'A') a = clamp(v / 100, 0, 1);
      else { const i = 'RGB'.indexOf(name); rgb[i] = clamp(v, 0, 255); hsl = rgb2hsl(rgb); hueR.value = Math.round(hsl[0] * 360); }
      paint(live);
    };
    r.addEventListener('input', () => upd(parseFloat(r.value), true));
    r.addEventListener('change', () => upd(parseFloat(r.value), false));
    n.addEventListener('change', () => upd(parseFloat(n.value), false));
    chans[name] = [r, n];
    return h('div', { class: 'chan' }, h('span', name), r, n);
  };

  wrap.append(preview, plane, hueR,
    chanRow('R', rgb[0], 255), chanRow('G', rgb[1], 255), chanRow('B', rgb[2], 255),
    chanRow('A', a * 100, 100),
    row(h('span', { class: 'tiny' }, 'RGBA'), hex));
  requestAnimationFrame(() => paint(true));
  return wrap;
}

function rgb2hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) hh = ((b - r) / d + 2) / 6;
    else hh = ((r - g) / d + 4) / 6;
  }
  return [hh, mx ? d / mx : 0, mx];
}
function hsv2rgb([hh, s, v]) {
  const i = Math.floor(hh * 6), f = hh * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const set = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return set.map(x => Math.round(x * 255));
}

function strokeStylePanel(host) {
  const sel = App.sel;
  const g = (k, d) => sel.length ? getStyle(sel[0], k, d) : (App.style[k] ?? d);
  const set = (props, label) => {
    Object.assign(App.style, props);
    sel.forEach(n => setStyle(n, props));
    if (sel.length) commit(label || 'Stroke style');
    bus.emit('style'); redraw();
  };
  host.appendChild(grp('Width',
    row(h('input', {
      type: 'number', step: .1, min: 0, value: round(num(g('stroke-width', 1), 1), 3),
      onchange: e => set({ 'stroke-width': Math.max(0, parseFloat(e.target.value) || 0) })
    }), h('span', { class: 'tiny' }, 'px'))));

  host.appendChild(grp('Join',
    h('div', { class: 'grid3' }, ['miter', 'round', 'bevel'].map(j =>
      h('button', { class: 'btn ghost' + (g('stroke-linejoin', 'miter') === j ? ' on' : ''), onclick: () => set({ 'stroke-linejoin': j }) }, j)))));
  host.appendChild(grp('Cap',
    h('div', { class: 'grid3' }, ['butt', 'round', 'square'].map(c =>
      h('button', { class: 'btn ghost' + (g('stroke-linecap', 'butt') === c ? ' on' : ''), onclick: () => set({ 'stroke-linecap': c }) }, c)))));

  const dashes = [['none', '———'], ['4,3', '– – –'], ['1,3', '· · ·'], ['8,4', '—  —'], ['12,4,2,4', '—·—·'], ['2,2', '▪▪▪'], ['16,6', '——  ——']];
  host.appendChild(grp('Dashes',
    h('select', { onchange: e => set({ 'stroke-dasharray': e.target.value === 'none' ? null : e.target.value }) },
      dashes.map(([v, l]) => h('option', { value: v, selected: (g('stroke-dasharray', 'none') || 'none') === v }, l))),
    row(h('label', 'Offset'), h('input', { type: 'number', step: 1, value: num(g('stroke-dashoffset', 0)), onchange: e => set({ 'stroke-dashoffset': parseFloat(e.target.value) || 0 }) }))));

  host.appendChild(grp('Markers',
    row(h('button', { class: 'btn ghost', onclick: () => runCmd('ext.markers') }, 'Arrow at end'),
      h('button', { class: 'btn ghost', onclick: () => set({ 'marker-end': null, 'marker-start': null, 'marker-mid': null }, 'Remove markers') }, 'None'))));

  host.appendChild(grp('Order',
    h('div', { class: 'grid3' }, [['normal', 'Fill first'], ['stroke fill markers', 'Stroke first'], ['markers stroke fill', 'Markers first']].map(([v, l]) =>
      h('button', { class: 'btn ghost' + (g('paint-order', 'normal') === v ? ' on' : ''), onclick: () => set({ 'paint-order': v === 'normal' ? null : v }) }, l)))));
}

/* ══════════════════════════ OBJECTS ══════════════════════════════════ */

P('objects', 'Objects', 'objects', host => {
  const tree = h('div', { class: 'tree' });
  const build = (parent, container) => {
    const kids = [...parent.children].filter(c => isLayer(c) || isDrawable(c)).reverse();
    for (const n of kids) {
      const label = n.getAttribute('inkscape:label') || (isLayer(n) ? 'Layer' : n.tagName) + (n.id ? ' #' + n.id : '');
      const hidden = /display\s*:\s*none/.test(n.getAttribute('style') || '');
      const locked = n.getAttribute('sodipodi:insensitive') === 'true';
      const nodeRow = h('div', {
        class: 'tnode' + (App.sel.includes(n) ? ' sel' : ''),
        onclick: e => {
          if (isLayer(n)) { setCurrentLayer(n); refreshPanels(); return; }
          select([n], e.shiftKey ? 'toggle' : 'set'); redraw();
        },
        ondblclick: () => { const b = bboxOf(n); if (b) zoomToBox(b, .3); }
      },
        h('span', { class: 'mini', title: hidden ? 'Show' : 'Hide', onclick: e => { e.stopPropagation(); setStyle(n, { display: hidden ? (isLayer(n) ? 'inline' : null) : 'none' }); commit('Toggle visibility'); refreshPanels(); } }, icon(hidden ? 'eye-off' : 'eye')),
        h('span', { class: 'mini', title: locked ? 'Unlock' : 'Lock', onclick: e => { e.stopPropagation(); locked ? n.removeAttribute('sodipodi:insensitive') : n.setAttribute('sodipodi:insensitive', 'true'); commit('Toggle lock'); refreshPanels(); } }, icon(locked ? 'lock' : 'unlock')),
        h('span', { class: 'tag' }, isLayer(n) ? '▤' : n.tagName === 'g' ? '▣' : '◆'),
        h('span', { class: 'lbl' }, label));
      container.appendChild(nodeRow);
      if (n.children.length && (isLayer(n) || n.tagName === 'g')) {
        const sub = h('div', { class: 'tkids' });
        container.appendChild(sub);
        build(n, sub);
      }
    }
  };
  build(App.doc, tree);
  host.appendChild(tree);
  host.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
    h('button', { class: 'btn ghost', onclick: () => runCmd('object.group') }, 'Group'),
    h('button', { class: 'btn ghost', onclick: () => runCmd('object.ungroup') }, 'Ungroup'),
    h('button', { class: 'btn ghost', onclick: () => runCmd('edit.delete') }, 'Delete')));
});

/* ══════════════════════════ LAYERS ═══════════════════════════════════ */

P('layers', 'Layers', 'layers', host => {
  const cur = currentLayer();
  const list = h('div', { class: 'tree' });
  for (const l of layers().slice().reverse()) {
    const hidden = /display\s*:\s*none/.test(l.getAttribute('style') || '');
    const locked = l.getAttribute('sodipodi:insensitive') === 'true';
    list.appendChild(h('div', { class: 'tnode' + (l === cur ? ' sel' : ''), onclick: () => { setCurrentLayer(l); refreshPanels(); } },
      h('span', { class: 'mini', onclick: e => { e.stopPropagation(); setStyle(l, { display: hidden ? 'inline' : 'none' }); commit('Layer visibility'); refreshPanels(); } }, icon(hidden ? 'eye-off' : 'eye')),
      h('span', { class: 'mini', onclick: e => { e.stopPropagation(); locked ? l.removeAttribute('sodipodi:insensitive') : l.setAttribute('sodipodi:insensitive', 'true'); commit('Layer lock'); refreshPanels(); } }, icon(locked ? 'lock' : 'unlock')),
      h('span', {
        class: 'lbl', ondblclick: e => {
          e.stopPropagation();
          const v = prompt('Layer name:', layerName(l));
          if (v !== null) { l.setAttribute('inkscape:label', v); commit('Rename layer'); refreshPanels(); }
        }
      }, layerName(l))));
  }
  host.appendChild(list);
  host.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
    h('button', { class: 'btn ghost', title: 'New layer', onclick: () => runCmd('layer.add') }, icon('plus')),
    h('button', { class: 'btn ghost', title: 'Duplicate', onclick: () => runCmd('layer.duplicate') }, icon('dup')),
    h('button', { class: 'btn ghost', title: 'Raise', onclick: () => runCmd('layer.up') }, icon('raise')),
    h('button', { class: 'btn ghost', title: 'Lower', onclick: () => runCmd('layer.down') }, icon('lower')),
    h('button', { class: 'btn ghost', title: 'Delete', onclick: () => runCmd('layer.delete') }, icon('trash'))));

  host.appendChild(grp('Current layer',
    slider('Opacity %', num(getStyle(cur, 'opacity', 1), 1) * 100, 0, 100, 1,
      v => setStyle(cur, { opacity: round(v / 100, 3) }), () => commit('Layer opacity')),
    row(h('label', 'Blend'), h('select', {
      onchange: e => { setStyle(cur, { 'mix-blend-mode': e.target.value === 'normal' ? null : e.target.value }); commit('Layer blend'); }
    }, ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']
      .map(m => h('option', { value: m, selected: getStyle(cur, 'mix-blend-mode', 'normal') === m }, m)))),
    App.sel.length ? row(h('button', { class: 'btn ghost', onclick: () => { moveToLayer(cur); commit('Move to layer'); refreshPanels(); } }, 'Move selection here')) : null));
});

/* ══════════════════════════ XML EDITOR ═══════════════════════════════ */

let xmlSel = null;

P('xml', 'XML Editor', 'xml', host => {
  if (!xmlSel || !App.doc.contains(xmlSel)) xmlSel = App.sel[0] || App.doc;
  const tree = h('div', { class: 'tree', style: { maxHeight: '42vh', overflow: 'auto' } });
  const build = (n, container, depth) => {
    if (n.nodeType !== 1) return;
    const label = n.tagName + (n.id ? ` id="${n.id}"` : '');
    container.appendChild(h('div', {
      class: 'tnode' + (n === xmlSel ? ' sel' : ''),
      onclick: () => { xmlSel = n; if (isDrawable(n)) select([n]); refreshPanels(); redraw(); }
    }, h('span', { class: 'tag' }, '<' + label + '>')));
    if (n.children.length && depth < 12) {
      const sub = h('div', { class: 'tkids' });
      container.appendChild(sub);
      for (const c of n.children) build(c, sub, depth + 1);
    }
  };
  build(App.doc, tree, 0);
  host.appendChild(tree);

  const n = xmlSel;
  const tbl = h('table', { class: 'attr-table' });
  for (const a of [...n.attributes]) {
    tbl.appendChild(h('tr',
      h('td', a.name),
      h('td', h('input', {
        value: a.value,
        onchange: e => { n.setAttribute(a.name, e.target.value); commit('Edit attribute'); bus.emit('objects'); redraw(); }
      })),
      h('td', h('button', {
        class: 'mini', title: 'Delete attribute',
        onclick: () => { n.removeAttribute(a.name); commit('Delete attribute'); refreshPanels(); redraw(); }
      }, '×'))));
  }
  host.appendChild(grp('Attributes of <' + n.tagName + '>', tbl));

  const newName = h('input', { placeholder: 'name', style: { width: '38%' } });
  const newVal = h('input', { placeholder: 'value', style: { flex: '1' } });
  host.appendChild(row(newName, newVal, h('button', {
    class: 'btn ghost', onclick: () => {
      if (!newName.value.trim()) return;
      try { n.setAttribute(newName.value.trim(), newVal.value); } catch (e) { toast('Invalid attribute name'); return; }
      commit('Add attribute'); refreshPanels(); redraw();
    }
  }, 'Add')));

  if (n.children.length === 0) {
    host.appendChild(grp('Text content', h('textarea', {
      rows: 3, value: n.textContent,
      onchange: e => { n.textContent = e.target.value; commit('Edit text node'); redraw(); }
    })));
  }

  host.appendChild(row(
    h('button', {
      class: 'btn ghost', onclick: () => {
        const tag = prompt('New child element (tag name):', 'rect'); if (!tag) return;
        const c = el(tag, { id: uid(tag.slice(0, 4)) }, n);
        xmlSel = c; commit('Create node'); refreshPanels(); redraw();
      }
    }, 'New node'),
    n !== App.doc ? h('button', {
      class: 'btn ghost', onclick: () => { const p = n.parentNode; n.remove(); xmlSel = p; commit('Delete node'); refreshPanels(); redraw(); }
    }, 'Delete node') : null,
    n.parentNode && n.previousElementSibling ? h('button', { class: 'btn ghost', title: 'Move up', onclick: () => { n.previousElementSibling.before(n); commit('Reorder'); refreshPanels(); } }, icon('raise')) : null,
    n.parentNode && n.nextElementSibling ? h('button', { class: 'btn ghost', title: 'Move down', onclick: () => { n.nextElementSibling.after(n); commit('Reorder'); refreshPanels(); } }, icon('lower')) : null));
});

/* ══════════════════════════ ALIGN & DISTRIBUTE ═══════════════════════ */

let alignRel = 'selection';

P('align', 'Align & Distribute', 'align', host => {
  host.appendChild(grp('Relative to',
    h('select', { onchange: e => alignRel = e.target.value },
      [['selection', 'Selection area'], ['first', 'First selected'], ['last', 'Last selected'], ['page', 'Page'], ['drawing', 'Drawing']]
        .map(([v, l]) => h('option', { value: v, selected: alignRel === v }, l)))));

  const ab = (how, label, title) => h('button', { class: 'btn ghost', title, onclick: () => alignSel(how, alignRel) }, label);
  host.appendChild(grp('Align horizontally', h('div', { class: 'grid4' },
    ab('leftEdge', '⇥|', 'Right edges to left anchor'), ab('left', '⊢', 'Left edges'),
    ab('hcenter', '⊣⊢', 'Centre on vertical axis'), ab('right', '⊣', 'Right edges'))));
  host.appendChild(grp('Align vertically', h('div', { class: 'grid4' },
    ab('topEdge', '⤒', 'Bottom edges to top anchor'), ab('top', '⊤', 'Top edges'),
    ab('vcenter', '⊥⊤', 'Centre on horizontal axis'), ab('bottom', '⊥', 'Bottom edges'))));

  const db = (how, label, title) => h('button', { class: 'btn ghost', title, onclick: () => distributeSel(how) }, label);
  host.appendChild(grp('Distribute', h('div', { class: 'grid4' },
    db('hleft', '|←', 'Left edges equidistant'), db('hcenter', '↔', 'Centres equidistant horizontally'),
    db('hright', '→|', 'Right edges equidistant'), db('hgap', '⇹', 'Equal horizontal gaps'),
    db('vtop', '↑—', 'Top edges equidistant'), db('vcenter', '↕', 'Centres equidistant vertically'),
    db('vbottom', '—↓', 'Bottom edges equidistant'), db('vgap', '⇳', 'Equal vertical gaps'))));

  host.appendChild(grp('Remove overlaps',
    h('button', {
      class: 'btn ghost', onclick: () => {
        const items = App.sel.map(n => ({ n, b: bboxOf(n) })).filter(i => i.b);
        for (let pass = 0; pass < 30; pass++) {
          let moved = false;
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i].b, b = items[j].b;
            if (a.x < b.x2 && a.x2 > b.x && a.y < b.y2 && a.y2 > b.y) {
              const dx = (a.cx < b.cx ? -1 : 1) * 2, dy = (a.cy < b.cy ? -1 : 1) * 2;
              applyMatrix(items[j].n, T(-dx, -dy));
              items[j].b = bboxOf(items[j].n); moved = true;
            }
          }
          if (!moved) break;
        }
        commit('Remove overlaps'); redraw();
      }
    }, 'Nudge apart')));
});

/* ══════════════════════════ TRANSFORM ════════════════════════════════ */

const TR = { tab: 'move', relative: true, mx: 0, my: 0, sx: 100, sy: 100, ang: 30, skx: 0, sky: 0 };

P('transform', 'Transform', 'transform', host => {
  host.appendChild(h('div', { class: 'fs-tabs' }, ['move', 'scale', 'rotate', 'skew', 'matrix'].map(t =>
    h('button', { class: 'btn' + (TR.tab === t ? ' on' : ''), onclick: () => { TR.tab = t; refreshPanels(); } }, t[0].toUpperCase() + t.slice(1)))));

  const apply = fn => {
    if (!App.sel.length) { toast('Nothing selected'); return; }
    const b = selBBox();
    App.sel.forEach(n => applyMatrix(n, fn(b, bboxOf(n))));
    commit('Transform'); redraw();
  };

  if (TR.tab === 'move') {
    host.appendChild(grp('Move',
      row(numField('X', TR.mx, v => TR.mx = v, { step: 1 }), numField('Y', TR.my, v => TR.my = v, { step: 1 })),
      row(h('label', h('input', { type: 'checkbox', checked: TR.relative, onchange: e => TR.relative = e.target.checked }), ' Relative move')),
      h('button', { class: 'btn primary', onclick: () => apply((b, ob) => TR.relative ? T(TR.mx, TR.my) : T(TR.mx - ob.x, TR.my - ob.y)) }, 'Apply')));
  } else if (TR.tab === 'scale') {
    host.appendChild(grp('Scale (%)',
      row(numField('W', TR.sx, v => TR.sx = v, { step: 5 }), numField('H', TR.sy, v => TR.sy = v, { step: 5 })),
      h('button', { class: 'btn primary', onclick: () => apply((b, ob) => mmul(T(ob.x, ob.y), mmul(S(TR.sx / 100, TR.sy / 100), T(-ob.x, -ob.y)))) }, 'Apply')));
  } else if (TR.tab === 'rotate') {
    host.appendChild(grp('Rotate',
      row(numField('Angle °', TR.ang, v => TR.ang = v, { step: 5 })),
      row(h('button', { class: 'btn ghost', onclick: () => apply((b, ob) => R(-TR.ang, ob.cx, ob.cy)) }, '↺ CCW'),
        h('button', { class: 'btn ghost', onclick: () => apply((b, ob) => R(TR.ang, ob.cx, ob.cy)) }, '↻ CW'))));
  } else if (TR.tab === 'skew') {
    host.appendChild(grp('Skew (°)',
      row(numField('X', TR.skx, v => TR.skx = v, { step: 5 }), numField('Y', TR.sky, v => TR.sky = v, { step: 5 })),
      h('button', {
        class: 'btn primary', onclick: () => apply((b, ob) => mmul(T(ob.cx, ob.cy),
          mmul({ a: 1, b: Math.tan(TR.sky * Math.PI / 180), c: Math.tan(TR.skx * Math.PI / 180), d: 1, e: 0, f: 0 }, T(-ob.cx, -ob.cy))))
      }, 'Apply')));
  } else {
    const cur = App.sel.length ? parseTransform(App.sel[0].getAttribute('transform')) : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const fields = {};
    host.appendChild(grp('Matrix',
      h('div', { class: 'grid3' }, ['a', 'c', 'e', 'b', 'd', 'f'].map(k => {
        const i = h('input', { type: 'number', step: .01, value: round(cur[k], 5) });
        fields[k] = i;
        return h('label', { class: 'field' }, h('span', k), i);
      })),
      h('button', {
        class: 'btn primary', onclick: () => {
          const m = {}; for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) m[k] = parseFloat(fields[k].value) || 0;
          App.sel.forEach(n => { n.setAttribute('transform', mstr(m) || 'matrix(1,0,0,1,0,0)'); });
          commit('Set matrix'); redraw();
        }
      }, 'Set matrix'),
      h('button', { class: 'btn ghost', onclick: () => { App.sel.forEach(n => n.removeAttribute('transform')); commit('Clear transform'); redraw(); } }, 'Clear transform')));
  }

  const b = selBBox();
  if (b) host.appendChild(grp('Selection bounds', h('p', { class: 'tiny' },
    `X ${round(b.x, 2)}  Y ${round(b.y, 2)}  W ${round(b.w, 2)}  H ${round(b.h, 2)}`)));
});

/* ══════════════════════════ DOCUMENT PROPERTIES ══════════════════════ */

const PAGE_PRESETS = [
  ['A4', 210, 297, 'mm'], ['A3', 297, 420, 'mm'], ['A5', 148, 210, 'mm'],
  ['US Letter', 8.5, 11, 'in'], ['US Legal', 8.5, 14, 'in'], ['Tabloid', 11, 17, 'in'],
  ['Business card', 85, 55, 'mm'], ['Square 1000', 1000, 1000, 'px'],
  ['Icon 512', 512, 512, 'px'], ['Icon 64', 64, 64, 'px'],
  ['1080p', 1920, 1080, 'px'], ['4K UHD', 3840, 2160, 'px'],
  ['Instagram post', 1080, 1080, 'px'], ['Instagram story', 1080, 1920, 'px'],
  ['iPhone wallpaper', 1170, 2532, 'px'], ['iPad wallpaper', 2048, 2732, 'px']
];

P('document', 'Document Properties', 'docprops', host => {
  const { w, h: hh } = docSize();
  const nv = namedview();
  const unit = App.prefs.unit;
  const setSize = (W, H, u) => { setDocSize(toPx(W, u), toPx(H, u), u); update(); commit('Page size'); refreshPanels(); };

  host.appendChild(grp('Page size',
    h('select', {
      onchange: e => {
        const p = PAGE_PRESETS[e.target.value];
        if (p) { App.prefs.unit = p[3]; setSize(p[1], p[2], p[3]); }
      }
    }, h('option', { value: '' }, 'Custom…'), PAGE_PRESETS.map((p, i) => h('option', { value: i }, `${p[0]} — ${p[1]}×${p[2]} ${p[3]}`))),
    row(numField('Width', round(fromPx(w, unit), 4), v => setSize(v, fromPx(hh, unit), unit), { step: 1 }),
      numField('Height', round(fromPx(hh, unit), 4), v => setSize(fromPx(w, unit), v, unit), { step: 1 }),
      h('select', { onchange: e => { App.prefs.unit = e.target.value; update(); refreshPanels(); } },
        Object.keys(UNITS).filter(u => u !== '%' && u !== 'em').map(u => h('option', { value: u, selected: u === unit }, u)))),
    row(h('button', { class: 'btn ghost', onclick: () => setSize(fromPx(hh, unit), fromPx(w, unit), unit) }, 'Swap orientation'),
      h('button', {
        class: 'btn ghost', onclick: () => {
          const b = drawingBBox(); if (!b) { toast('Nothing to fit'); return; }
          allObjects(App.doc).forEach(n => applyMatrix(n, T(-b.x, -b.y)));
          setDocSize(b.w, b.h, unit); update(); commit('Resize to drawing'); refreshPanels();
        }
      }, 'Fit to drawing'))));

  host.appendChild(grp('Background',
    row(h('label', 'Page'), h('input', {
      type: 'color', value: (nv.getAttribute('pagecolor') || '#ffffff'),
      oninput: e => { nv.setAttribute('pagecolor', e.target.value); update(); },
      onchange: () => commit('Page colour')
    }), h('label', 'Border'), h('input', {
      type: 'color', value: (nv.getAttribute('bordercolor') || '#666666'),
      oninput: e => { nv.setAttribute('bordercolor', e.target.value); update(); },
      onchange: () => commit('Border colour')
    }))));

  const g = App.grid;
  host.appendChild(grp('Grid',
    row(h('label', h('input', { type: 'checkbox', checked: App.prefs.gridVisible, onchange: e => { App.prefs.gridVisible = e.target.checked; update(); } }), ' Show grid')),
    row(h('label', 'Type'), h('select', { onchange: e => { g.type = e.target.value; update(); } },
      [['xy', 'Rectangular'], ['axo', 'Axonometric']].map(([v, l]) => h('option', { value: v, selected: g.type === v }, l)))),
    row(numField('Spacing X', g.sx, v => { g.sx = Math.max(.01, v); update(); }, { step: 1 }),
      numField('Y', g.sy, v => { g.sy = Math.max(.01, v); update(); }, { step: 1 })),
    row(numField('Major every', g.major, v => { g.major = Math.max(1, Math.round(v)); update(); }, { step: 1 }),
      h('input', { type: 'color', value: g.color, oninput: e => { g.color = e.target.value; update(); } }))));

  host.appendChild(grp('Snapping',
    row(h('label', h('input', { type: 'checkbox', checked: App.prefs.snapEnabled, onchange: e => { App.prefs.snapEnabled = e.target.checked; bus.emit('ui'); } }), ' Enable snapping')),
    ...Object.keys(App.snap).map(k => row(h('label', h('input', {
      type: 'checkbox', checked: App.snap[k], onchange: e => { App.snap[k] = e.target.checked; bus.emit('ui'); }
    }), ' snap to ' + k))),
    numField('Distance (px)', App.prefs.snapDist, v => App.prefs.snapDist = clamp(v, 2, 80), { step: 1 })));

  host.appendChild(grp('Guides',
    row(h('button', { class: 'btn ghost', onclick: () => runCmd('view.deleteGuides') }, 'Delete all guides'),
      h('label', h('input', { type: 'checkbox', checked: App.prefs.guidesVisible, onchange: e => { App.prefs.guidesVisible = e.target.checked; drawGuides(); } }), ' Show')),
    h('p', { class: 'tiny' }, 'Drag from a ruler to create a guide; drag a guide off-canvas to delete it.')));

  host.appendChild(grp('Metadata',
    row(h('label', 'Title'), h('input', {
      value: (App.doc.querySelector('title')?.textContent) || '',
      onchange: e => {
        let t = App.doc.querySelector('title');
        if (!t) { t = el('title', {}); App.doc.prepend(t); }
        t.textContent = e.target.value; commit('Set title');
      }
    }))));
});

/* ══════════════════════════ TEXT & FONT ══════════════════════════════ */

P('text', 'Text & Font', 'text', host => {
  const t = TOOLS.text;
  const sel = App.sel.filter(n => n.tagName === 'text');
  const cur = k => sel.length ? (parseStyleAttr(sel[0].getAttribute('style'))[k] ?? '') : '';
  host.appendChild(grp('Font',
    h('select', {
      size: 8, style: { width: '100%' },
      onchange: e => { t.family = e.target.value; t.apply({ 'font-family': e.target.value }); refreshPanels(); }
    }, FONTS.map(f => h('option', { value: f, selected: (cur('font-family') || t.family) === f, style: { fontFamily: f } }, f))),
    row(numField('Size', num(cur('font-size'), t.size), v => { t.size = v; t.apply({ 'font-size': v + 'px' }); }, { step: 1 }),
      h('button', { class: 'btn ghost' + ((cur('font-weight') || '') === 'bold' ? ' on' : ''), onclick: () => { t.bold = !t.bold; t.apply({ 'font-weight': t.bold ? 'bold' : 'normal' }); refreshPanels(); } }, icon('bold')),
      h('button', { class: 'btn ghost' + ((cur('font-style') || '') === 'italic' ? ' on' : ''), onclick: () => { t.italic = !t.italic; t.apply({ 'font-style': t.italic ? 'italic' : 'normal' }); refreshPanels(); } }, icon('italic')))));
  host.appendChild(grp('Layout',
    row(...[['start', 'align-left'], ['middle', 'align-center'], ['end', 'align-right']].map(([v, ic]) =>
      h('button', { class: 'btn ghost' + ((cur('text-anchor') || t.align) === v ? ' on' : ''), onclick: () => { t.align = v; t.apply({ 'text-anchor': v }); refreshPanels(); } }, icon(ic)))),
    slider('Line height', num(cur('line-height'), t.lineHeight), .5, 3, .05, v => { t.lineHeight = v; }, v => t.apply({ 'line-height': v })),
    slider('Letter spacing', num(cur('letter-spacing'), t.letterSpacing), -10, 40, .5, v => { t.letterSpacing = v; }, v => t.apply({ 'letter-spacing': v + 'px' })),
    slider('Word spacing', num(cur('word-spacing'), 0), -10, 60, .5, () => { }, v => t.apply({ 'word-spacing': v + 'px' }))));
  host.appendChild(grp('Case',
    h('div', { class: 'grid3' },
      h('button', { class: 'btn ghost', onclick: () => runCmd('text.upper') }, 'ABC'),
      h('button', { class: 'btn ghost', onclick: () => runCmd('text.lower') }, 'abc'),
      h('button', { class: 'btn ghost', onclick: () => runCmd('text.title') }, 'Abc'))));
  host.appendChild(h('p', { class: 'tiny' }, 'Fonts come from the device. Convert text to path is not available in the browser because glyph outlines require the font binary.'));
});

/* ══════════════════════════ FILTERS ══════════════════════════════════ */

P('filters', 'Filters', 'filter', host => {
  host.appendChild(h('p', { class: 'tiny' }, 'Filters are real SVG filter primitives and stay editable in the XML editor.'));
  host.appendChild(h('div', { class: 'grid2' }, FILTER_LIST.map(f =>
    h('button', { class: 'btn ghost', onclick: () => runCmd('filter.apply', f.key) }, f.label))));
  host.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } },
    h('button', { class: 'btn ghost', onclick: () => runCmd('filter.remove') }, 'Remove filters from selection')));
});

/* ══════════════════════════ UNDO HISTORY ═════════════════════════════ */

P('history', 'Undo History', 'history', host => {
  const st = historyState();
  const list = h('div', { class: 'tree' });
  st.list.slice().reverse().forEach(item => {
    list.appendChild(h('div', { class: 'tnode' + (item.cur ? ' sel' : ''), onclick: () => { historyGoto(item.i); redraw(); } },
      h('span', { class: 'lbl' }, item.label)));
  });
  host.appendChild(list);
});

/* ══════════════════════════ TRACE BITMAP ═════════════════════════════ */

const TB = { mode: 'brightness', threshold: .45, steps: 4, invert: false, smooth: 1.2, speckles: 14 };

P('trace', 'Trace Bitmap', 'trace', host => {
  const img = App.sel.find(n => n.tagName === 'image');
  host.appendChild(h('p', { class: 'tiny' }, img ? 'Tracing: ' + (img.id || 'image') : 'Select an imported bitmap image first.'));
  host.appendChild(grp('Mode',
    h('select', { onchange: e => { TB.mode = e.target.value; refreshPanels(); } },
      [['brightness', 'Brightness cutoff'], ['steps', 'Brightness steps (multiple scans)']]
        .map(([v, l]) => h('option', { value: v, selected: TB.mode === v }, l))),
    TB.mode === 'brightness'
      ? slider('Threshold', TB.threshold, 0, 1, .01, v => TB.threshold = v)
      : slider('Scans', TB.steps, 2, 8, 1, v => TB.steps = Math.round(v)),
    slider('Smoothing', TB.smooth, 0, 5, .1, v => TB.smooth = v),
    slider('Speckles', TB.speckles, 0, 80, 1, v => TB.speckles = v),
    row(h('label', h('input', { type: 'checkbox', checked: TB.invert, onchange: e => TB.invert = e.target.checked }), ' Invert'))));
  host.appendChild(h('button', {
    class: 'btn primary', disabled: !img,
    onclick: async () => {
      try {
        toast('Tracing…');
        const cv = await imageToCanvas(img, 1000);
        const bb = bboxOf(img);
        const res = traceCanvas(cv, {
          ...TB, scaleX: bb.w / cv.width, scaleY: bb.h / cv.height, offX: bb.x, offY: bb.y
        });
        if (!res.length) { toast('Nothing traced — adjust the threshold', 'err'); return; }
        const g = el('g', { id: uid('trace'), 'inkscape:label': 'Traced bitmap' });
        for (const r of res) el('path', { id: uid('path'), d: r.d, style: `fill:${r.fill};fill-rule:evenodd;stroke:none` }, g);
        addObject(g);
        select([g]); commit('Trace bitmap'); redraw();
        toast(`Traced ${res.length} path${res.length > 1 ? 's' : ''}`);
      } catch (e) { console.error(e); toast('Trace failed: ' + e.message, 'err'); }
    }
  }, 'Trace'));
});

/* ══════════════════════════ EXPORT ═══════════════════════════════════ */

P('export', 'Export', 'export', host => exportDialogBody(host));
