/* ==========================================================================
   main.js — bootstrap
   ========================================================================== */

import { App, bus, historyInit, commit, select } from './doc.js';
import { initView, update, zoomPage, resize } from './view.js';
import { initTools, setTool, redraw, TOOLS } from './tools.js';
import './tools-shapes.js';
import './tools-draw.js';
import './tools-text.js';
import { CMD, runCmd } from './commands.js';
import { buildUI, refreshUI } from './ui.js';
import { openPanel } from './dialogs.js';
import {
  newDocument, registerFileCommands, initAutosave, recoverySnapshot, clearRecovery,
  adoptDocument, importFile, openFile
} from './io.js';
import { h, modal, toast } from './dom.js';

function boot() {
  /* theme */
  const theme = localStorage.getItem('inkweb.theme') || 'dark';
  document.documentElement.dataset.theme = theme;
  App.prefs.theme = theme;
  document.documentElement.dataset.rulers = App.prefs.rulers ? 'on' : 'off';

  /* document + canvas */
  newDocument();
  initView();
  registerFileCommands();
  initTools();
  buildUI();
  setTool('select');
  historyInit();
  update();
  zoomPage();
  redraw();
  initAutosave();

  /* the canvas has no size until layout settles — fit the page once it does */
  bus.on('firstsize', () => { zoomPage(); redraw(); });

  /* first-run panel so the app doesn't look empty */
  if (innerWidth > 1100) openPanel('fill');
  refreshUI();

  offerRecovery();
  wireDragDrop();
  wireOrientation();
  registerSW();

  // handy for debugging and for scripting the editor from the console
  window.InkWeb = { App, bus, TOOLS, CMD, setTool, redraw, runCmd, openPanel, commit, select };

  console.log('%cInkWeb ready', 'color:#4a90d9;font-weight:bold');
}

/* ── crash / reload recovery ──────────────────────────────────────────── */

function offerRecovery() {
  const snap = recoverySnapshot();
  if (!snap || !snap.svg) return;
  const age = Date.now() - (snap.t || 0);
  if (age > 1000 * 60 * 60 * 24 * 14) { clearRecovery(); return; }
  const when = new Date(snap.t).toLocaleString();
  modal({
    title: 'Restore previous drawing?',
    body: h('div',
      h('p', `A drawing from ${when} was found in this browser.`),
      h('p', { class: 'tiny' }, snap.name || 'drawing.svg')),
    buttons: [
      { label: 'Start fresh', fn: () => { clearRecovery(); } },
      {
        label: 'Restore', primary: true, fn: () => {
          try {
            const doc = new DOMParser().parseFromString(snap.svg, 'image/svg+xml');
            if (doc.querySelector('parsererror')) throw new Error('corrupt snapshot');
            adoptDocument(doc.documentElement, snap.name || 'drawing.svg');
            toast('Drawing restored');
          } catch (e) { toast('Could not restore: ' + e.message, 'err'); }
        }
      }
    ]
  });
}

/* ── drag & drop files onto the canvas ────────────────────────────────── */

function wireDragDrop() {
  const stop = e => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => addEventListener(ev, stop, false));
  addEventListener('drop', e => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    if (files.length === 1 && /\.svgz?$/i.test(files[0].name) && !App.dirty) openFile(files[0]);
    else files.forEach(importFile);
  });
}

/* ── viewport quirks on phones ────────────────────────────────────────── */

function wireOrientation() {
  const fix = () => { document.documentElement.style.setProperty('--vh', innerHeight + 'px'); resize(); };
  addEventListener('resize', fix);
  addEventListener('orientationchange', () => setTimeout(fix, 220));
  visualViewport?.addEventListener('resize', fix);
  fix();
  // iOS Safari: stop the page itself from scrolling / rubber-banding
  document.addEventListener('touchmove', e => {
    if (e.target.closest('#canvas-wrap')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
}

/* ── offline support ──────────────────────────────────────────────────── */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  const url = new URL('sw.js', location.href.replace(/[^/]*$/, ''));
  navigator.serviceWorker.register(url, { scope: './' }).catch(() => { /* offline mode unavailable */ });
}

/* ── go ───────────────────────────────────────────────────────────────── */

addEventListener('error', e => {
  console.error(e.error || e.message);
});

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
