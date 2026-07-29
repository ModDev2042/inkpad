/* ==========================================================================
   io.js — open, import, save, export (SVG / SVGZ / PNG / JPEG / WebP / PDF)
   ========================================================================== */

import {
  App, bus, el, commit, select, clearSel, historyInit, docSize, setDocSize, uid,
  ensureId, currentLayer, addLayer, setCurrentLayer, addObject, bboxOf, selBBox,
  namedview, SVGNS, layers, allObjects, isLayer, docScaleFactor, normalizeNS
} from './doc.js';
import { View, update, zoomPage, loadGuides, drawingBBox } from './view.js';
import { serializeDoc, renderArea, cloneDoc } from './raster.js';
import { CMD, runCmd } from './commands.js';
import { h, clear, icon, modal, toast } from './dom.js';
import { round, num, clamp, box, boxUnion } from './geom.js';
import { redraw } from './tools.js';

/* ── helpers ──────────────────────────────────────────────────────────── */

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const base = () => App.filename.replace(/\.(svgz?|png|jpe?g|webp|pdf)$/i, '') || 'drawing';

/* ── new document ─────────────────────────────────────────────────────── */

export function newDocument(wPx = 210 * 96 / 25.4, hPx = 297 * 96 / 25.4, unit = 'mm') {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('xmlns', SVGNS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('xmlns:inkscape', 'http://www.inkscape.org/namespaces/inkscape');
  svg.setAttribute('xmlns:sodipodi', 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd');
  svg.setAttribute('xmlns:inkweb', 'https://github.com/inkweb');
  svg.setAttribute('version', '1.1');
  svg.style.overflow = 'visible';
  App.doc = svg;
  setDocSize(wPx, hPx, unit);
  el('defs', { id: 'defs1' }, svg);
  const nv = document.createElementNS('http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd', 'sodipodi:namedview');
  nv.setAttribute('id', 'namedview1');
  nv.setAttribute('pagecolor', '#ffffff');
  nv.setAttribute('bordercolor', '#666666');
  nv.setAttribute('inkscape:document-units', unit);
  svg.appendChild(nv);
  const l = el('g', { id: 'layer1', 'inkscape:groupmode': 'layer', 'inkscape:label': 'Layer 1', style: 'display:inline' }, svg);
  App.defs = svg.querySelector('defs');
  App.guides = [];
  setCurrentLayer(l);
  return svg;
}

export function adoptDocument(svgNode, filename) {
  const fresh = normalizeNS(document.importNode(svgNode, true));
  fresh.style.overflow = 'visible';
  if (!fresh.getAttribute('viewBox')) {
    const w = parseLen(fresh.getAttribute('width')) || 800, hh = parseLen(fresh.getAttribute('height')) || 600;
    fresh.setAttribute('viewBox', `0 0 ${w} ${hh}`);
  }
  const old = App.doc;
  if (old && old.parentNode) old.replaceWith(fresh); else if (App.scene) App.scene.appendChild(fresh);
  App.doc = fresh;
  App.defs = fresh.querySelector('defs') || el('defs', { id: uid('defs') }, fresh);
  App.sel = []; App.context = null;
  if (filename) App.filename = filename;
  if (!layers().length) {
    // keep the file structure, but give new objects somewhere to live
    const l = el('g', { id: uid('layer'), 'inkscape:groupmode': 'layer', 'inkscape:label': 'Layer 1', style: 'display:inline' }, fresh);
    setCurrentLayer(l);
  } else setCurrentLayer(layers()[0]);
  allObjects(fresh).forEach(ensureId);
  loadGuides();
  historyInit();
  bus.emit('docreplaced'); bus.emit('objects'); bus.emit('layers'); bus.emit('selection');
  update(); zoomPage(); redraw();
}

export function parseLen(v) {
  if (!v) return null;
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(v));
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = (m[2] || 'px').toLowerCase();
  const f = { px: 1, '': 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16, q: 96 / 101.6 }[u];
  return f ? n * f : n;
}

/* ── open / import ────────────────────────────────────────────────────── */

const fileInput = () => document.getElementById('file-input');

export function pickFile(accept, cb) {
  const inp = fileInput();
  inp.accept = accept;
  inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) cb(f); };
  inp.click();
}

export async function openFile(file) {
  try {
    let text;
    if (/\.svgz$/i.test(file.name)) text = await gunzipText(await file.arrayBuffer());
    else text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('This file is not valid SVG');
    adoptDocument(doc.documentElement, file.name);
    App.dirty = false;
    bus.emit('changed');
    toast('Opened ' + file.name);
  } catch (e) { console.error(e); toast('Could not open: ' + e.message, 'err'); }
}

export async function importFile(file) {
  try {
    if (/svgz?$/i.test(file.name) || file.type === 'image/svg+xml') {
      const text = /\.svgz$/i.test(file.name) ? await gunzipText(await file.arrayBuffer()) : await file.text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error('invalid SVG');
      const src = doc.documentElement;
      const g = el('g', { id: uid('import'), 'inkscape:label': file.name });
      for (const c of [...src.children]) {
        if (/namedview$/.test(c.tagName)) continue;
        g.appendChild(normalizeNS(document.importNode(c, true)));
      }
      allObjects(g).forEach(ensureId);
      addObject(g); select([g]); commit('Import SVG');
      toast('Imported ' + file.name);
      redraw();
      return;
    }
    const dataUrl = await readDataURL(file);
    const dims = await imageSize(dataUrl);
    const { w, h: dh } = docSize();
    const sc = Math.min(1, (w * .8) / dims.w, (dh * .8) / dims.h);
    const img = el('image', {
      id: uid('image'), href: dataUrl, 'xlink:href': dataUrl,
      x: round((w - dims.w * sc) / 2, 2), y: round((dh - dims.h * sc) / 2, 2),
      width: round(dims.w * sc, 2), height: round(dims.h * sc, 2),
      preserveAspectRatio: 'none'
    });
    addObject(img); select([img]); commit('Import image');
    toast('Imported ' + file.name);
    redraw();
  } catch (e) { console.error(e); toast('Import failed: ' + e.message, 'err'); }
}

const readDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const imageSize = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = url; });

async function gunzipText(buf) {
  if (typeof DecompressionStream === 'undefined') throw new Error('SVGZ needs a browser with DecompressionStream');
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}
async function gzipBytes(str) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('gzip');
  const stream = new Blob([str]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ── save ─────────────────────────────────────────────────────────────── */

export function saveSVG(plain = false, filename) {
  const text = serializeDoc({ stripEditor: plain, pretty: true });
  const name = filename || (base() + '.svg');
  download(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), name);
  App.filename = name; App.dirty = false;
  bus.emit('changed');
  toast('Saved ' + name);
}

export function optimizedSVG() {
  let text = serializeDoc({ stripEditor: true, pretty: false });
  text = text
    .replace(/<\?xml[^>]*\?>\s*/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\d\.\d{4})\d+/g, '$1')
    .replace(/>\s+</g, '><');
  download(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), base() + '.min.svg');
  toast('Optimised SVG saved');
}

export async function saveSVGZ() {
  const bytes = await gzipBytes(serializeDoc({ pretty: false }));
  if (!bytes) { toast('SVGZ is unavailable in this browser', 'err'); return; }
  download(new Blob([bytes], { type: 'image/svg+xml-compressed' }), base() + '.svgz');
  toast('SVGZ saved');
}

/* ── export ───────────────────────────────────────────────────────────── */

export function exportArea(kind) {
  const { w, h } = docSize();
  if (kind === 'page') return box(0, 0, w, h);
  if (kind === 'drawing') return drawingBBox() || box(0, 0, w, h);
  if (kind === 'selection') return selBBox() || drawingBBox() || box(0, 0, w, h);
  return box(0, 0, w, h);
}

export async function exportRaster({ area, scale, format = 'png', quality = .92, background = '#ffffff', transparent = true, filename }) {
  const cv = await renderArea(area, scale, { background, transparent: format === 'png' || format === 'webp' ? transparent : false });
  const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[format] || 'image/png';
  const blob = await new Promise(r => cv.toBlob(r, mime, quality));
  if (!blob) throw new Error(format.toUpperCase() + ' is not supported by this browser');
  download(blob, filename || `${base()}.${format === 'jpeg' ? 'jpg' : format}`);
  return blob;
}

export async function exportPDF({ area, scale = 2, filename, background = '#ffffff' }) {
  const cv = await renderArea(area, scale, { background, transparent: true });
  const bytes = await buildPDF(cv, area.w * 72 / 96, area.h * 72 / 96);
  download(new Blob([bytes], { type: 'application/pdf' }), filename || base() + '.pdf');
}

/* Minimal single-page PDF with a Flate-compressed RGB image + alpha SMask. */
async function buildPDF(canvas, ptW, ptH) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
  let hasAlpha = false;
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    rgb[p * 3] = data[i]; rgb[p * 3 + 1] = data[i + 1]; rgb[p * 3 + 2] = data[i + 2];
    alpha[p] = data[i + 3];
    if (data[i + 3] !== 255) hasAlpha = true;
  }
  const rgbZ = await deflate(rgb), alphaZ = hasAlpha ? await deflate(alpha) : null;

  const enc = new TextEncoder();
  const chunks = []; let len = 0;
  const offsets = [];
  const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; chunks.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };

  const content = `q ${round(ptW, 4)} 0 0 ${round(ptH, 4)} 0 0 cm /Im0 Do Q`;
  const nObjs = hasAlpha ? 6 : 5;

  push('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(ptW, 4)} ${round(ptH, 4)}] ` +
    `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  obj(4, `<< /Length ${content.length} >>`, content);
  obj(5, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
    `/BitsPerComponent 8 ${rgbZ.filter} ${hasAlpha ? '/SMask 6 0 R ' : ''}/Length ${rgbZ.data.length} >>`, rgbZ.data);
  if (hasAlpha) obj(6, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray ` +
    `/BitsPerComponent 8 ${alphaZ.filter} /Length ${alphaZ.data.length} >>`, alphaZ.data);

  const xrefPos = len;
  let xref = `xref\n0 ${nObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= nObjs; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push(`trailer\n<< /Size ${nObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return { data: bytes, filter: '' };
  const cs = new CompressionStream('deflate');
  const s = new Blob([bytes]).stream().pipeThrough(cs);
  return { data: new Uint8Array(await new Response(s).arrayBuffer()), filter: '/Filter /FlateDecode' };
}

/* ── export panel UI ──────────────────────────────────────────────────── */

const EX = { area: 'page', format: 'png', dpi: 96, quality: 92, transparent: true, custom: null };

export function exportDialogBody(host) {
  const area = exportArea(EX.area);
  const scale = EX.dpi / 96;
  const pxW = Math.max(1, Math.round(area.w * scale)), pxH = Math.max(1, Math.round(area.h * scale));

  const refresh = () => { clear(host); exportDialogBody(host); };

  host.appendChild(h('div', { class: 'pgroup' }, h('h4', 'Export area'),
    h('div', { class: 'grid4' }, [['page', 'Page'], ['drawing', 'Drawing'], ['selection', 'Selection']].map(([v, l]) =>
      h('button', { class: 'btn ghost' + (EX.area === v ? ' on' : ''), onclick: () => { EX.area = v; refresh(); } }, l))),
    h('p', { class: 'tiny' }, `x ${round(area.x, 2)}  y ${round(area.y, 2)}  w ${round(area.w, 2)}  h ${round(area.h, 2)} (user units)`)));

  host.appendChild(h('div', { class: 'pgroup' }, h('h4', 'Format'),
    h('div', { class: 'grid3' }, ['png', 'jpeg', 'webp', 'pdf', 'svg', 'svgz'].map(f =>
      h('button', { class: 'btn ghost' + (EX.format === f ? ' on' : ''), onclick: () => { EX.format = f; refresh(); } }, f.toUpperCase())))));

  if (['png', 'jpeg', 'webp', 'pdf'].includes(EX.format)) {
    host.appendChild(h('div', { class: 'pgroup' }, h('h4', 'Size'),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', 'Width'), h('input', {
          type: 'number', value: pxW, min: 1, step: 1,
          onchange: e => { EX.dpi = clamp(parseFloat(e.target.value) / area.w * 96, 1, 4800); refresh(); }
        })),
        h('label', { class: 'field' }, h('span', 'Height'), h('input', {
          type: 'number', value: pxH, min: 1, step: 1,
          onchange: e => { EX.dpi = clamp(parseFloat(e.target.value) / area.h * 96, 1, 4800); refresh(); }
        }))),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', 'DPI'), h('input', {
          type: 'number', value: round(EX.dpi, 2), min: 1, step: 6,
          onchange: e => { EX.dpi = clamp(parseFloat(e.target.value), 1, 4800); refresh(); }
        })),
        ...[96, 192, 300, 600].map(d => h('button', { class: 'btn ghost', onclick: () => { EX.dpi = d; refresh(); } }, d))),
      EX.format === 'jpeg' || EX.format === 'webp'
        ? h('div', { class: 'row' }, h('label', 'Quality'), h('input', {
          type: 'range', min: 10, max: 100, value: EX.quality, oninput: e => EX.quality = +e.target.value
        }))
        : null,
      EX.format === 'png' || EX.format === 'webp'
        ? h('div', { class: 'row' }, h('label', h('input', {
          type: 'checkbox', checked: EX.transparent, onchange: e => EX.transparent = e.target.checked
        }), ' Transparent background'))
        : null));
  }

  const nameInput = h('input', { value: `${base()}.${EX.format === 'jpeg' ? 'jpg' : EX.format}`, style: { flex: '1' } });
  host.appendChild(h('div', { class: 'pgroup' }, h('h4', 'File name'), h('div', { class: 'row' }, nameInput)));

  host.appendChild(h('button', {
    class: 'btn primary', style: { width: '100%' },
    onclick: async () => {
      const fn = nameInput.value.trim() || base();
      try {
        if (EX.format === 'svg') saveSVG(false, fn.endsWith('.svg') ? fn : fn + '.svg');
        else if (EX.format === 'svgz') await saveSVGZ();
        else if (EX.format === 'pdf') { toast('Rendering PDF…'); await exportPDF({ area, scale: EX.dpi / 96, filename: fn }); toast('PDF exported'); }
        else {
          toast('Rendering…');
          await exportRaster({
            area, scale: EX.dpi / 96, format: EX.format, quality: EX.quality / 100,
            transparent: EX.transparent, filename: fn
          });
          toast(EX.format.toUpperCase() + ' exported');
        }
      } catch (e) { console.error(e); toast('Export failed: ' + e.message, 'err'); }
    }
  }, 'Export'));

  if (['png', 'jpeg', 'webp'].includes(EX.format)) {
    const prev = h('div', { class: 'export-preview' }, h('span', { class: 'tiny' }, 'preview'));
    host.appendChild(h('div', { class: 'pgroup', style: { marginTop: '10px' } }, prev));
    renderArea(area, Math.min(2, 320 / Math.max(area.w, 1)), { transparent: true })
      .then(cv => { clear(prev); prev.appendChild(h('img', { src: cv.toDataURL() })); })
      .catch(() => { });
  }

  if (EX.format === 'pdf') host.appendChild(h('p', { class: 'tiny', style: { marginTop: '8px' } },
    'PDF export embeds a high-resolution raster of the drawing (with transparency). For vector PDF, export SVG and convert with Inkscape or a print-to-PDF driver.'));
}

/* ── autosave / recovery ──────────────────────────────────────────────── */

const LSKEY = 'inkweb.autosave';
let saveTimer = 0;
export function initAutosave() {
  bus.on('changed', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LSKEY, JSON.stringify({ t: Date.now(), name: App.filename, svg: serializeDoc({ pretty: false }) })); }
      catch { /* quota */ }
    }, 1500);
  });
  addEventListener('beforeunload', e => { if (App.dirty) { e.preventDefault(); e.returnValue = ''; } });
}
export function recoverySnapshot() {
  try { return JSON.parse(localStorage.getItem(LSKEY) || 'null'); } catch { return null; }
}
export const clearRecovery = () => localStorage.removeItem(LSKEY);

/* ── register file commands ───────────────────────────────────────────── */

export function registerFileCommands() {
  const def = (n, label, fn, extra) => CMD[n] = { name: n, label, fn, ...extra };
  def('file.new', 'New', () => {
    if (App.dirty && !confirm('Discard unsaved changes?')) return;
    const cur = App.doc;
    const svg = newDocument();
    if (cur && cur.parentNode) cur.replaceWith(svg); else App.scene.appendChild(svg);
    App.filename = 'drawing.svg'; App.dirty = false;
    historyInit();
    bus.emit('docreplaced'); bus.emit('layers'); bus.emit('objects'); bus.emit('selection'); bus.emit('changed');
    update(); zoomPage(); redraw();
  }, { key: 'Ctrl+N', icon: 'new' });

  def('file.open', 'Open…', () => pickFile('.svg,.svgz,image/svg+xml', f => {
    if (App.dirty && !confirm('Discard unsaved changes?')) return;
    openFile(f);
  }), { key: 'Ctrl+O', icon: 'open' });

  def('file.import', 'Import…', () => pickFile('.svg,.svgz,image/svg+xml,image/png,image/jpeg,image/gif,image/webp', importFile), { key: 'Ctrl+I', icon: 'import' });
  def('file.save', 'Save', () => saveSVG(false), { key: 'Ctrl+S', icon: 'save' });
  def('file.saveAs', 'Save As…', () => {
    const n = prompt('File name:', base() + '.svg');
    if (n) saveSVG(false, n.endsWith('.svg') ? n : n + '.svg');
  }, { key: 'Ctrl+Shift+S' });
  def('file.savePlain', 'Save as Plain SVG', () => saveSVG(true));
  def('file.saveOptimized', 'Save as Optimised SVG', () => optimizedSVG());
  def('file.saveSvgz', 'Save as Compressed SVG (.svgz)', () => saveSVGZ());
  def('file.export', 'Export…', () => bus.emit('panel', 'export'), { key: 'Ctrl+Shift+E', icon: 'export' });
  def('file.docprops', 'Document Properties…', () => bus.emit('panel', 'document'), { key: 'Ctrl+Shift+D', icon: 'docprops' });

  def('file.print', 'Print…', async () => {
    try {
      const area = exportArea('page');
      const cv = await renderArea(area, 2, { background: '#ffffff', transparent: false });
      const w = window.open('', '_blank');
      if (!w) { toast('Pop-up blocked', 'err'); return; }
      w.document.write(`<html><head><title>${base()}</title><style>@page{margin:0}body{margin:0}img{width:100%}</style></head>
        <body><img src="${cv.toDataURL('image/png')}" onload="window.print()"></body></html>`);
      w.document.close();
    } catch (e) { toast('Print failed: ' + e.message, 'err'); }
  }, { key: 'Ctrl+P', icon: 'print' });

  def('file.cleanup', 'Clean Up Document', () => {
    const defsNode = App.doc.querySelector('defs');
    let removed = 0;
    if (defsNode) {
      const xml = App.doc.innerHTML;
      for (const c of [...defsNode.children]) {
        const id = c.getAttribute('id');
        if (!id) continue;
        if (!new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[)"']`).test(xml)) { c.remove(); removed++; }
      }
    }
    for (const l of layers()) if (!l.children.length && layers().length > 1) { l.remove(); removed++; }
    commit('Clean up document');
    toast(removed ? `Removed ${removed} unused definition(s)` : 'Nothing to clean up');
  });

  def('file.share', 'Share / Copy SVG', async () => {
    const text = serializeDoc({ pretty: true });
    const file = new File([text], base() + '.svg', { type: 'image/svg+xml' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: base() }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(text); toast('SVG copied to clipboard'); }
    catch { toast('Sharing is not available here', 'err'); }
  }, { icon: 'share' });
}
