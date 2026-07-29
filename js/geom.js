/* ==========================================================================
   geom.js — matrices, path data, curves
   ========================================================================== */

export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const round = (v, p = 4) => { const f = 10 ** p; return Math.round(v * f) / f; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/* ── matrices: {a,b,c,d,e,f} ──────────────────────────────────────────── */

export const I = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
export const T = (x, y) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
export const S = (x, y = x) => ({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
export function R(deg, cx = 0, cy = 0) {
  const t = deg * D2R, s = Math.sin(t), c = Math.cos(t);
  return { a: c, b: s, c: -s, d: c, e: cx - c * cx + s * cy, f: cy - s * cx - c * cy };
}
export const SKX = deg => ({ a: 1, b: 0, c: Math.tan(deg * D2R), d: 1, e: 0, f: 0 });
export const SKY = deg => ({ a: 1, b: Math.tan(deg * D2R), c: 0, d: 1, e: 0, f: 0 });

export function mmul(m, n) {
  return {
    a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f
  };
}
export const mmulAll = (...ms) => ms.reduce(mmul);
export const mapply = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
export const mapplyV = (m, x, y) => [m.a * x + m.c * y, m.b * x + m.d * y];

export function minv(m) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return I();
  return {
    a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det
  };
}
export const mIsIdentity = m =>
  Math.abs(m.a - 1) < 1e-9 && Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 &&
  Math.abs(m.d - 1) < 1e-9 && Math.abs(m.e) < 1e-9 && Math.abs(m.f) < 1e-9;

export function mstr(m, p = 6) {
  if (mIsIdentity(m)) return '';
  if (Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9) {
    if (Math.abs(m.a - 1) < 1e-9 && Math.abs(m.d - 1) < 1e-9)
      return `translate(${round(m.e, p)},${round(m.f, p)})`;
  }
  return `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(v => round(v, p)).join(',')})`;
}
export const mfrom = dm => ({ a: dm.a, b: dm.b, c: dm.c, d: dm.d, e: dm.e, f: dm.f });

/** Average absolute scale factor of a matrix. */
export const mscale = m => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

export function parseTransform(str) {
  let m = I();
  if (!str) return m;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g; let g;
  while ((g = re.exec(str))) {
    const v = (g[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []).map(Number);
    switch (g[1]) {
      case 'matrix': if (v.length >= 6) m = mmul(m, { a: v[0], b: v[1], c: v[2], d: v[3], e: v[4], f: v[5] }); break;
      case 'translate': m = mmul(m, T(v[0] || 0, v[1] || 0)); break;
      case 'scale': m = mmul(m, S(v[0] ?? 1, v[1] ?? v[0] ?? 1)); break;
      case 'rotate': m = mmul(m, R(v[0] || 0, v[1] || 0, v[2] || 0)); break;
      case 'skewX': m = mmul(m, SKX(v[0] || 0)); break;
      case 'skewY': m = mmul(m, SKY(v[0] || 0)); break;
    }
  }
  return m;
}

/** Decompose into translate / rotate / scale / skewX (in that application order). */
export function decompose(m) {
  const tx = m.e, ty = m.f;
  const rot = Math.atan2(m.b, m.a);
  const den = m.a * m.a + m.b * m.b;
  const sx = Math.sqrt(den);
  const sk = (m.a * m.c + m.b * m.d) / den;
  const sy = (m.a * m.d - m.b * m.c) / sx;
  return { tx, ty, rot: rot * R2D, sx, sy, skew: Math.atan(sk) * R2D };
}

/* ── boxes ────────────────────────────────────────────────────────────── */

export const box = (x, y, w, h) => ({ x, y, w, h, x2: x + w, y2: y + h, cx: x + w / 2, cy: y + h / 2 });
export function boxFromPts(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return Number.isFinite(x0) ? box(x0, y0, x1 - x0, y1 - y0) : null;
}
export const boxUnion = (a, b) => !a ? b : !b ? a :
  box(Math.min(a.x, b.x), Math.min(a.y, b.y),
      Math.max(a.x2, b.x2) - Math.min(a.x, b.x), Math.max(a.y2, b.y2) - Math.min(a.y, b.y));
export const boxTransform = (m, b) => boxFromPts([
  mapply(m, b.x, b.y), mapply(m, b.x2, b.y), mapply(m, b.x2, b.y2), mapply(m, b.x, b.y2)]);
export const boxHit = (b, x, y, pad = 0) => b && x >= b.x - pad && x <= b.x2 + pad && y >= b.y - pad && y <= b.y2 + pad;
export const boxOverlap = (a, b) => a && b && a.x < b.x2 && a.x2 > b.x && a.y < b.y2 && a.y2 > b.y;
export const boxInside = (inner, outer) => inner && outer &&
  inner.x >= outer.x && inner.x2 <= outer.x2 && inner.y >= outer.y && inner.y2 <= outer.y2;

/* ── path data ────────────────────────────────────────────────────────── */

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 4, A: 7, Z: 0 };

export function parsePathD(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let m, cur = null;
  while ((m = re.exec(d))) {
    if (m[1]) { cur = { cmd: m[1], args: [] }; out.push(cur); }
    else if (cur) cur.args.push(parseFloat(m[2]));
  }
  return out;
}

/**
 * Normalise path data to absolute M / L / C / Z segments.
 * Segment shape: {c:'M'|'L'|'C'|'Z', p:[...numbers]}
 */
export function normalize(d) {
  const raw = parsePathD(d || ''), segs = [];
  let cx = 0, cy = 0, sx = 0, sy = 0, lastC = null, lastQ = null, prev = '';
  for (const { cmd, args } of raw) {
    const rel = cmd >= 'a';
    const C = cmd.toUpperCase();
    if (C === 'Z') { segs.push({ c: 'Z' }); cx = sx; cy = sy; prev = 'Z'; lastC = lastQ = null; continue; }
    const n = ARITY[C]; if (!n) continue;
    const a = args.slice();
    let first = true;
    while (a.length >= n) {
      const v = a.splice(0, n);
      let K = (C === 'M' && !first) ? 'L' : C;
      switch (K) {
        case 'M': {
          const x = rel ? cx + v[0] : v[0], y = rel ? cy + v[1] : v[1];
          segs.push({ c: 'M', p: [x, y] }); cx = sx = x; cy = sy = y; lastC = lastQ = null; break;
        }
        case 'L': {
          const x = rel ? cx + v[0] : v[0], y = rel ? cy + v[1] : v[1];
          segs.push({ c: 'L', p: [x, y] }); cx = x; cy = y; lastC = lastQ = null; break;
        }
        case 'H': { const x = rel ? cx + v[0] : v[0]; segs.push({ c: 'L', p: [x, cy] }); cx = x; lastC = lastQ = null; break; }
        case 'V': { const y = rel ? cy + v[0] : v[0]; segs.push({ c: 'L', p: [cx, y] }); cy = y; lastC = lastQ = null; break; }
        case 'C': {
          const p = rel ? [cx + v[0], cy + v[1], cx + v[2], cy + v[3], cx + v[4], cy + v[5]] : v.slice();
          segs.push({ c: 'C', p }); lastC = [p[2], p[3]]; lastQ = null; cx = p[4]; cy = p[5]; break;
        }
        case 'S': {
          const p2 = rel ? [cx + v[0], cy + v[1], cx + v[2], cy + v[3]] : v.slice();
          const r = (prev === 'C' || prev === 'S') && lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
          const p = [r[0], r[1], p2[0], p2[1], p2[2], p2[3]];
          segs.push({ c: 'C', p }); lastC = [p[2], p[3]]; lastQ = null; cx = p[4]; cy = p[5]; break;
        }
        case 'Q': {
          const q = rel ? [cx + v[0], cy + v[1], cx + v[2], cy + v[3]] : v.slice();
          segs.push({ c: 'C', p: q2c(cx, cy, q[0], q[1], q[2], q[3]) });
          lastQ = [q[0], q[1]]; lastC = null; cx = q[2]; cy = q[3]; break;
        }
        case 'T': {
          const t = rel ? [cx + v[0], cy + v[1]] : v.slice();
          const q = (prev === 'Q' || prev === 'T') && lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
          segs.push({ c: 'C', p: q2c(cx, cy, q[0], q[1], t[0], t[1]) });
          lastQ = q; lastC = null; cx = t[0]; cy = t[1]; break;
        }
        case 'A': {
          const x = rel ? cx + v[5] : v[5], y = rel ? cy + v[6] : v[6];
          for (const c of arcToCubics(cx, cy, v[0], v[1], v[2], !!v[3], !!v[4], x, y)) segs.push({ c: 'C', p: c });
          cx = x; cy = y; lastC = lastQ = null; break;
        }
      }
      prev = K; first = false;
    }
  }
  return segs;
}

const q2c = (x0, y0, qx, qy, x, y) => [
  x0 + 2 / 3 * (qx - x0), y0 + 2 / 3 * (qy - y0),
  x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y];

export function arcToCubics(x1, y1, rx, ry, phiDeg, fA, fS, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = phiDeg * D2R, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cp * dx + sp * dy, yp = -sp * dx + cp * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = (fA === fS) ? -1 : 1;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const co = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den));
  const cxp = co * rx * yp / ry, cyp = -co * ry * xp / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dd = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(clamp(dd ? (ux * vx + uy * vy) / dd : 1, -1, 1));
    return (ux * vy - uy * vx < 0) ? -a : a;
  };
  const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry, vx = (-xp - cxp) / rx, vy = (-yp - cyp) / ry;
  let th = ang(1, 0, ux, uy), dth = ang(ux, uy, vx, vy);
  if (!fS && dth > 0) dth -= TAU; else if (fS && dth < 0) dth += TAU;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const step = dth / n, k = 4 / 3 * Math.tan(step / 4), out = [];
  const P = t => [cp * rx * Math.cos(t) - sp * ry * Math.sin(t) + cx, sp * rx * Math.cos(t) + cp * ry * Math.sin(t) + cy];
  const D = t => [-cp * rx * Math.sin(t) - sp * ry * Math.cos(t), -sp * rx * Math.sin(t) + cp * ry * Math.cos(t)];
  let p0 = P(th), d0 = D(th);
  for (let i = 0; i < n; i++) {
    const t2 = th + step, p1 = P(t2), d1 = D(t2);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]]);
    th = t2; p0 = p1; d0 = d1;
  }
  return out;
}

export function segsToD(segs, prec = 4) {
  const f = v => String(round(v, prec));
  let out = '', last = '';
  for (const s of segs) {
    if (s.c === 'Z') { out += 'Z'; last = 'Z'; continue; }
    if (s.c !== last) { out += s.c; last = s.c; } else out += ' ';
    out += s.p.map(f).join(',');
  }
  return out.trim();
}

/** Split a normalised segment list into subpaths. */
export function toSubpaths(segs) {
  const subs = []; let cur = null;
  for (const s of segs) {
    if (s.c === 'M') { cur = { segs: [s], closed: false }; subs.push(cur); }
    else if (!cur) { cur = { segs: [{ c: 'M', p: [0, 0] }, s], closed: false }; subs.push(cur); }
    else if (s.c === 'Z') { cur.closed = true; cur.segs.push(s); }
    else cur.segs.push(s);
  }
  return subs;
}

export const cubicAt = (p, t) => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
};

export function cubicSplit(p, t) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const l = (a, b) => a + (b - a) * t;
  const ax = l(x0, x1), ay = l(y0, y1), bx = l(x1, x2), by = l(y1, y2), cx = l(x2, x3), cy = l(y2, y3);
  const dx = l(ax, bx), dy = l(ay, by), ex = l(bx, cx), ey = l(by, cy);
  const fx = l(dx, ex), fy = l(dy, ey);
  return [[x0, y0, ax, ay, dx, dy, fx, fy], [fx, fy, ex, ey, cx, cy, x3, y3]];
}

function flatCubic(p, tol, out, depth = 0) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const dx = x3 - x0, dy = y3 - y0;
  const d1 = Math.abs((x1 - x3) * dy - (y1 - y3) * dx);
  const d2 = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);
  if (depth > 18 || (d1 + d2) ** 2 <= tol * (dx * dx + dy * dy)) { out.push([x3, y3]); return; }
  const [a, b] = cubicSplit(p, .5);
  flatCubic(a, tol, out, depth + 1); flatCubic(b, tol, out, depth + 1);
}

/** Flatten to polylines: [{pts:[[x,y]…], closed}] */
export function flatten(segs, tol = .12) {
  const out = []; let cur = null, cx = 0, cy = 0;
  for (const s of segs) {
    if (s.c === 'M') { cur = { pts: [[s.p[0], s.p[1]]], closed: false }; out.push(cur); cx = s.p[0]; cy = s.p[1]; }
    else if (!cur) continue;
    else if (s.c === 'L') { cur.pts.push([s.p[0], s.p[1]]); cx = s.p[0]; cy = s.p[1]; }
    else if (s.c === 'C') { flatCubic([cx, cy, ...s.p], tol, cur.pts); cx = s.p[4]; cy = s.p[5]; }
    else if (s.c === 'Z') { cur.closed = true; if (cur.pts.length) { cx = cur.pts[0][0]; cy = cur.pts[0][1]; } }
  }
  return out.filter(s => s.pts.length > 1);
}

export function polysToSegs(polys) {
  const segs = [];
  for (const p of polys) {
    const pts = p.pts || p, closed = p.closed !== undefined ? p.closed : true;
    if (pts.length < 2) continue;
    segs.push({ c: 'M', p: [pts[0][0], pts[0][1]] });
    for (let i = 1; i < pts.length; i++) segs.push({ c: 'L', p: [pts[i][0], pts[i][1]] });
    if (closed) segs.push({ c: 'Z' });
  }
  return segs;
}

export function transformSegs(segs, m) {
  return segs.map(s => {
    if (s.c === 'Z') return { c: 'Z' };
    const p = [];
    for (let i = 0; i < s.p.length; i += 2) { const q = mapply(m, s.p[i], s.p[i + 1]); p.push(q[0], q[1]); }
    return { c: s.c, p };
  });
}

/** Tight bbox of normalised segments (samples cubics). */
export function segsBBox(segs) {
  const pts = []; let cx = 0, cy = 0;
  for (const s of segs) {
    if (s.c === 'Z') continue;
    if (s.c === 'C') {
      const p = [cx, cy, ...s.p];
      for (let i = 0; i <= 16; i++) pts.push(cubicAt(p, i / 16));
      cx = s.p[4]; cy = s.p[5];
    } else { pts.push([s.p[0], s.p[1]]); cx = s.p[0]; cy = s.p[1]; }
  }
  return boxFromPts(pts);
}

export function segsLength(segs) {
  let len = 0;
  for (const sp of flatten(segs, .05)) {
    const p = sp.pts;
    for (let i = 1; i < p.length; i++) len += dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
    if (sp.closed && p.length > 2) len += dist(p[p.length - 1][0], p[p.length - 1][1], p[0][0], p[0][1]);
  }
  return len;
}

/** Signed area (>0 == clockwise in SVG's y-down space). */
export function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return a / 2;
}

export function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd containment against a set of rings. */
export const pointInRings = (rings, x, y) => rings.reduce((n, r) => n ^ (pointInPoly(r, x, y) ? 1 : 0), 0) === 1;

/** Closest point on a polyline; returns {x,y,d,i,t}. */
export function nearestOnPoly(pts, x, y, closed) {
  let best = null;
  const n = pts.length, lim = closed ? n : n - 1;
  for (let i = 0; i < lim; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0;
    t = clamp(t, 0, 1);
    const px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(px - x, py - y);
    if (!best || d < best.d) best = { x: px, y: py, d, i, t };
  }
  return best;
}

/* ── simplification & curve fitting ───────────────────────────────────── */

export function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    let maxD = -1, idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i];
      const d = L < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1])
        : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([i0, idx], [idx, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Schneider curve fitting → array of cubics [x0,y0,x1,y1,x2,y2,x3,y3]. */
export function fitCurve(points, error = 2) {
  const pts = [];
  for (const p of points) { const l = pts[pts.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-6) pts.push(p); }
  if (pts.length < 2) return [];
  if (pts.length === 2) {
    const [a, b] = pts;
    return [[a[0], a[1], lerp(a[0], b[0], 1 / 3), lerp(a[1], b[1], 1 / 3), lerp(a[0], b[0], 2 / 3), lerp(a[1], b[1], 2 / 3), b[0], b[1]]];
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const norm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const out = [];
  fitCubic(pts, norm(sub(pts[1], pts[0])), norm(sub(pts[pts.length - 2], pts[pts.length - 1])), error, out);
  return out;

  function fitCubic(d, t1, t2, err, out) {
    if (d.length === 2) {
      const L = Math.hypot(d[1][0] - d[0][0], d[1][1] - d[0][1]) / 3;
      out.push([d[0][0], d[0][1], d[0][0] + t1[0] * L, d[0][1] + t1[1] * L,
                d[1][0] + t2[0] * L, d[1][1] + t2[1] * L, d[1][0], d[1][1]]);
      return;
    }
    const u = chordParams(d);
    let bez = generate(d, u, t1, t2);
    let { err: maxErr, idx } = computeError(d, bez, u);
    if (maxErr < err) { out.push(bez); return; }
    if (maxErr < err * err) {
      let uu = u;
      for (let i = 0; i < 12; i++) {
        uu = reparam(d, bez, uu);
        bez = generate(d, uu, t1, t2);
        const r = computeError(d, bez, uu);
        if (r.err < err) { out.push(bez); return; }
        idx = r.idx;
      }
    }
    idx = clamp(idx, 1, d.length - 2);
    const c = norm([d[idx - 1][0] - d[idx + 1][0], d[idx - 1][1] - d[idx + 1][1]]);
    fitCubic(d.slice(0, idx + 1), t1, c, err, out);
    fitCubic(d.slice(idx), [-c[0], -c[1]], t2, err, out);
  }
  function chordParams(d) {
    const u = [0];
    for (let i = 1; i < d.length; i++) u.push(u[i - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]));
    const tot = u[u.length - 1] || 1;
    return u.map(v => v / tot);
  }
  function generate(d, u, t1, t2) {
    const n = d.length, A = [];
    for (let i = 0; i < n; i++) {
      const t = u[i], mt = 1 - t;
      const b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t;
      A.push([[t1[0] * b1, t1[1] * b1], [t2[0] * b2, t2[1] * b2]]);
    }
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    const p0 = d[0], p3 = d[n - 1];
    for (let i = 0; i < n; i++) {
      const t = u[i], mt = 1 - t;
      const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
      c00 += A[i][0][0] * A[i][0][0] + A[i][0][1] * A[i][0][1];
      c01 += A[i][0][0] * A[i][1][0] + A[i][0][1] * A[i][1][1];
      c11 += A[i][1][0] * A[i][1][0] + A[i][1][1] * A[i][1][1];
      const tx = d[i][0] - (p0[0] * (b0 + b1) + p3[0] * (b2 + b3));
      const ty = d[i][1] - (p0[1] * (b0 + b1) + p3[1] * (b2 + b3));
      x0 += A[i][0][0] * tx + A[i][0][1] * ty;
      x1 += A[i][1][0] * tx + A[i][1][1] * ty;
    }
    const det = c00 * c11 - c01 * c01;
    let a1, a2;
    if (Math.abs(det) > 1e-12) { a1 = (x0 * c11 - x1 * c01) / det; a2 = (c00 * x1 - c01 * x0) / det; }
    else { const L = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 3; a1 = a2 = L; }
    const segLen = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    if (a1 < 1e-6 || a2 < 1e-6) { a1 = a2 = segLen / 3; }
    return [p0[0], p0[1], p0[0] + t1[0] * a1, p0[1] + t1[1] * a1,
            p3[0] + t2[0] * a2, p3[1] + t2[1] * a2, p3[0], p3[1]];
  }
  function computeError(d, bez, u) {
    let err = 0, idx = Math.floor(d.length / 2);
    for (let i = 0; i < d.length; i++) {
      const p = cubicAt(bez, u[i]);
      const e = (p[0] - d[i][0]) ** 2 + (p[1] - d[i][1]) ** 2;
      if (e > err) { err = e; idx = i; }
    }
    return { err: Math.sqrt(err), idx };
  }
  function reparam(d, bez, u) {
    return u.map((t, i) => {
      const q = cubicAt(bez, t);
      const d1 = [3 * (bez[2] - bez[0]), 3 * (bez[3] - bez[1])],
            d2 = [3 * (bez[4] - bez[2]), 3 * (bez[5] - bez[3])],
            d3 = [3 * (bez[6] - bez[4]), 3 * (bez[7] - bez[5])];
      const qp = quadAt(d1, d2, d3, t);
      const qpp = [2 * (d2[0] - d1[0]) * (1 - t) + 2 * (d3[0] - d2[0]) * t,
                   2 * (d2[1] - d1[1]) * (1 - t) + 2 * (d3[1] - d2[1]) * t];
      const nx = (q[0] - d[i][0]) * qp[0] + (q[1] - d[i][1]) * qp[1];
      const dn = qp[0] ** 2 + qp[1] ** 2 + (q[0] - d[i][0]) * qpp[0] + (q[1] - d[i][1]) * qpp[1];
      return Math.abs(dn) < 1e-12 ? t : clamp(t - nx / dn, 0, 1);
    });
  }
  function quadAt(a, b, c, t) {
    const mt = 1 - t;
    return [mt * mt * a[0] + 2 * mt * t * b[0] + t * t * c[0], mt * mt * a[1] + 2 * mt * t * b[1] + t * t * c[1]];
  }
}

/** Fit a polyline (possibly closed) back to a cubic path. */
export function polyToCurves(pts, closed, error = 1.2) {
  const p = closed && pts.length > 2 ? pts.concat([pts[0]]) : pts;
  const cubics = fitCurve(p, error);
  if (!cubics.length) return [];
  const segs = [{ c: 'M', p: [cubics[0][0], cubics[0][1]] }];
  for (const c of cubics) segs.push({ c: 'C', p: [c[2], c[3], c[4], c[5], c[6], c[7]] });
  if (closed) segs.push({ c: 'Z' });
  return segs;
}
