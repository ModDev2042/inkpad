/* ==========================================================================
   trace.js — bitmap → vector tracing (Inkscape's "Trace Bitmap", simplified)
   ========================================================================== */

import { rdp, polyToCurves, segsToD, round, clamp } from './geom.js';

/** Render an <image> element into a canvas at the requested max dimension. */
export function imageToCanvas(imgEl, maxDim = 900) {
  return new Promise((res, rej) => {
    const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href');
    if (!href) return rej(new Error('image has no href'));
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      const s = Math.min(1, maxDim / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.max(1, Math.round(im.naturalWidth * s)), h = Math.max(1, Math.round(im.naturalHeight * s));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0, w, h);
      res(c);
    };
    im.onerror = rej;
    im.src = href;
  });
}

const NB8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

/** Trace every connected component in a binary mask, returning contour rings. */
function traceMask(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const rings = [];
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x];

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (!mask[k] || seen[k]) continue;
    // flood the component so it is only traced once
    const comp = [];
    const st = [[x, y]]; seen[k] = 1;
    while (st.length) {
      const [px, py] = st.pop(); comp.push(py * w + px);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (mask[nk] && !seen[nk]) { seen[nk] = 1; st.push([nx, ny]); }
      }
    }
    if (comp.length < 12) continue;
    rings.push(moore(at, x, y, w, h));
    // inner holes: background pixels enclosed by this component
    const holes = findHoles(mask, comp, w, h);
    for (const hstart of holes) rings.push(moore((qx, qy) => (at(qx, qy) ? 0 : 1), hstart[0], hstart[1], w, h, true));
  }
  return rings.filter(Boolean);
}

function findHoles(mask, comp, w, h) {
  const set = new Set(comp);
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (const k of comp) { const x = k % w, y = (k / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const seen = new Set();
  const starts = [];
  for (let y = minY + 1; y < maxY; y++) for (let x = minX + 1; x < maxX; x++) {
    const k = y * w + x;
    if (mask[k] || seen.has(k)) continue;
    // flood background; if it never touches the component bbox border it is a hole
    const st = [[x, y]], cells = []; let touches = false;
    seen.add(k);
    while (st.length) {
      const [px, py] = st.pop(); cells.push([px, py]);
      if (px <= minX || px >= maxX || py <= minY || py >= maxY) touches = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < minX || ny < minY || nx > maxX || ny > maxY) { touches = true; continue; }
        const nk = ny * w + nx;
        if (!mask[nk] && !seen.has(nk)) { seen.add(nk); st.push([nx, ny]); }
      }
      if (cells.length > w * h) break;
    }
    if (!touches && cells.length > 12) {
      let best = cells[0];
      for (const c of cells) if (c[1] < best[1] || (c[1] === best[1] && c[0] < best[0])) best = c;
      starts.push(best);
    }
  }
  return starts;
}

function moore(at, sx, sy, w, h) {
  const pts = [[sx, sy]];
  let cx = sx, cy = sy, dir = 6, guard = 0;
  do {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8;
      const nx = cx + NB8[d][0], ny = cy + NB8[d][1];
      if (at(nx, ny)) { cx = nx; cy = ny; dir = d; pts.push([cx, cy]); found = true; break; }
    }
    if (!found) break;
  } while ((cx !== sx || cy !== sy) && ++guard < w * h * 4);
  return pts.length > 10 ? pts : null;
}

/**
 * Trace a canvas into path data.
 * mode: 'brightness' | 'edge' | 'steps'
 * Returns [{d, fill}] ordered back-to-front.
 */
export function traceCanvas(canvas, {
  mode = 'brightness', threshold = 0.45, steps = 1, invert = false,
  smooth = 1.2, speckles = 12, scaleX = 1, scaleY = 1, offX = 0, offY = 0
} = {}) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    lum[p] = (data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114) / 255 * a + (1 - a);
  }
  const out = [];
  const levels = mode === 'steps' ? Math.max(1, Math.min(8, steps)) : 1;
  for (let s = 0; s < levels; s++) {
    const cut = levels === 1 ? threshold : (s + 1) / (levels + 1);
    const mask = new Uint8Array(w * h);
    for (let p = 0; p < lum.length; p++) {
      let on = lum[p] < cut;
      if (invert) on = !on;
      mask[p] = on ? 1 : 0;
    }
    const rings = traceMask(mask, w, h).filter(r => r && r.length > speckles);
    if (!rings.length) continue;
    const segs = [];
    for (const r of rings) {
      const pts = r.map(p => [offX + p[0] * scaleX, offY + p[1] * scaleY]);
      const simp = rdp(pts, smooth * Math.max(scaleX, scaleY));
      if (simp.length < 4) continue;
      segs.push(...polyToCurves(simp, true, smooth * 1.6 * Math.max(scaleX, scaleY)));
    }
    if (!segs.length) continue;
    const g = Math.round(255 * (1 - (s + 1) / (levels + 1)));
    const fill = levels === 1 ? '#000000' : `#${g.toString(16).padStart(2, '0').repeat(3)}`;
    out.push({ d: segsToD(segs), fill });
  }
  return out.reverse();
}
