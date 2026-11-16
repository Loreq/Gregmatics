/* View-only 3D of the plan. Drag turns, right-drag slides, the wheel zooms toward the pointer.
   Double-click frames the thing under the pointer. Double-click empty ground fits the base.
   view3d-scene.js turns the plan into triangles, view3d-camera.js holds the camera's arithmetic,
   and this file draws the scene with Three.js, paints the names over it, and reads the pointer. */
(function (root) {
  "use strict";

  const { lighten, Triangles } = root.Mesh3D;
  const Camera = root.Camera3D;

  const NO_SCENE = { origin: [0, 0, 0], opaque: null, clear: null, segs: [], picks: [], labels: [], slabs: [], bounds: null };
  const TAG_HALO = "rgba(244, 241, 234, 0.92)";
  const TAG_INK = "#241e18";
  // A room narrower than this on screen gets no name.
  const SMALLEST_NAMED_ROOM = 48;
  const VERTEX_SHADER = `
      attribute vec3 aPos;
      attribute vec3 aNrm;
      attribute vec4 aCol;
      uniform mat4 uMvp;
      varying vec3 vNrm;
      varying vec4 vCol;
      void main() {
        gl_Position = uMvp * vec4(aPos, 1.0);
        vNrm = aNrm;
        vCol = aCol;
      }
    `;
  const FRAGMENT_SHADER = `
      precision mediump float;
      varying vec3 vNrm;
      varying vec4 vCol;
      void main() {
        vec3 n = normalize(vNrm);
        vec3 L = normalize(vec3(0.35, 0.86, 0.28));
        float nd = max(dot(n, L), 0.0);
        float up = clamp(n.y, 0.0, 1.0);
        float light = min(1.0, 0.84 + 0.10 * up + 0.06 * nd);
        gl_FragColor = vec4(vCol.rgb * light, vCol.a);
      }
    `;

  // The picture canvas, and the plain canvas over it that names are painted on.
  const canvas = { el: null };
  const tags = { el: null, ctx: null };
  let layout = null;
  let catalog = null;
  // The ids of the floors that are shown, or null for all of them.
  let shown = null;
  let tell = function () {};
  // The plan's fill for a multiblock, handed in by the editor so both views use one table.
  let padColor = function () { return "#A3988C"; };
  let scene = NO_SCENE;
  let hovered = null;
  let drag = null;
  let viewFrame = 0;
  const cam = Camera.create();

  // The picture: one renderer, and one mesh for each list of triangles, in draw order.
  let renderer = null;
  let stage = null;
  let camera = null;
  const mesh = { solid: null, lines: null, glass: null, hover: null };
  const bufferSize = { w: 0, h: 0 };
  // What the outline and hover buffers were last built for, so they are rebuilt only when that changes.
  let edgeKey = "";
  let hoverKey = "";
  const matProj = new Float32Array(16);
  const matView = new Float32Array(16);
  const matMvp = new Float32Array(16);

  // ---- the scene ----

  /** Whether a floor or the crawl is shown. */
  function visible(id) {
    return !shown || shown.has(id);
  }

  /** Build the scene again from the plan and hand it to WebGL. Nothing is hovered afterwards. */
  function rebuild() {
    scene = NO_SCENE;
    edgeKey = "";
    hoverKey = "";
    hovered = null;
    tell("");
    scene = root.Scene3D.build(layout, catalog, visible, padColor);
    uploadMesh();
  }

  /** The width of the canvas over its height. */
  function aspect() {
    return (canvas.el.clientWidth || 1) / (canvas.el.clientHeight || 1);
  }

  // ---- the picture ----

  /** One mesh of corners, added in the order it should be drawn. */
  function makePass(material) {
    const item = new root.THREE.Mesh(new root.THREE.BufferGeometry(), material);
    item.frustumCulled = false;
    stage.add(item);
    return item;
  }

  /** Make the renderer and the four meshes. Returns false when the renderer cannot be created. */
  function setup(el) {
    const THREE = root.THREE;
    if (!THREE) return false;
    const previous = el.getContext;
    /** Keep the canvas opaque. This Three build turns alpha on anyway. */
    function keepOpaque(kind, attrs) {
      if (attrs) attrs.alpha = false;
      return previous.call(this, kind, attrs);
    }
    el.getContext = keepOpaque;
    let created;
    try {
      created = new THREE.WebGLRenderer({
        canvas: el,
        antialias: true,
        alpha: false,
      });
    } catch (err) {
      created = null;
    } finally {
      el.getContext = previous;
    }
    if (!created) return false;
    // Linear output leaves the clear color at the same 0.173, 0.149, 0.133.
    created.outputColorSpace = THREE.LinearSRGBColorSpace;
    created.sortObjects = false;
    const clear = new THREE.Color();
    clear.r = 0.173;
    clear.g = 0.149;
    clear.b = 0.133;
    created.setClearColor(clear, 1);
    stage = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    camera.matrixAutoUpdate = false;
    camera.matrixWorldAutoUpdate = false;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { uMvp: { value: matMvp } },
      blending: THREE.CustomBlending,
      depthFunc: THREE.LessDepth,
      side: THREE.DoubleSide,
    });
    mesh.solid = makePass(material);
    mesh.lines = makePass(material);
    mesh.glass = makePass(material);
    mesh.hover = makePass(material);
    renderer = created;
    return true;
  }

  /** Replace one mesh's corners with the next list of floats. */
  function fillGeometry(item, data) {
    const THREE = root.THREE;
    const array = data && data.length ? data : new Float32Array(0);
    const geometry = new THREE.BufferGeometry();
    const buffer = new THREE.InterleavedBuffer(array, root.Mesh3D.CORNER_SIZE);
    geometry.setAttribute("aPos", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute("aNrm", new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    geometry.setAttribute("aCol", new THREE.InterleavedBufferAttribute(buffer, 4, 6));
    geometry.setDrawRange(0, array.length / root.Mesh3D.CORNER_SIZE);
    const previous = item.geometry;
    item.geometry = geometry;
    item.visible = array.length > 0;
    if (previous) previous.dispose();
  }

  /** Hand the scene's solid and glass triangles to the picture. The outlines follow at the next draw. */
  function uploadMesh() {
    if (!renderer || !mesh.solid) return;
    fillGeometry(mesh.solid, scene.opaque);
    fillGeometry(mesh.glass, scene.clear);
    edgeKey = "";
    hoverKey = "";
  }

  // ---- outlines, which keep one width on screen ----

  /** How wide an outline is in blocks, so it stays about a pixel wide at this distance. */
  function edgePixelWidth() {
    const h = canvas.el.clientHeight || 1;
    const worldPerPx = (2 * cam.dist * Math.tan(Camera.HALF_FOV)) / h;
    return Math.min(0.05, Math.max(0.02, worldPerPx * 0.85));
  }

  /** Rebuild the outline triangles when their width or their number has changed. */
  function refreshEdges() {
    const width = edgePixelWidth();
    const stamp = `${width.toFixed(3)}:${scene.segs.length}`;
    if (stamp === edgeKey) return;
    edgeKey = stamp;
    const bars = new Triangles(scene.origin);
    for (const s of scene.segs) bars.ribbon(s[0], s[1], s[2], s[3], s[4], s[5], s[6], width);
    fillGeometry(mesh.lines, bars.toArray());
  }

  /** Add the twelve edges of a box to a list of triangles, as bars. */
  function boxEdges(bars, box, color, width) {
    const [x0, y0, z0, x1, y1, z1] = box;
    const edge = (ax, ay, az, bx, by, bz) => bars.ribbon(ax, ay, az, bx, by, bz, color, width);
    edge(x0, y0, z0, x1, y0, z0);
    edge(x1, y0, z0, x1, y0, z1);
    edge(x1, y0, z1, x0, y0, z1);
    edge(x0, y0, z1, x0, y0, z0);
    edge(x0, y1, z0, x1, y1, z0);
    edge(x1, y1, z0, x1, y1, z1);
    edge(x1, y1, z1, x0, y1, z1);
    edge(x0, y1, z1, x0, y1, z0);
    edge(x0, y0, z0, x0, y1, z0);
    edge(x1, y0, z0, x1, y1, z0);
    edge(x0, y0, z1, x0, y1, z1);
    edge(x1, y0, z1, x1, y1, z1);
  }

  /** Rebuild the bright box around the hovered thing when it or the outline width has changed. */
  function refreshHover() {
    const width = edgePixelWidth();
    const stamp = hovered ? `${hovered.box.join(",")}:${width.toFixed(3)}` : "";
    if (stamp === hoverKey) return;
    hoverKey = stamp;
    const bars = new Triangles(scene.origin);
    if (hovered) boxEdges(bars, hovered.box, lighten(hovered.color, 0.58), width * 1.8);
    fillGeometry(mesh.hover, bars.toArray());
  }

  // ---- names painted over the picture ----

  /** Where a point in block coordinates lands on the canvas, or null. */
  function project(x, y, z, w, h) {
    return Camera.project(matMvp, scene.origin, x, y, z, w, h);
  }

  /**
   * Whether a floor above cuts the line from the eye to a point, both in block coordinates.
   * Names are painted over the scene, so this is what hides one on a floor below.
   */
  function covered(eye, x, y, z) {
    for (const slab of scene.slabs) {
      if (slab.y <= y + 0.5 || slab.y >= eye[1]) continue;
      const t = (eye[1] - slab.y) / (eye[1] - y);
      const px = eye[0] + (x - eye[0]) * t;
      const pz = eye[2] + (z - eye[2]) * t;
      if (px >= slab.x0 && px <= slab.x1 && pz >= slab.z0 && pz <= slab.z1) return true;
    }
    return false;
  }

  /** Paint text with a pale edge, so it reads over any color. */
  function halo(ctx, text, x, y) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = TAG_HALO;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = TAG_INK;
    ctx.fillText(text, x, y);
  }

  /** The size on screen of a room's floor, as [width, height], or null when under two corners are in view. */
  function roomOnScreen(item, w, h) {
    const corners = [
      project(item.x0, item.y, item.z0, w, h),
      project(item.x1, item.y, item.z0, w, h),
      project(item.x1, item.y, item.z1, w, h),
      project(item.x0, item.y, item.z1, w, h),
    ].filter(Boolean);
    if (corners.length < 2) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of corners) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return [maxX - minX, maxY - minY];
  }

  /** Paint a room's name where the plan puts it. A room too small on screen for its name gets its code, or nothing. */
  function paintRoomName(ctx, item, w, h) {
    const size = roomOnScreen(item, w, h);
    if (!size || Math.min(size[0], size[1]) < SMALLEST_NAMED_ROOM) return;
    const at = project(item.x, item.y, item.z, w, h);
    if (!at) return;
    const [pw, ph] = size;
    ctx.font = `bold ${Math.max(11, Math.min(18, Math.max(pw, ph) / 9))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let text = item.name;
    if (ctx.measureText(text).width > pw * 0.82) text = item.code || text;
    if (ctx.measureText(text).width > pw * 0.9) return;
    halo(ctx, text, at.x, at.y);
  }

  /** Paint a street's name, turned on its side when the plan says so. A street seen from too far gets none. */
  function paintStreetName(ctx, item, w, h) {
    const alongX = (item.x1 - item.x0) >= (item.z1 - item.z0);
    const a = project(item.x, item.y, item.z, w, h);
    const b = project(item.x + (alongX ? 4 : 0), item.y, item.z + (alongX ? 0 : 4), w, h);
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 22) return;
    ctx.font = "bold 12px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(a.x, a.y);
    if (item.vertical) ctx.rotate(-Math.PI / 2);
    halo(ctx, item.name, 0, 0);
    ctx.restore();
  }

  /** The canvas for names, sized to the 3D canvas and wiped, as { ctx, w, h }. Null when the page has none. */
  function clearTags() {
    const el = tags.el || (typeof document !== "undefined" ? document.getElementById("space-tags") : null);
    if (!el || !canvas.el) return null;
    tags.el = el;
    if (!tags.ctx) tags.ctx = el.getContext("2d");
    const w = canvas.el.clientWidth || 1;
    const h = canvas.el.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (el.width !== pw || el.height !== ph) {
      el.width = pw;
      el.height = ph;
    }
    tags.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tags.ctx.clearRect(0, 0, w, h);
    return { ctx: tags.ctx, w, h };
  }

  /** Paint every room and street name that no floor above hides. */
  function paintLabels() {
    const page = clearTags();
    if (!page) return;
    const eye = Camera.eye(cam).map((v, i) => v + scene.origin[i]);
    for (const item of scene.labels) {
      if (covered(eye, item.x, item.y, item.z)) continue;
      if (item.kind === "room") paintRoomName(page.ctx, item, page.w, page.h);
      else if (item.kind === "street") paintStreetName(page.ctx, item, page.w, page.h);
    }
  }

  // ---- drawing ----

  /** Match the renderer to the drawing buffer. Leave the page CSS alone. */
  function syncSize() {
    const w = canvas.el.width;
    const h = canvas.el.height;
    if (w === bufferSize.w && h === bufferSize.h) return;
    bufferSize.w = w;
    bufferSize.h = h;
    renderer.setSize(w, h, false);
  }

  /** Make the canvas as many pixels as it is shown at. */
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round((canvas.el.clientWidth || 1) * dpr);
    const ph = Math.round((canvas.el.clientHeight || 1) * dpr);
    if (canvas.el.width !== pw || canvas.el.height !== ph) {
      canvas.el.width = pw;
      canvas.el.height = ph;
    }
  }

  /** Work out the matrix that takes the scene to the screen from where the camera stands. */
  function aimCamera() {
    Camera.perspective(matProj, canvas.el.width / Math.max(1, canvas.el.height), cam.dist);
    Camera.lookAt(matView, Camera.eye(cam), cam.target);
    Camera.multiply(matMvp, matProj, matView);
  }

  /** Draw the scene now: solids, outlines, glass, the hover box, then the names. */
  function draw() {
    if (!renderer || !scene.opaque) return;
    fitCanvas();
    syncSize();
    aimCamera();
    camera.projectionMatrix.fromArray(matProj);
    camera.matrixWorldInverse.fromArray(matView);
    refreshEdges();
    refreshHover();
    renderer.render(stage, camera);
    paintLabels();
  }

  /** Draw at the next frame. Many moves before then share one draw. */
  function drawSoon() {
    if (viewFrame) return;
    viewFrame = requestAnimationFrame(() => {
      viewFrame = 0;
      draw();
    });
  }

  // ---- the pointer ----

  /** The ray from the eye through the pointer, or null while the canvas has no size. */
  function pointerRay(event) {
    const rect = canvas.el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    return Camera.ray(cam, ndcX, ndcY, rect.width / rect.height);
  }

  /** What is under the pointer, or null. */
  function thingAt(event) {
    const ray = pointerRay(event);
    return ray ? Camera.pick(scene.picks, ray) : null;
  }

  /** Light up what is under the pointer and tell the page its name. */
  function look(event) {
    const hit = thingAt(event);
    if (hit === hovered) return;
    hovered = hit;
    tell(hit ? hit.name : "");
    drawSoon();
  }

  /** A press of the left or right button starts a drag. */
  function onDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button };
    canvas.el.classList.add("dragging");
    try { canvas.el.setPointerCapture(event.pointerId); } catch (err) { /* Move events still arrive. */ }
  }

  /** A move turns the camera, or slides it with the right button or Shift. With no drag it looks. */
  function onMove(event) {
    if (!drag || drag.id !== event.pointerId) {
      if (!drag) look(event);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.button === 2 || event.shiftKey) Camera.slide(cam, dx, dy);
    else Camera.turn(cam, dx, dy);
    drawSoon();
  }

  /** A release ends the drag. */
  function onUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    canvas.el.classList.remove("dragging");
    look(event);
  }

  /** The wheel zooms, toward whatever is under the pointer. */
  function onWheel(event) {
    event.preventDefault();
    const ray = pointerRay(event);
    const hit = ray ? Camera.pick(scene.picks, ray) : null;
    Camera.zoom(cam, Math.exp(event.deltaY * 0.001), ray, hit);
    drawSoon();
    look(event);
  }

  /** A double-click frames the thing under the pointer, or the whole base on empty ground. */
  function onDouble(event) {
    const hit = thingAt(event);
    if (hit) Camera.frameBox(cam, hit, aspect());
    else reset();
    draw();
  }

  /** Listen to the canvas. This happens once, when WebGL starts. */
  function listen(el) {
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("contextmenu", (event) => event.preventDefault());
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDouble);
  }

  // ---- what the editor calls ----

  /** Look at the whole base from the home angle. */
  function reset() {
    Camera.home(cam);
    if (scene.bounds) Camera.frameScene(cam, scene.bounds, scene.origin, aspect());
    draw();
  }

  /**
   * Show a plan on a canvas. `onHover(name)` hears what is under the pointer, and `fill(spec)` gives a
   * multiblock's color. Returns false when the renderer cannot be created.
   */
  function open(el, nextLayout, nextCatalog, onHover, fill) {
    canvas.el = el;
    layout = nextLayout;
    catalog = nextCatalog;
    tell = onHover || function () {};
    if (fill) padColor = fill;
    shown = null;
    hovered = null;
    if (!renderer) {
      if (!setup(el)) return false;
      listen(el);
    }
    rebuild();
    reset();
    return true;
  }

  /** Show or hide one floor, or the crawl. */
  function setVisible(id, on) {
    if (!layout) return;
    if (!shown) shown = new Set(root.Core.layers(layout).map((layer) => layer.id));
    if (on) shown.add(id);
    else shown.delete(id);
    rebuild();
    draw();
  }

  /** The canvas changed size. */
  function resize() {
    draw();
  }

  /** Stop drawing and wipe the names. The scene is kept for the next open. */
  function close() {
    if (viewFrame) cancelAnimationFrame(viewFrame);
    viewFrame = 0;
    drag = null;
    hovered = null;
    if (canvas.el) canvas.el.classList.remove("dragging");
    if (tags.ctx && tags.el) {
      tags.ctx.setTransform(1, 0, 0, 1, 0, 0);
      tags.ctx.clearRect(0, 0, tags.el.width, tags.el.height);
    }
  }

  root.View3D = { open, close, resize, setVisible, reset };
}(window));
