# InkWeb

A vector graphics editor that runs entirely in the browser, modelled closely on
Inkscape's interface and workflow. No build step, no server, no dependencies —
it's plain ES modules and static files, so you can drop the folder on GitHub
Pages and it just works.

Documents are ordinary SVG. Layers, live shapes (stars, spirals, arcs) and
guides are written using Inkscape's own `inkscape:` / `sodipodi:` attributes, so
files round-trip between InkWeb and desktop Inkscape.

![Shapes drawn in InkWeb: a boolean union, a gradient-filled rounded rectangle,
a calligraphic stroke, text and a freehand curve](demo.png)

*Everything above was drawn with InkWeb's own tools — star ∪ ellipse, a linear
gradient, the calligraphy pen, and freehand pencil with curve fitting.*

---

## Hosting it on GitHub Pages

```bash
cd inkweb
git init -b main
git add -A
git commit -m "Add InkWeb"
gh repo create inkweb --public --source=. --push
```

Then either:

- **Simplest** — repo → *Settings* → *Pages* → Source: **Deploy from a branch**,
  branch `main`, folder `/ (root)`. Done; the included `.nojekyll` file stops
  Jekyll from mangling anything.
- **Or via Actions** — the bundled `.github/workflows/pages.yml` publishes on
  every push once you set Pages Source to **GitHub Actions**.

Your editor lands at `https://<user>.github.io/inkweb/`. Everything uses
relative paths, so a subdirectory deployment works without configuration.

Running locally is just as easy — any static server will do:

```bash
python -m http.server 8000
```

Opening `index.html` straight from disk mostly works too, but browsers block ES
modules on `file://`, so use a server.

---

## Installing it on an iPad or iPhone

Open the page in Safari → **Share** → **Add to Home Screen**. It launches
full-screen, keeps working offline (service worker), and drawings survive
reloads via autosave.

**Touch controls**

| Gesture | Action |
| --- | --- |
| One finger | Draw / select / drag, whatever the active tool does |
| Two fingers | Pan and pinch-zoom (works mid-tool; it cancels the stroke) |
| Long-press | Context menu |
| Two-finger tap on a stroke | Nothing destructive — safe to rest a palm |

On narrow screens the menu bar collapses into a hamburger, the toolbox becomes a
scrollable strip under the canvas, and dialogs slide in as an overlay sheet.
Apple Pencil pressure feeds the calligraphy tool.

---

## What's in it

**Tools** — Selector, Node editor, Rectangle, Ellipse/Arc, Star/Polygon, 3D Box,
Spiral, Pencil, Pen (Bézier), Calligraphy, Text, Gradient, Dropper, Paint
bucket, Tweak, Spray, Eraser, Connector, Measure, Zoom.

**Selector** — click to select, click again for rotate/skew handles, drag a
rubber band, Shift to add, Alt to click through, a draggable rotation centre,
snapping, and X/Y/W/H fields.

**Node editor** — move nodes and handles, insert (double-click or Ins), delete,
break, join, corner/smooth/symmetric, line↔curve, rubber-band node selection,
plus on-canvas parameter handles for the live shapes.

**Paths** — Union, Difference, Intersection, Exclusion, Division, Cut Path,
Combine, Break Apart, Inset/Outset, Simplify, Reverse, Object to Path, Stroke to
Path. The boolean engine splits edges at every crossing, classifies them and
re-chains the result, so holes and multi-part shapes come out right.

**Objects** — groups (with enter/leave), z-order, align & distribute, transform
dialog, clip, mask, lock, hide, linked clones, blend modes, opacity, blur.

**Layers** — add/duplicate/delete/reorder, per-layer visibility, lock, opacity
and blend mode, move selection between layers.

**Text** — on-canvas editing, device fonts, size/weight/style, alignment, line
and letter spacing, and drag-out text frames with real word wrapping.

**Gradients** — linear and radial with on-canvas stop handles, multi-stop
editing, spread modes, reverse.

**Canvas** — rulers with drag-out guides, configurable rectangular/axonometric
grid, snapping (bbox, nodes, centres, grid, guides, page) with a snap toolbar,
and an XML editor that exposes the live document tree.

**Filters** — 14 real SVG filter presets (blur, drop shadow, glow, greyscale,
invert, sepia, saturate, hue rotate, emboss, edge detect, noise, roughen,
posterise) that stay editable in the XML editor.

**Trace Bitmap** — import a raster image and vectorise it by brightness cutoff
or multiple brightness scans, with hole detection, speckle suppression and curve
fitting.

**Import** — SVG, SVGZ, PNG, JPEG, GIF, WebP (drag and drop onto the canvas).

**Export** — SVG, Plain SVG, Optimised SVG, SVGZ, PNG, JPEG, WebP and PDF, from
the page, the drawing, or the selection, at any DPI, with a live preview.

**Also** — 120-step undo history with a browsable list, autosave and crash
recovery, dark/light themes, an Inkscape-style palette (plus Material,
Solarized, greyscale), and Inkscape's keyboard shortcuts.

---

## Known limits

These are honest gaps, not oversights:

- **Text to path** needs the actual font binary to extract glyph outlines, and
  browsers don't expose that. Text stays text; everything else converts.
- **Mesh gradients** (SVG 2) are not rendered by any browser, so the mesh tool
  redirects to the gradient tool.
- **PDF export** embeds a high-resolution raster (with transparency) rather than
  vector drawing operators. For true vector PDF, export SVG and convert.
- **Boolean results are re-fitted from flattened curves**, so a boolean on a
  very small shape may need Simplify afterwards.
- **Live path effects** and multi-page documents aren't implemented.

---

## Layout

```
index.html            markup shell
css/app.css           theme, layout, responsive + touch rules
js/geom.js            matrices, path parsing, flattening, curve fitting
js/bool.js            boolean ops, offsetting, stroke outlining
js/doc.js             document model, history, selection, layers, live shapes
js/view.js            viewport, rulers, grid, guides, snapping, hit testing
js/tools.js           tool framework, pointer/gesture plumbing, Selector, Node
js/tools-shapes.js    Rectangle, Ellipse, Star, Spiral, 3D Box
js/tools-draw.js      Pencil, Pen, Calligraphy, Eraser, Spray, Tweak, Bucket, …
js/tools-text.js      Text (on-canvas editing) and Gradient
js/commands.js        every menu command
js/dialogs.js         docked panels
js/ui.js              menus, bars, palette, status bar, shortcuts
js/io.js              open, save, export, PDF writer, autosave
js/raster.js          serialisation and rasterisation
js/trace.js           bitmap tracing
js/dom.js             DOM helper, icon set, modals
```

`window.InkWeb` exposes `App`, `TOOLS`, `CMD` and friends if you want to script
the editor from the console.

## Licence

MIT — see [LICENSE](LICENSE). Not affiliated with or endorsed by the Inkscape
project; it's an independent implementation inspired by their interface.
