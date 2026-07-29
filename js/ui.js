/* ==========================================================================
   ui.js — menus, command bar, toolbox, tool options, palette, status bar
   ========================================================================== */

import {
  App, bus, commit, select, clearSel, layers, currentLayer, setCurrentLayer,
  layerName, getStyle, setStyle, selBBox, bboxOf, applyMatrix, historyState,
  docSize, isLayer, allObjects
} from './doc.js';
import { View, update, setZoom, zoomPage } from './view.js';
import { TOOLS, setTool, redraw, isTyping } from './tools.js';
import { CMD, runCmd, registerToolCommands, FILTER_LIST } from './commands.js';
import { PANELS, openPanel, togglePanel, isPanelOpen, refreshPanels } from './dialogs.js';
import { h, clear, icon, modal, toast } from './dom.js';
import { round, num, clamp, T, S, mmul } from './geom.js';

/* ══════════════════════════ MENUS ════════════════════════════════════ */

const S_ = '-';
const MENUS = () => [
  ['File', [
    'file.new', 'file.open', 'file.import', S_,
    'file.save', 'file.saveAs', 'file.savePlain', 'file.saveOptimized', 'file.saveSvgz', S_,
    'file.export', 'file.print', 'file.share', S_,
    'file.docprops', 'file.cleanup'
  ]],
  ['Edit', [
    'edit.undo', 'edit.redo', { cmd: 'panel.history', label: 'Undo History…', icon: 'history' }, S_,
    'edit.cut', 'edit.copy', 'edit.paste', 'edit.pasteInPlace', 'edit.pasteStyle', S_,
    'edit.duplicate', 'edit.clone', 'edit.unlinkClone', 'edit.delete', S_,
    'edit.selectAll', 'edit.selectAllLayers', 'edit.invert', 'edit.deselect'
  ]],
  ['View', [
    'view.zoomIn', 'view.zoomOut', 'view.zoom1', 'view.zoom2', S_,
    'view.zoomPage', 'view.zoomWidth', 'view.zoomDrawing', 'view.zoomSelection', S_,
    'view.grid', 'view.guides', 'view.rulers', 'view.snap', 'view.deleteGuides', S_,
    'view.theme', 'view.fullscreen'
  ]],
  ['Layer', [
    'layer.add', 'layer.duplicate', 'layer.rename', 'layer.delete', S_,
    'layer.up', 'layer.down', S_,
    'layer.moveSelUp', 'layer.moveSelDown', S_,
    'layer.showAll', 'layer.hideOthers', 'layer.lockOthers', 'layer.unlockAll', S_,
    { cmd: 'panel.layers', label: 'Layers…', icon: 'layers' }
  ]],
  ['Object', [
    { cmd: 'panel.fill', label: 'Fill and Stroke…', icon: 'fill', key: 'Ctrl+Shift+F' },
    { cmd: 'panel.objects', label: 'Objects…', icon: 'objects' },
    { cmd: 'panel.transform', label: 'Transform…', icon: 'transform', key: 'Ctrl+Shift+M' },
    { cmd: 'panel.align', label: 'Align and Distribute…', icon: 'align', key: 'Ctrl+Shift+A' }, S_,
    'object.group', 'object.ungroup', S_,
    'object.raiseTop', 'object.raise', 'object.lower', 'object.lowerBottom', S_,
    'object.rot90cw', 'object.rot90ccw', 'object.flipH', 'object.flipV', S_,
    'object.clipSet', 'object.clipRelease', 'object.maskSet', 'object.maskRelease', S_,
    'object.hide', 'object.unhideAll', 'object.lock', 'object.unlockAll'
  ]],
  ['Path', [
    'path.objectToPath', 'path.strokeToPath', S_,
    'path.union', 'path.difference', 'path.intersection', 'path.exclusion', 'path.division', 'path.cutPath', S_,
    'path.combine', 'path.breakApart', S_,
    'path.inset', 'path.outset', 'path.insetBy', S_,
    'path.simplify', 'path.reverse'
  ]],
  ['Text', [
    { cmd: 'panel.text', label: 'Text and Font…', icon: 'text', key: 'Ctrl+Shift+T' }, S_,
    'text.upper', 'text.lower', 'text.title', S_, 'text.unflow'
  ]],
  ['Filters', [
    ...FILTER_LIST.map(f => ({ cmd: 'filter.apply', arg: f.key, label: f.label })),
    S_, 'filter.remove',
    { cmd: 'panel.filters', label: 'Filters…', icon: 'filter' }
  ]],
  ['Extensions', [
    'ext.addNodes', 'ext.flatten', 'ext.jitter', 'ext.roughen', 'ext.markers', S_,
    'ext.colorGrayscale', 'ext.colorNegative', 'ext.colorRandom', 'ext.colorMoreHue', 'ext.colorLessHue', S_,
    'ext.grid', { cmd: 'panel.trace', label: 'Trace Bitmap…', icon: 'trace' }
  ]],
  ['Help', ['help.keys', 'help.about']]
];

let openMenu = null;

function buildMenus() {
  const nav = clear(document.getElementById('menus'));
  MENUS().forEach(([title, items]) => {
    const b = h('div', { class: 'menu-title', role: 'menuitem' }, title);
    b.addEventListener('pointerdown', e => { e.preventDefault(); toggleMenu(b, title, items); });
    b.addEventListener('pointerenter', () => { if (openMenu && openMenu.title !== title) toggleMenu(b, title, items, true); });
    nav.appendChild(b);
  });
}

function closeMenu() {
  if (!openMenu) return;
  openMenu.el.remove();
  openMenu.btn.classList.remove('open');
  openMenu = null;
  document.getElementById('scrim').hidden = true;
}

function toggleMenu(btn, title, items, force) {
  const was = openMenu && openMenu.title === title;
  closeMenu();
  if (was && !force) return;
  const r = btn.getBoundingClientRect();
  const dd = buildDropdown(items);
  dd.style.left = Math.min(r.left, innerWidth - 260) + 'px';
  dd.style.top = r.bottom + 'px';
  document.body.appendChild(dd);
  btn.classList.add('open');
  openMenu = { title, el: dd, btn };
}

function buildDropdown(items) {
  const dd = h('div', { class: 'dropdown' });
  for (const it of items) {
    if (it === S_) { dd.appendChild(h('div', { class: 'hsep' })); continue; }
    const spec = typeof it === 'string' ? { cmd: it } : it;
    const c = CMD[spec.cmd] || {};
    const label = spec.label || c.label || spec.cmd;
    const key = spec.key || c.key;
    const checked = c.checked ? c.checked() : false;
    const row = h('button', {
      class: 'mi' + (checked ? ' checked' : ''),
      onclick: () => { closeMenu(); runMenu(spec); }
    },
      h('span', { class: 'chk' }, '✓'),
      (spec.icon || c.icon) ? icon(spec.icon || c.icon) : h('span', { class: 'ico' }),
      h('span', label),
      key ? h('span', { class: 'k' }, key.replace('Ctrl', ctrlLabel())) : null);
    dd.appendChild(row);
  }
  return dd;
}
const ctrlLabel = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

function runMenu(spec) {
  if (spec.cmd && spec.cmd.startsWith('panel.')) { openPanel(spec.cmd.slice(6)); return; }
  runCmd(spec.cmd, spec.arg);
  redraw(); refreshUI();
}

document.addEventListener('pointerdown', e => {
  if (openMenu && !openMenu.el.contains(e.target) && !openMenu.btn.contains(e.target)) closeMenu();
}, true);

/* mobile: full menu list in a modal */
function mobileMenu() {
  const body = h('div');
  MENUS().forEach(([title, items]) => {
    body.appendChild(h('h4', { style: { margin: '10px 0 4px', color: 'var(--fg3)' } }, title));
    items.forEach(it => {
      if (it === S_) return;
      const spec = typeof it === 'string' ? { cmd: it } : it;
      const c = CMD[spec.cmd] || {};
      body.appendChild(h('button', {
        class: 'mi', onclick: () => { m.close(); runMenu(spec); }
      }, (spec.icon || c.icon) ? icon(spec.icon || c.icon) : h('span', { class: 'ico' }), spec.label || c.label || spec.cmd));
    });
  });
  const m = modal({ title: 'Menu', body });
}

/* ══════════════════════════ COMMAND BAR ══════════════════════════════ */

const COMMAND_BAR = [
  'file.new', 'file.open', 'file.save', 'file.import', 'file.export', S_,
  'edit.undo', 'edit.redo', S_,
  'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', S_,
  'object.group', 'object.ungroup', S_,
  'object.raiseTop', 'object.raise', 'object.lower', 'object.lowerBottom', S_,
  'path.union', 'path.difference', 'path.intersection', 'path.exclusion', 'path.division', 'path.cutPath', S_,
  'view.zoomPage', 'view.zoomDrawing', 'view.zoomSelection', S_,
  { panel: 'fill' }, { panel: 'objects' }, { panel: 'layers' }, { panel: 'align' }, { panel: 'transform' },
  { panel: 'xml' }, { panel: 'document' }, { panel: 'export' }
];

function buildCommandBar() {
  const bar = clear(document.getElementById('commandbar'));
  for (const it of COMMAND_BAR) {
    if (it === S_) { bar.appendChild(h('div', { class: 'sep' })); continue; }
    if (it.panel) {
      const p = PANELS[it.panel];
      bar.appendChild(h('button', {
        class: 'btn' + (isPanelOpen(it.panel) ? ' on' : ''), title: p.title,
        'data-panel': it.panel,
        onclick: () => { togglePanel(it.panel); refreshUI(); }
      }, icon(p.icon)));
      continue;
    }
    const c = CMD[it];
    if (!c) continue;
    bar.appendChild(h('button', {
      class: 'btn', title: c.label + (c.key ? `  (${c.key.replace('Ctrl', ctrlLabel())})` : ''),
      'data-cmd': it,
      onclick: () => { runCmd(it); redraw(); refreshUI(); }
    }, icon(c.icon || 'check')));
  }
}

/* ══════════════════════════ TOOLBOX ══════════════════════════════════ */

const TOOL_ORDER = ['select', 'node', 'rect', 'ellipse', 'star', 'box3d', 'spiral',
  'pencil', 'pen', 'calligraphy', 'text', 'gradient', 'mesh', 'dropper', 'bucket',
  'tweak', 'spray', 'eraser', 'connector', 'measure', 'zoom'];

function buildToolbox() {
  const tb = clear(document.getElementById('toolbox'));
  for (const name of TOOL_ORDER) {
    const t = TOOLS[name]; if (!t) continue;
    tb.appendChild(h('button', {
      class: 'tool-btn' + (App.toolName === name ? ' on' : ''),
      title: `${t.title}${t.key ? ' (' + t.key.toUpperCase() + ')' : ''}`,
      'data-tool': name, 'data-badge': (t.key || '').toUpperCase(),
      onclick: () => { setTool(name); refreshUI(); }
    }, icon(t.icon)));
  }
}

/* ══════════════════════════ TOOL OPTIONS BAR ═════════════════════════ */

export function buildToolbar() {
  const bar = clear(document.getElementById('toolbar'));
  const t = App.tool; if (!t) return;
  bar.appendChild(h('span', { class: 'tool-name' }, t.title));
  const opts = t.options ? t.options() : [];
  for (const o of opts) {
    if (o.hidden) continue;
    bar.appendChild(renderOption(o));
  }
}

function renderOption(o) {
  switch (o.type) {
    case 'sep': return h('div', { class: 'sep' });
    case 'label': return h('span', { class: 'tiny', style: { padding: '0 6px' } }, o.text);
    case 'button':
      return h('button', {
        class: 'btn', title: o.title || o.label, disabled: o.disabled,
        onclick: () => { o.cmd ? runCmd(o.cmd) : o.fn && o.fn(); redraw(); refreshUI(); }
      }, o.icon ? icon(o.icon) : o.label);
    case 'toggle': {
      const on = o.get ? o.get() : o.value;
      return h('button', {
        class: 'btn' + (on ? ' on' : ''), title: o.title || o.label,
        onclick: () => { o.set(!on); buildToolbar(); redraw(); }
      }, o.icon ? icon(o.icon) : o.label);
    }
    case 'number':
      return h('label', { class: 'field' },
        o.label ? h('span', o.label) : null,
        h('input', {
          type: 'number', value: Number.isFinite(o.value) ? round(o.value, 4) : o.value ?? '',
          step: o.step ?? 1, min: o.min, max: o.max, disabled: o.disabled,
          style: { width: '68px' },
          onchange: e => { o.set(parseFloat(e.target.value)); buildToolbar(); redraw(); }
        }));
    case 'select':
      return h('label', { class: 'field' },
        o.label ? h('span', o.label) : null,
        h('select', {
          style: o.wide ? { minWidth: '130px' } : null,
          onchange: e => { o.set(e.target.value); buildToolbar(); redraw(); }
        }, o.options.map(([v, l]) => h('option', { value: v, selected: String(o.value) === String(v) }, l))));
    case 'radio':
      return h('div', { class: 'field' }, o.options.map(([v, ic, title]) =>
        h('button', {
          class: 'btn' + (String(o.value) === String(v) ? ' on' : ''), title: title || v,
          onclick: () => { o.set(v); buildToolbar(); redraw(); }
        }, ic && (typeof ic === 'string') ? icon(ic) : v)));
    case 'xywh': return xywhFields();
    default: return h('span');
  }
}

function xywhFields() {
  const b = selBBox();
  const mk = (label, val, fn) => h('label', { class: 'field' }, h('span', label),
    h('input', {
      type: 'number', step: 1, value: b ? round(val, 3) : '', disabled: !b, style: { width: '72px' },
      onchange: e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { fn(v); commit('Set position'); redraw(); buildToolbar(); } }
    }));
  return h('div', { class: 'field' },
    mk('X', b?.x, v => App.sel.forEach(n => applyMatrix(n, T(v - b.x, 0)))),
    mk('Y', b?.y, v => App.sel.forEach(n => applyMatrix(n, T(0, v - b.y)))),
    mk('W', b?.w, v => { const k = v / (b.w || 1); App.sel.forEach(n => applyMatrix(n, mmul(T(b.x, 0), mmul(S(k, 1), T(-b.x, 0))))); }),
    mk('H', b?.h, v => { const k = v / (b.h || 1); App.sel.forEach(n => applyMatrix(n, mmul(T(0, b.y), mmul(S(1, k), T(0, -b.y))))); }));
}

/* ══════════════════════════ SNAP BAR ═════════════════════════════════ */

const SNAP_ITEMS = [
  ['bbox', 'select-all', 'Snap bounding boxes'],
  ['node', 'node', 'Snap nodes and paths'],
  ['center', 'node-sym', 'Snap centres and midpoints'],
  ['grid', 'grid', 'Snap to grid'],
  ['guide', 'align', 'Snap to guides'],
  ['page', 'page', 'Snap to page border']
];

function buildSnapBar() {
  const bar = clear(document.getElementById('snapbar'));
  bar.appendChild(h('button', {
    class: 'snap-btn' + (App.prefs.snapEnabled ? ' on' : ''), title: 'Enable snapping (%)',
    onclick: () => { App.prefs.snapEnabled = !App.prefs.snapEnabled; refreshUI(); }
  }, icon('snap')));
  for (const [k, ic, title] of SNAP_ITEMS) {
    bar.appendChild(h('button', {
      class: 'snap-btn' + (App.snap[k] ? ' on' : ''), title,
      onclick: () => { App.snap[k] = !App.snap[k]; refreshUI(); }
    }, icon(ic)));
  }
}

/* ══════════════════════════ PALETTE ══════════════════════════════════ */

const PALETTES = {
  'Inkscape default': (() => {
    const out = ['none'];
    for (let i = 0; i <= 15; i++) { const v = Math.round(i * 255 / 15); out.push(`#${v.toString(16).padStart(2, '0').repeat(3)}`); }
    const hues = 24;
    for (const [s, l] of [[1, .35], [1, .5], [1, .65], [.55, .5], [.3, .55]]) {
      for (let i = 0; i < hues; i++) out.push(hslHex(i / hues, s, l));
    }
    return out;
  })(),
  'Material': ['none', '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
    '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
    '#795548', '#9e9e9e', '#607d8b', '#000000', '#ffffff'],
  'Solarized': ['none', '#002b36', '#073642', '#586e75', '#657b83', '#839496', '#93a1a1', '#eee8d5', '#fdf6e3',
    '#b58900', '#cb4b16', '#dc322f', '#d33682', '#6c71c4', '#268bd2', '#2aa198', '#859900'],
  'Grayscale': (() => { const o = ['none']; for (let i = 0; i <= 32; i++) { const v = Math.round(i * 255 / 32); o.push(`#${v.toString(16).padStart(2, '0').repeat(3)}`); } return o; })()
};
function hslHex(hh, s, l) {
  const f = n => {
    const k = (n + hh * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function buildPalette() {
  const sel = document.getElementById('palette-pick');
  if (!sel.children.length) {
    Object.keys(PALETTES).forEach(k => sel.appendChild(h('option', { value: k }, k)));
    sel.addEventListener('change', buildPalette);
  }
  const pal = clear(document.getElementById('palette'));
  for (const c of PALETTES[sel.value] || PALETTES['Inkscape default']) {
    pal.appendChild(h('div', {
      class: 'pal-sw' + (c === 'none' ? ' none' : ''),
      style: c === 'none' ? null : { background: c },
      title: c === 'none' ? 'No paint' : c,
      onclick: e => applyPaletteColor(c, e.shiftKey),
      oncontextmenu: e => { e.preventDefault(); applyPaletteColor(c, true); }
    }));
  }
}

function applyPaletteColor(color, toStroke) {
  const key = toStroke ? 'stroke' : 'fill';
  if (App.toolName === 'gradient' && App.gradStop && App.doc.contains(App.gradStop.node) && color !== 'none') {
    const st = App.gradStop.node;
    const cur = st.getAttribute('style') || '';
    st.setAttribute('style', cur.replace(/stop-color\s*:[^;]*/, `stop-color:${color}`) || `stop-color:${color};stop-opacity:1`);
    if (!/stop-color/.test(st.getAttribute('style'))) st.setAttribute('style', `stop-color:${color};stop-opacity:1`);
    commit('Change stop colour'); redraw(); refreshPanels();
    return;
  }
  App.style[key] = color;
  if (color !== 'none' && !App.style[key + '-opacity']) App.style[key + '-opacity'] = 1;
  App.sel.forEach(n => setStyle(n, { [key]: color }));
  if (App.sel.length) commit(toStroke ? 'Set stroke' : 'Set fill');
  bus.emit('style'); redraw(); refreshPanels();
}

/* ══════════════════════════ STATUS BAR ═══════════════════════════════ */

function buildStatus() {
  const layerSel = document.getElementById('layer-select');
  layerSel.onchange = () => {
    const l = layers().find(x => x.id === layerSel.value);
    if (l) { setCurrentLayer(l); refreshUI(); }
  };
  document.getElementById('layer-vis').onclick = () => {
    const l = currentLayer();
    const hidden = /display\s*:\s*none/.test(l.getAttribute('style') || '');
    setStyle(l, { display: hidden ? 'inline' : 'none' });
    commit('Toggle layer'); refreshUI();
  };
  document.getElementById('layer-lock').onclick = () => {
    const l = currentLayer();
    l.getAttribute('sodipodi:insensitive') === 'true' ? l.removeAttribute('sodipodi:insensitive') : l.setAttribute('sodipodi:insensitive', 'true');
    commit('Toggle layer lock'); refreshUI();
  };
  const zi = document.getElementById('zoom-input');
  zi.onchange = () => { const v = parseFloat(zi.value); if (Number.isFinite(v)) setZoom(v / 100); };
  document.getElementById('si-fill').onclick = () => openPanel('fill');
  document.getElementById('si-stroke').onclick = () => openPanel('fill');
  const op = document.getElementById('si-opacity');
  op.oninput = () => App.sel.forEach(n => setStyle(n, { opacity: round(op.value / 100, 3) }));
  op.onchange = () => { if (App.sel.length) commit('Opacity'); };
}

function refreshStatus() {
  const sel = App.sel;
  const fillSw = document.getElementById('si-fill'), strokeSw = document.getElementById('si-stroke');
  const paint = k => sel.length ? getStyle(sel[0], k, 'none') : App.style[k];
  const setSw = (node, v) => {
    clear(node);
    const i = h('i');
    if (!v || v === 'none') i.style.background = 'linear-gradient(45deg,transparent 44%,#e05252 44% 56%,transparent 56%)';
    else if (/^url/.test(v)) i.style.background = 'linear-gradient(90deg,#888,#fff)';
    else i.style.background = v;
    node.appendChild(i);
  };
  setSw(fillSw, paint('fill')); setSw(strokeSw, paint('stroke'));
  document.getElementById('si-width').textContent = round(num(sel.length ? getStyle(sel[0], 'stroke-width', 0) : App.style['stroke-width'], 0), 2);
  document.getElementById('si-opacity').value = Math.round(num(sel.length ? getStyle(sel[0], 'opacity', 1) : 1, 1) * 100);

  const layerSel = document.getElementById('layer-select');
  const cur = currentLayer();
  clear(layerSel);
  for (const l of layers().slice().reverse()) layerSel.appendChild(h('option', { value: l.id, selected: l === cur }, layerName(l)));
  const hidden = /display\s*:\s*none/.test(cur.getAttribute('style') || '');
  clear(document.getElementById('layer-vis')).appendChild(icon(hidden ? 'eye-off' : 'eye'));
  const locked = cur.getAttribute('sodipodi:insensitive') === 'true';
  clear(document.getElementById('layer-lock')).appendChild(icon(locked ? 'lock' : 'unlock'));

  document.getElementById('zoom-input').value = round(View.zoom * 100, 1);
  document.getElementById('doctitle').textContent = App.filename;
  document.getElementById('dirty').hidden = !App.dirty;

  const hs = historyState();
  const ub = document.querySelector('#commandbar [data-cmd="edit.undo"]');
  const rb = document.querySelector('#commandbar [data-cmd="edit.redo"]');
  if (ub) ub.disabled = !hs.canUndo;
  if (rb) rb.disabled = !hs.canRedo;
}

/* status messages */
let statusTimer = 0;
bus.on('status', msg => {
  const n = document.getElementById('status-msg');
  if (n) n.textContent = msg;
});
bus.on('toast', m => toast(m));
bus.on('panel', p => { openPanel(p); refreshUI(); });
bus.on('coords', p => {
  const u = App.prefs.unit;
  const f = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16 }[u] || 1;
  const x = document.getElementById('coord-x'), y = document.getElementById('coord-y');
  if (x) x.textContent = round(p.x / f, 2);
  if (y) y.textContent = round(p.y / f, 2);
  App.lastPointer = [p.x, p.y];
});

/* selection summary */
bus.on('selection', () => {
  const n = App.sel.length;
  let msg;
  if (!n) msg = App.tool?.hint || 'No objects selected. Click to select.';
  else if (n === 1) {
    const o = App.sel[0];
    const b = bboxOf(o);
    msg = `${o.tagName}${o.id ? ' #' + o.id : ''} in layer ${layerName(currentLayer())}` +
      (b ? `  —  ${round(b.w, 2)} × ${round(b.h, 2)}` : '');
  } else msg = `${n} objects selected`;
  bus.emit('status', msg);
});

/* ══════════════════════════ SHORTCUTS ════════════════════════════════ */

const ALIASES = {
  'Ctrl+=': 'Ctrl++', 'Ctrl+Add': 'Ctrl++', 'Ctrl+Subtract': 'Ctrl+-',
  'Ctrl+Multiply': 'Ctrl+*', '=': '+', 'Add': '+', 'Subtract': '-',
  'Ctrl+Y': 'Ctrl+Shift+Z', 'F1': 'S', 'F2': 'N', 'F4': 'R', 'F5': 'E',
  'PageUp': 'Page_Up', 'PageDown': 'Page_Down',
  'Ctrl+PageUp': 'Ctrl+Shift+Page_Up', 'Ctrl+PageDown': 'Ctrl+Shift+Page_Down'
};

function keyString(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  if (k === ' ') k = 'Space';
  else if (k === 'PageUp') k = 'Page_Up';
  else if (k === 'PageDown') k = 'Page_Down';
  else if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join('+');
}

let SHORTCUTS = {};
function buildShortcuts() {
  SHORTCUTS = {};
  for (const name in CMD) {
    const k = CMD[name].key;
    if (k) SHORTCUTS[k] = name;
  }
}

function onKey(e) {
  if (isTyping(e)) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (App.tool && App.tool.keydown && App.tool.keydown(e)) { e.preventDefault(); redraw(); refreshUI(); return; }

  let ks = keyString(e);
  if (ALIASES[ks]) ks = ALIASES[ks];
  let name = SHORTCUTS[ks];
  // symbols typed with Shift (!, *, #, %, |) come through without needing the modifier
  if (!name && e.shiftKey) name = SHORTCUTS[ks.replace('Shift+', '')];
  if (name) { e.preventDefault(); runCmd(name); redraw(); refreshUI(); return; }

  // selector nudging
  if (App.toolName === 'select' && App.sel.length) {
    const step = e.shiftKey ? App.prefs.moveStep * 10 : App.prefs.moveStep;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      App.sel.forEach(n => applyMatrix(n, T(d[0], d[1])));
      commit('Nudge'); redraw(); return;
    }
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      const b = selBBox(); if (!b) return;
      const ang = (e.key === '[' ? -1 : 1) * App.prefs.rotStep;
      App.sel.forEach(n => applyMatrix(n, { a: Math.cos(ang * Math.PI / 180), b: Math.sin(ang * Math.PI / 180), c: -Math.sin(ang * Math.PI / 180), d: Math.cos(ang * Math.PI / 180), e: b.cx - Math.cos(ang * Math.PI / 180) * b.cx + Math.sin(ang * Math.PI / 180) * b.cy, f: b.cy - Math.sin(ang * Math.PI / 180) * b.cx - Math.cos(ang * Math.PI / 180) * b.cy }));
      commit('Rotate'); redraw(); return;
    }
  }
  if (e.key === 'Tab' && App.toolName === 'select') {
    e.preventDefault();
    const all = allObjects(App.doc);
    if (!all.length) return;
    const i = all.indexOf(App.sel[0]);
    const next = all[(i + (e.shiftKey ? -1 : 1) + all.length + 1) % all.length];
    select([next]); redraw();
  }
}

/* ══════════════════════════ CONTEXT MENU ═════════════════════════════ */

bus.on('contextmenu', e => {
  closeMenu();
  const items = App.sel.length
    ? ['edit.cut', 'edit.copy', 'edit.duplicate', 'edit.delete', S_, 'object.group', 'object.ungroup',
       S_, 'object.raiseTop', 'object.lowerBottom', S_, 'path.objectToPath', { cmd: 'panel.fill', label: 'Fill and Stroke…', icon: 'fill' }]
    : ['edit.paste', 'edit.selectAll', S_, 'view.zoomPage', 'view.zoomDrawing', S_, { cmd: 'panel.document', label: 'Document Properties…', icon: 'docprops' }];
  const dd = buildDropdown(items);
  dd.style.left = Math.min(e.clientX, innerWidth - 250) + 'px';
  dd.style.top = Math.min(e.clientY, innerHeight - 320) + 'px';
  document.body.appendChild(dd);
  openMenu = { title: '__ctx', el: dd, btn: document.body };
});

/* ══════════════════════════ MODALS ═══════════════════════════════════ */

bus.on('modal', which => {
  if (which === 'about') {
    modal({
      title: 'About InkWeb',
      body: h('div',
        h('p', h('b', 'InkWeb'), ' — a vector graphics editor that runs entirely in your browser, modelled on Inkscape.'),
        h('p', 'Everything happens on your device: no upload, no server, no account. Documents are plain SVG and stay compatible with Inkscape (layers, live shapes and guides round-trip).'),
        h('p', { class: 'tiny' }, 'Touch: one finger draws, two fingers pan and pinch-zoom. On phones the toolbox sits below the canvas and dialogs slide in from the right.'),
        h('p', { class: 'tiny' }, 'Not supported in-browser: converting text to paths (needs the font binary) and SVG 2 mesh gradients (no browser renders them).')),
      buttons: [{ label: 'Close', primary: true }]
    });
  } else if (which === 'keys') {
    const rows = Object.entries(SHORTCUTS).map(([k, n]) =>
      h('tr', h('td', { style: { fontFamily: 'var(--mono)', paddingRight: '14px', whiteSpace: 'nowrap' } }, k.replace('Ctrl', ctrlLabel())),
        h('td', CMD[n]?.label || n)));
    modal({
      title: 'Keyboard Shortcuts',
      body: h('div', h('table', { style: { width: '100%', fontSize: '12px' } }, rows),
        h('p', { class: 'tiny', style: { marginTop: '12px' } },
          'Also: Space + drag or middle-drag pans · wheel scrolls · Ctrl+wheel zooms · Ctrl constrains · Shift adds to the selection · Alt clicks through.')),
      buttons: [{ label: 'Close', primary: true }]
    });
  }
});

/* ══════════════════════════ BOOTSTRAP ════════════════════════════════ */

const PANEL_KEYS = {
  fill: 'Ctrl+Shift+F', xml: 'Ctrl+Shift+X', layers: 'Ctrl+Shift+L', objects: 'Ctrl+Shift+O',
  align: 'Ctrl+Shift+A', transform: 'Ctrl+Shift+M', text: 'Ctrl+Shift+T', history: 'Ctrl+Shift+H',
  document: null, filters: null, trace: null, export: null
};
function registerPanelCommands() {
  for (const name in PANELS) {
    const p = PANELS[name];
    CMD['panel.' + name] = {
      name: 'panel.' + name, label: p.title + '…', icon: p.icon,
      key: PANEL_KEYS[name] || null, fn: () => { togglePanel(name); refreshUI(); }
    };
  }
}

export function buildUI() {
  registerToolCommands();
  registerPanelCommands();
  buildShortcuts();
  buildMenus();
  buildCommandBar();
  buildToolbox();
  buildSnapBar();
  buildPalette();
  buildStatus();
  buildToolbar();
  refreshStatus();

  document.getElementById('menu-burger').onclick = mobileMenu;
  document.querySelectorAll('[data-cmd]').forEach(b => {
    if (b.closest('#commandbar')) return;
    b.onclick = () => { runCmd(b.dataset.cmd); refreshUI(); };
  });
  document.querySelectorAll('[data-icon]').forEach(b => { if (!b.firstChild) b.appendChild(icon(b.dataset.icon)); });

  addEventListener('keydown', onKey);

  ['tool', 'selection', 'layers', 'objects', 'changed', 'history', 'style', 'ui', 'view', 'docreplaced']
    .forEach(ev => bus.on(ev, scheduleUI));
}

let uiRaf = 0;
function scheduleUI() { if (uiRaf) return; uiRaf = requestAnimationFrame(() => { uiRaf = 0; refreshUI(); }); }

export function refreshUI() {
  buildToolbox();
  buildToolbar();
  buildSnapBar();
  refreshStatus();
  document.querySelectorAll('#commandbar [data-panel]').forEach(b =>
    b.classList.toggle('on', isPanelOpen(b.dataset.panel)));
}
