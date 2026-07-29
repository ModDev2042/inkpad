/* ==========================================================================
   bool.js — path booleans, offsetting, stroke outlining
   Works on flattened rings; results are re-fitted to curves where useful.
   ========================================================================== */

import {
  flatten, polysToSegs, polyArea, pointInPoly, clamp, rdp, polyToCurves, dist
} from './geom.js';

const EPS = 1e-7;
const QK = 1e6;                       // quantisation for vertex matching
const qk = p => `${Math.round(p[0] * QK)}|${Math.round(p[1] * QK)}`;

/* ── ring helpers ─────────────────────────────────────────────────────── */

/** Path segments → array of closed rings (arrays of points). */
export function segsToRings(segs, tol = .04) {
  const rings = [];
  for (const sp of flatten(segs, tol)) {
    const pts = dedupe(sp.pts);
    if (pts.length >= 3) rings.push(pts);
  }
  return rings;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || Math.abs(l[0] - p[0]) > EPS || Math.abs(l[1] - p[1]) > EPS) out.push([p[0], p[1]]);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) out.pop(); else break;
  }
  return out;
}

export const ringsToSegs = rings => polysToSegs(rings.map(r => ({ pts: r, closed: true })));

/* ── segment intersection ─────────────────────────────────────────────── */

function segInt(a1, a2, b1, b2) {
  const rx = a2[0] - a1[0], ry = a2[1] - a1[1];
  const sx = b2[0] - b1[0], sy = b2[1] - b1[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-14) return null;                     // parallel / collinear
  const qpx = b1[0] - a1[0], qpy = b1[1] - a1[1];
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t: clamp(t, 0, 1), u: clamp(u, 0, 1), p: [a1[0] + rx * t, a1[1] + ry * t] };
}

/** Break every ring edge at its intersections with the other shape. */
function buildEdges(ringsA, ringsB) {
  const edges = [];
  const listOf = (rings, owner) => {
    const arr = [];
    rings.forEach((r, ri) => {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) continue;
        arr.push({ a, b, owner, ring: ri, cuts: [] });
      }
    });
    return arr;
  };
  const EA = listOf(ringsA, 0), EB = listOf(ringsB, 1);
  for (const ea of EA) for (const eb of EB) {
    const x = segInt(ea.a, ea.b, eb.a, eb.b);
    if (!x) continue;
    if (x.t > EPS && x.t < 1 - EPS) ea.cuts.push(x.t);
    if (x.u > EPS && x.u < 1 - EPS) eb.cuts.push(x.u);
  }
  for (const e of [...EA, ...EB]) {
    const ts = [...new Set(e.cuts)].sort((p, q) => p - q);
    let prev = e.a;
    for (const t of ts) {
      const p = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
      if (dist(prev[0], prev[1], p[0], p[1]) > EPS) edges.push({ a: prev, b: p, owner: e.owner });
      prev = p;
    }
    if (dist(prev[0], prev[1], e.b[0], e.b[1]) > EPS) edges.push({ a: prev, b: e.b, owner: e.owner });
  }
  return edges;
}

const insideRings = (rings, x, y) => rings.reduce((n, r) => n ^ (pointInPoly(r, x, y) ? 1 : 0), 0) === 1;

/** Distance from a point to the boundary of a ring set. */
function distToRings(rings, x, y) {
  let best = Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L, 0, 1) : 0;
    const d = Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y);
    if (d < best) best = d;
  }
  return best;
}

/* ── chaining ─────────────────────────────────────────────────────────── */

function chain(edges) {
  const start = new Map();
  for (const e of edges) {
    const k = qk(e.a);
    if (!start.has(k)) start.set(k, []);
    start.get(k).push(e);
    e.used = false;
  }
  const rings = [];
  for (const seed of edges) {
    if (seed.used) continue;
    const pts = [seed.a]; let cur = seed; cur.used = true;
    const startKey = qk(seed.a);
    for (let guard = 0; guard < 200000; guard++) {
      pts.push(cur.b);
      const k = qk(cur.b);
      if (k === startKey) break;
      const cands = (start.get(k) || []).filter(e => !e.used);
      if (!cands.length) break;
      let next = cands[0];
      if (cands.length > 1) {
        // prefer the sharpest left turn — keeps traversal on one face
        const inAng = Math.atan2(cur.b[1] - cur.a[1], cur.b[0] - cur.a[0]);
        let best = -Infinity;
        for (const c of cands) {
          let d = Math.atan2(c.b[1] - c.a[1], c.b[0] - c.a[0]) - inAng;
          while (d <= -Math.PI) d += Math.PI * 2;
          while (d > Math.PI) d -= Math.PI * 2;
          if (d > best) { best = d; next = c; }
        }
      }
      next.used = true; cur = next;
    }
    const ring = dedupe(pts);
    if (ring.length >= 3 && Math.abs(polyArea(ring)) > 1e-9) rings.push(ring);
  }
  return rings;
}

/* ── the operation ────────────────────────────────────────────────────── */

/**
 * op: 'union' | 'difference' | 'intersection' | 'exclusion'
 * A minus B for 'difference'.
 */
export function boolOp(ringsA, ringsB, op) {
  ringsA = ringsA.map(dedupe).filter(r => r.length >= 3);
  ringsB = ringsB.map(dedupe).filter(r => r.length >= 3);
  if (!ringsA.length) return op === 'intersection' || op === 'difference' ? [] : ringsB.slice();
  if (!ringsB.length) return op === 'intersection' ? [] : ringsA.slice();

  const edges = buildEdges(ringsA, ringsB);

  // drop coincident edge pairs (shared borders) — they never bound the result
  const seen = new Map();
  for (const e of edges) {
    const k1 = qk(e.a) + '>' + qk(e.b), k2 = qk(e.b) + '>' + qk(e.a);
    const hit = seen.get(k1) || seen.get(k2);
    if (hit && hit.owner !== e.owner) { hit.dup = true; e.dup = true; }
    else seen.set(k1, e);
  }

  const out = [];
  for (const e of edges) {
    if (e.dup) continue;
    const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
    const other = e.owner === 0 ? ringsB : ringsA;
    if (distToRings(other, mx, my) < 1e-6) continue;           // lies on the other outline
    const inside = insideRings(other, mx, my);
    let keep = false, flip = false;
    switch (op) {
      case 'union': keep = !inside; break;
      case 'intersection': keep = inside; break;
      case 'difference': keep = (e.owner === 0) ? !inside : inside; flip = e.owner === 1; break;
      case 'exclusion': keep = true; flip = inside; break;
    }
    if (!keep) continue;
    out.push(flip ? { a: e.b, b: e.a, owner: e.owner } : { a: e.a, b: e.b, owner: e.owner });
  }
  return chain(out);
}

/** Cut A's outline where B crosses it — returns open polylines. */
export function cutOp(ringsA, ringsB) {
  const edges = buildEdges(ringsA, ringsB).filter(e => e.owner === 0);
  const pieces = []; let cur = null;
  const key = new Map();
  for (const e of edges) {
    const k = qk(e.a);
    if (!key.has(k)) key.set(k, []);
    key.get(k).push(e); e.used = false;
  }
  for (const seed of edges) {
    if (seed.used) continue;
    seed.used = true;
    cur = [seed.a, seed.b];
    let e = seed;
    for (let g = 0; g < 100000; g++) {
      const cands = (key.get(qk(e.b)) || []).filter(x => !x.used);
      if (cands.length !== 1) break;
      e = cands[0]; e.used = true; cur.push(e.b);
      // stop at a crossing point (vertex touched by B)
      if (cands.length > 1) break;
    }
    if (cur.length > 1) pieces.push(cur);
  }
  return pieces;
}

/* ── convenience wrappers over elements' path data ────────────────────── */

export function opSegs(segsA, segsB, op) {
  const rings = boolOp(segsToRings(segsA), segsToRings(segsB), op);
  return ringsToSegs(rings);
}

/* ── offsetting (inset / outset) ──────────────────────────────────────── */

function offsetRing(pts, delta, join = 'miter', miterLimit = 4) {
  const n = pts.length; if (n < 3) return [];
  const cw = polyArea(pts) > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    let n1 = normal(p0, p1), n2 = normal(p1, p2);
    if (!n1 || !n2) continue;
    n1 = [n1[0] * cw, n1[1] * cw]; n2 = [n2[0] * cw, n2[1] * cw];
    const bx = n1[0] + n2[0], by = n1[1] + n2[1];
    const L = Math.hypot(bx, by);
    if (L < 1e-9) { out.push([p1[0] + n1[0] * delta, p1[1] + n1[1] * delta]); continue; }
    const cosHalf = L / 2;
    const scale = 1 / Math.max(cosHalf, 1e-6);
    if (join === 'miter' && scale <= miterLimit) {
      out.push([p1[0] + (bx / L) * delta * scale, p1[1] + (by / L) * delta * scale]);
    } else {
      out.push([p1[0] + n1[0] * delta, p1[1] + n1[1] * delta]);
      if (join === 'round') {
        const a1 = Math.atan2(n1[1], n1[0]), a2 = Math.atan2(n2[1], n2[0]);
        let d = a2 - a1; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        const steps = Math.max(1, Math.ceil(Math.abs(d) / .4));
        for (let s = 1; s < steps; s++) {
          const a = a1 + d * (s / steps);
          out.push([p1[0] + Math.cos(a) * delta, p1[1] + Math.sin(a) * delta]);
        }
      }
      out.push([p1[0] + n2[0] * delta, p1[1] + n2[1] * delta]);
    }
  }
  return dedupe(out);
}

function normal(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  return L < 1e-9 ? null : [dy / L, -dx / L];
}

/** Grow (delta>0) or shrink (delta<0) a filled shape. */
export function offsetRings(rings, delta) {
  const res = [];
  for (const r of rings) {
    const o = offsetRing(r, delta);
    if (o.length >= 3 && Math.abs(polyArea(o)) > 1e-9) res.push(cleanSelfIntersections(o, polyArea(r) > 0));
  }
  return res.filter(r => r.length >= 3);
}

/** Remove small self-intersecting loops produced by offsetting. */
function cleanSelfIntersections(pts, wantCW) {
  const n = pts.length;
  if (n < 8) return pts;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const x = segInt(pts[i], pts[i + 1], pts[j], pts[(j + 1) % n]);
      if (!x) continue;
      const loopA = pts.slice(0, i + 1).concat([x.p], pts.slice(j + 1));
      const loopB = [x.p].concat(pts.slice(i + 1, j + 1));
      const a = Math.abs(polyArea(loopA)), b = Math.abs(polyArea(loopB));
      const pick = a >= b ? loopA : loopB;
      const ok = (polyArea(pick) > 0) === wantCW;
      return cleanSelfIntersections(ok ? pick : (a >= b ? loopB : loopA), wantCW);
    }
  }
  return pts;
}

/* ── stroke → path ────────────────────────────────────────────────────── */

export function strokeOutline(segs, width, cap = 'butt', join = 'miter') {
  const w = Math.max(width, 1e-4) / 2;
  const rings = [];
  for (const sp of flatten(segs, .04)) {
    const pts = dedupe(sp.pts);
    if (pts.length < 2) continue;
    if (sp.closed && pts.length >= 3) {
      const outer = offsetRing(pts, polyArea(pts) > 0 ? w : -w, join);
      const inner = offsetRing(pts, polyArea(pts) > 0 ? -w : w, join);
      if (outer.length >= 3) rings.push(outer);
      if (inner.length >= 3) rings.push(inner.slice().reverse());
    } else {
      rings.push(openOutline(pts, w, cap, join));
    }
  }
  return rings.filter(r => r.length >= 3);
}

function openOutline(pts, w, cap, join) {
  const side = (list, sign) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const nPrev = i > 0 ? normal(list[i - 1], p) : null;
      const nNext = i < list.length - 1 ? normal(p, list[i + 1]) : null;
      const ns = [nPrev, nNext].filter(Boolean);
      if (!ns.length) continue;
      if (ns.length === 1) { out.push([p[0] + ns[0][0] * w * sign, p[1] + ns[0][1] * w * sign]); continue; }
      const bx = ns[0][0] + ns[1][0], by = ns[0][1] + ns[1][1], L = Math.hypot(bx, by);
      if (L < 1e-9) { out.push([p[0] + ns[0][0] * w * sign, p[1] + ns[0][1] * w * sign]); continue; }
      const sc = 1 / Math.max(L / 2, 1e-6);
      if (join === 'miter' && sc <= 4) out.push([p[0] + (bx / L) * w * sign * sc, p[1] + (by / L) * w * sign * sc]);
      else {
        out.push([p[0] + ns[0][0] * w * sign, p[1] + ns[0][1] * w * sign]);
        out.push([p[0] + ns[1][0] * w * sign, p[1] + ns[1][1] * w * sign]);
      }
    }
    return out;
  };
  const A = side(pts, 1), B = side(pts.slice().reverse(), 1);
  const ring = A.slice();
  const endCap = (from, to, at) => {
    if (cap === 'round') {
      const a1 = Math.atan2(from[1] - at[1], from[0] - at[0]);
      const a2 = Math.atan2(to[1] - at[1], to[0] - at[0]);
      let d = a2 - a1; while (d <= 0) d += Math.PI * 2;
      const steps = Math.max(2, Math.ceil(d / .35));
      for (let s = 1; s < steps; s++) {
        const a = a1 + d * (s / steps);
        ring.push([at[0] + Math.cos(a) * w, at[1] + Math.sin(a) * w]);
      }
    } else if (cap === 'square') {
      const dx = at[0] - (from[0] + to[0]) / 2, dy = at[1] - (from[1] + to[1]) / 2;
      const L = Math.hypot(dx, dy) || 1;
      ring.push([from[0] + dx / L * w, from[1] + dy / L * w], [to[0] + dx / L * w, to[1] + dy / L * w]);
    }
  };
  if (A.length && B.length) endCap(A[A.length - 1], B[0], pts[pts.length - 1]);
  ring.push(...B);
  if (A.length && B.length) endCap(B[B.length - 1], A[0], pts[0]);
  return dedupe(ring);
}

/* ── simplify a path (Inkscape Ctrl+L) ────────────────────────────────── */

export function simplifySegs(segs, threshold = 2) {
  const out = [];
  for (const sp of flatten(segs, .05)) {
    const pts = rdp(sp.pts, threshold * .5);
    if (pts.length < 2) continue;
    out.push(...polyToCurves(pts, sp.closed, threshold));
  }
  return out;
}

/** Convert every curve to line segments (Extensions ▸ Flatten Beziers). */
export function flattenSegs(segs, tol = .3) {
  return polysToSegs(flatten(segs, tol));
}
