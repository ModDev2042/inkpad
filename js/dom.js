/* ==========================================================================
   dom.js — tiny DOM builder, icon set, modal helper
   ========================================================================== */

export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)) { kids.unshift(attrs); attrs = null; }
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
export const clear = n => { n.replaceChildren(); return n; };

/* ── icons: raw inner SVG on a 24×24 grid ─────────────────────────────── */

export const ICONS = {
  /* toolbox */
  select: '<path d="M6 3l13 7.4-5.9 1.5-1.6 5.9z" fill="currentColor" stroke="none"/>',
  node: '<path d="M4 17c5 0 9-10 16-10"/><rect x="1.5" y="14.5" width="5" height="5" rx="1" fill="currentColor"/><rect x="17.5" y="4.5" width="5" height="5" rx="1"/>',
  rect: '<rect x="3.5" y="6.5" width="17" height="11" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
  star: '<path d="M12 3l2.6 6.1 6.6.5-5 4.3 1.5 6.4L12 17l-5.7 3.3 1.5-6.4-5-4.3 6.6-.5z"/>',
  box3d: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  spiral: '<path d="M12 12a2 2 0 1 1 2.2 2 4.2 4.2 0 1 1-4.6-4.2 6.4 6.4 0 1 1 6.9 6.6"/>',
  pencil: '<path d="M4 20l1.2-4.2L16 5a2 2 0 0 1 2.8 2.8L8 18.6z"/><path d="M14.2 6.8l3 3"/>',
  pen: '<path d="M3 21c6-1 8-3 9-6"/><path d="M12 15c4-1 6-4 6-8 0-2-1-4-3-4-3 0-4 3-4 6z"/>',
  calligraphy: '<path d="M4 20c3-1 6-4 9-9s5-7 6-7c1 0 1 2-1 6s-6 8-9 9c-2 .6-3 .5-3 .5z" fill="currentColor" stroke="none"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  gradient: '<defs><linearGradient id="_gi" x1="0" x2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="3.5" y="6.5" width="17" height="11" fill="url(#_gi)"/>',
  mesh: '<rect x="3.5" y="5.5" width="17" height="13"/><path d="M3.5 12h17M12 5.5v13"/>',
  dropper: '<path d="M15 4l5 5-2 2-1-1-6.5 6.5L7 20l-3 1 1-3 .5-3.5L12 8l-1-1z"/>',
  bucket: '<path d="M9 3l9 9-7 7-9-9z"/><path d="M20 15c0 1.7-1 3-2.2 3S16 16.7 16 15s2-3 2-3 2 1.3 2 3z" fill="currentColor"/>',
  tweak: '<path d="M12 4v6M12 14v6M4 12h6M14 12h6"/><circle cx="12" cy="12" r="2.2"/>',
  spray: '<path d="M9 9h6v11H9z"/><path d="M11 9V5h2v4"/><circle cx="18" cy="5" r="1"/><circle cx="20" cy="9" r="1"/><circle cx="17.5" cy="12" r="1"/>',
  eraser: '<path d="M8 19h11"/><path d="M15.5 4.5l4 4-9 9h-4l-2.5-2.5z"/>',
  connector: '<circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="6" r="2.5"/><path d="M7 16.5L17 7.5"/>',
  measure: '<path d="M3 15l12-12 6 6-12 12z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5M8.5 11h5M11 8.5v5"/>',
  page: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',

  /* file / edit */
  new: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 10v7M8.5 13.5h7"/>',
  open: '<path d="M3 7h6l2 2h10v10H3z"/>',
  save: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
  import: '<path d="M12 3v10M8 10l4 4 4-4"/><path d="M4 16v4h16v-4"/>',
  export: '<path d="M12 15V5M8 8l4-4 4 4"/><path d="M4 16v4h16v-4"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 0 12h-2"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0 0 12h2"/>',
  cut: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 16L18 4M16 16L6 4"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="1"/><path d="M15.5 5.5h-11v11"/>',
  paste: '<path d="M8 5H5v16h14V5h-3"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
  dup: '<rect x="4.5" y="4.5" width="11" height="11" rx="1"/><rect x="8.5" y="8.5" width="11" height="11" rx="1"/>',
  delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  'select-all': '<rect x="3.5" y="3.5" width="17" height="17" stroke-dasharray="3 2.4"/><rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none"/>',
  deselect: '<rect x="3.5" y="3.5" width="17" height="17" stroke-dasharray="3 2.4"/>',

  /* object */
  group: '<rect x="3.5" y="3.5" width="17" height="17" stroke-dasharray="3 2.4"/><rect x="6" y="6" width="6" height="6"/><rect x="12" y="12" width="6" height="6"/>',
  ungroup: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  raise: '<path d="M12 20V6M7 11l5-5 5 5"/>',
  lower: '<path d="M12 4v14M7 13l5 5 5-5"/>',
  top: '<path d="M4 4h16M12 21V8M7 13l5-5 5 5"/>',
  bottom: '<path d="M4 20h16M12 3v13M7 11l5 5 5-5"/>',
  'flip-h': '<path d="M12 3v18"/><path d="M9 7L3 12l6 5zM15 7l6 5-6 5z"/>',
  'flip-v': '<path d="M3 12h18"/><path d="M7 9L12 3l5 6zM7 15l5 6 5-6z"/>',
  'rot-cw': '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  'rot-ccw': '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>',

  /* path ops */
  union: '<circle cx="9" cy="12" r="6" fill="currentColor" stroke="none" opacity=".85"/><circle cx="15" cy="12" r="6" fill="currentColor" stroke="none" opacity=".85"/>',
  difference: '<circle cx="9" cy="12" r="6" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="6" fill="var(--bg2,#2e3235)" stroke="currentColor"/>',
  intersection: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M12 6.6a6 6 0 0 0 0 10.8 6 6 0 0 0 0-10.8z" fill="currentColor" stroke="none"/>',
  exclusion: '<circle cx="9" cy="12" r="6" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="6" fill="currentColor" stroke="none"/><path d="M12 6.6a6 6 0 0 0 0 10.8 6 6 0 0 0 0-10.8z" fill="var(--bg2,#2e3235)" stroke="none"/>',
  division: '<circle cx="12" cy="12" r="7"/><path d="M4 8l16 4"/>',
  cutpath: '<circle cx="12" cy="12" r="7" stroke-dasharray="4 3"/><path d="M4 8l16 4"/>',
  'to-path': '<path d="M4 18c4-12 12-12 16 0"/><rect x="1.8" y="15.8" width="4.4" height="4.4"/><rect x="17.8" y="15.8" width="4.4" height="4.4"/>',

  /* node tool */
  'node-add': '<path d="M4 16c5 0 10-8 16-8"/><path d="M12 8v7M8.5 11.5h7" stroke-width="2"/>',
  'node-del': '<path d="M4 16c5 0 10-8 16-8"/><path d="M9 13l6 6M15 13l-6 6"/>',
  'node-break': '<path d="M3 17c3 0 5-3 6-5M15 12c1-2 3-5 6-5"/><circle cx="10.5" cy="10.5" r="1.8"/><circle cx="13.5" cy="13.5" r="1.8"/>',
  'node-join': '<path d="M3 17c4 0 6-5 9-5s5 5 9 5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>',
  'node-corner': '<path d="M4 20V8h12"/><rect x="1.8" y="17.8" width="4.4" height="4.4" fill="currentColor"/>',
  'node-smooth': '<path d="M3 18c6 0 8-12 18-12"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>',
  'node-sym': '<path d="M4 12h16"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/><circle cx="4" cy="12" r="1.6"/><circle cx="20" cy="12" r="1.6"/>',
  'seg-line': '<path d="M4 19L20 5"/><rect x="1.8" y="16.8" width="4.4" height="4.4"/><rect x="17.8" y="2.8" width="4.4" height="4.4"/>',
  'seg-curve': '<path d="M4 19C4 9 14 5 20 5"/><rect x="1.8" y="16.8" width="4.4" height="4.4"/><rect x="17.8" y="2.8" width="4.4" height="4.4"/>',
  handles: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7.4 16.6L16.6 7.4"/>',

  /* zoom / view */
  'zoom-page': '<rect x="6.5" y="3.5" width="11" height="17"/><path d="M3 8V3h4M21 8V3h-4M3 16v5h4M21 16v5h-4"/>',
  'zoom-draw': '<path d="M5 15c3-8 7-8 10-4s4 4 4 4"/><rect x="2.5" y="2.5" width="19" height="19" stroke-dasharray="3 2.4"/>',
  'zoom-sel': '<rect x="7.5" y="7.5" width="9" height="9" fill="currentColor" stroke="none"/><path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/>',
  'zoom-1': '<path d="M6 8l3-2v12M14 6h4l-4 12h4"/>',
  grid: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  snap: '<path d="M5 4v9a7 7 0 0 0 14 0V4"/><path d="M3 4h4M17 4h4"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19"/>',
  eye: '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  'eye-off': '<path d="M4 4l16 16"/><path d="M9.5 5.8A11 11 0 0 1 12 5.5c6.2 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4M6.6 7.6A17 17 0 0 0 2 12s3.8 6.5 10 6.5a11 11 0 0 0 3.4-.5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',

  /* panels */
  fill: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" fill="currentColor" stroke="none"/>',
  stroke: '<path d="M4 12h16" stroke-width="4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5"/>',
  objects: '<rect x="3.5" y="3.5" width="7" height="7"/><rect x="13.5" y="3.5" width="7" height="7"/><rect x="3.5" y="13.5" width="7" height="7"/><rect x="13.5" y="13.5" width="7" height="7"/>',
  xml: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5M13.5 4l-3 16"/>',
  align: '<path d="M3 3v18"/><rect x="6" y="5" width="12" height="4"/><rect x="6" y="14" width="7" height="4"/>',
  transform: '<rect x="4" y="4" width="8" height="8"/><path d="M14 14l6-6M20 8v5h-5"/><rect x="12" y="12" width="8" height="8" stroke-dasharray="3 2"/>',
  docprops: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
  filter: '<path d="M3 5h18l-7 8v7l-4-2v-5z"/>',
  history: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5M12 8v5l3.5 2"/>',
  trace: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 2.6"/><path d="M12 4a8 8 0 0 1 0 16"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.8 2.8 0 1 1 3.4 3.2c-.6.2-.7.7-.7 1.3"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M4 12.5l5 5L20 6"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',

  /* misc toolbar */
  bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z" stroke-width="1.8"/>',
  italic: '<path d="M10 4h8M6 20h8M14.5 4l-5 16"/>',
  'align-left': '<path d="M4 6h16M4 11h10M4 16h13M4 21h8"/>',
  'align-center': '<path d="M4 6h16M7 11h10M5.5 16h13M8 21h8"/>',
  'align-right': '<path d="M4 6h16M10 11h10M7 16h13M12 21h8"/>',
  'grad-linear': '<defs><linearGradient id="_gl" x1="0" x2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="3.5" y="6.5" width="17" height="11" fill="url(#_gl)"/>',
  'grad-radial': '<defs><radialGradient id="_gr"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs><rect x="3.5" y="6.5" width="17" height="11" fill="url(#_gr)"/>',
  pie: '<path d="M12 12V4a8 8 0 1 0 8 8z"/>',
  arc: '<path d="M4 16a8 8 0 0 1 16 0"/>',
  chord: '<path d="M4 16a8 8 0 0 1 16 0z"/>',
  'circle-full': '<circle cx="12" cy="12" r="8"/>',
  polygon: '<path d="M12 4l7.4 5.4-2.8 8.7H7.4L4.6 9.4z"/>',
  sharp: '<path d="M5 19V5h14"/>',
  'stroke-scale': '<path d="M4 18h16" stroke-width="3"/><path d="M6 8l4-4M14 8l4-4"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3.5" y="9.5" width="17" height="7" rx="1"/><path d="M7 15h10v6H7z"/>'
};

export function icon(name, cls = 'ico') {
  const body = ICONS[name];
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', cls);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.6');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = body || '<circle cx="12" cy="12" r="8"/>';
  return s;
}

/* ── modal ────────────────────────────────────────────────────────────── */

export function modal({ title, body, buttons = [], width, onClose }) {
  const scrim = document.getElementById('scrim');
  const root = document.getElementById('modal-root');
  const close = () => { box.remove(); scrim.hidden = true; scrim.onclick = null; onClose && onClose(); };
  const box = h('div', { class: 'modal', style: width ? { width } : null },
    h('header', title, h('button', { class: 'x', onclick: close, title: 'Close' }, icon('close'))),
    h('div', { class: 'content' }, body),
    buttons.length ? h('footer', buttons.map(b =>
      h('button', {
        class: 'btn ' + (b.primary ? 'primary' : 'ghost'),
        onclick: () => { const r = b.fn ? b.fn() : true; if (r !== false) close(); }
      }, b.label))) : null
  );
  root.appendChild(box);
  scrim.hidden = false;
  scrim.onclick = close;
  return { close, box };
}

export function toast(msg, kind) {
  let t = document.getElementById('toaster');
  if (!t) { t = h('div', { id: 'toaster' }); document.body.appendChild(t); }
  const n = h('div', { class: 'toast ' + (kind || '') }, msg);
  t.appendChild(n);
  setTimeout(() => { n.style.opacity = '0'; n.style.transition = 'opacity .3s'; }, 2200);
  setTimeout(() => n.remove(), 2600);
}
