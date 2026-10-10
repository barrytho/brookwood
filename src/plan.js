/* Plate I. Plan of the London Necropolis at Brookwood.
 *
 *   window.BrookwoodPlan.mount(host, { geo, markers, onSelect, onOpen })
 *     → { select(id, { pan }), setFilter(fn), showWalk(ids | null), reset() }
 *
 * Drawn as an engraved estate plan in a single SVG. The root viewBox is in metres (a local equirectangular
 * projection centred on the boundary, north up), and panning or zooming moves that viewBox. Line work uses
 * non-scaling strokes, so its weight and the railway's bars stay constant on screen. The lettering, tree glyphs,
 * stations, key numbers, compass and scales sit in a pixel overlay (its transform undoes the viewBox), so they keep
 * their size at every zoom. Key numbers that collide are separated in screen space by a small deterministic
 * relaxation once a pan or zoom settles, with a hairline leader back to the true position; lettering is then set
 * greedily, in order of importance, wherever it clears the numbers, the instruments and the other lettering.
 */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const CHAIN_M = 20.1168;                       // Gunter's chain
  const HINT_WHEEL = "Hold Ctrl (⌘) and scroll to zoom";
  const HINT_TOUCH = "Use two fingers to move or zoom the plan";
  let instances = 0;

  /* ——— Styling: colours only through the page's tokens ——— */
  const CSS = `
.bw-plan{-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:var(--yew-wash)}
.bw-plan .bw-svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:hidden;cursor:grab;font-family:var(--f-text);font-variant-numeric:lining-nums proportional-nums}
.bw-plan.is-dragging .bw-svg{cursor:grabbing}
.bw-plan .w path{vector-effect:non-scaling-stroke}
.bw-plan .pat-bg{fill:var(--paper)}
.bw-plan .pat-dot{fill:var(--ink-faint)}
.bw-plan .pat-tuft{fill:none;stroke:var(--ink-faint);stroke-width:.75;stroke-linecap:round}
.bw-plan .pat-grain{fill:var(--ink-faint);opacity:.75}
.bw-plan .zn-fill{stroke:none}
.bw-plan .zn-line{fill:none;stroke:var(--ink-soft);stroke-width:1.7px;stroke-dasharray:0 4.4px;stroke-linecap:round;stroke-linejoin:round}
.bw-plan .bd-a{fill:none;stroke:var(--ink);stroke-width:11.6px;stroke-linejoin:miter}
.bw-plan .bd-b{fill:none;stroke:var(--paper);stroke-width:9.4px;stroke-linejoin:miter}
.bw-plan .bd-c{fill:none;stroke:var(--ink);stroke-width:5px;stroke-linejoin:miter}
.bw-plan .pd-body{fill:var(--paper);stroke:none}
.bw-plan .pd-lines{fill:none;stroke:var(--ink-soft);stroke-width:.8px}
.bw-plan .pd-edge{fill:none;stroke:var(--ink);stroke-width:1.2px}
.bw-plan .av-case{fill:none;stroke:var(--ink-soft);stroke-width:12.4px;stroke-linejoin:round}
.bw-plan .av-fill{fill:none;stroke:var(--paper);stroke-width:10.8px;stroke-linejoin:round}
.bw-plan .pa-case{fill:none;stroke:var(--ink-soft);stroke-width:4.4px;stroke-linejoin:round}
.bw-plan .pa-fill{fill:none;stroke:var(--paper);stroke-width:2.8px;stroke-linejoin:round}
.bw-plan .rd-case{fill:none;stroke:var(--ink);stroke-width:6.6px;stroke-linejoin:round}
.bw-plan .rd-fill{fill:none;stroke:var(--paper);stroke-width:4.6px;stroke-linejoin:round}
.bw-plan .rd-main.rd-case{stroke-width:7.8px}
.bw-plan .rd-main.rd-fill{stroke-width:5.6px}
.bw-plan .rl-case{fill:none;stroke:var(--ink);stroke-width:6.8px}
.bw-plan .rl-fill{fill:none;stroke:var(--paper);stroke-width:4.4px}
.bw-plan .rl-bars{fill:none;stroke:var(--ink);stroke-width:4.4px;stroke-dasharray:11px 11px}
.bw-plan .br-case{fill:none;stroke:var(--ink-soft);stroke-width:4.6px}
.bw-plan .br-fill{fill:none;stroke:var(--paper);stroke-width:2.6px}
.bw-plan .br-bars{fill:none;stroke:var(--ink-soft);stroke-width:2.6px;stroke-dasharray:6px 6px}
.bw-plan .rt-halo{fill:none;stroke:var(--paper);stroke-width:7.5px;stroke-linecap:round;stroke-linejoin:round;opacity:.9}
.bw-plan .rt-line{fill:none;stroke:var(--yew);stroke-width:3.4px;stroke-dasharray:0 7.5px;stroke-linecap:round;stroke-linejoin:round}
.bw-plan .rt-arw{fill:var(--yew);stroke:var(--paper);stroke-width:1px;stroke-linejoin:round}
.bw-plan .tr-body{fill:var(--paper);stroke:var(--ink-soft);stroke-width:.85px;stroke-linejoin:round;stroke-linecap:round}
.bw-plan .tr-shade{fill:var(--ink-soft);stroke:none}
.bw-plan .tr-av.tr-body{stroke:var(--ink)}
.bw-plan .tr-av.tr-shade{fill:var(--ink)}
.bw-plan .st-solid{fill:var(--ink)}
.bw-plan .st-open{fill:var(--paper);stroke:var(--ink);stroke-width:1.1px}
.bw-plan .st-site{fill:var(--paper);stroke:var(--ink);stroke-width:1px;stroke-dasharray:2px 1.6px}
.bw-plan .lb{fill:var(--ink);stroke:var(--paper);stroke-width:3.2px;stroke-linejoin:round;paint-order:stroke fill;font-family:var(--f-text)}
.bw-plan .lb-zone{font-style:italic;font-variant:small-caps;letter-spacing:.1em}
.bw-plan .lb-dist{letter-spacing:.34em;text-transform:uppercase}
.bw-plan .lb-sub{font-style:italic;letter-spacing:.05em}
.bw-plan .lb-road{font-variant:small-caps;letter-spacing:.16em}
.bw-plan .lb-path{font-style:italic;letter-spacing:.03em;fill:var(--ink-soft)}
.bw-plan .lb-rail{letter-spacing:.22em;text-transform:uppercase}
.bw-plan .lb-stn{font-style:italic}
.bw-plan .lb-end{font-style:italic;fill:var(--ink-soft)}
.bw-plan .mk{cursor:pointer;outline:none}
.bw-plan .mk:focus{outline:none}
.bw-plan .mk-hit{fill:none;stroke:none;pointer-events:all}
.bw-plan .mk-shape{fill:var(--paper);stroke:var(--ink);stroke-width:1.4px;stroke-linejoin:round}
.bw-plan .mk-approx .mk-shape{stroke-dasharray:3px 2.1px}
.bw-plan .mk-n{font-family:var(--f-label);fill:var(--ink);text-anchor:middle;dominant-baseline:central;font-variant-numeric:lining-nums tabular-nums;letter-spacing:.02em;pointer-events:none}
.bw-plan .mk:hover .mk-shape{stroke:var(--yew);stroke-width:2.2px}
.bw-plan .mk.is-sel .mk-shape{fill:var(--yew);stroke:var(--ink);stroke-width:1.4px}
.bw-plan .mk.is-sel .mk-n{fill:var(--paper)}
.bw-plan .mk-ring{fill:none;stroke:var(--yew);stroke-width:2.2px;opacity:0}
.bw-plan .mk:focus-visible .mk-ring{opacity:1}
.bw-plan .mk-ld{stroke:var(--ink);stroke-width:.8px;fill:none}
.bw-plan .mk-dot{fill:var(--ink)}
.bw-plan .fl-shadow{fill:var(--ink);opacity:.16}
.bw-plan .fl-box{fill:var(--paper);stroke:var(--ink);stroke-width:1.1px;stroke-linejoin:round}
.bw-plan .fl-rule{fill:none;stroke:var(--ink-faint);stroke-width:.6px}
.bw-plan .fl-kick{fill:var(--ink-soft);letter-spacing:.14em;text-transform:uppercase}
.bw-plan .fl-label{fill:var(--ink)}
.bw-plan .fl-open{cursor:pointer}
.bw-plan .fl-open-hit{fill:none;stroke:none;pointer-events:all}
.bw-plan .fl-open-t{font-style:italic;fill:var(--yew);text-decoration:underline}
.bw-plan .fl-open:hover .fl-open-t{fill:var(--ink)}
.bw-plan .hud-bg{fill:var(--paper)}
.bw-plan .hud-compass{color:var(--ink)}
.bw-plan .hud-n{font-family:var(--f-text);font-weight:700;text-anchor:middle;fill:var(--ink)}
.bw-plan .cp-line{fill:none;stroke:var(--ink);stroke-width:1px}
.bw-plan .cp-dark{fill:var(--ink)}
.bw-plan .cp-light{fill:var(--paper);stroke:var(--ink);stroke-width:.8px}
.bw-plan .sb-on{fill:var(--ink)}
.bw-plan .sb-off{fill:var(--paper);stroke:var(--ink);stroke-width:.8px}
.bw-plan .sb-t{fill:var(--ink);text-anchor:middle}
.bw-plan .sb-u{font-style:italic;fill:var(--ink)}
.bw-plan .nt{font-style:italic;fill:var(--ink-soft);stroke:var(--paper);stroke-width:3px;stroke-linejoin:round;paint-order:stroke fill}
.bw-plan .neat{fill:none;stroke:var(--ink);stroke-width:.7px}
.bw-plan .plan-tools button{display:flex;align-items:center;justify-content:center;padding:0;color:var(--ink)}
.bw-plan .plan-tools button:hover{background:linear-gradient(var(--yew-wash),var(--yew-wash)) var(--paper)}
.bw-plan .plan-tools svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.bw-plan .plan-hint{top:50%;bottom:auto;left:50%;right:auto;width:max-content;max-width:calc(100% - 40px);transform:translate(-50%,-50%);margin:0;padding:.5rem .95rem .45rem;background:var(--paper);color:var(--ink);border:1px solid var(--ink);box-shadow:0 0 0 3px var(--paper),0 0 0 4px var(--ink);font-size:.92rem;line-height:1.3;text-align:center;opacity:0;transition:opacity .2s ease}
.bw-plan .plan-hint.is-on{opacity:1}
@media (prefers-reduced-motion: reduce){.bw-plan .plan-hint{transition:none}}
`;

  function injectStyle() {
    if (document.getElementById("bw-plan-style")) return;
    const st = document.createElement("style");
    st.id = "bw-plan-style";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ——— Small helpers ——— */
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const f1 = v => String(Math.round(v * 10) / 10);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const okPt = p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]);

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function polyD(pts, close) {
    if (!pts || !pts.length) return "";
    let d = "M" + f1(pts[0][0]) + " " + f1(pts[0][1]);
    for (let i = 1; i < pts.length; i++) d += "L" + f1(pts[i][0]) + " " + f1(pts[i][1]);
    return close ? d + "Z" : d;
  }
  function smoothClosedD(pts) {          // closed Catmull–Rom spline as cubic Béziers
    const n = pts.length;
    let d = "M" + f1(pts[0][0]) + " " + f1(pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += "C" + f1(p1[0] + (p2[0] - p0[0]) / 6) + " " + f1(p1[1] + (p2[1] - p0[1]) / 6) + " " +
        f1(p2[0] - (p3[0] - p1[0]) / 6) + " " + f1(p2[1] - (p3[1] - p1[1]) / 6) + " " + f1(p2[0]) + " " + f1(p2[1]);
    }
    return d + "Z";
  }
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function lineDist(px, py, pts, closed) {
    let best = Infinity;
    const n = pts.length;
    for (let i = 0; i < n - (closed ? 0 : 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      best = Math.min(best, segDist(px, py, a[0], a[1], b[0], b[1]));
    }
    return best;
  }
  function polyLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }
  function pointAt(pts, s) {               // → [x, y, unit tangent x, unit tangent y]
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + L >= s || i === pts.length - 1) {
        const t = L ? clamp((s - acc) / L, 0, 1) : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, L ? (b[0] - a[0]) / L : 1, L ? (b[1] - a[1]) / L : 0];
      }
      acc += L;
    }
    return [pts[0][0], pts[0][1], 1, 0];
  }
  function leftNormal(a, b) {              // left of travel; with y pointing down, "left" of eastward travel is up
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l];
  }
  function offsetLine(pts, d) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const n1 = i > 0 ? leftNormal(pts[i - 1], pts[i]) : null;
      const n2 = i < n - 1 ? leftNormal(pts[i], pts[i + 1]) : null;
      let nx, ny;
      if (n1 && n2) {
        nx = n1[0] + n2[0]; ny = n1[1] + n2[1];
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        const m = 1 / Math.max(nx * n1[0] + ny * n1[1], 0.5);
        nx *= m; ny *= m;
      } else { [nx, ny] = n1 || n2; }
      out.push([pts[i][0] + nx * d, pts[i][1] + ny * d]);
    }
    return out;
  }
  function extendLine(pts, a, b) {
    if (pts.length < 2) return pts.slice();
    const out = pts.map(p => p.slice());
    const p0 = out[0], p1 = out[1], l0 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]) || 1;
    out[0] = [p0[0] + ((p0[0] - p1[0]) / l0) * a, p0[1] + ((p0[1] - p1[1]) / l0) * a];
    const q0 = out[out.length - 1], q1 = out[out.length - 2], l1 = Math.hypot(q0[0] - q1[0], q0[1] - q1[1]) || 1;
    out[out.length - 1] = [q0[0] + ((q0[0] - q1[0]) / l1) * b, q0[1] + ((q0[1] - q1[1]) / l1) * b];
    return out;
  }
  function nearestOnLine(pts, p) {
    let best = null, bd = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
      const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) { bd = d; best = [q[0], q[1], i - 1]; }
    }
    return best;
  }
  function clipSeg(p, q, x0, y0, x1, y1) { // Liang–Barsky
    let t0 = 0, t1 = 1;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const P = [-dx, dx, -dy, dy], Q = [p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]];
    for (let i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] < 0) return null; continue; }
      const t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy], t0 === 0, t1 === 1];
  }
  function clipRuns(pts, x0, y0, x1, y1) {
    const runs = [];
    let cur = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const c = clipSeg(pts[i], pts[i + 1], x0, y0, x1, y1);
      if (!c) { if (cur) { runs.push(cur); cur = null; } continue; }
      if (cur && c[2]) cur.push(c[1]);
      else { if (cur) runs.push(cur); cur = [c[0], c[1]]; }
      if (!c[3]) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    return runs;
  }
  function boxHit(b, list) {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o && b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true;
    }
    return false;
  }
  function segHit(b, segs, own, hardOnly) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (own && own.indexOf(s.key) >= 0) continue;
      if (hardOnly && !s.hard) continue;
      const x0 = b.x0 - s.hw, y0 = b.y0 - s.hw, x1 = b.x1 + s.hw, y1 = b.y1 + s.hw;
      if (Math.max(s.ax, s.bx) < x0 || Math.min(s.ax, s.bx) > x1 || Math.max(s.ay, s.by) < y0 || Math.min(s.ay, s.by) > y1) continue;
      if (clipSeg([s.ax, s.ay], [s.bx, s.by], x0, y0, x1, y1)) return true;
    }
    return false;
  }
  function circleD(r) {
    return "M" + f1(-r) + " 0A" + f1(r) + " " + f1(r) + " 0 1 0 " + f1(r) + " 0A" + f1(r) + " " + f1(r) + " 0 1 0 " + f1(-r) + " 0Z";
  }
  function shapeD(group, r) {
    if (group === "building") { const h = r * 0.86; return polyD([[-h, -h], [h, -h], [h, h], [-h, h]], true); }
    if (group === "ground") { const d = r * 1.2; return polyD([[0, -d], [d, 0], [0, d], [-d, 0]], true); }
    if (group === "landscape") {
      const q = r * 1.07, pts = [];
      for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; pts.push([Math.cos(a) * q, Math.sin(a) * q]); }
      return polyD(pts, true);
    }
    return circleD(r * 0.98);
  }

  /* ——— The plan ——— */
  function mount(host, opts) {
    if (!host) throw new Error("BrookwoodPlan.mount: no host element");
    opts = opts || {};
    const geo = opts.geo || {};
    const onSelect = typeof opts.onSelect === "function" ? opts.onSelect : function () {};
    const onOpen = typeof opts.onOpen === "function" ? opts.onOpen : function () {};
    const N = ++instances;
    const pid = s => "bw-plan-" + N + "-" + s;
    const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const reduced = () => !!(mq && mq.matches);

    injectStyle();
    host.textContent = "";
    host.classList.add("bw-plan");
    host.style.touchAction = "pan-x pan-y";

    /* ——— Projection: local equirectangular, metres, centred on the boundary's bounding box ——— */
    const boundaryLL = (geo.boundary || []).filter(okPt);
    if (boundaryLL.length < 3) throw new Error("BrookwoodPlan: geo.boundary is missing");
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
    boundaryLL.forEach(p => { la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); lo0 = Math.min(lo0, p[1]); lo1 = Math.max(lo1, p[1]); });
    const lat0 = (la0 + la1) / 2, lng0 = (lo0 + lo1) / 2;
    const KX = Math.cos((lat0 * Math.PI) / 180) * 111320, KY = 110574;
    const P = p => [(p[1] - lng0) * KX, (lat0 - p[0]) * KY];
    const B = boundaryLL.map(P);
    const bx0 = (lo0 - lng0) * KX, bx1 = (lo1 - lng0) * KX, by0 = (lat0 - la1) * KY, by1 = (lat0 - la0) * KY;
    const bw = bx1 - bx0, bh = by1 - by0;
    const home = { x0: bx0 - bw * 0.035, x1: bx1 + bw * 0.035, y0: by0 - bh * 0.075, y1: by1 + bh * 0.04 };
    const homeC = [(home.x0 + home.x1) / 2, (home.y0 + home.y1) / 2];
    const insideB = (x, y) => pointInPoly(x, y, B);

    /* ——— Linear features ——— */
    const mainBase = (geo.main_line || []).filter(okPt).map(P);
    const mainLine = extendLine(mainBase, 3200, 3200);
    const branch = (geo.railway_branch || []).filter(okPt).map(P);
    const RL = geo.railway_labels || {};
    const roads = (geo.roads || []).map(r => ({ name: String(r.name || ""), pts: (r.points || []).filter(okPt).map(P) })).filter(r => r.pts.length > 1);
    roads.forEach((r, i) => {
      const n = r.name.toLowerCase();
      r.kind = /bagshot|a322/.test(n) ? "main" : /pales/.test(n) ? "road" : /railway avenue|trackbed/.test(n) ? "avenue" : "path";
      r.key = r.kind === "path" ? "path" + i : r.kind;
      r.label = r.kind === "main" ? "Bagshot Road (A322)" : r.name.replace(/\s*\(.*?\)\s*/g, " ").replace(/,.*$/, "").trim();
      if (r.kind === "main") r.pts = extendLine(r.pts, 520, 520);
      if (r.kind === "road") r.pts = extendLine(r.pts, 0, 260);
    });
    const roadMain = roads.find(r => r.kind === "main");
    const roadPales = roads.find(r => r.kind === "road");
    const roadAvenue = roads.find(r => r.kind === "avenue");
    // Offset the main line and the A322 off the boundary (they run along it), always away from the interior.
    function outwardSign(pts) {
      if (pts.length < 2) return 1;
      let plus = 0, minus = 0;
      const a = offsetLine(pts, 25), b = offsetLine(pts, -25);
      const L = polyLen(pts);
      for (let s = 0; s <= L; s += 40) {
        const p = pointAt(a, s), q = pointAt(b, s);
        if (insideB(p[0], p[1])) plus++;
        if (insideB(q[0], q[1])) minus++;
      }
      return plus > minus ? -1 : 1;
    }
    const mainSign = outwardSign(mainBase);
    const a322Sign = roadMain ? outwardSign(roadMain.pts) : 1;
    const dyn = { main: mainLine, branch: branch, a322: roadMain ? roadMain.pts : null, pales: roadPales ? roadPales.pts : null };

    /* ——— Grounds (zones) ——— */
    function zoneInfo(name) {
      const n = name.toLowerCase();
      if (/north cemetery/.test(n)) return { dist: true, lines: ["North Cemetery", "(Nonconformist)"] };
      if (/south cemetery/.test(n)) return { dist: true, lines: ["South Cemetery", "(Anglican)"] };
      if (/military/.test(n)) return { text: "Military Cemetery" };
      if (/american/.test(n)) return { text: "American Cemetery" };
      if (/parsi|zoroastrian/.test(n)) return { text: "Zoroastrian Ground" };
      if (/muslim/.test(n)) return { text: "Muslim Grounds" };
      if (/\bring\b/.test(n)) return { text: "The Ring", ring: true };
      if (/glade/.test(n)) return { text: "Glades of Remembrance", woodland: true };
      if (/edward/.test(n)) return { text: "St Edward Brotherhood" };
      return { text: name.replace(/\s*\(.*?\)\s*/g, " ").trim() };
    }
    function ovalPoly(c, R, seed, round) {
      const rnd = mulberry(seed), p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28, rot = rnd() * 0.6 - 0.3;
      const pts = [];
      for (let i = 0; i < 36; i++) {
        const t = (i / 36) * Math.PI * 2;
        const rr = round ? R : R * (1 + 0.075 * Math.sin(2 * t + p1) + 0.05 * Math.sin(3 * t + p2) + 0.03 * Math.sin(5 * t + p3));
        const ex = Math.cos(t) * rr * (round ? 1 : 1.12), ey = Math.sin(t) * rr * (round ? 1 : 0.9);
        pts.push([c[0] + ex * Math.cos(rot) - ey * Math.sin(rot), c[1] + ex * Math.sin(rot) + ey * Math.cos(rot)]);
      }
      return pts;
    }
    const zones = (geo.zones || []).filter(z => z && okPt(z.centre)).map(z => {
      const name = String(z.name || "");
      const info = zoneInfo(name);
      const c = P(z.centre);
      let poly = null, smooth = false, rm = z.radius_m || 0;
      if (Array.isArray(z.extent) && z.extent.filter(okPt).length > 2) {
        poly = z.extent.filter(okPt).map(P);
        let a = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
        rm = Math.sqrt(Math.abs(a / 2) / Math.PI);
      } else if (z.radius_m > 0) {
        poly = ovalPoly(c, z.radius_m, hashStr(name), info.ring);
        smooth = true;
      }
      return { name, info, c, poly, smooth, rm, d: poly ? (smooth ? smoothClosedD(poly) : polyD(poly, true)) : "" };
    });
    const glades = zones.find(z => z.info.woodland);
    const ringZone = zones.find(z => z.info.ring);
    const pond = glades ? (() => {
      const r = glades.rm || 150;
      const c = [glades.c[0] - r * 0.3, glades.c[1] + r * 0.33];
      const pts = ovalPoly(c, r * 0.24, 1907, false).map(p => [c[0] + (p[0] - c[0]) * 1.5, c[1] + (p[1] - c[1]) * 0.78]);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
      return { c, pts, d: smoothClosedD(pts), x0, x1, y0, y1 };
    })() : null;
    const ringRoad = ringZone ? ovalPoly(ringZone.c, (ringZone.rm || 90) * 0.42, 1, true) : null;

    /* ——— Markers ——— */
    const mks = (opts.markers || []).filter(m => m && m.id != null && isFinite(m.lat) && isFinite(m.lng)).map(m => {
      const p = P([m.lat, m.lng]);
      return { m, id: String(m.id), x: p[0], y: p[1], visible: true, off: [0, 0], from: [0, 0], to: [0, 0], sx: 0, sy: 0 };
    });
    mks.sort((a, b) => (a.m.n || 0) - (b.m.n || 0));
    const byId = new Map(mks.map(k => [k.id, k]));
    const bwStation = byId.get("brookwood-station");
    const stationBW = bwStation ? [bwStation.x, bwStation.y] : mainBase.length > 2 ? mainBase[1] : null;

    /* ——— Tree glyph positions (seeded, so the plan is the same at every visit) ——— */
    const avoidLines = [mainBase, branch].concat(roads.map(r => r.pts)).concat(ringRoad ? [ringRoad] : []);
    const laidZones = zones.filter(z => z.poly && !z.info.woodland && !z.info.dist);
    const trees = [];
    (function plantTrees() {
      const rnd = mulberry(1854);
      const okTree = (x, y) => {
        if (!insideB(x, y) || lineDist(x, y, B, true) < 28) return false;
        for (const l of avoidLines) if (l.length > 1 && lineDist(x, y, l, false) < 26) return false;
        for (const k of mks) if (Math.hypot(k.x - x, k.y - y) < 30) return false;
        if (pond && x > pond.x0 - 14 && x < pond.x1 + 14 && y > pond.y0 - 22 && y < pond.y1 + 10) return false;
        for (const t of trees) if (Math.abs(t.x - x) < 13 && Math.abs(t.y - y) < 13) return false;
        for (const z of laidZones) if (pointInPoly(x, y, z.poly) && rnd() > 0.3) return false;
        return true;
      };
      const plant = (x, y) => { if (okTree(x, y)) trees.push({ x, y, kind: rnd() < 0.62 ? "c" : "r", rank: rnd(), sz: 0.82 + rnd() * 0.36 }); };
      for (let c = 0; c < 64; c++) {
        const cx = bx0 + rnd() * bw, cy = by0 + rnd() * bh;
        if (!insideB(cx, cy)) continue;
        const n = 3 + Math.floor(rnd() * 7);
        for (let i = 0; i < n; i++) { const a = rnd() * 6.283, d = 8 + rnd() * 58; plant(cx + Math.cos(a) * d * 1.2, cy + Math.sin(a) * d); }
      }
      for (let i = 0; i < 120; i++) plant(bx0 + rnd() * bw, by0 + rnd() * bh);
      if (glades) for (let i = 0; i < 40; i++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * (glades.rm || 150); plant(glades.c[0] + Math.cos(a) * d, glades.c[1] + Math.sin(a) * d); }
    })();
    const avTrees = [];
    if (roadAvenue) {
      const pts = roadAvenue.pts, L = polyLen(pts), others = roads.filter(r => r !== roadAvenue && r.kind !== "path");
      for (let s = 18; s < L - 14; s += 22) {
        const q = pointAt(pts, s);
        if (others.some(r => lineDist(q[0], q[1], r.pts, false) < 24)) continue;
        avTrees.push({ x: q[0], y: q[1], nx: q[3], ny: -q[2] });
      }
    }

    /* ——— DOM ——— */
    const svg = el("svg", { class: "bw-svg" });
    host.appendChild(svg);
    const defs = el("defs", null, svg);
    const world = el("g", { class: "w", "aria-hidden": "true" }, svg);
    const over = el("g", { class: "o" }, svg);

    // Heath: sparse stipple and tussocks. Laid-out grounds: paper with a quiet regular grain.
    const patHeath = el("pattern", { id: pid("heath"), patternUnits: "userSpaceOnUse", width: 64, height: 64 }, defs);
    (function () {
      const rnd = mulberry(77);
      let dots = "", tufts = "";
      for (let i = 0; i < 34; i++) {
        const x = rnd() * 64, y = rnd() * 64, r = 0.5 + rnd() * 0.35;
        dots += "M" + f1(x - r) + " " + f1(y) + "a" + r + " " + r + " 0 1 0 " + 2 * r + " 0a" + r + " " + r + " 0 1 0 " + -2 * r + " 0";
      }
      for (let i = 0; i < 5; i++) {
        const x = 4 + rnd() * 56, y = 6 + rnd() * 54;
        tufts += "M" + f1(x - 0.7) + " " + f1(y) + "l-1.6 -2.5M" + f1(x) + " " + f1(y) + "v-3.1M" + f1(x + 0.7) + " " + f1(y) + "l1.6 -2.5M" + f1(x - 2.8) + " " + f1(y + 0.3) + "h5.6";
      }
      el("path", { class: "pat-dot", d: dots }, patHeath);
      el("path", { class: "pat-tuft", d: tufts }, patHeath);
    })();
    const patLaid = el("pattern", { id: pid("laid"), patternUnits: "userSpaceOnUse", width: 9, height: 9 }, defs);
    el("rect", { class: "pat-bg", x: 0, y: 0, width: 9, height: 9 }, patLaid);
    el("path", { class: "pat-grain", d: "M1.75 2.25a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0M6.25 6.75a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" }, patLaid);
    const clipIn = el("clipPath", { id: pid("in") }, defs);
    el("path", { d: polyD(B, true) }, clipIn);
    const clipPond = el("clipPath", { id: pid("pond") }, defs);
    if (pond) el("path", { d: pond.d }, clipPond);

    const Bd = polyD(B, true);
    el("path", { class: "heath", d: Bd, fill: "url(#" + pid("heath") + ")" }, world);
    const gZoneFill = el("g", { "clip-path": "url(#" + pid("in") + ")" }, world);
    laidZones.forEach(z => el("path", { class: "zn-fill", d: z.d, fill: "url(#" + pid("laid") + ")" }, gZoneFill));
    let pondLines = null;
    if (pond) {
      el("path", { class: "pd-body", d: pond.d }, world);
      pondLines = el("path", { class: "pd-lines", "clip-path": "url(#" + pid("pond") + ")" }, world);
      el("path", { class: "pd-edge", d: pond.d }, world);
    }
    zones.filter(z => z.poly).forEach(z => el("path", { class: "zn-line", d: z.d }, world));
    const gBound = el("g", { "clip-path": "url(#" + pid("in") + ")" }, world);
    ["bd-a", "bd-b", "bd-c"].forEach(c => el("path", { class: c, d: Bd }, gBound));
    if (roadAvenue) { el("path", { class: "av-case", d: polyD(roadAvenue.pts) }, world); el("path", { class: "av-fill", d: polyD(roadAvenue.pts) }, world); }
    const lightPaths = roads.filter(r => r.kind === "path").map(r => r.pts).concat(ringRoad ? [ringRoad] : []);
    lightPaths.forEach(pts => el("path", { class: "pa-case", d: polyD(pts, pts === ringRoad) }, world));
    lightPaths.forEach(pts => el("path", { class: "pa-fill", d: polyD(pts, pts === ringRoad) }, world));
    const roadEls = {};
    [["main", roadMain], ["road", roadPales]].forEach(([k, r]) => { if (r) roadEls[k + "c"] = el("path", { class: "rd-case" + (k === "main" ? " rd-main" : "") }, world); });
    [["main", roadMain], ["road", roadPales]].forEach(([k, r]) => { if (r) roadEls[k + "f"] = el("path", { class: "rd-fill" + (k === "main" ? " rd-main" : "") }, world); });
    const brEls = branch.length > 1 ? ["br-case", "br-fill", "br-bars"].map(c => el("path", { class: c }, world)) : [];
    const rlEls = mainLine.length > 1 ? ["rl-case", "rl-fill", "rl-bars"].map(c => el("path", { class: c }, world)) : [];
    const rtHalo = el("path", { class: "rt-halo" }, world);
    const rtLine = el("path", { class: "rt-line" }, world);

    const gTrees = el("g", { "aria-hidden": "true" }, over);
    const trBody = el("path", { class: "tr-body" }, gTrees), trShade = el("path", { class: "tr-shade" }, gTrees);
    const avBody = el("path", { class: "tr-body tr-av" }, gTrees), avShade = el("path", { class: "tr-shade tr-av" }, gTrees);
    const gStations = el("g", { "aria-hidden": "true" }, over);
    const gLabels = el("g", { "aria-hidden": "true" }, over);
    const gArrows = el("path", { class: "rt-arw", "aria-hidden": "true" }, over);
    const gHud = el("g", { "aria-hidden": "true" }, over);
    const gLeaders = el("g", { "aria-hidden": "true" }, over);
    const gMarkers = el("g", { class: "mks" }, over);
    const flag = el("g", { class: "fl", "aria-hidden": "true", visibility: "hidden" }, over);
    const meas = el("text", { x: -9999, y: -9999, visibility: "hidden", "aria-hidden": "true" }, over);

    const tools = document.createElement("div");
    tools.className = "plan-tools";
    const addTool = (label, html, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("aria-label", label); b.title = label; b.innerHTML = html;
      b.addEventListener("click", fn);
      tools.appendChild(b);
    };
    addTool("Zoom in", "+", () => zoomBy(1.6));
    addTool("Zoom out", "−", () => zoomBy(1 / 1.6));
    addTool("Reset the plan", '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/></svg>', () => api.reset());
    host.insertBefore(tools, svg);          // first in tab order, then the key numbers
    const hint = document.createElement("p");
    hint.className = "plan-hint";
    hint.setAttribute("aria-live", "polite");
    host.appendChild(hint);

    /* ——— View state ——— */
    let W = 0, H = 0, s0 = 1, narrow = false, R = 11, fsK = 1, walkPts = null;
    const view = { cx: homeC[0], cy: homeC[1], z: 1 };
    const ZMIN = 1, ZMAX = 8;
    const S = () => s0 * view.z;
    const toScreen = (x, y) => { const s = S(); return [(x - view.cx) * s + W / 2, (y - view.cy) * s + H / 2]; };
    const toWorld = (px, py) => { const s = S(); return [(px - W / 2) / s + view.cx, (py - H / 2) / s + view.cy]; };
    function clampView(v) {
      v.z = clamp(v.z, ZMIN, ZMAX);
      v.cx = clamp(v.cx, bx0, bx1);
      v.cy = clamp(v.cy, by0, by1);
      return v;
    }

    /* ——— Markers ——— */
    mks.forEach(k => {
      const m = k.m, grp = ["monument", "building", "ground", "landscape"].indexOf(m.group) >= 0 ? m.group : "monument";
      k.group = grp;
      k.g = el("g", { class: "mk mk-" + grp + (m.approx ? " mk-approx" : ""), tabindex: "0", role: "button", "aria-label": "No. " + m.n + ": " + m.label, "data-id": k.id }, gMarkers);
      k.ring = el("path", { class: "mk-ring" }, k.g);
      k.hit = el("path", { class: "mk-hit" }, k.g);
      k.shape = el("path", { class: "mk-shape" }, k.g);
      k.num = el("text", { class: "mk-n", x: 0, y: 0.6 }, k.g);
      k.num.textContent = m.n;
      k.ld = el("line", { class: "mk-ld", visibility: "hidden" }, gLeaders);
      k.dot = el("circle", { class: "mk-dot", r: 1.8, visibility: "hidden" }, gLeaders);
    });
    function sizeMarkers() {
      mks.forEach(k => {
        k.ring.setAttribute("d", circleD(R + 5));
        k.hit.setAttribute("d", circleD(R + 3));
        k.shape.setAttribute("d", shapeD(k.group, R));
        k.num.style.fontSize = (narrow ? 13 : 14.5) + "px";
      });
    }

    /* ——— Measuring text ——— */
    const mcache = new Map();
    function measure(text, cls, fs) {
      const key = cls + "|" + fs + "|" + text;
      const hit = mcache.get(key);
      if (hit != null) return hit;
      meas.setAttribute("class", cls);
      meas.style.fontSize = fs + "px";
      meas.textContent = text;
      let v = 0;
      try { v = meas.getBBox().width; } catch (e) { v = 0; }
      if (v > 0) mcache.set(key, v); else v = text.length * fs * 0.56;
      return v;
    }
    function wrap(text, cls, fs, maxW) {
      const words = String(text).split(/\s+/).filter(Boolean), lines = [];
      let cur = "";
      words.forEach(w => {
        const t = cur ? cur + " " + w : w;
        if (!cur || measure(t, cls, fs) <= maxW) cur = t;
        else { lines.push(cur); cur = w; }
      });
      if (cur) lines.push(cur);
      return lines;
    }

    /* ——— Lettering ——— */
    const FS = { zone: 11.5, dist: 12.5, sub: 10.5, road: 11, path: 10.5, rail: 9.5, stn: 10.5, end: 10.5 };
    const labels = [];
    function splitTwo(text) {
      const w = text.split(" ");
      if (w.length < 2) return null;
      let best = 1, bd = Infinity;
      for (let i = 1; i < w.length; i++) {
        const a = w.slice(0, i).join(" ").length, b = w.slice(i).join(" ").length;
        if (Math.abs(a - b) < bd) { bd = Math.abs(a - b); best = i; }
      }
      return [w.slice(0, best).join(" "), w.slice(best).join(" ")];
    }
    function addPoint(o) { o.kind = "point"; o.idx = labels.length; labels.push(o); }
    function addLine(o) { o.kind = "line"; o.idx = labels.length; labels.push(o); }
    const mainHW = 3.4, brHW = 2.3, avHW = 6.2, rdHW = 3.3, a3HW = 3.9, paHW = 2.2;

    if (mainLine.length > 1) {
      addLine({ prio: 10, text: "London & South Western Railway", cls: "lb-rail", fs: FS.rail, line: () => dyn.main, sides: [1, -1], gap: mainHW + 3, along: "mid", own: ["main"] });
      addLine({ prio: 62, text: "to Woking & London →", cls: "lb-end", fs: FS.end, line: () => dyn.main, sides: [-1, 1], gap: mainHW + 3, along: "end", own: ["main"] });
      addLine({ prio: 63, text: "← to Southampton", cls: "lb-end", fs: FS.end, line: () => dyn.main, sides: [-1, 1], gap: mainHW + 3, along: "start", own: ["main"] });
    }
    zones.forEach((z, i) => {
      if (z.info.dist) {
        addPoint({ prio: 20, wx: z.c[0], wy: z.c[1], maxShift: () => 90,
          variants: [[{ t: z.info.lines[0], c: "lb-dist", fs: FS.dist }, { t: z.info.lines[1], c: "lb-sub", fs: FS.sub }]] });
      } else if (z.poly) {
        const one = [{ t: z.info.text, c: "lb-zone", fs: FS.zone }];
        const two = z.info.text.length > 12 ? splitTwo(z.info.text) : null;
        const variants = [one];
        if (two) variants.push(two.map(t => ({ t, c: "lb-zone", fs: FS.zone })));
        addPoint({ prio: 30 + i * 0.1, wx: z.c[0], wy: z.c[1], variants, maxShift: () => clamp((z.rm || 60) * S() * 1.1 + 12, 24, 84) });
      }
    });
    const stations = [];
    if (stationBW && mainLine.length > 1) stations.push({ name: "Brookwood Station", w: [stationBW[0], stationBW[1]], line: () => dyn.main, hw: mainHW, cls: "st-solid", len: 20, side: 1 });
    if (okPt(RL.north_station_site) && branch.length > 1) stations.push({ name: "North Station (site)", w: P(RL.north_station_site), line: () => dyn.branch, hw: brHW, cls: "st-site", len: 14, side: 1 });
    if (okPt(RL.south_station) && branch.length > 1) stations.push({ name: "South Station", w: P(RL.south_station), line: () => dyn.branch, hw: brHW, cls: "st-open", len: 14, side: -1 });
    stations.forEach(st => {
      st.el = el("rect", { class: st.cls, x: -st.len / 2, y: -2.6, width: st.len, height: 5.2 }, gStations);
      addPoint({ prio: 40, wx: st.w[0], wy: st.w[1], maxShift: () => 46, variants: [[{ t: st.name, c: "lb-stn", fs: FS.stn }]] });
    });
    if (roadPales) addLine({ prio: 44, text: roadPales.label, cls: "lb-road", fs: FS.road, line: () => dyn.pales, sides: [1, -1], gap: rdHW + 2.5, along: "mid", own: ["road"] });
    if (roadMain) addLine({ prio: 45, text: roadMain.label, cls: "lb-road", fs: FS.road, line: () => dyn.a322, sides: [-1, 1], gap: a3HW + 2.5, along: "mid", own: ["main-road"] });
    roads.filter(r => r.kind === "path").forEach(r => addLine({ prio: 52, text: r.label, cls: "lb-path", fs: FS.path, line: () => r.pts, sides: [1, -1], gap: paHW + 2.5, along: "mid", own: [r.key] }));
    if (branch.length > 1) addLine({ prio: 42, text: "Necropolis branch (closed 1941)", cls: "lb-path", fs: FS.path, line: () => dyn.branch, sides: [1, -1], gap: avHW + 2.5, along: "mid", own: ["branch", "avenue"] });
    if (roadAvenue) addLine({ prio: 54, text: roadAvenue.label, cls: "lb-path", fs: FS.path, line: () => roadAvenue.pts, sides: [-1, 1], gap: avHW + 2.5, along: "mid", own: ["branch", "avenue"] });
    labels.sort((a, b) => a.prio - b.prio);

    function metricsOf(variant) {
      const lines = variant.map(ln => ({ t: ln.t, c: ln.c, fs: ln.fs * fsK, w: measure(ln.t, "lb " + ln.c, ln.fs * fsK) }));
      let h = 0;
      lines.forEach(ln => { ln.lh = ln.fs * 1.22; h += ln.lh; });
      let y = -h / 2;
      lines.forEach(ln => { ln.y = y + ln.lh / 2 + ln.fs * 0.34; y += ln.lh; });
      return { lines, w: Math.max.apply(null, lines.map(l => l.w)), h };
    }
    const RING = (function () {
      const out = [[0, 0]];
      [10, 19, 29, 40, 52, 66, 82].forEach(r => [-90, 90, 0, 180, -140, -40, 140, 40].forEach(a => {
        out.push([Math.cos((a * Math.PI) / 180) * r * 1.3, Math.sin((a * Math.PI) / 180) * r * 0.72]);
      }));
      return out;
    })();
    function placePoint(L, boxes, segs) {
      const sp = toScreen(L.wx, L.wy);
      if (sp[0] < -160 || sp[0] > W + 160 || sp[1] < -100 || sp[1] > H + 100) return;
      const maxShift = L.maxShift();
      const vars = L.variants.map(metricsOf);
      for (let pass = 0; pass < 2; pass++) {
        for (const off of RING) {
          if (Math.hypot(off[0], off[1]) > maxShift) continue;
          for (let vi = 0; vi < vars.length; vi++) {
            const m = vars[vi], x = sp[0] + off[0], y = sp[1] + off[1];
            const b = { x0: x - m.w / 2 - 2, y0: y - m.h / 2 - 1, x1: x + m.w / 2 + 2, y1: y + m.h / 2 + 1 };
            if (b.x0 < 6 || b.y0 < 6 || b.x1 > W - 6 || b.y1 > H - 6) continue;
            if (boxHit(b, boxes)) continue;
            if (segHit(b, segs, null, pass === 1)) continue;
            L.placed = { x, y, lines: m.lines, boxes: [b], sig: "p" + vi + "|" + m.lines.map(l => l.t + l.fs).join("|") };
            return;
          }
        }
      }
    }
    function placeLine(L, boxes, segs) {
      const wpts = L.line();
      if (!wpts || wpts.length < 2) return;
      const spts = wpts.map(p => toScreen(p[0], p[1]));
      const runs = clipRuns(spts, 8, 8, W - 8, H - 8).sort((a, b) => polyLen(b) - polyLen(a));
      const fs = L.fs * fsK, cls = "lb " + L.cls, w = measure(L.text, cls, fs), cap = fs * 0.74;
      for (let run of runs) {
        const dx = run[run.length - 1][0] - run[0][0], dy = run[run.length - 1][1] - run[0][1];
        if (Math.abs(dx) < Math.abs(dy) * 0.3 ? dy > 0 : dx < 0) run = run.slice().reverse();
        if (polyLen(run) < w + 16) continue;
        for (const side of L.sides) {
          const path = offsetLine(run, side > 0 ? L.gap : -(L.gap + cap));
          const plen = polyLen(path), lo = w / 2 + 6, hi = plen - w / 2 - 6;
          if (hi < lo) continue;
          const pref = L.along === "start" ? lo : L.along === "end" ? hi : (lo + hi) / 2;
          const reach = L.along === "start" || L.along === "end" ? Math.max(40, (hi - lo) * 0.3) : Infinity;
          for (let k = 0; k < 48; k++) {
            const c = pref + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 14;
            if (c < lo || c > hi || Math.abs(c - pref) > reach) continue;
            const bxs = [];
            let ok = true;
            for (let t = c - w / 2; t < c + w / 2 + cap * 0.5; t += cap) {
              const q = pointAt(path, Math.min(t, c + w / 2));
              const mx = q[0] + q[3] * cap * 0.5, my = q[1] - q[2] * cap * 0.5;
              const b = { x0: mx - cap / 2 - 1.5, y0: my - cap / 2 - 1.5, x1: mx + cap / 2 + 1.5, y1: my + cap / 2 + 1.5 };
              if (b.x0 < 4 || b.y0 < 4 || b.x1 > W - 4 || b.y1 > H - 4 || boxHit(b, boxes) || segHit(b, segs, L.own)) { ok = false; break; }
              bxs.push(b);
            }
            if (!ok) continue;
            const o = pointAt(path, c);
            const local = path.map(p => [p[0] - o[0], p[1] - o[1]]);
            const d = polyD(local);
            L.placed = { x: o[0], y: o[1], d, start: c - w / 2, fs, boxes: bxs, sig: d + "|" + f1(c - w / 2) + "|" + fs };
            return;
          }
        }
      }
    }
    function drawLabel(L) {
      if (!L.g) L.g = el("g", null, gLabels);
      const p = L.placed;
      if (!p) { if (L.g.style.display !== "none") L.g.style.display = "none"; return; }
      L.g.style.display = "";
      if (L.sig === p.sig) return;
      L.sig = p.sig;
      L.g.textContent = "";
      if (L.kind === "point") {
        const t = el("text", { class: "lb", "text-anchor": "middle" }, L.g);
        p.lines.forEach(ln => {
          const ts = el("tspan", { class: ln.c, x: 0, y: f1(ln.y) }, t);
          ts.style.fontSize = ln.fs + "px";
          ts.textContent = ln.t;
        });
      } else {
        const id = pid("lp-" + L.idx);
        el("path", { id, d: p.d }, el("defs", null, L.g));
        const t = el("text", { class: "lb " + L.cls }, L.g);
        t.style.fontSize = p.fs + "px";
        const tp = el("textPath", { href: "#" + id, startOffset: f1(p.start) }, t);
        tp.textContent = L.text;
      }
    }

    /* ——— Screen-space line features (for lettering and trees to keep clear of) ——— */
    function screenSegs() {
      const out = [];
      const add = (pts, hw, key, closed) => {
        if (!pts || pts.length < 2) return;
        let prev = toScreen(pts[0][0], pts[0][1]);
        const first = prev;
        for (let i = 1; i < pts.length; i++) {
          const q = toScreen(pts[i][0], pts[i][1]);
          out.push({ ax: prev[0], ay: prev[1], bx: q[0], by: q[1], hw, key, hard: key === "boundary" || key === "main" });
          prev = q;
        }
        if (closed) out.push({ ax: prev[0], ay: prev[1], bx: first[0], by: first[1], hw, key, hard: key === "boundary" });
      };
      add(B, 3.2, "boundary", true);
      add(dyn.main, mainHW, "main");
      add(dyn.branch, brHW, "branch");
      if (roadAvenue) add(roadAvenue.pts, avHW, "avenue");
      if (roadPales) add(dyn.pales, rdHW, "road");
      if (roadMain) add(dyn.a322, a3HW, "main-road");
      roads.filter(r => r.kind === "path").forEach(r => add(r.pts, paHW, r.key));
      if (ringRoad) add(ringRoad, paHW, "ring", true);
      if (walkPts) add(walkPts, 3, "route");
      return out;
    }

    /* ——— Instruments: neat line, compass, scales, note ——— */
    const gMargin = el("path", { class: "hud-bg", "fill-rule": "evenodd" }, gHud);   // paper outside the neat line hides lines running off the plate
    const gNeat = el("rect", { class: "neat" }, gHud);
    const gCompass = el("g", { class: "hud-compass" }, gHud);
    const gScale = el("g", null, gHud);
    const gNote = el("text", { class: "nt" }, gHud);
    let compassBox = null, scaleBox = null, noteBox = null, scaleKey = "", scaleBase = 0;
    function buildHud() {
      gMargin.setAttribute("d", "M-2 -2H" + (W + 2) + "V" + (H + 2) + "H-2Z M4.5 4.5V" + (H - 4.5) + "H" + (W - 4.5) + "V4.5Z");
      gNeat.setAttribute("x", 4.5); gNeat.setAttribute("y", 4.5);
      gNeat.setAttribute("width", Math.max(0, W - 9)); gNeat.setAttribute("height", Math.max(0, H - 9));
      gCompass.textContent = "";
      const cs = narrow ? 44 : 60, x = W - cs - 14, y = narrow ? 24 : 28;
      gCompass.setAttribute("transform", "translate(" + x + " " + y + ")");
      el("circle", { class: "hud-bg", cx: cs / 2, cy: cs / 2, r: cs / 2 + 3 }, gCompass);
      if (document.getElementById("vig-compass")) {
        el("use", { href: "#vig-compass", x: 0, y: 0, width: cs, height: cs }, gCompass);
      } else {
        const c = cs / 2, r = cs * 0.46;
        el("circle", { class: "cp-line", cx: c, cy: c, r }, gCompass);
        el("circle", { class: "cp-line", cx: c, cy: c, r: r * 0.86 }, gCompass);
        el("path", { class: "cp-light", d: polyD([[c, c - r], [c + r * 0.16, c], [c, c + r], [c - r * 0.16, c]], true) }, gCompass);
        el("path", { class: "cp-light", d: polyD([[c - r, c], [c, c - r * 0.16], [c + r, c], [c, c + r * 0.16]], true) }, gCompass);
        el("path", { class: "cp-dark", d: polyD([[c, c - r], [c + r * 0.16, c], [c, c]], true) + polyD([[c, c + r], [c - r * 0.16, c], [c, c]], true) + polyD([[c + r, c], [c, c + r * 0.16], [c, c]], true) + polyD([[c - r, c], [c, c - r * 0.16], [c, c]], true) }, gCompass);
      }
      const n = el("text", { class: "hud-n lb", x: cs / 2, y: -5 }, gCompass);
      n.style.fontSize = (narrow ? 12 : 13.5) + "px";
      n.textContent = "N";
      compassBox = { x0: x - 8, y0: 0, x1: W, y1: y + cs + 8 };
      // Note on the geometry, bottom left
      gNote.textContent = "";
      // On a narrow plate the note runs full width along the foot and the scales stand above it.
      const fs = narrow ? 9.5 : 10.5, avail = narrow ? W - 28 : Math.max(110, W - 214);
      gNote.style.fontSize = fs + "px";
      const lines = wrap("Schematic plan: boundary, roads and railway estimated.", "nt", fs, avail)
        .concat(wrap("Dashed outlines: positions approximate.", "nt", fs, avail));
      const lh = fs * 1.3;
      lines.forEach((t, i) => {
        const ts = el("tspan", { x: 14, y: f1(H - 13 - (lines.length - 1 - i) * lh) }, gNote);
        ts.textContent = t;
      });
      let bb = null;
      try { bb = gNote.getBBox(); } catch (e) { bb = null; }
      noteBox = bb && bb.width ? { x0: bb.x - 5, y0: bb.y - 5, x1: bb.x + bb.width + 5, y1: H } : { x0: 0, y0: H - 40, x1: 220, y1: H };
      scaleBase = narrow ? Math.round(noteBox.y0 - 1) : H - 14;
      scaleKey = "";
    }
    function pickScale(s, target, unitM, steps) {
      let best = null;
      steps.forEach(u => {
        const seg = u * unitM * s;
        if (seg < 16) return;
        for (let n = 2; n <= 5; n++) {
          const tot = seg * n, score = Math.abs(tot - target) + (seg > 60 ? (seg - 60) * 2 : 0);
          if (!best || score < best.score) best = { u, n, seg, tot, score };
        }
      });
      return best || { u: steps[steps.length - 1], n: 2, seg: steps[steps.length - 1] * unitM * s, tot: 2 * steps[steps.length - 1] * unitM * s };
    }
    function renderScale() {
      const s = S(), key = W + "|" + H + "|" + s.toFixed(6);
      if (key === scaleKey) return;
      scaleKey = key;
      const target = narrow ? 88 : 118;
      const m = pickScale(s, target, 1, [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]);
      const c = pickScale(s, target, CHAIN_M, [1, 2, 5, 10, 20, 40, 80]);
      const fs = narrow ? 8.5 : 9.5, uw = narrow ? 42 : 50;
      const len = Math.max(m.tot, c.tot), x0 = Math.round(W - 16 - uw - len), yb = scaleBase || H - 14;
      const ym = yb - 18, yc = yb - 12;           // bar tops
      let h = '<rect class="hud-bg" x="' + (x0 - 10) + '" y="' + (yb - 33) + '" width="' + (len + uw + 22) + '" height="' + Math.max(40, H - 4.5 - (yb - 33)) + '"/>';
      const bar = (sc, y, unit, below) => {
        let out = "";
        for (let i = 0; i < sc.n; i++) out += '<rect class="' + (i % 2 ? "sb-off" : "sb-on") + '" x="' + f1(x0 + i * sc.seg) + '" y="' + y + '" width="' + f1(sc.seg) + '" height="3.5"/>';
        out += '<rect class="sb-off" x="' + x0 + '" y="' + y + '" width="' + f1(sc.tot) + '" height="3.5" style="fill:none"/>';
        const every = sc.seg >= (narrow ? 22 : 26) ? 1 : sc.n;
        for (let i = 0; i <= sc.n; i++) {
          if (i % every && i !== sc.n) continue;
          const v = i * sc.u;
          out += '<text class="sb-t" x="' + f1(x0 + i * sc.seg) + '" y="' + (below ? y + 3.5 + fs + 1 : y - 2.5) + '" style="font-size:' + fs + 'px">' + v + "</text>";
        }
        out += '<text class="sb-u" x="' + f1(x0 + sc.tot + 14) + '" y="' + (below ? y + 3.5 + fs * 0.4 : y + 3.5) + '" style="font-size:' + fs + 'px">' + unit + "</text>";
        return out;
      };
      h += bar(m, ym, "Metres", false) + bar(c, yc, "Chains", true);
      gScale.innerHTML = h;
      scaleBox = { x0: x0 - 14, y0: yb - 37, x1: W, y1: yb + 8 };
    }
    function hudBoxes() {
      const out = [compassBox, scaleBox, noteBox];
      const hr = host.getBoundingClientRect(), tr = tools.getBoundingClientRect();
      if (tr.width) out.push({ x0: tr.left - hr.left - 6, y0: tr.top - hr.top - 6, x1: tr.right - hr.left + 6, y1: tr.bottom - hr.top + 6 });
      return out.filter(Boolean);
    }

    /* ——— Per-frame drawing ——— */
    let patLOD = 0;
    function updatePatterns() {
      const zl = Math.pow(2, Math.round(Math.log2(view.z))), key = zl * s0;
      if (key === patLOD) return;
      patLOD = key;
      const k = 1 / (s0 * zl);
      patHeath.setAttribute("patternTransform", "scale(" + k + ")");
      patLaid.setAttribute("patternTransform", "scale(" + k + ")");
    }
    function updateDynamicWorld(s) {
      if (mainLine.length > 1) {
        dyn.main = offsetLine(mainLine, (mainSign * 7.5) / s);
        const d = polyD(dyn.main);
        rlEls.forEach(e => e.setAttribute("d", d));
      }
      if (branch.length > 1) {
        const j = mainLine.length > 1 ? nearestOnLine(dyn.main, branch[0]) : null;
        dyn.branch = j && Math.hypot(j[0] - branch[0][0], j[1] - branch[0][1]) < 60 ? [[j[0], j[1]]].concat(branch.slice(1)) : branch;
        const d = polyD(dyn.branch);
        brEls.forEach(e => e.setAttribute("d", d));
      }
      const offA = (a322Sign * 7) / s;
      if (roadMain) {
        dyn.a322 = offsetLine(roadMain.pts, offA);
        const d = polyD(dyn.a322);
        roadEls.mainc.setAttribute("d", d); roadEls.mainf.setAttribute("d", d);
      }
      if (roadPales) {
        dyn.pales = roadMain ? extendLine(roadPales.pts, Math.abs(offA) + 1 / s, 0) : roadPales.pts;
        const d = polyD(dyn.pales);
        roadEls.roadc.setAttribute("d", d); roadEls.roadf.setAttribute("d", d);
      }
    }
    function renderMarkers() {
      for (const k of mks) {
        if (!k.visible) continue;
        const a = toScreen(k.x, k.y), px = a[0] + k.off[0], py = a[1] + k.off[1];
        k.ax = a[0]; k.ay = a[1]; k.sx = px; k.sy = py;
        k.g.setAttribute("transform", "translate(" + f1(px) + " " + f1(py) + ")");
        const dx = px - a[0], dy = py - a[1], d = Math.hypot(dx, dy);
        if (d > 3.5) {
          const ex = px - (dx / d) * (R - 1), ey = py - (dy / d) * (R - 1);
          k.ld.setAttribute("x1", f1(a[0])); k.ld.setAttribute("y1", f1(a[1]));
          k.ld.setAttribute("x2", f1(ex)); k.ld.setAttribute("y2", f1(ey));
          k.dot.setAttribute("cx", f1(a[0])); k.dot.setAttribute("cy", f1(a[1]));
          if (!k.ldOn) { k.ld.setAttribute("visibility", "visible"); k.dot.setAttribute("visibility", "visible"); k.ldOn = true; }
        } else if (k.ldOn) { k.ld.setAttribute("visibility", "hidden"); k.dot.setAttribute("visibility", "hidden"); k.ldOn = false; }
      }
    }
    function renderLabels() {
      for (const L of labels) {
        if (!L.placed || !L.g) continue;
        const a = toScreen(L.ax, L.ay);
        L.g.setAttribute("transform", "translate(" + f1(a[0]) + " " + f1(a[1]) + ")");
        L.sx = a[0]; L.sy = a[1];
      }
    }
    function renderStations() {
      stations.forEach(st => {
        const line = st.line();
        const q = nearestOnLine(line, st.w);
        if (!q) return;
        const a = toScreen(q[0], q[1]), i = q[2];
        const p0 = toScreen(line[i][0], line[i][1]), p1 = toScreen(line[i + 1][0], line[i + 1][1]);
        let ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
        const nx = Math.sin(ang), ny = -Math.cos(ang), o = st.hw + 4.2;
        st.el.setAttribute("transform", "translate(" + f1(a[0] + nx * o * st.side) + " " + f1(a[1] + ny * o * st.side) + ") rotate(" + f1((ang * 180) / Math.PI) + ")");
      });
    }
    function currentBoxes() {
      const out = hudBoxes();
      for (const k of mks) if (k.visible) out.push({ x0: k.sx - R - 1, y0: k.sy - R - 1, x1: k.sx + R + 1, y1: k.sy + R + 1 });
      for (const L of labels) {
        if (!L.placed) continue;
        const dx = L.sx - L.placed.x, dy = L.sy - L.placed.y;
        for (const b of L.placed.boxes) out.push({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
      }
      return out;
    }
    function renderTrees() {
      const s = S(), g = Math.pow(view.z, 0.33), obs = currentBoxes(), segs = screenSegs();
      const hC = (narrow ? 6.4 : 7.6) * g, hW = (narrow ? 8 : 9.6) * g;
      let b1 = "", s1 = "", b2 = "", s2 = "";
      const inView = [];
      for (const t of trees) {
        const a = toScreen(t.x, t.y);
        if (a[0] < -12 || a[0] > W + 12 || a[1] < -4 || a[1] > H + 16) continue;
        inView.push([t, a[0], a[1]]);
      }
      const cap = (W * H) / (narrow ? 2700 : 2200), frac = Math.min(1, cap / Math.max(1, inView.length));
      for (const it of inView) {
        const t = it[0], x = it[1], y = it[2];
        if (t.rank > frac) continue;
        const h = hC * t.sz * (t.kind === "c" ? 1 : 0.8), w = h * (t.kind === "c" ? 0.52 : 0.82);
        const bb = { x0: x - w / 2 - 1, y0: y - h - 1, x1: x + w / 2 + 1, y1: y + 1 };
        if (boxHit(bb, obs) || segHit(bb, segs, ["boundary"])) continue;
        const top = y - h, base = y - h * 0.16, hw = w / 2, bow = t.kind === "c" ? 0.32 : 0.62;
        const right = "Q" + f1(x + hw * bow) + " " + f1(y - h * 0.58) + " " + f1(x + hw) + " " + f1(base);
        b1 += "M" + f1(x) + " " + f1(top) + right + "H" + f1(x - hw) + "Q" + f1(x - hw * bow) + " " + f1(y - h * 0.58) + " " + f1(x) + " " + f1(top) + "ZM" + f1(x) + " " + f1(base) + "V" + f1(y);
        s1 += "M" + f1(x) + " " + f1(top) + right + "H" + f1(x) + "Z";
      }
      // Wellingtonias in rows either side of Railway Avenue
      const step = Math.max(1, Math.ceil((narrow ? 7.5 : 8.5) / (22 * s)));
      const off = avHW + 2 + hW * 0.55;
      for (let i = 0; i < avTrees.length; i += step) {
        const t = avTrees[i], a = toScreen(t.x, t.y);
        if (a[0] < -20 || a[0] > W + 20 || a[1] < -20 || a[1] > H + 20) continue;
        for (const side of [-1, 1]) {
          const cx = a[0] + t.nx * off * side, cy = a[1] + t.ny * off * side;
          const h = hW, w = h * 0.42, x = cx, y = cy + h / 2;
          const bb = { x0: x - w / 2 - 1, y0: y - h - 1, x1: x + w / 2 + 1, y1: y + 1 };
          if (boxHit(bb, obs) || segHit(bb, segs, ["avenue", "branch", "boundary"])) continue;
          const top = y - h, base = y - h * 0.12, hw = w / 2;
          b2 += "M" + f1(x) + " " + f1(top) + "L" + f1(x + hw) + " " + f1(base) + "H" + f1(x - hw) + "ZM" + f1(x) + " " + f1(base) + "V" + f1(y);
          s2 += "M" + f1(x) + " " + f1(top) + "L" + f1(x + hw) + " " + f1(base) + "H" + f1(x) + "Z";
        }
      }
      trBody.setAttribute("d", b1); trShade.setAttribute("d", s1);
      avBody.setAttribute("d", b2); avShade.setAttribute("d", s2);
    }
    function renderArrows() {
      if (!walkPts || walkPts.length < 2) { gArrows.setAttribute("d", ""); return; }
      let d = "";
      for (let i = 0; i < walkPts.length - 1; i++) {
        const a = toScreen(walkPts[i][0], walkPts[i][1]), b = toScreen(walkPts[i + 1][0], walkPts[i + 1][1]);
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        if (L < 2 * R + 22) continue;
        const ux = dx / L, uy = dy / L, mx = a[0] + dx / 2, my = a[1] + dy / 2;
        d += "M" + f1(mx + ux * 5) + " " + f1(my + uy * 5) + "L" + f1(mx - ux * 4 - uy * 4.2) + " " + f1(my - uy * 4 + ux * 4.2) +
          "L" + f1(mx - ux * 2) + " " + f1(my - uy * 2) + "L" + f1(mx - ux * 4 + uy * 4.2) + " " + f1(my - uy * 4 - ux * 4.2) + "Z";
      }
      gArrows.setAttribute("d", d);
    }

    /* ——— The name flag ——— */
    let selectedId = null, pinned = false, hoverId = null, focusId = null, flagFor = null, flagGeom = null, hoverT = 0;
    const flagShadow = el("path", { class: "fl-shadow", transform: "translate(2.5 2.5)" }, flag);
    const flagBox = el("path", { class: "fl-box" }, flag);
    const flagRule = el("path", { class: "fl-rule" }, flag);
    const flagBody = el("g", null, flag);
    function buildFlag(k) {
      flagBody.textContent = "";
      const m = k.m, pad = 10;
      const fsK2 = narrow ? 9 : 9.5, fsL = narrow ? 13 : 14, fsO = narrow ? 12 : 12.5;
      const maxW = Math.min(250, W - 44);
      const kick = "No. " + m.n + " · " + (m.type || m.group || "") + (m.approx ? " · approximate" : "");
      const lines = wrap(m.label, "fl-label", fsL, maxW);
      const kw = measure(kick, "fl-kick", fsK2), ow = measure("Particulars ›", "fl-open-t", fsO);
      const lw = Math.max.apply(null, lines.map(l => measure(l, "fl-label", fsL)));
      const w = Math.ceil(Math.min(Math.max(kw, lw, ow), maxW + 4) + pad * 2);
      let y = pad + fsK2 * 0.8;
      const tk = el("text", { class: "fl-kick", x: pad, y: f1(y) }, flagBody);
      tk.style.fontSize = fsK2 + "px";
      tk.textContent = kick;
      y += 5;
      const tl = el("text", { class: "fl-label" }, flagBody);
      tl.style.fontSize = fsL + "px";
      lines.forEach(t => { y += fsL * 1.18; const ts = el("tspan", { x: pad, y: f1(y) }, tl); ts.textContent = t; });
      y += fsO * 1.45;
      const og = el("g", { class: "fl-open" }, flagBody);
      el("rect", { class: "fl-open-hit", x: pad - 4, y: f1(y - fsO - 3), width: f1(ow + 8), height: f1(fsO + 9) }, og);
      const to = el("text", { class: "fl-open-t", x: pad, y: f1(y) }, og);
      to.style.fontSize = fsO + "px";
      to.textContent = "Particulars ›";
      flagGeom = { w, h: Math.ceil(y + pad - 2) };
      flagRule.setAttribute("d", "M3 3H" + (w - 3) + "V" + (flagGeom.h - 3) + "H3Z");
    }
    function updateFlag() {
      let id = hoverId || focusId || (pinned ? selectedId : null);
      const k = id ? byId.get(id) : null;
      if (!k || !k.visible) id = null;
      if (id !== flagFor) {
        flagFor = id;
        if (id) buildFlag(k);
      }
      renderFlag();
    }
    function renderFlag() {
      const k = flagFor ? byId.get(flagFor) : null;
      if (!k || !flagGeom || k.sx < -2 || k.sx > W + 2 || k.sy < -2 || k.sy > H + 2) { flag.setAttribute("visibility", "hidden"); return; }
      const w = flagGeom.w, h = flagGeom.h, gap = R + 9;
      let top = k.sy - gap - h, below = false;
      if (top < 6) { top = k.sy + gap; below = true; }
      const left = clamp(k.sx - w / 2, 6, Math.max(6, W - 6 - w));
      const px = clamp(k.sx - left, 12, w - 12);
      const d = below
        ? "M0 0H" + f1(px - 6) + "L" + f1(px) + " -7L" + f1(px + 6) + " 0H" + w + "V" + h + "H0Z"
        : "M0 0H" + w + "V" + h + "H" + f1(px + 6) + "L" + f1(px) + " " + (h + 7) + "L" + f1(px - 6) + " " + h + "H0Z";
      flagBox.setAttribute("d", d);
      flagShadow.setAttribute("d", d);
      flag.setAttribute("transform", "translate(" + f1(left) + " " + f1(top) + ")");
      flag.setAttribute("visibility", "visible");
    }
    function setSelected(id) {
      if (selectedId === id) return;
      const old = selectedId ? byId.get(selectedId) : null;
      if (old) old.g.classList.remove("is-sel");
      selectedId = id;
      const k = id ? byId.get(id) : null;
      if (k) k.g.classList.add("is-sel");
    }

    /* ——— Layout: separate the key numbers, then set the lettering ——— */
    function relax(items, keepOut) {
      const n = items.length, minD = 2 * R + 2.5;
      if (!n) return;
      for (let it = 0; it < 160; it++) {
        let moved = false;
        for (let i = 0; i < n; i++) {
          const a = items[i];
          for (let j = i + 1; j < n; j++) {
            const b = items[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            if (dx >= minD || dx <= -minD || dy >= minD || dy <= -minD) continue;
            let d = Math.sqrt(dx * dx + dy * dy);
            if (d >= minD) continue;
            if (d < 0.01) { const ang = i * 2.399963 + j * 0.713; dx = Math.cos(ang); dy = Math.sin(ang); d = 0; } else { dx /= d; dy /= d; }
            const push = (minD - d) / 2;
            a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
            moved = true;
          }
        }
        if (it < 110) for (const a of items) { a.x += (a.ax - a.x) * 0.035; a.y += (a.ay - a.y) * 0.035; }
        for (const a of items) {
          if (!(a.ax >= 0 && a.ax <= W && a.ay >= 0 && a.ay <= H)) continue;
          // stay clear of the instruments (zoom buttons, compass, scales, note), and on the plate
          for (const b of keepOut) {
            const x0 = b.x0 - R - 2, x1 = b.x1 + R + 2, y0 = b.y0 - R - 2, y1 = b.y1 + R + 2;
            if (a.x <= x0 || a.x >= x1 || a.y <= y0 || a.y >= y1) continue;
            const opts = [[x0 - a.x, 0], [x1 - a.x, 0], [0, y0 - a.y], [0, y1 - a.y]]
              .filter(o => a.x + o[0] >= R + 3 && a.x + o[0] <= W - R - 3 && a.y + o[1] >= R + 3 && a.y + o[1] <= H - R - 3)
              .sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
            if (opts.length) { a.x += opts[0][0]; a.y += opts[0][1]; moved = true; }
          }
          a.x = clamp(a.x, R + 3, W - R - 3); a.y = clamp(a.y, R + 3, H - R - 3);
        }
        if (!moved && it >= 110) break;
      }
    }
    let offAnim = 0;
    function layout(animate) {
      if (!W || !H) return;
      const act = [];
      for (const k of mks) {
        k.from = k.off.slice();
        k.to = [0, 0];
        if (!k.visible) continue;
        const a = toScreen(k.x, k.y);
        if (a[0] < -80 || a[0] > W + 80 || a[1] < -80 || a[1] > H + 80) continue;
        act.push({ k, ax: a[0], ay: a[1], x: a[0], y: a[1] });
      }
      const hud = hudBoxes();
      relax(act, hud);
      act.forEach(a => { a.k.to = [a.x - a.ax, a.y - a.ay]; });
      const boxes = hud.concat(act.map(a => ({ x0: a.x - R - 2, y0: a.y - R - 2, x1: a.x + R + 2, y1: a.y + R + 2 })));
      if (pond) {
        const p0 = toScreen(pond.x0, pond.y0), p1 = toScreen(pond.x1, pond.y1);
        boxes.push({ x0: p0[0] - 2, y0: p0[1] - 2, x1: p1[0] + 2, y1: p1[1] + 2 });
      }
      const segs = screenSegs();
      for (const L of labels) {
        L.placed = null;
        if (L.kind === "point") placePoint(L, boxes, segs); else placeLine(L, boxes, segs);
        if (L.placed) {
          L.placed.boxes.forEach(b => boxes.push(b));
          const w = toWorld(L.placed.x, L.placed.y);
          L.ax = w[0]; L.ay = w[1];
        }
        drawLabel(L);
      }
      if (pondLines) {
        const sp = 2.3 / S();
        let d = "";
        for (let y = pond.y0 + sp * 0.6; y < pond.y1; y += sp) d += "M" + (pond.x0 - 2).toFixed(2) + " " + y.toFixed(2) + "H" + (pond.x1 + 2).toFixed(2);
        pondLines.setAttribute("d", d);
      }
      cancelAnimationFrame(offAnim);
      const moving = mks.some(k => Math.abs(k.to[0] - k.from[0]) + Math.abs(k.to[1] - k.from[1]) > 0.5);
      if (!animate || reduced() || !moving) {
        mks.forEach(k => { k.off = k.to.slice(); });
        render();
        return;
      }
      const t0 = performance.now();
      const step = now => {
        const t = Math.min(1, (now - t0) / 240), e = easeInOut(t);
        mks.forEach(k => { k.off = [k.from[0] + (k.to[0] - k.from[0]) * e, k.from[1] + (k.to[1] - k.from[1]) * e]; });
        render();
        if (t < 1) offAnim = requestAnimationFrame(step);
      };
      offAnim = requestAnimationFrame(step);
    }

    function render() {
      if (!W || !H) return;
      const s = S(), vw = W / s, vh = H / s, x0 = view.cx - vw / 2, y0 = view.cy - vh / 2;
      svg.setAttribute("viewBox", x0.toFixed(3) + " " + y0.toFixed(3) + " " + vw.toFixed(3) + " " + vh.toFixed(3));
      over.setAttribute("transform", "matrix(" + (1 / s).toFixed(7) + " 0 0 " + (1 / s).toFixed(7) + " " + x0.toFixed(3) + " " + y0.toFixed(3) + ")");
      updatePatterns();
      updateDynamicWorld(s);
      renderMarkers();
      renderLabels();
      renderStations();
      renderTrees();
      renderArrows();
      renderScale();
      renderFlag();
    }

    /* ——— View changes and animation ——— */
    let rafId = 0, anim = 0, settleT = 0;
    function requestRender() { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); }); }
    function viewChanged() {
      requestRender();
      clearTimeout(settleT);
      settleT = setTimeout(settle, 170);
    }
    function settle() {
      if (anim || pinch || drag.moved) { settleT = setTimeout(settle, 120); return; }
      layout(true);
    }
    function cancelAnim() { if (anim) { cancelAnimationFrame(anim); anim = 0; } }
    function setView(v) { cancelAnim(); clampView(v); view.cx = v.cx; view.cy = v.cy; view.z = v.z; viewChanged(); }
    function animateTo(target, pivot) {
      clampView(target);
      cancelAnim();
      if (reduced()) { view.cx = target.cx; view.cy = target.cy; view.z = target.z; viewChanged(); return; }
      const from = { cx: view.cx, cy: view.cy, z: view.z }, t0 = performance.now(), dur = 440;
      const wp = pivot ? toWorld(pivot[0], pivot[1]) : null;
      const step = now => {
        const t = Math.min(1, (now - t0) / dur), e = easeInOut(t);
        view.z = from.z * Math.pow(target.z / from.z, e);
        if (wp) {
          const s = s0 * view.z;
          view.cx = wp[0] - (pivot[0] - W / 2) / s; view.cy = wp[1] - (pivot[1] - H / 2) / s;
          clampView(view);
        } else {
          view.cx = from.cx + (target.cx - from.cx) * e; view.cy = from.cy + (target.cy - from.cy) * e;
        }
        if (t >= 1) { view.cx = target.cx; view.cy = target.cy; view.z = target.z; }
        render();
        if (t < 1) anim = requestAnimationFrame(step);
        else { anim = 0; viewChanged(); }
      };
      anim = requestAnimationFrame(step);
    }
    function zoomTarget(px, py, factor) {
      const wpt = toWorld(px, py), z = clamp(view.z * factor, ZMIN, ZMAX), s = s0 * z;
      return { cx: wpt[0] - (px - W / 2) / s, cy: wpt[1] - (py - H / 2) / s, z };
    }
    function zoomBy(f) {
      if (!W) return;
      animateTo({ cx: view.cx, cy: view.cy, z: clamp(view.z * f, ZMIN, ZMAX) }, [W / 2, H / 2]);
    }
    function bringIntoView(k) {
      const a = toScreen(k.x, k.y), px = a[0] + k.to[0], py = a[1] + k.to[1];
      if (px >= 60 && px <= W - 28 && py >= 100 && py <= H - 48) return;
      animateTo({ cx: k.x, cy: k.y - (H * 0.08) / S(), z: view.z });
    }
    function fitTo(pts) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
      const padL = 66, padR = 46, padT = 74, padB = 60;
      const aw = Math.max(60, W - padL - padR), ah = Math.max(60, H - padT - padB);
      const z = clamp(Math.min(aw / (Math.max(x1 - x0, 1) * s0), ah / (Math.max(y1 - y0, 1) * s0)), 1, 5);
      const s = s0 * z;
      animateTo({ cx: (x0 + x1) / 2 - (padL - padR) / 2 / s, cy: (y0 + y1) / 2 - (padT - padB) / 2 / s, z });
    }
    let hintT = 0;
    function flashHint(text) {
      hint.textContent = text;
      hint.classList.add("is-on");
      clearTimeout(hintT);
      hintT = setTimeout(() => hint.classList.remove("is-on"), 1700);
    }
    const local = e => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    /* ——— Pointer: drag to pan, click, hover ——— */
    let armed = false, suppressClick = false;
    const drag = { id: null, x: 0, y: 0, lx: 0, ly: 0, active: false, moved: false };
    svg.addEventListener("pointerdown", e => {
      armed = true;
      if (e.pointerType === "touch" || e.button !== 0) return;
      if (e.target.closest && e.target.closest(".fl")) return;
      drag.id = e.pointerId; drag.x = drag.lx = e.clientX; drag.y = drag.ly = e.clientY; drag.active = true; drag.moved = false;
    });
    svg.addEventListener("pointermove", e => {
      if (!drag.active || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
        drag.moved = true;
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* capture unavailable */ }
        host.classList.add("is-dragging");
        cancelAnim();
        hoverId = null;
      }
      const s = S();
      view.cx -= (e.clientX - drag.lx) / s; view.cy -= (e.clientY - drag.ly) / s;
      clampView(view);
      drag.lx = e.clientX; drag.ly = e.clientY;
      viewChanged();
    });
    const endDrag = e => {
      if (!drag.active || e.pointerId !== drag.id) return;
      drag.active = false;
      if (drag.moved) {
        drag.moved = false;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        host.classList.remove("is-dragging");
        try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        viewChanged();
      }
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);
    svg.addEventListener("pointerover", e => {
      if (e.pointerType !== "mouse" || drag.moved) return;
      const g = e.target.closest(".mk");
      if (g) { clearTimeout(hoverT); if (hoverId !== g.dataset.id) { hoverId = g.dataset.id; updateFlag(); } }
      else if (e.target.closest(".fl")) clearTimeout(hoverT);
    });
    svg.addEventListener("pointerout", e => {
      if (e.pointerType !== "mouse") return;
      const g = e.target.closest(".mk, .fl");
      if (!g || (e.relatedTarget && g.contains(e.relatedTarget))) return;
      clearTimeout(hoverT);
      hoverT = setTimeout(() => { if (hoverId) { hoverId = null; updateFlag(); } }, 280);
    });
    host.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") armed = false; });
    const onDocDown = e => { if (!host.contains(e.target)) armed = false; };
    document.addEventListener("pointerdown", onDocDown, true);

    function userSelect(id) {
      api.select(id, { pan: false });
      onSelect(id);
    }
    svg.addEventListener("click", e => {
      if (suppressClick) return;
      const t = e.target;
      if (t.closest(".fl-open")) { if (flagFor) onOpen(flagFor); return; }
      if (t.closest(".fl")) return;
      const g = t.closest(".mk");
      if (g) { userSelect(g.dataset.id); return; }
      pinned = false; hoverId = null;
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest(".bw-plan .mk")) ae.blur();
      focusId = null;
      updateFlag();
    });
    svg.addEventListener("dblclick", e => {
      const g = e.target.closest(".mk");
      if (g) { e.preventDefault(); onOpen(g.dataset.id); return; }
      if (e.target.closest(".fl")) return;
      const p = local(e);
      animateTo(zoomTarget(p[0], p[1], 2), p);
    });

    /* ——— Keyboard ——— */
    gMarkers.addEventListener("focusin", e => {
      const g = e.target.closest(".mk");
      if (!g) return;
      focusId = g.dataset.id;
      const k = byId.get(focusId);
      if (k && (k.sx < 0 || k.sx > W || k.sy < 0 || k.sy > H)) bringIntoView(k);
      updateFlag();
    });
    gMarkers.addEventListener("focusout", () => { focusId = null; updateFlag(); });
    gMarkers.addEventListener("keydown", e => {
      const g = e.target.closest(".mk");
      if (!g) return;
      const id = g.dataset.id;
      if (e.key === "Enter") { e.preventDefault(); if (selectedId === id) onOpen(id); else userSelect(id); }
      else if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); userSelect(id); }
    });
    host.addEventListener("keydown", e => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target.closest && e.target.closest(".plan-tools")) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.6); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 1.6); }
      else if (e.key === "Escape") { pinned = false; hoverId = null; updateFlag(); }
      else if (/^Arrow/.test(e.key) && e.target.closest && e.target.closest(".mk")) {
        e.preventDefault();
        const st = 80 / S();
        setView({ cx: view.cx + (e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0), cy: view.cy + (e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0), z: view.z });
      }
    });

    /* ——— Wheel: zoom only with Ctrl/⌘ or after a click inside the plan ——— */
    host.addEventListener("wheel", e => {
      if (!(e.ctrlKey || e.metaKey || armed)) { if (!hint.classList.contains("is-on") || hint.textContent !== HINT_WHEEL) flashHint(HINT_WHEEL); return; }
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= H || 600;
      const p = local(e);
      setView(zoomTarget(p[0], p[1], clamp(Math.exp(-dy * 0.0055), 0.7, 1.45)));
    }, { passive: false });

    /* ——— Touch: one finger scrolls the page; two fingers pan and pinch the plan ——— */
    let pinch = null, touchHintAt = 0;
    const pinchState = touches => {
      const r = host.getBoundingClientRect(), a = touches[0], b = touches[1];
      return { x: clamp((a.clientX + b.clientX) / 2 - r.left, 0, r.width), y: clamp((a.clientY + b.clientY) / 2 - r.top, 0, r.height), d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    };
    host.addEventListener("touchstart", e => {
      if (e.touches.length >= 2) { if (e.cancelable) e.preventDefault(); pinch = pinchState(e.touches); cancelAnim(); hint.classList.remove("is-on"); }
    }, { passive: false });
    host.addEventListener("touchmove", e => {
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        const p = pinchState(e.touches);
        if (!pinch) { pinch = p; return; }
        const s = S();
        view.cx -= (p.x - pinch.x) / s; view.cy -= (p.y - pinch.y) / s;
        clampView(view);
        const f = pinch.d > 0 && p.d > 0 ? p.d / pinch.d : 1;
        setView(zoomTarget(p.x, p.y, f));
        pinch = p;
      } else if (!pinch && Date.now() - touchHintAt > 4000) {
        touchHintAt = Date.now();
        flashHint(HINT_TOUCH);
      }
    }, { passive: false });
    const endTouch = e => { if (e.touches.length < 2 && pinch) { pinch = null; viewChanged(); } };
    host.addEventListener("touchend", endTouch);
    host.addEventListener("touchcancel", endTouch);

    /* ——— Size ——— */
    function measureHost() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h || (w === W && h === H)) return;
      W = w; H = h;
      narrow = W < 520;
      fsK = narrow ? 0.9 : 1;
      R = narrow ? 10 : 11;
      host.classList.toggle("is-narrow", narrow);
      s0 = Math.min(W / (home.x1 - home.x0), H / (home.y1 - home.y0));
      patLOD = 0;
      sizeMarkers();
      buildHud();
      if (flagFor) { const k = byId.get(flagFor); if (k) buildFlag(k); }
      render();
      layout(false);
    }
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(() => measureHost()); ro.observe(host); }
    else window.addEventListener("resize", measureHost);
    measureHost();
    if (document.fonts && document.fonts.ready) {
      const refit = () => {
        mcache.clear();
        if (!W) return;
        buildHud();
        labels.forEach(L => { L.sig = null; });
        if (flagFor) { const k = byId.get(flagFor); if (k) buildFlag(k); }
        layout(false);
      };
      document.fonts.ready.then(refit).catch(() => {});
      if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", refit);
    }

    /* ——— Public interface ——— */
    const api = {
      select(id, o) {
        const k = id == null ? null : byId.get(String(id));
        setSelected(k ? k.id : null);
        if (k) {
          pinned = true;
          if (focusId && focusId !== k.id) focusId = null;   // the newest choice owns the flag
          if (hoverId && hoverId !== k.id) hoverId = null;
          if (o && o.pan) bringIntoView(k);
        }
        updateFlag();
      },
      setFilter(fn) {
        const f = typeof fn === "function" ? fn : null;
        for (const k of mks) {
          let v = true;
          if (f) { try { v = !!f(k.m); } catch (err) { v = true; } }
          k.visible = v;
          k.g.style.display = v ? "" : "none";
          if (!v && k.ldOn) { k.ld.setAttribute("visibility", "hidden"); k.dot.setAttribute("visibility", "hidden"); k.ldOn = false; }
        }
        updateFlag();
        layout(true);
      },
      showWalk(ids) {
        const list = Array.isArray(ids) ? ids.map(String).filter(id => byId.has(id)) : [];
        walkPts = list.length ? list.map(id => [byId.get(id).x, byId.get(id).y]) : null;
        const d = walkPts && walkPts.length > 1 ? polyD(walkPts) : "";
        rtHalo.setAttribute("d", d);
        rtLine.setAttribute("d", d);
        if (walkPts) { pinned = false; hoverId = null; updateFlag(); if (W) fitTo(walkPts); }
        requestRender();
      },
      reset() {
        animateTo({ cx: homeC[0], cy: homeC[1], z: 1 });
      },
    };
    return api;
  }

  window.BrookwoodPlan = { mount };
})();
