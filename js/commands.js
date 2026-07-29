/* ==========================================================================
   commands.js — every menu / shortcut command
   ========================================================================== */

import {
  App, bus, el, commit, undo, redo, select, clearSel, selectAll, selectAllLayers,
  invertSelection, duplicate, cloneLinked, unlinkClone, removeNodes, group, ungroup,
  raise, lower, raiseTop, lowerBottom, cmpDoc, addLayer, layers, currentLayer,
  setCurrentLayer, layerName, isLayer, layerOf, allObjects, uid, ensureId, reId,
  applyMatrix, bboxOf, selBBox, toPath, shapeToD, segsOf, setSegsUser, defs,
  getStyle, setStyle, parseStyleAttr, styleAttrStr, rebuildShape, docSize, setDocSize,
  isHidden, isLocked, ctmOf, addObject
} from './doc.js';
import {
  View, zoomPage, zoomDrawing, zoomSelection, zoomWidth, setZoom, zoomBy, update,
  drawGuides, saveGuides, loadGuides, drawingBBox
} from './view.js';
import { setTool, TOOLS, redraw } from './tools.js';
import {
  segsToRings, ringsToSegs, boolOp, offsetRings, strokeOutline, simplifySegs, flattenSegs
} from './bool.js';
import {
  normalize, segsToD, toSubpaths, transformSegs, minv, mmul, T, R, S, round, num,
  clamp, box, boxUnion, mapply, parseTransform, mstr, flatten, polysToSegs, rdp, polyToCurves
} from './geom.js';
import { textOf, setTextContent, reflow } from './tools-text.js';

export const CMD = {};
const def = (name, label, fn, extra = {}) => { CMD[name] = { name, label, fn, ...extra }; };
export function runCmd(name, arg) {
  const c = CMD[name];
  if (!c) { console.warn('unknown command', name); return; }
  try { c.fn(arg); } catch (e) { console.error(name, e); bus.emit('toast', 'Command failed: ' + e.message); }
}
const toast = m => bus.emit('toast', m);
const need = (n = 1) => { if (App.sel.length < n) { toast(n === 1 ? 'Nothing selected' : `Select at least ${n} objects`); return false; } return true; };

/* ══════════════════════════ FILE ═════════════════════════════════════ */
/* (file.* handlers are installed by io.js) */

/* ══════════════════════════ EDIT ═════════════════════════════════════ */

def('edit.undo', 'Undo', () => { if (!undo()) toast('Nothing to undo'); redraw(); }, { key: 'Ctrl+Z', icon: 'undo' });
def('edit.redo', 'Redo', () => { if (!redo()) toast('Nothing to redo'); redraw(); }, { key: 'Ctrl+Shift+Z', icon: 'redo' });

def('edit.cut', 'Cut', () => { if (!need()) return; runCmd('edit.copy'); removeNodes(App.sel.slice()); commit('Cut'); }, { key: 'Ctrl+X', icon: 'cut' });
def('edit.copy', 'Copy', () => {
  if (!need()) return;
  App.clipboard = App.sel.slice().sort(cmpDoc).map(n => ({ xml: n.outerHTML, ctm: ctmOf(n), bbox: bboxOf(n) }));
  const svg = App.sel.map(n => n.outerHTML).join('\n');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(svg).catch(() => { });
  toast(`${App.sel.length} object(s) copied`);
}, { key: 'Ctrl+C', icon: 'copy' });

function pasteInto(dx, dy) {
  if (!App.clipboard.length) { toast('Clipboard is empty'); return; }
  const made = [];
  const target = App.context || currentLayer();
  for (const item of App.clipboard) {
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tmp.innerHTML = item.xml;
    for (const c of [...tmp.children]) {
      reId(c);
      target.appendChild(c);
      const want = mmul(T(dx, dy), item.ctm);
      const local = mmul(minv(ctmOf(target)), want);
      const s = mstr(local);
      if (s) c.setAttribute('transform', s); else c.removeAttribute('transform');
      made.push(c);
    }
  }
  select(made); commit('Paste'); bus.emit('objects');
}
def('edit.paste', 'Paste', () => {
  const b = App.clipboard[0]?.bbox;
  let dx = 0, dy = 0;
  if (b && App.lastPointer) { dx = App.lastPointer[0] - b.cx; dy = App.lastPointer[1] - b.cy; }
  else { dx = 20; dy = 20; }
  pasteInto(dx, dy);
}, { key: 'Ctrl+V', icon: 'paste' });
def('edit.pasteInPlace', 'Paste in Place', () => pasteInto(0, 0), { key: 'Ctrl+Alt+V' });
def('edit.pasteStyle', 'Paste Style', () => {
  if (!need() || !App.clipboard.length) return;
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  tmp.innerHTML = App.clipboard[0].xml;
  const src = tmp.firstElementChild; if (!src) return;
  const st = parseStyleAttr(src.getAttribute('style'));
  App.sel.forEach(n => setStyle(n, st));
  commit('Paste style');
}, { key: 'Ctrl+Shift+V' });

def('edit.delete', 'Delete', () => { if (!need()) return; removeNodes(App.sel.slice()); commit('Delete'); }, { key: 'Delete', icon: 'delete' });
def('edit.duplicate', 'Duplicate', () => { if (!need()) return; duplicate(); commit('Duplicate'); }, { key: 'Ctrl+D', icon: 'dup' });
def('edit.clone', 'Create Clone', () => { if (!need()) return; cloneLinked(); commit('Clone'); }, { key: 'Alt+D' });
def('edit.unlinkClone', 'Unlink Clone', () => { if (!need()) return; unlinkClone(); commit('Unlink clone'); }, { key: 'Alt+Shift+D' });
def('edit.selectAll', 'Select All', () => { selectAll(); redraw(); }, { key: 'Ctrl+A', icon: 'select-all' });
def('edit.selectAllLayers', 'Select All in All Layers', () => { selectAllLayers(); redraw(); }, { key: 'Ctrl+Alt+A' });
def('edit.invert', 'Invert Selection', () => { invertSelection(); redraw(); }, { key: '!' });
def('edit.deselect', 'Deselect', () => { clearSel(); redraw(); }, { key: 'Escape', icon: 'deselect' });

/* ══════════════════════════ VIEW ═════════════════════════════════════ */

def('view.zoomIn', 'Zoom In', () => zoomBy(1.4), { key: '+' });
def('view.zoomOut', 'Zoom Out', () => zoomBy(1 / 1.4), { key: '-' });
def('view.zoom1', 'Zoom 1:1', () => setZoom(1), { key: '1', icon: 'zoom-1' });
def('view.zoom2', 'Zoom 1:2', () => setZoom(.5), { key: '2' });
def('view.zoomPage', 'Fit Page in Window', () => zoomPage(), { key: '5', icon: 'zoom-page' });
def('view.zoomWidth', 'Fit Page Width', () => zoomWidth(), { key: 'Ctrl+E' });
def('view.zoomDrawing', 'Fit Drawing in Window', () => zoomDrawing(), { key: '4', icon: 'zoom-draw' });
def('view.zoomSelection', 'Zoom to Selection', () => zoomSelection(), { key: '3', icon: 'zoom-sel' });
def('view.grid', 'Show Grid', () => { App.prefs.gridVisible = !App.prefs.gridVisible; update(); bus.emit('ui'); }, { key: '#', icon: 'grid', checked: () => App.prefs.gridVisible });
def('view.guides', 'Show Guides', () => { App.prefs.guidesVisible = !App.prefs.guidesVisible; drawGuides(); bus.emit('ui'); }, { key: '|', checked: () => App.prefs.guidesVisible });
def('view.rulers', 'Show Rulers', () => {
  App.prefs.rulers = !App.prefs.rulers;
  document.documentElement.dataset.rulers = App.prefs.rulers ? 'on' : 'off';
  update(); bus.emit('ui');
}, { key: 'Ctrl+R', checked: () => App.prefs.rulers });
def('view.snap', 'Enable Snapping', () => { App.prefs.snapEnabled = !App.prefs.snapEnabled; bus.emit('ui'); }, { key: '%', icon: 'snap', checked: () => App.prefs.snapEnabled });
def('view.deleteGuides', 'Delete All Guides', () => { App.guides = []; saveGuides(); drawGuides(); commit('Delete guides'); });
def('view.theme', 'Toggle Dark / Light Theme', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next; App.prefs.theme = next;
  localStorage.setItem('inkweb.theme', next); update();
});
def('view.fullscreen', 'Full Screen', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => toast('Full screen unavailable'));
}, { key: 'F11' });

/* ══════════════════════════ LAYERS ═══════════════════════════════════ */

def('layer.add', 'Add Layer…', () => {
  const name = prompt('Layer name:', 'Layer ' + (layers().length + 1));
  if (name === null) return;
  const g = addLayer(name || 'Layer', currentLayer(), 'above');
  setCurrentLayer(g); commit('Add layer');
}, { key: 'Ctrl+Shift+N' });
def('layer.duplicate', 'Duplicate Current Layer', () => {
  const l = currentLayer(); const c = l.cloneNode(true);
  reId(c); c.setAttribute('inkscape:label', layerName(l) + ' copy'); c.classList.remove('current');
  l.after(c); setCurrentLayer(c); commit('Duplicate layer');
});
def('layer.delete', 'Delete Current Layer', () => {
  const l = currentLayer();
  if (layers().length < 2) { toast('Cannot delete the only layer'); return; }
  const next = l.nextElementSibling || l.previousElementSibling;
  l.remove(); setCurrentLayer(next); clearSel(); commit('Delete layer');
});
def('layer.rename', 'Rename Layer…', () => {
  const l = currentLayer();
  const n = prompt('Layer name:', layerName(l));
  if (n === null) return;
  l.setAttribute('inkscape:label', n); bus.emit('layers'); commit('Rename layer');
});
def('layer.up', 'Raise Layer', () => { const l = currentLayer(); const n = l.nextElementSibling; if (n && isLayer(n)) { n.after(l); bus.emit('layers'); commit('Raise layer'); } }, { key: 'Ctrl+Shift+Page_Up' });
def('layer.down', 'Lower Layer', () => { const l = currentLayer(); const p = l.previousElementSibling; if (p && isLayer(p)) { p.before(l); bus.emit('layers'); commit('Lower layer'); } });
def('layer.moveSelUp', 'Move Selection to Layer Above', () => moveSelToLayer(1), { key: 'Ctrl+Shift+Page_Up' });
def('layer.moveSelDown', 'Move Selection to Layer Below', () => moveSelToLayer(-1), { key: 'Ctrl+Shift+Page_Down' });
function moveSelToLayer(dir) {
  if (!need()) return;
  const ls = layers(), i = ls.indexOf(layerOf(App.sel[0]) || currentLayer());
  const t = ls[i + dir];
  if (!t) { toast('No layer in that direction'); return; }
  moveToLayer(t); commit('Move to layer');
}
export function moveToLayer(target) {
  for (const n of App.sel.slice().sort(cmpDoc)) {
    const want = ctmOf(n);
    target.appendChild(n);
    const local = mmul(minv(ctmOf(target)), want);
    const s = mstr(local); if (s) n.setAttribute('transform', s); else n.removeAttribute('transform');
  }
  bus.emit('objects');
}
def('layer.showAll', 'Show All Layers', () => { layers().forEach(l => setStyle(l, { display: 'inline' })); bus.emit('layers'); commit('Show layers'); });
def('layer.hideOthers', 'Hide Other Layers', () => { const c = currentLayer(); layers().forEach(l => setStyle(l, { display: l === c ? 'inline' : 'none' })); bus.emit('layers'); commit('Hide layers'); });
def('layer.lockOthers', 'Lock Other Layers', () => { const c = currentLayer(); layers().forEach(l => l === c ? l.removeAttribute('sodipodi:insensitive') : l.setAttribute('sodipodi:insensitive', 'true')); bus.emit('layers'); commit('Lock layers'); });
def('layer.unlockAll', 'Unlock All Layers', () => { layers().forEach(l => l.removeAttribute('sodipodi:insensitive')); bus.emit('layers'); commit('Unlock layers'); });

/* ══════════════════════════ OBJECT ═══════════════════════════════════ */

def('object.group', 'Group', () => { if (!need(1)) return; group(); commit('Group'); }, { key: 'Ctrl+G', icon: 'group' });
def('object.ungroup', 'Ungroup', () => { if (!need()) return; ungroup(); commit('Ungroup'); }, { key: 'Ctrl+Shift+G', icon: 'ungroup' });
def('object.raise', 'Raise', () => { if (!need()) return; raise(); commit('Raise'); }, { key: 'Page_Up', icon: 'raise' });
def('object.lower', 'Lower', () => { if (!need()) return; lower(); commit('Lower'); }, { key: 'Page_Down', icon: 'lower' });
def('object.raiseTop', 'Raise to Top', () => { if (!need()) return; raiseTop(); commit('Raise to top'); }, { key: 'Home', icon: 'top' });
def('object.lowerBottom', 'Lower to Bottom', () => { if (!need()) return; lowerBottom(); commit('Lower to bottom'); }, { key: 'End', icon: 'bottom' });

const withBBox = fn => { if (!need()) return; const b = selBBox(); if (!b) return; fn(b); };
def('object.flipH', 'Flip Horizontal', () => withBBox(b => { App.sel.forEach(n => applyMatrix(n, mmul(T(b.cx, 0), mmul(S(-1, 1), T(-b.cx, 0))))); commit('Flip horizontal'); redraw(); }), { key: 'H', icon: 'flip-h' });
def('object.flipV', 'Flip Vertical', () => withBBox(b => { App.sel.forEach(n => applyMatrix(n, mmul(T(0, b.cy), mmul(S(1, -1), T(0, -b.cy))))); commit('Flip vertical'); redraw(); }), { key: 'V', icon: 'flip-v' });
def('object.rot90cw', 'Rotate 90° CW', () => withBBox(b => { App.sel.forEach(n => applyMatrix(n, R(90, b.cx, b.cy))); commit('Rotate 90° CW'); redraw(); }), { icon: 'rot-cw' });
def('object.rot90ccw', 'Rotate 90° CCW', () => withBBox(b => { App.sel.forEach(n => applyMatrix(n, R(-90, b.cx, b.cy))); commit('Rotate 90° CCW'); redraw(); }), { icon: 'rot-ccw' });

def('object.clipSet', 'Clip ▸ Set Clip', () => {
  if (!need(2)) return;
  const sorted = App.sel.slice().sort(cmpDoc);
  const clipper = sorted.pop();
  const cp = el('clipPath', { id: uid('clip'), clipPathUnits: 'userSpaceOnUse' }, defs());
  const want = ctmOf(clipper);
  cp.appendChild(clipper);
  const s = mstr(want); if (s) clipper.setAttribute('transform', s); else clipper.removeAttribute('transform');
  sorted.forEach(n => {
    const wrap = el('g', { id: uid('clipg'), 'clip-path': `url(#${cp.id})` });
    n.before(wrap); wrap.appendChild(n);
  });
  select(sorted.map(n => n.parentNode)); commit('Set clip');
});
def('object.clipRelease', 'Clip ▸ Release Clip', () => {
  if (!need()) return;
  const out = [];
  App.sel.forEach(n => {
    const holder = n.getAttribute('clip-path') ? n : n.closest('[clip-path]');
    if (!holder) return;
    const m = /url\(["']?#([^)"']+)/.exec(holder.getAttribute('clip-path'));
    holder.removeAttribute('clip-path');
    const cp = m && App.doc.querySelector(`#${CSS.escape(m[1])}`);
    if (cp) { [...cp.children].forEach(c => { holder.after(c); out.push(c); }); cp.remove(); }
    out.push(holder);
  });
  select(out); commit('Release clip');
});
def('object.maskSet', 'Mask ▸ Set Mask', () => {
  if (!need(2)) return;
  const sorted = App.sel.slice().sort(cmpDoc);
  const masker = sorted.pop();
  const mk = el('mask', { id: uid('mask'), maskUnits: 'userSpaceOnUse' }, defs());
  const want = ctmOf(masker);
  mk.appendChild(masker);
  const s = mstr(want); if (s) masker.setAttribute('transform', s); else masker.removeAttribute('transform');
  sorted.forEach(n => { const wrap = el('g', { id: uid('maskg'), mask: `url(#${mk.id})` }); n.before(wrap); wrap.appendChild(n); });
  select(sorted.map(n => n.parentNode)); commit('Set mask');
});
def('object.maskRelease', 'Mask ▸ Release Mask', () => {
  if (!need()) return;
  const out = [];
  App.sel.forEach(n => {
    const holder = n.getAttribute('mask') ? n : n.closest('[mask]');
    if (!holder) return;
    const m = /url\(["']?#([^)"']+)/.exec(holder.getAttribute('mask'));
    holder.removeAttribute('mask');
    const mk = m && App.doc.querySelector(`#${CSS.escape(m[1])}`);
    if (mk) { [...mk.children].forEach(c => { holder.after(c); out.push(c); }); mk.remove(); }
    out.push(holder);
  });
  select(out); commit('Release mask');
});

def('object.hide', 'Hide Selection', () => { if (!need()) return; App.sel.forEach(n => setStyle(n, { display: 'none' })); commit('Hide'); bus.emit('objects'); });
def('object.unhideAll', 'Unhide All', () => { allObjects(App.doc).forEach(n => setStyle(n, { display: null })); layers().forEach(l => setStyle(l, { display: 'inline' })); commit('Unhide all'); bus.emit('objects'); });
def('object.lock', 'Lock Selection', () => { if (!need()) return; App.sel.forEach(n => n.setAttribute('sodipodi:insensitive', 'true')); clearSel(); commit('Lock'); bus.emit('objects'); });
def('object.unlockAll', 'Unlock All', () => { App.doc.querySelectorAll('[sodipodi\\:insensitive]').forEach(n => n.removeAttribute('sodipodi:insensitive')); commit('Unlock all'); bus.emit('objects'); });

/* ══════════════════════════ PATH ═════════════════════════════════════ */

export function ensurePath(n) {
  if (n.tagName === 'text' || n.tagName === 'image' || n.tagName === 'use') return null;
  if (n.tagName === 'g') {
    const kids = [...n.children].map(ensurePath).filter(Boolean);
    return kids.length ? n : null;
  }
  return toPath(n);
}

def('path.objectToPath', 'Object to Path', () => {
  if (!need()) return;
  let skipped = 0;
  const out = [];
  for (const n of App.sel.slice()) {
    if (n.tagName === 'text') { skipped++; out.push(n); continue; }
    const p = ensurePath(n);
    out.push(p || n);
  }
  select(out.filter(Boolean));
  commit('Object to path');
  if (skipped) toast('Text kept as text — glyph outlining needs the font file (see README)');
}, { key: 'Ctrl+Shift+C', icon: 'to-path' });

def('path.strokeToPath', 'Stroke to Path', () => {
  if (!need()) return;
  const out = [];
  for (const n of App.sel.slice()) {
    const stroke = getStyle(n, 'stroke', 'none');
    if (stroke === 'none' || !stroke) { out.push(n); continue; }
    const segs = segsOf(n); if (!segs) { out.push(n); continue; }
    const w = num(getStyle(n, 'stroke-width', 1), 1) * scaleOf(n);
    const rings = strokeOutline(segs, w, getStyle(n, 'stroke-linecap', 'butt'), getStyle(n, 'stroke-linejoin', 'miter'));
    if (!rings.length) { out.push(n); continue; }
    const fill = getStyle(n, 'fill', 'none');
    const sp = el('path', { id: uid('stroke'), d: segsToD(ringsToSegs(rings)), 'fill-rule': 'evenodd' });
    setStyle(sp, { fill: stroke, stroke: 'none', 'fill-opacity': getStyle(n, 'stroke-opacity', 1) });
    if (fill && fill !== 'none') {
      const g = el('g', { id: uid('g') });
      n.before(g);
      const fp = toPath(n);
      setStyle(fp, { stroke: 'none' });
      g.appendChild(fp); g.appendChild(sp);
      out.push(g);
    } else { n.before(sp); n.remove(); out.push(sp); }
  }
  select(out); commit('Stroke to path');
}, { key: 'Ctrl+Alt+C' });

const scaleOf = n => { const m = ctmOf(n); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1; };

function doBool(op, label) {
  if (!need(2)) return;
  const sel = App.sel.slice().sort(cmpDoc);
  const base = sel[0];
  const items = sel.map(n => ({ n, rings: segsToRings(segsOf(n) || []) })).filter(i => i.rings.length);
  if (items.length < 2) { toast('These objects have no usable outlines'); return; }
  let acc = items[0].rings;
  for (let i = 1; i < items.length; i++) acc = boolOp(acc, items[i].rings, op);
  if (!acc.length) { removeNodes(sel); commit(label); return; }
  const p = toPath(base);
  setSegsUser(p, ringsToSegs(acc));
  p.setAttribute('fill-rule', 'evenodd');
  sel.slice(1).forEach(n => n.remove());
  select([p]); commit(label);
}
def('path.union', 'Union', () => doBool('union', 'Union'), { key: 'Ctrl++', icon: 'union' });
def('path.difference', 'Difference', () => doBool('difference', 'Difference'), { key: 'Ctrl+-', icon: 'difference' });
def('path.intersection', 'Intersection', () => doBool('intersection', 'Intersection'), { key: 'Ctrl+*', icon: 'intersection' });
def('path.exclusion', 'Exclusion', () => doBool('exclusion', 'Exclusion'), { key: 'Ctrl+^', icon: 'exclusion' });

def('path.division', 'Division', () => {
  if (!need(2)) return;
  const sel = App.sel.slice().sort(cmpDoc);
  const bottom = sel[0], top = sel[sel.length - 1];
  const A = segsToRings(segsOf(bottom) || []), B = segsToRings(segsOf(top) || []);
  if (!A.length || !B.length) { toast('Need two filled shapes'); return; }
  const outside = boolOp(A, B, 'difference');
  const inside = boolOp(A, B, 'intersection');
  const made = [];
  for (const rings of [outside, inside]) {
    if (!rings.length) continue;
    const p = bottom.cloneNode(true);
    reId(p);
    bottom.before(p);
    const path = toPath(p);
    setSegsUser(path, ringsToSegs(rings));
    path.setAttribute('fill-rule', 'evenodd');
    made.push(path);
  }
  bottom.remove(); top.remove();
  select(made); commit('Division');
}, { key: 'Ctrl+/', icon: 'division' });

def('path.cutPath', 'Cut Path', () => {
  if (!need(2)) return;
  const sel = App.sel.slice().sort(cmpDoc);
  const bottom = sel[0], top = sel[sel.length - 1];
  const A = segsToRings(segsOf(bottom) || []), B = segsToRings(segsOf(top) || []);
  if (!A.length || !B.length) { toast('Need two closed shapes'); return; }
  const inside = boolOp(A, B, 'intersection');
  const outside = boolOp(A, B, 'difference');
  const made = [];
  for (const rings of [outside, inside]) {
    if (!rings.length) continue;
    const p = bottom.cloneNode(true); reId(p); bottom.before(p);
    const path = toPath(p);
    setSegsUser(path, ringsToSegs(rings));
    setStyle(path, { fill: 'none', stroke: getStyle(bottom, 'stroke', '#000') === 'none' ? '#000000' : getStyle(bottom, 'stroke', '#000') });
    made.push(path);
  }
  bottom.remove(); top.remove();
  select(made); commit('Cut path');
}, { key: 'Ctrl+Alt+/', icon: 'cutpath' });

def('path.combine', 'Combine', () => {
  if (!need(2)) return;
  const sel = App.sel.slice().sort(cmpDoc);
  const base = toPath(sel[0]);
  let segs = segsOf(base) || [];
  for (let i = 1; i < sel.length; i++) {
    const s = segsOf(sel[i]);
    if (s) segs = segs.concat(s);
    sel[i].remove();
  }
  setSegsUser(base, segs);
  base.setAttribute('fill-rule', 'evenodd');
  select([base]); commit('Combine');
}, { key: 'Ctrl+K' });

def('path.breakApart', 'Break Apart', () => {
  if (!need()) return;
  const made = [];
  for (const n of App.sel.slice()) {
    const p = toPath(n);
    if (!p || p.tagName !== 'path') { made.push(n); continue; }
    const subs = toSubpaths(normalize(p.getAttribute('d')));
    if (subs.length < 2) { made.push(p); continue; }
    for (const sp of subs) {
      const c = p.cloneNode(false); reId(c);
      c.setAttribute('d', segsToD(sp.segs));
      p.before(c); made.push(c);
    }
    p.remove();
  }
  select(made); commit('Break apart');
}, { key: 'Ctrl+Shift+K' });

def('path.inset', 'Inset', () => offsetSel(-App.prefs.moveStep), { key: 'Ctrl+(' });
def('path.outset', 'Outset', () => offsetSel(App.prefs.moveStep), { key: 'Ctrl+)' });
def('path.insetBy', 'Inset / Outset by…', () => {
  const v = parseFloat(prompt('Offset amount (px, negative = inset):', '2'));
  if (Number.isFinite(v)) offsetSel(v);
});
function offsetSel(delta) {
  if (!need()) return;
  let done = 0;
  for (const n of App.sel.slice()) {
    const segs = segsOf(n); if (!segs) continue;
    const rings = offsetRings(segsToRings(segs), delta);
    if (!rings.length) continue;
    const p = toPath(n);
    setSegsUser(p, ringsToSegs(rings));
    p.setAttribute('fill-rule', 'evenodd');
    done++;
  }
  if (done) commit(delta < 0 ? 'Inset' : 'Outset');
  redraw();
}

def('path.simplify', 'Simplify', () => {
  if (!need()) return;
  let done = 0;
  for (const n of App.sel.slice()) {
    const segs = segsOf(n); if (!segs) continue;
    const p = toPath(n);
    setSegsUser(p, simplifySegs(segs, 2.2));
    done++;
  }
  if (done) commit('Simplify');
  redraw();
}, { key: 'Ctrl+L' });

def('path.reverse', 'Reverse', () => {
  if (!need()) return;
  for (const n of App.sel.slice()) {
    const p = toPath(n); if (!p || p.tagName !== 'path') continue;
    p.setAttribute('d', segsToD(reverseSegs(normalize(p.getAttribute('d')))));
  }
  commit('Reverse'); redraw();
}, { key: 'Shift+R' });

export function reverseSegs(segs) {
  const out = [];
  for (const sp of toSubpaths(segs)) {
    const pts = [];
    let cx = 0, cy = 0;
    for (const s of sp.segs) {
      if (s.c === 'M') { cx = s.p[0]; cy = s.p[1]; pts.push({ p: [cx, cy], inH: null, outH: null }); }
      else if (s.c === 'L') { cx = s.p[0]; cy = s.p[1]; pts.push({ p: [cx, cy], inH: null, outH: null }); }
      else if (s.c === 'C') {
        pts[pts.length - 1].outH = [s.p[0], s.p[1]];
        cx = s.p[4]; cy = s.p[5];
        pts.push({ p: [cx, cy], inH: [s.p[2], s.p[3]], outH: null });
      }
    }
    if (sp.closed && pts.length > 1) {
      const f = pts[0], l = pts[pts.length - 1];
      if (Math.hypot(f.p[0] - l.p[0], f.p[1] - l.p[1]) < 1e-7) { f.inH = l.inH; pts.pop(); }
    }
    pts.reverse();
    for (const q of pts) { const t = q.inH; q.inH = q.outH; q.outH = t; }
    out.push({ c: 'M', p: pts[0].p });
    const lim = sp.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < lim; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (!a.outH && !b.inH) out.push({ c: 'L', p: b.p });
      else out.push({ c: 'C', p: [...(a.outH || a.p), ...(b.inH || b.p), ...b.p] });
    }
    if (sp.closed) out.push({ c: 'Z' });
  }
  return out;
}

/* ══════════════════════════ TEXT ═════════════════════════════════════ */

const textSel = () => App.sel.filter(n => n.tagName === 'text');
def('text.upper', 'UPPERCASE', () => mapText(s => s.toUpperCase()));
def('text.lower', 'lowercase', () => mapText(s => s.toLowerCase()));
def('text.title', 'Title Case', () => mapText(s => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())));
def('text.unflow', 'Unflow (remove text frame)', () => {
  textSel().forEach(n => { n.removeAttribute('inkweb:flow-w'); n.removeAttribute('inkweb:flow-h'); reflow(n); });
  commit('Unflow text');
});
function mapText(fn) {
  const t = textSel();
  if (!t.length) { toast('Select a text object'); return; }
  t.forEach(n => setTextContent(n, fn(textOf(n))));
  commit('Change case');
}

/* ══════════════════════════ FILTERS ══════════════════════════════════ */

const FILTERS = {
  blur: ['Blur', '<feGaussianBlur stdDeviation="2.5"/>'],
  strongBlur: ['Strong Blur', '<feGaussianBlur stdDeviation="8"/>'],
  dropShadow: ['Drop Shadow', '<feDropShadow dx="3" dy="3" stdDeviation="2" flood-opacity="0.5"/>'],
  glow: ['Outer Glow', '<feGaussianBlur stdDeviation="3" result="b"/><feFlood flood-color="#ffdd55" flood-opacity="0.9" result="c"/><feComposite in="c" in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>'],
  grayscale: ['Greyscale', '<feColorMatrix type="saturate" values="0"/>'],
  invert: ['Invert', '<feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"/>'],
  sepia: ['Sepia', '<feColorMatrix type="matrix" values="0.393 0.769 0.189 0 0  0.349 0.686 0.168 0 0  0.272 0.534 0.131 0 0  0 0 0 1 0"/>'],
  saturate: ['Saturate ×2', '<feColorMatrix type="saturate" values="2"/>'],
  hue: ['Hue Rotate 90°', '<feColorMatrix type="hueRotate" values="90"/>'],
  emboss: ['Emboss', '<feConvolveMatrix order="3" kernelMatrix="-2 -1 0 -1 1 1 0 1 2" divisor="1"/>'],
  edge: ['Edge Detect', '<feColorMatrix type="saturate" values="0"/><feConvolveMatrix order="3" kernelMatrix="0 1 0 1 -4 1 0 1 0" divisor="1"/>'],
  noise: ['Noise Texture', '<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" result="n"/><feComposite in="n" in2="SourceGraphic" operator="in" result="t"/><feBlend in="SourceGraphic" in2="t" mode="multiply"/>'],
  roughen: ['Roughen', '<feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="6" xChannelSelector="R" yChannelSelector="G"/>'],
  posterize: ['Posterise', '<feComponentTransfer><feFuncR type="discrete" tableValues="0 .25 .5 .75 1"/><feFuncG type="discrete" tableValues="0 .25 .5 .75 1"/><feFuncB type="discrete" tableValues="0 .25 .5 .75 1"/></feComponentTransfer>']
};
export const FILTER_LIST = Object.entries(FILTERS).map(([k, v]) => ({ key: k, label: v[0] }));

def('filter.apply', 'Apply Filter', k => {
  if (!need()) return;
  const spec = FILTERS[k]; if (!spec) return;
  const id = uid('filter');
  const f = el('filter', { id, 'inkscape:label': spec[0], x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs());
  f.innerHTML = spec[1];
  App.sel.forEach(n => setStyle(n, { filter: `url(#${id})` }));
  commit('Apply filter: ' + spec[0]);
});
def('filter.remove', 'Remove Filters', () => {
  if (!need()) return;
  App.sel.forEach(n => setStyle(n, { filter: null }));
  commit('Remove filters');
});

/* ══════════════════════════ EXTENSIONS ═══════════════════════════════ */

def('ext.addNodes', 'Modify Path ▸ Add Nodes', () => {
  if (!need()) return;
  for (const n of App.sel.slice()) {
    const segs = segsOf(n); if (!segs) continue;
    const p = toPath(n);
    setSegsUser(p, subdivide(segs));
  }
  commit('Add nodes'); redraw();
});
function subdivide(segs) {
  const out = []; let cx = 0, cy = 0;
  for (const s of segs) {
    if (s.c === 'M') { out.push(s); cx = s.p[0]; cy = s.p[1]; }
    else if (s.c === 'Z') out.push(s);
    else if (s.c === 'L') {
      const mx = (cx + s.p[0]) / 2, my = (cy + s.p[1]) / 2;
      out.push({ c: 'L', p: [mx, my] }, { c: 'L', p: [s.p[0], s.p[1]] });
      cx = s.p[0]; cy = s.p[1];
    } else {
      const p = [cx, cy, ...s.p];
      const t = .5, u = 1 - t;
      const ax = u * p[0] + t * p[2], ay = u * p[1] + t * p[3];
      const bx = u * p[2] + t * p[4], by = u * p[3] + t * p[5];
      const ccx = u * p[4] + t * p[6], ccy = u * p[5] + t * p[7];
      const dx = u * ax + t * bx, dy = u * ay + t * by;
      const ex = u * bx + t * ccx, ey = u * by + t * ccy;
      const fx = u * dx + t * ex, fy = u * dy + t * ey;
      out.push({ c: 'C', p: [ax, ay, dx, dy, fx, fy] }, { c: 'C', p: [ex, ey, ccx, ccy, p[6], p[7]] });
      cx = p[6]; cy = p[7];
    }
  }
  return out;
}

def('ext.flatten', 'Modify Path ▸ Flatten Beziers', () => {
  if (!need()) return;
  for (const n of App.sel.slice()) {
    const segs = segsOf(n); if (!segs) continue;
    const p = toPath(n);
    setSegsUser(p, flattenSegs(segs, .8));
  }
  commit('Flatten beziers'); redraw();
});

def('ext.jitter', 'Modify Path ▸ Jitter Nodes', () => {
  if (!need()) return;
  const amt = parseFloat(prompt('Jitter amount (px):', '4'));
  if (!Number.isFinite(amt)) return;
  for (const n of App.sel.slice()) {
    const segs = segsOf(n); if (!segs) continue;
    const p = toPath(n);
    setSegsUser(p, segs.map(s => s.c === 'Z' ? s : {
      c: s.c, p: s.p.map(v => v + (Math.random() - .5) * amt * 2)
    }));
  }
  commit('Jitter nodes'); redraw();
});

def('ext.roughen', 'Modify Path ▸ Roughen', () => {
  if (!need()) return;
  for (const n of App.sel.slice()) {
    const segs = segsOf(n); if (!segs) continue;
    const p = toPath(n);
    const dense = subdivide(subdivide(segs));
    setSegsUser(p, dense.map(s => s.c === 'Z' ? s : { c: s.c, p: s.p.map(v => v + (Math.random() - .5) * 1.6) }));
  }
  commit('Roughen'); redraw();
});

def('ext.grid', 'Render ▸ Grid', () => {
  const cols = parseInt(prompt('Columns:', '10'), 10);
  if (!Number.isFinite(cols)) return;
  const rows = parseInt(prompt('Rows:', '10'), 10) || cols;
  const { w, h } = docSize();
  const g = el('g', { id: uid('grid'), 'inkscape:label': 'Grid' });
  const d = [];
  for (let i = 0; i <= cols; i++) d.push(`M${round(i * w / cols, 3)},0V${round(h, 3)}`);
  for (let j = 0; j <= rows; j++) d.push(`M0,${round(j * h / rows, 3)}H${round(w, 3)}`);
  const p = el('path', { id: uid('path'), d: d.join(''), style: 'fill:none;stroke:#000;stroke-width:0.5' }, g);
  addObject(g); select([g]); commit('Render grid');
});

def('ext.colorRandom', 'Colour ▸ Randomise', () => {
  if (!need()) return;
  App.sel.forEach(n => setStyle(n, { fill: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }));
  commit('Randomise colour');
});
def('ext.colorGrayscale', 'Colour ▸ Greyscale', () => mapColor(rgb => { const y = rgb[0] * .3 + rgb[1] * .59 + rgb[2] * .11; return [y, y, y]; }));
def('ext.colorNegative', 'Colour ▸ Negative', () => mapColor(rgb => rgb.map(v => 255 - v)));
def('ext.colorMoreHue', 'Colour ▸ More Hue', () => shiftHue(20));
def('ext.colorLessHue', 'Colour ▸ Less Hue', () => shiftHue(-20));
function mapColor(fn) {
  if (!need()) return;
  App.sel.forEach(n => {
    for (const k of ['fill', 'stroke']) {
      const c = hexToRgb(getStyle(n, k, 'none'));
      if (c) setStyle(n, { [k]: rgbToHex(fn(c)) });
    }
  });
  commit('Change colour');
}
function shiftHue(deg) {
  mapColor(rgb => {
    const hsl = rgb2hsl(rgb);
    hsl[0] = (hsl[0] + deg / 360 + 1) % 1;
    return hsl2rgb(hsl);
  });
}
export function hexToRgb(c) {
  if (!c || c === 'none') return null;
  c = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map(x => parseInt(x + x, 16));
  m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(([^)]+)\)/i.exec(c);
  if (m) { const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2]]; }
  return null;
}
export const rgbToHex = a => '#' + a.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}
export function hsl2rgb([h, s, l]) {
  if (!s) { const v = l * 255; return [v, v, v]; }
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

def('ext.markers', 'Modify Path ▸ Add Arrow Marker', () => {
  if (!need()) return;
  const id = 'InkWebArrow';
  if (!App.doc.querySelector('#' + id)) {
    const m = el('marker', { id, orient: 'auto', refX: 8, refY: 4, markerWidth: 9, markerHeight: 8, markerUnits: 'strokeWidth' }, defs());
    el('path', { d: 'M0,0 L9,4 L0,8 z', fill: 'context-stroke' }, m);
  }
  App.sel.forEach(n => setStyle(n, { 'marker-end': `url(#${id})` }));
  commit('Add marker');
});

/* ══════════════════════════ ALIGN & DISTRIBUTE ═══════════════════════ */

export function alignSel(how, relativeTo = 'selection') {
  if (App.sel.length < 1) { toast('Nothing selected'); return; }
  const items = App.sel.map(n => ({ n, b: bboxOf(n) })).filter(i => i.b);
  if (!items.length) return;
  let ref;
  if (relativeTo === 'page') { const { w, h } = docSize(); ref = box(0, 0, w, h); }
  else if (relativeTo === 'first') ref = items[0].b;
  else if (relativeTo === 'last') ref = items[items.length - 1].b;
  else if (relativeTo === 'drawing') ref = drawingBBox();
  else ref = items.reduce((a, i) => boxUnion(a, i.b), null);
  if (!ref) return;
  for (const it of items) {
    let dx = 0, dy = 0;
    switch (how) {
      case 'left': dx = ref.x - it.b.x; break;
      case 'hcenter': dx = ref.cx - it.b.cx; break;
      case 'right': dx = ref.x2 - it.b.x2; break;
      case 'top': dy = ref.y - it.b.y; break;
      case 'vcenter': dy = ref.cy - it.b.cy; break;
      case 'bottom': dy = ref.y2 - it.b.y2; break;
      case 'leftEdge': dx = ref.x - it.b.x2; break;
      case 'rightEdge': dx = ref.x2 - it.b.x; break;
      case 'topEdge': dy = ref.y - it.b.y2; break;
      case 'bottomEdge': dy = ref.y2 - it.b.y; break;
    }
    if (dx || dy) applyMatrix(it.n, T(dx, dy));
  }
  commit('Align'); redraw();
}

export function distributeSel(how) {
  if (App.sel.length < 3) { toast('Select at least three objects'); return; }
  const items = App.sel.map(n => ({ n, b: bboxOf(n) })).filter(i => i.b);
  const horiz = /^h/.test(how);
  const key = b => how === 'hcenter' ? b.cx : how === 'vcenter' ? b.cy
    : how === 'hleft' ? b.x : how === 'hright' ? b.x2 : how === 'vtop' ? b.y : b.y2;
  items.sort((a, b) => key(a.b) - key(b.b));
  if (how === 'hgap' || how === 'vgap') {
    items.sort((a, b) => horiz ? a.b.x - b.b.x : a.b.y - b.b.y);
    const total = horiz ? items[items.length - 1].b.x2 - items[0].b.x : items[items.length - 1].b.y2 - items[0].b.y;
    const used = items.reduce((s, i) => s + (horiz ? i.b.w : i.b.h), 0);
    const gap = (total - used) / (items.length - 1);
    let pos = horiz ? items[0].b.x : items[0].b.y;
    for (const it of items) {
      const cur = horiz ? it.b.x : it.b.y;
      const d = pos - cur;
      if (d) applyMatrix(it.n, horiz ? T(d, 0) : T(0, d));
      pos += (horiz ? it.b.w : it.b.h) + gap;
    }
  } else {
    const first = key(items[0].b), last = key(items[items.length - 1].b);
    const step = (last - first) / (items.length - 1);
    items.forEach((it, i) => {
      const want = first + step * i, cur = key(it.b), d = want - cur;
      if (d) applyMatrix(it.n, horiz ? T(d, 0) : T(0, d));
    });
  }
  commit('Distribute'); redraw();
}

/* ══════════════════════════ HELP ═════════════════════════════════════ */

def('help.about', 'About InkWeb', () => bus.emit('modal', 'about'));
def('help.keys', 'Keyboard Shortcuts', () => bus.emit('modal', 'keys'));

/* — tool switching commands (built from the tool registry) — */
export function registerToolCommands() {
  for (const name in TOOLS) {
    const t = TOOLS[name];
    def('tool.' + name, t.title, () => setTool(name), { key: t.key ? t.key.toUpperCase() : null, icon: t.icon });
  }
}
