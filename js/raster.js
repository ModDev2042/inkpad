/* ==========================================================================
   raster.js — SVG serialisation + rasterisation (dropper, bucket, export)
   ========================================================================== */

import { App, bus, docSize, namedview, SVGNS } from './doc.js';
import { View } from './view.js';
import { round, clamp } from './geom.js';

const NS = {
  xmlns: SVGNS,
  'xmlns:xlink': 'http://www.w3.org/1999/xlink',
  'xmlns:inkscape': 'http://www.inkscape.org/namespaces/inkscape',
  'xmlns:sodipodi': 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd',
  'xmlns:inkweb': 'https://github.com/inkweb'
};

/** A standalone copy of the document ready for serialisation. */
export function cloneDoc({ pretty = true, stripEditor = false } = {}) {
  const c = App.doc.cloneNode(true);
  c.querySelectorAll('.current').forEach(n => { n.classList.remove('current'); if (!n.getAttribute('class')) n.removeAttribute('class'); });
  c.querySelectorAll('[data-inkweb-temp]').forEach(n => n.remove());
  c.removeAttribute('style');
  for (const k in NS) c.setAttribute(k, NS[k]);
  c.setAttribute('version', '1.1');
  if (stripEditor) {
    c.querySelectorAll('sodipodi\\:namedview, namedview').forEach(n => n.remove());
    walk(c, n => {
      [...n.attributes].forEach(a => { if (/^(inkscape|sodipodi|inkweb):/.test(a.name)) n.removeAttribute(a.name); });
    });
  }
  return c;
}
function walk(n, fn) { if (n.nodeType !== 1) return; fn(n); for (const c of [...n.children]) walk(c, fn); }

export function serializeDoc(opts = {}) {
  const c = cloneDoc(opts);
  let s = new XMLSerializer().serializeToString(c);
  if (opts.pretty !== false) s = prettyXML(s);
  return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    (opts.stripEditor ? '' : '<!-- Created with InkWeb (https://github.com/) -->\n') + s + '\n';
}

export function prettyXML(xml) {
  const tokens = xml.replace(/>\s*</g, '><').replace(/></g, '>\n<').split('\n');
  let depth = 0, out = [];
  for (let t of tokens) {
    if (/^<\//.test(t)) depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + t);
    if (/^<[^!?/][^>]*[^/]>$/.test(t) && !/^<(metadata|title|desc|tspan|text)[\s>]/.test(t)) depth++;
    else if (/^<[^!?/][^>]*[^/]>$/.test(t)) depth++;
  }
  return out.join('\n');
}

/* ── rasterisation ────────────────────────────────────────────────────── */

let cache = null;
export const invalidateRaster = () => { cache = null; };
bus.on('changed', invalidateRaster);
bus.on('view', invalidateRaster);
bus.on('docreplaced', invalidateRaster);

function svgWrapper(inner, w, h) {
  const attrs = Object.entries(NS).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<svg ${attrs} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
}

export function loadSvgImage(svgText) {
  return new Promise((res, rej) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = e => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

/** Render exactly what the user currently sees (page + objects), 1 canvas px per screen px. */
export async function renderScreenCanvas() {
  if (cache) return cache;
  const w = Math.max(1, Math.round(View.w)), h = Math.max(1, Math.round(View.h));
  const { w: dw, h: dh } = docSize();
  const nv = namedview();
  const pageColor = nv.getAttribute('pagecolor') || '#ffffff';
  const canvasColor = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#3b3f43';
  const body = new XMLSerializer().serializeToString(cloneDoc({ pretty: false }));
  const inner =
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${canvasColor}"/>` +
    `<g transform="translate(${round(View.tx, 3)},${round(View.ty, 3)}) scale(${round(View.zoom, 8)})">` +
    `<rect x="0" y="0" width="${dw}" height="${dh}" fill="${pageColor}"/>${body}</g>`;
  try {
    const img = await loadSvgImage(svgWrapper(inner, w, h));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    cache = cv;
    return cv;
  } catch (e) { console.warn('raster failed', e); return null; }
}

/**
 * Render an arbitrary document area to a canvas.
 * area: {x,y,w,h} in user units; scale: output px per user unit.
 */
export async function renderArea(area, scale, { background = null, transparent = true } = {}) {
  const W = Math.max(1, Math.round(area.w * scale)), H = Math.max(1, Math.round(area.h * scale));
  const body = new XMLSerializer().serializeToString(cloneDoc({ pretty: false }));
  const bg = background && !transparent ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${background}"/>` : '';
  const inner = `${bg}<g transform="scale(${round(scale, 8)}) translate(${round(-area.x, 5)},${round(-area.y, 5)})">${body}</g>`;
  const img = await loadSvgImage(svgWrapper(inner, W, H));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return cv;
}
