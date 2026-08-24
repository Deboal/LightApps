import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Globe, haversineKm } from "./globe.js";
import { paintMap, swatch, SEA_STOPS, ISO_STOPS } from "./palette.js";

/* Isolation Globe.
 *
 * One question, asked two ways, over one grid:
 *   how far is the nearest land — and how alone is each piece of land?
 * The elevation slider redefines "land" as "ground reaching at least E metres",
 * which turns the same two questions into "how far to the nearest high ground"
 * and "how isolated is this massif".
 *
 * No backend, no sign-in: the whole dataset is one 2160x1080 PNG.
 */

// More resolution down low, where the interesting thresholds are crowded.
const STEPS = [
  0, 25, 50, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1800,
  2100, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000,
];

const C = {
  bg: "#05070c", panel: "#0d1420", line: "#1e2a3d", text: "#e8eff7",
  dim: "#8a9bb0", faint: "#5a6b80", accent: "#4fd0c4", warm: "#f0a04b",
};

const fmtKm = (v) => (v == null || v < 0 ? "—" : `${Math.round(v).toLocaleString()} km`);
const fmtArea = (v) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M km²`
    : v >= 1000 ? `${Math.round(v).toLocaleString()} km²`
      : `${v.toFixed(0)} km²`;

/* ---- data loading -------------------------------------------------------- */

const loadImage = (src) =>
  new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`${src} failed to load`));
    im.src = src;
  });

function pixels(img, W, H) {
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  return cx.getImageData(0, 0, W, H).data;
}

async function loadTerrain() {
  const labels = await fetch("assets/labels.json").then((r) => {
    if (!r.ok) throw new Error(`labels.json: HTTP ${r.status}`);
    return r.json();
  });
  const W = labels.width, H = labels.height;
  const [terrainImg, regionImg] = await Promise.all([
    loadImage("assets/terrain.png"),
    loadImage("assets/regions.png"),
  ]);

  // terrain.png: R,G = elevation+1 big-endian (0 = no land); B = place index.
  const raw = pixels(terrainImg, W, H);
  const elev = new Int16Array(W * H);
  const place = new Uint8Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) {
    const v = (raw[o] << 8) | raw[o + 1];
    elev[i] = v === 0 ? -1 : v - 1;
    place[i] = raw[o + 2];
  }

  // regions.png: R,G = index into labels.regions.
  const rraw = pixels(regionImg, W, H);
  const region = new Uint16Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) region[i] = (rraw[o] << 8) | rraw[o + 1];

  return { labels, elev, place, region, W, H };
}

/* ---- naming -------------------------------------------------------------- */

/* Natural Earth gives us three overlapping ways to name a cell: the named region
 * it falls in (island, archipelago, range, plateau), the country or territory it
 * belongs to, and ~700 surveyed summits with a position. Which one reads best
 * depends on what is being named:
 *
 *   a summit, once the elevation bar is raised   -> the peak's own name
 *   a small island                               -> the region ("Easter Island")
 *   a continent-sized mass                       -> the region, not its summit
 *
 * The country is always the subtitle, never the headline, unless nothing else
 * is available. That is what stops a readout saying "United States of America"
 * when it means Hawai'i.
 */
function makeNamer(data) {
  const { labels, place, region, W, H } = data;
  const cellKm = (180 / H) * 111.2;

  const nearest = (list, lat, lon, maxKm, filter) => {
    let best = null, bestD = maxKm;
    for (const it of list) {
      if (filter && !filter(it)) continue;
      if (Math.abs(it.lat - lat) * 111 > bestD) continue;
      const d = haversineKm([lat, lon], [it.lat, it.lon]);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  };

  return function name(idx, threshold, areaKm2) {
    const r = (idx / W) | 0, c = idx - r * W;
    const lat = 90 - (r + 0.5) * (180 / H);
    const lon = -180 + (c + 0.5) * (360 / W);
    const country = labels.places[place[idx]] || "";
    const ri = region[idx];
    const reg = labels.regions[ri] || "";
    const tier = reg ? labels.regionTier[ri] : 3;
    const exact = tier === 0 ? reg : "";   // names this island / range / plateau
    const group = tier === 1 ? reg : "";   // names the archipelago it sits in
    const broad = tier === 2 ? reg : "";   // "Polynesia", "Siberia"
    // A summit label sitting a couple of cells away is still describing this
    // ground; one 300 km away is describing somewhere else.
    const peak = threshold > 0
      ? nearest(labels.peaks, lat, lon, Math.max(2.5 * cellKm, 80), (p) => p.elev >= threshold)
      : null;
    const isle = exact ? null : nearest(labels.islands, lat, lon, Math.max(2 * cellKm, 60));

    // On anything bigger than a small country, a single summit is the wrong
    // handle for the whole mass — the range or plateau name is.
    const big = areaKm2 != null && areaKm2 > 120000;
    const order = big
      ? [exact, group, isle && isle.name, peak && peak.name, country, broad]
      : [peak && peak.name, exact, isle && isle.name, group, country, broad];
    const title = order.find(Boolean) || "Unnamed land";
    const sub = country && country !== title ? country : "";
    return { title, sub, lat, lon };
  };
}

/* The big landmasses have no single Natural Earth label, so anchor them by a
 * point that is unambiguously inside each one. Only used while a mass is still
 * continent-sized; raise the slider and they break into named ranges instead. */
const ANCHORS = [
  ["Afro-Eurasia", 48, 10], ["the Americas", 41, -100], ["Antarctica", -82, 40],
  ["Australia", -25, 134], ["Greenland", 72, -40],
];

/* ---- worker plumbing ----------------------------------------------------- */

function useField(data) {
  const [field, setField] = useState(null);
  const [busy, setBusy] = useState(true);
  const workerRef = useRef(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!data) return undefined;
    const w = new Worker("worker.js");
    workerRef.current = w;
    w.onmessage = (e) => {
      if (e.data.type !== "result") return;
      if (e.data.seq !== seqRef.current) return; // a newer request is in flight
      setField(e.data);
      setBusy(false);
    };
    // The elevation grid is copied into the worker once and stays there.
    w.postMessage({ type: "init", elev: data.elev.buffer.slice(0), W: data.W, H: data.H });
    return () => w.terminate();
  }, [data]);

  const compute = useCallback((threshold) => {
    if (!workerRef.current) return;
    setBusy(true);
    workerRef.current.postMessage({ type: "compute", threshold, seq: ++seqRef.current });
  }, []);

  return { field, busy, compute };
}

/* ---- app ----------------------------------------------------------------- */

function App() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [applied, setApplied] = useState(0); // threshold the current field is for
  const [mode, setMode] = useState("sea");
  const [sel, setSel] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
  const [wide, setWide] = useState(() => window.innerWidth >= 900);

  const canvasRef = useRef(null);
  const globeRef = useRef(null);
  const mapRef = useRef(null);
  const frameRef = useRef(0);

  const threshold = STEPS[stepIdx];
  const { field, busy, compute } = useField(data);

  // Declared before the effects that list it as a dependency: a dependency array
  // is evaluated during render, so a const declared below one would throw.
  const draw = useCallback(() => {
    if (!globeRef.current) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => globeRef.current.render());
  }, []);

  useEffect(() => {
    loadTerrain().then(setData).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    const onResize = () => { setWide(window.innerWidth >= 900); draw(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // Kick off the first field as soon as the grid is in the worker.
  useEffect(() => { if (data) compute(0); }, [data, compute]);

  const namer = useMemo(() => (data ? makeNamer(data) : null), [data]);

  // Repaint the equirectangular map whenever the field or the colour mode changes.
  useEffect(() => {
    if (!field || !data) return;
    const { W, H } = data;
    if (!mapRef.current) {
      mapRef.current = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    }
    paintMap(mapRef.current, {
      elev: data.elev, dist: field.dist, comp: field.comp, iso: field.iso,
      threshold: field.threshold, mode, W, H,
    });
    if (!globeRef.current) globeRef.current = new Globe(canvasRef.current);
    globeRef.current.setMap(mapRef.current);
    setApplied(field.threshold);
    draw();
  }, [field, data, mode, draw]);

  /* -- pointer handling: drag to spin, wheel/pinch to zoom, tap to inspect --
   * Registered once. The handlers reach the current inspect() through a ref
   * rather than by re-subscribing on every render, so a re-render arriving
   * mid-gesture — the worker finishing, say — cannot cancel the timer that
   * restores full render quality and leave the globe soft. */
  const inspectRef = useRef(() => {});
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    let dragging = false, moved = 0, lastX = 0, lastY = 0, pinch = 0;
    const pts = new Map();

    const settle = () => {
      const g = globeRef.current;
      if (!g || g.quality === 1) return;
      g.quality = 1;
      draw();
    };
    let settleTimer = 0;
    const coarse = () => {
      const g = globeRef.current;
      if (g && g.quality === 1) g.quality = 0.62;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 140);
    };

    const down = (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
      pinch = pts.size === 2 ? spread(pts) : 0;
    };
    const move = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const g = globeRef.current;
      if (!g) return;
      if (pts.size === 2) {
        const s = spread(pts);
        if (pinch > 0) { g.zoom = clampZoom(g.zoom * (s / pinch)); coarse(); draw(); }
        pinch = s;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      // Degrees per pixel scales with the globe's on-screen size, so dragging
      // feels the same whether zoomed out or in.
      const k = 180 / (Math.min(cv.clientWidth, cv.clientHeight) * 0.94 * g.zoom);
      g.lon = wrapLon(g.lon - dx * k);
      g.lat = Math.max(-89, Math.min(89, g.lat + dy * k));
      coarse();
      draw();
    };
    const up = (e) => {
      pts.delete(e.pointerId);
      pinch = 0;
      if (dragging && moved < 6) inspectRef.current(e.clientX, e.clientY);
      dragging = pts.size > 0;
      settle();
    };
    const wheel = (e) => {
      e.preventDefault();
      const g = globeRef.current;
      if (!g) return;
      g.zoom = clampZoom(g.zoom * Math.exp(-e.deltaY * 0.0016));
      coarse();
      draw();
    };

    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
      clearTimeout(settleTimer);
    };
  }, [draw]);

  /** Turn a click into the readout for whatever is under it. */
  const inspect = useCallback((clientX, clientY) => {
    const g = globeRef.current;
    if (!g || !field || !data || !namer) return;
    const rect = g.canvas.getBoundingClientRect();
    const scale = g.canvas.width / rect.width;
    const ll = g.unproject((clientX - rect.left) * scale, (clientY - rect.top) * scale);
    if (!ll) { setSel(null); g.setOverlay(null); draw(); return; }
    setSel(describe(ll, { field, data, namer }));
  }, [field, data, namer, draw]);
  inspectRef.current = inspect;

  // Keep the drawn line in step with the readout.
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.setOverlay(sel ? {
      line: sel.line,
      lineColor: mode === "iso" ? "#ffe9ab" : "#ffffff",
      markers: [
        { lat: sel.line[0][0], lon: sel.line[0][1], fill: "#ffffff", r: 5 },
        { lat: sel.line[1][0], lon: sel.line[1][1], fill: C.accent, r: 5 },
      ],
    } : null);
    draw();
  }, [sel, mode, draw]);

  // A new threshold invalidates the old selection's numbers.
  useEffect(() => { setSel(null); }, [applied, mode]);

  const flyTo = useCallback((lat, lon) => {
    const g = globeRef.current;
    if (!g) return;
    const from = [g.lat, g.lon];
    const dLon = shortestLon(g.lon, lon);
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / 620);
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      g.lat = from[0] + (lat - from[0]) * e;
      g.lon = wrapLon(from[1] + dLon * e);
      g.render();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  const ranked = useMemo(() => rankIsolated(field, data, namer), [field, data, namer]);

  // A small handle for headless checking. The numbers this app reports are the
  // whole product, and there is no other way to assert on them from outside.
  useEffect(() => {
    if (!field || !data || !namer) return;
    window.__globeDebug = {
      field, data,
      probe: (lat, lon) => describe([lat, lon], { field, data, namer }),
      nemoLatLon: () => cellLatLon(field.farthest, data.W, data.H),
      setThreshold: (m) => {
        let i = 0;
        for (let k = 1; k < STEPS.length; k++) {
          if (Math.abs(STEPS[k] - m) < Math.abs(STEPS[i] - m)) i = k;
        }
        setStepIdx(i);
        compute(STEPS[i]);
      },
    };
  }, [field, data, namer, compute]);

  if (err) {
    return (
      <div style={{ padding: 30, color: C.text, fontFamily: "inherit" }}>
        <h2 style={{ margin: "0 0 8px" }}>Could not load the terrain data</h2>
        <p style={{ color: C.dim, lineHeight: 1.5, maxWidth: 460 }}>
          {err}. The app needs <code>assets/terrain.png</code> and{" "}
          <code>assets/labels.json</code> served alongside it, so it has to run
          from a web server rather than a <code>file://</code> page.
        </p>
      </div>
    );
  }

  // "pending" is a threshold the user has dialled in but not yet spent a compute
  // on — keyboard users get a button, pointer and touch users never see it
  // because releasing the slider commits.
  const pending = !busy && applied !== threshold;

  return (
    <div style={{
      display: "flex", flexDirection: wide ? "row" : "column",
      height: "100dvh", background: C.bg, color: C.text, overflow: "hidden",
    }}>
      <div style={{ position: "relative", flex: 1, minHeight: 0, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "grab" }}
        />
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, padding: "14px 16px 26px",
          pointerEvents: "none", display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", gap: 12,
          // Zoom in far enough and the header sits over lit snowfields, so it
          // carries its own scrim rather than relying on the space behind it.
          background: "linear-gradient(180deg, rgba(5,7,12,.82) 0%, rgba(5,7,12,.55) 45%, rgba(5,7,12,0) 100%)",
        }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: ".22em", color: C.faint, fontWeight: 700 }}>
              ISOLATION GLOBE
            </div>
            <div style={{ fontSize: 13, color: C.dim, marginTop: 3, maxWidth: 260 }}>
              {threshold === 0
                ? "Distance to the nearest land, of any size"
                : `Distance to the nearest ground reaching ${threshold.toLocaleString()} m`}
            </div>
          </div>
          <button
            onClick={() => setShowAbout(true)}
            style={{ ...btn, pointerEvents: "auto", padding: "6px 11px", fontSize: 12 }}
          >
            About
          </button>
        </div>

        {!data && <Center>Loading terrain…</Center>}
        {data && !field && <Center>Measuring the oceans…</Center>}
        {field && busy && (
          <div style={{
            position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
            background: "rgba(8,14,24,.86)", border: `1px solid ${C.line}`, color: C.dim,
            padding: "6px 13px", borderRadius: 20, fontSize: 12, pointerEvents: "none",
          }}>
            Recomputing at {threshold.toLocaleString()} m…
          </div>
        )}
      </div>

      <Panel
        wide={wide}
        stepIdx={stepIdx} setStepIdx={setStepIdx}
        threshold={threshold} applied={applied} pending={pending}
        commit={() => compute(STEPS[stepIdx])}
        mode={mode} setMode={setMode}
        field={field} data={data} namer={namer}
        sel={sel} ranked={ranked} flyTo={flyTo} setSel={setSel}
      />

      {showAbout && <About onClose={() => setShowAbout(false)} />}
    </div>
  );
}

/* ---- readout ------------------------------------------------------------- */

function cellOf(lat, lon, W, H) {
  const r = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
  const c = ((Math.floor(((lon + 180) / 360) * W) % W) + W) % W;
  return r * W + c;
}

function cellLatLon(idx, W, H) {
  const r = (idx / W) | 0, c = idx - r * W;
  return [90 - (r + 0.5) * (180 / H), -180 + (c + 0.5) * (360 / W)];
}

function massName(compId, field, data, namer) {
  if (compId < 0) return { title: "—", sub: "" };
  const area = field.area[compId];
  if (area > 900000) {
    for (const [nm, lat, lon] of ANCHORS) {
      const i = cellOf(lat, lon, data.W, data.H);
      if (field.comp[i] === compId) return { title: nm, sub: "" };
    }
  }
  return namer(field.peak[compId], field.threshold, area);
}

function describe(ll, { field, data, namer }) {
  const { W, H } = data;
  const idx = cellOf(ll[0], ll[1], W, H);
  const t = field.threshold;
  const qualifies = data.elev[idx] >= t;

  if (qualifies) {
    const k = field.comp[idx];
    const iso = field.iso[k];
    const here = massName(k, field, data, namer);
    const a = field.endA[k] >= 0 ? cellLatLon(field.endA[k], W, H) : ll;
    const b = field.endB[k] >= 0 ? cellLatLon(field.endB[k], W, H) : ll;
    const other = field.other[k] >= 0 ? massName(field.other[k], field, data, namer) : null;
    return {
      kind: "land",
      title: here.title,
      sub: here.sub,
      headline: iso >= 0 ? iso : null,
      headlineLabel: t === 0 ? "to the nearest separate land" : "to the nearest separate high ground",
      toward: other ? other.title : "nothing else on Earth qualifies",
      area: field.area[k],
      peakM: field.peakM[k],
      cells: field.cells[k],
      at: ll,
      line: [a, b],
    };
  }

  const target = field.near[idx];
  const to = target >= 0 ? cellLatLon(target, W, H) : ll;
  // Name the landmass the target belongs to, not just the cell: a cell on the
  // Antarctic coast should read "Antarctica", not whatever islet is nearby.
  const named = target >= 0 ? massName(field.comp[target], field, data, namer) : { title: "—", sub: "" };
  return {
    kind: "sea",
    title: data.elev[idx] >= 0
      ? `Land at ${data.elev[idx].toLocaleString()} m — below the line`
      : "Open water",
    sub: `${fmtLat(ll[0])}  ${fmtLon(ll[1])}`,
    headline: field.dist[idx],
    headlineLabel: t === 0 ? "to the nearest land" : `to the nearest ground reaching ${t.toLocaleString()} m`,
    toward: named.title,
    towardSub: named.sub,
    at: ll,
    line: [ll, to],
  };
}

function rankIsolated(field, data, namer) {
  if (!field || !data || !namer) return [];
  const n = field.count;
  const order = [];
  for (let k = 0; k < n; k++) if (field.iso[k] > 0) order.push(k);
  order.sort((a, b) => field.iso[b] - field.iso[a]);
  return order.slice(0, 12).map((k) => {
    const nm = massName(k, field, data, namer);
    const [lat, lon] = cellLatLon(field.peak[k], data.W, data.H);
    return { k, name: nm.title, sub: nm.sub, iso: field.iso[k], area: field.area[k], lat, lon };
  });
}

const fmtLat = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "E" : "W"}`;

/* ---- panel --------------------------------------------------------------- */

function Panel({
  wide, stepIdx, setStepIdx, threshold, applied, pending, commit,
  mode, setMode, field, data, namer, sel, ranked, flyTo, setSel,
}) {
  const [tab, setTab] = useState("point");
  const far = field && data && namer
    ? (() => {
      const [lat, lon] = cellLatLon(field.farthest, data.W, data.H);
      const tgt = field.near[field.farthest];
      const t = tgt >= 0 ? massName(field.comp[tgt], field, data, namer) : null;
      return { lat, lon, km: field.farthestKm, toward: t ? t.title : "" };
    })()
    : null;

  return (
    <div style={{
      width: wide ? 372 : "auto",
      height: wide ? "auto" : "46dvh",
      flexShrink: 0,
      background: C.panel,
      borderTop: wide ? "none" : `1px solid ${C.line}`,
      borderLeft: wide ? `1px solid ${C.line}` : "none",
      display: "flex", flexDirection: "column", minHeight: 0,
    }}>
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label style={lbl} htmlFor="elev">Reference elevation</label>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums" }}>
            {threshold === 0 ? "Sea level" : `${threshold.toLocaleString()} m`}
          </span>
        </div>
        <input
          id="elev" type="range" min={0} max={STEPS.length - 1} step={1} value={stepIdx}
          onChange={(e) => setStepIdx(+e.target.value)}
          onPointerUp={commit} onKeyUp={commit} onTouchEnd={commit}
          style={{ width: "100%", margin: "10px 0 2px", accentColor: C.accent }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.faint }}>
          <span>Sea level — every island counts</span>
          <span>8,000 m</span>
        </div>
        {pending && (
          <button onClick={commit} style={{ ...btn, width: "100%", marginTop: 9 }}>
            Recompute at {threshold.toLocaleString()} m
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, padding: "10px 16px 0" }}>
        {[["sea", "Ocean remoteness"], ["iso", "Landmass isolation"]].map(([k, t]) => (
          <button key={k} onClick={() => setMode(k)} style={{
            ...btn, flex: 1, fontSize: 12,
            background: mode === k ? C.accent : "transparent",
            color: mode === k ? "#04231f" : C.dim,
            borderColor: mode === k ? C.accent : C.line,
            fontWeight: mode === k ? 700 : 500,
          }}>{t}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, padding: "12px 16px 0", borderBottom: `1px solid ${C.line}` }}>
        {[["point", "Selection"], ["top", "Most isolated"], ["key", "Key"]].map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: "none", border: "none", padding: "0 0 9px", cursor: "pointer",
            color: tab === k ? C.text : C.faint, fontSize: 13, fontWeight: tab === k ? 700 : 500,
            borderBottom: `2px solid ${tab === k ? C.accent : "transparent"}`, marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 22px", minHeight: 0 }}>
        {tab === "point" && (sel ? <Selection sel={sel} /> : <Hint far={far} />)}
        {tab === "top" && <TopList ranked={ranked} threshold={applied} onPick={(r) => { flyTo(r.lat, r.lon); setSel(null); }} />}
        {tab === "key" && <Key mode={mode} threshold={applied} />}
      </div>
    </div>
  );
}

function Selection({ sel }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.01em" }}>{sel.title}</div>
      {sel.sub && <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>{sel.sub}</div>}
      <div style={{ margin: "16px 0 4px", fontSize: 34, fontWeight: 800, letterSpacing: "-.03em", color: C.accent, fontVariantNumeric: "tabular-nums" }}>
        {fmtKm(sel.headline)}
      </div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.45 }}>
        {sel.headlineLabel} — <span style={{ color: C.text }}>{sel.toward}</span>
        {sel.towardSub ? <span style={{ color: C.faint }}> · {sel.towardSub}</span> : null}
      </div>
      {sel.kind === "land" && (
        <dl style={{ margin: "18px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "7px 14px", fontSize: 13 }}>
          <dt style={dt}>Area</dt><dd style={dd}>{fmtArea(sel.area)}</dd>
          <dt style={dt}>Highest</dt><dd style={dd}>{sel.peakM.toLocaleString()} m</dd>
          <dt style={dt}>Grid cells</dt><dd style={dd}>{sel.cells.toLocaleString()}</dd>
        </dl>
      )}
      <div style={{ marginTop: 16, fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
        The dashed line on the globe is the great circle being measured.
      </div>
    </div>
  );
}

function Hint({ far }) {
  return (
    <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.55 }}>
      <p style={{ margin: "0 0 14px" }}>
        Tap anywhere on the globe. On water you get the distance to the nearest
        qualifying ground; on land you get how far that landmass is from the
        nearest separate one.
      </p>
      {far && (
        <div style={{ background: "#0a1018", border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 13px" }}>
          <div style={lbl}>Most remote water right now</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.accent, letterSpacing: "-.02em", margin: "5px 0 2px", fontVariantNumeric: "tabular-nums" }}>
            {fmtKm(far.km)}
          </div>
          <div style={{ fontSize: 12, color: C.dim }}>
            {fmtLat(far.lat)} {fmtLon(far.lon)} — nearest is {far.toward}
          </div>
        </div>
      )}
    </div>
  );
}

function TopList({ ranked, threshold, onPick }) {
  if (!ranked.length) return <div style={{ color: C.dim, fontSize: 13 }}>Nothing qualifies at this elevation.</div>;
  return (
    <div>
      <div style={{ ...lbl, marginBottom: 10 }}>
        {threshold === 0 ? "Loneliest pieces of land" : `Loneliest ground above ${threshold.toLocaleString()} m`}
      </div>
      {ranked.map((r, i) => (
        <button key={r.k} onClick={() => onPick(r)} style={{
          display: "flex", width: "100%", alignItems: "baseline", gap: 10, textAlign: "left",
          background: "none", border: "none", borderBottom: `1px solid ${C.line}`,
          padding: "9px 0", cursor: "pointer", color: C.text, font: "inherit",
        }}>
          <span style={{ color: C.faint, fontSize: 12, width: 16, flexShrink: 0 }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name}
            </span>
            <span style={{ fontSize: 11, color: C.faint }}>{fmtArea(r.area)}</span>
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.warm, fontVariantNumeric: "tabular-nums" }}>
            {fmtKm(r.iso)}
          </span>
        </button>
      ))}
      <p style={{ color: C.faint, fontSize: 11.5, lineHeight: 1.5, marginTop: 12 }}>
        Strictly nearest-neighbour: an island in a chain is measured to its
        closest neighbour in that same chain, not to the mainland.
      </p>
    </div>
  );
}

function Key({ mode, threshold }) {
  const stops = mode === "iso" ? ISO_STOPS : SEA_STOPS;
  const label = mode === "iso"
    ? "Land, by distance to the nearest separate landmass"
    : threshold === 0
      ? "Water, by distance to the nearest land"
      : `Everything below ${threshold.toLocaleString()} m, by distance to ground that reaches it`;
  return (
    <div>
      <div style={{ ...lbl, marginBottom: 10 }}>{label}</div>
      {stops.map(([v, hexv], i) => (
        <div key={v} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
          <span style={{ width: 26, height: 14, borderRadius: 3, background: swatch(stops, v), flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: C.dim, fontVariantNumeric: "tabular-nums" }}>
            {i === stops.length - 1 ? `${v.toLocaleString()} km and beyond` : `${v.toLocaleString()} km`}
          </span>
        </div>
      ))}
      {mode === "sea" && threshold > 0 && (
        <p style={{ color: C.faint, fontSize: 11.5, lineHeight: 1.5, marginTop: 14 }}>
          Land that does not reach {threshold.toLocaleString()} m keeps its relief
          and a warmer cast, so the continents stay recognisable while they are
          out of the running.
        </p>
      )}
      <p style={{ color: C.faint, fontSize: 11.5, lineHeight: 1.5, marginTop: 14 }}>
        Grid is 10 arc-minutes — about 18 km at the equator. Distances are true
        great circles, rounded to that grid.
      </p>
    </div>
  );
}

function About({ onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(3,6,11,.82)", zIndex: 20,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14,
        maxWidth: 520, maxHeight: "84dvh", overflowY: "auto", padding: "22px 22px 24px",
      }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 19, letterSpacing: "-.02em" }}>How this is measured</h2>
        <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.62 }}>
          <p style={{ marginTop: 0 }}>
            <strong style={{ color: C.text }}>Isolation</strong> is the great-circle
            distance to the next piece of land, however small that piece is. A rock
            with a name counts the same as a continent.
          </p>
          <p>
            <strong style={{ color: C.text }}>The elevation slider</strong> changes
            what counts as land. At sea level, land is land. Set it to 3,000 m and
            only ground that actually reaches 3,000 m qualifies — so the question
            becomes how far you are from the nearest high country, and the world
            breaks into mountain islands separated by lowland ocean.
          </p>
          <p>
            <strong style={{ color: C.text }}>Coastlines</strong> come from Natural
            Earth 10m, including its minor-islands layer, rasterised so that any
            cell containing any land at all counts as land — no islet is rounded
            away. <strong style={{ color: C.text }}>Elevation</strong> is max-pooled
            from AWS Terrain Tiles at zoom 6, refined to zoom 8 above 600 m, with
            surveyed heights stamped in for ~700 named summits. Taking the maximum
            rather than the mean is what keeps both a low atoll and a sharp peak
            from being averaged out of existence.
          </p>
          <p>
            <strong style={{ color: C.text }}>The catch:</strong> the working grid
            is 10 arc-minutes, roughly 18 km at the equator, so distances are
            accurate to about that, two islands closer together than one cell
            merge into one, and the areas quoted are cell counts rather than
            surveyed figures. Web Mercator tiles stop at 85.05°S, so the innermost
            Antarctic plateau is carried down from the last row with coverage.
          </p>
          <p style={{ marginBottom: 0 }}>
            Everything is computed in your browser from a single 2160×1080 image —
            nothing is sent anywhere.
          </p>
        </div>
        <button onClick={onClose} style={{ ...btn, marginTop: 18, width: "100%" }}>Close</button>
      </div>
    </div>
  );
}

function Center({ children }) {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", alignItems: "center",
      justifyContent: "center", color: C.dim, fontSize: 14, pointerEvents: "none",
    }}>{children}</div>
  );
}

/* ---- odds and ends ------------------------------------------------------- */

const btn = {
  background: "transparent", color: C.dim, border: `1px solid ${C.line}`,
  borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer",
  font: "inherit", fontWeight: 500,
};
const lbl = { fontSize: 10, letterSpacing: ".18em", color: C.faint, fontWeight: 700, textTransform: "uppercase" };
const dt = { color: C.faint };
const dd = { margin: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const clampZoom = (z) => Math.max(0.85, Math.min(4.5, z));
const wrapLon = (v) => ((((v + 180) % 360) + 360) % 360) - 180;
const shortestLon = (from, to) => {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
};
function spread(pts) {
  const [a, b] = [...pts.values()];
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

createRoot(document.getElementById("root")).render(<App />);
