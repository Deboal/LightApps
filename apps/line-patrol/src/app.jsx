import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";

/* Line Patrol.
 *
 * PG&E's transmission network (HIFLD, 2025) plus every helicopter track sampled
 * across 14 UTC days in 2025, sorted into three groups by how likely the flight
 * was power-line work: confirmed, probable, and everything else flying nearby.
 * No backend, no sign-in — one static GeoJSON-ish payload in assets/, rendered
 * with Leaflet loaded from a CDN (same pattern as the azores app).
 */

const GROUP_META = {
  1: { label: "Confirmed line work", color: "#ff5a3c", weight: 2.6, opacity: 0.9, short: "Confirmed" },
  2: { label: "Probable line work", color: "#f2b84b", weight: 2.2, opacity: 0.8, short: "Probable" },
  3: { label: "Other traffic nearby", color: "#5fb0e6", weight: 1.1, opacity: 0.38, short: "Other" },
};
const LINE_COLOR = "#e7edf2";
const LEAFLET_JS = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
];
const LEAFLET_SRI = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const tryLoad = (i) => {
      if (i >= LEAFLET_JS.length) return reject(new Error("both CDNs unreachable"));
      const s = document.createElement("script");
      s.src = LEAFLET_JS[i];
      s.integrity = LEAFLET_SRI;
      s.crossOrigin = "";
      s.onload = () => resolve(window.L);
      s.onerror = () => tryLoad(i + 1);
      document.head.appendChild(s);
    };
    tryLoad(0);
  });
}

function fmtKm(km) {
  if (km == null) return "—";
  return km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1);
}

function App() {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const [L, setL] = useState(null);
  const [leafletError, setLeafletError] = useState(null);
  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [enabled, setEnabled] = useState({ lines: true, 1: true, 2: true, 3: false });
  const [panelOpen, setPanelOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // { tail, operator, model, group }
  const [building, setBuilding] = useState(null); // group key currently being built

  // Leaflet layer bookkeeping, kept outside React state (Leaflet owns this).
  const layersRef = useRef({ lines: null, 1: null, 2: null, 3: null });
  const trackRefsRef = useRef({}); // tail -> [{ layer, group }]

  useEffect(() => {
    loadLeaflet().then(setL).catch((e) => setLeafletError(e.message || String(e)));
  }, []);

  useEffect(() => {
    fetch("assets/data.json")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(setData)
      .catch((e) => setDataError(e.message || String(e)));
  }, []);

  // Build the map once, when Leaflet has arrived.
  useEffect(() => {
    if (!L || mapRef.current) return;
    const map = L.map(mapElRef.current, {
      preferCanvas: true,
      zoomControl: false,
      attributionControl: true,
    }).setView([37.9, -121.3], 7);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);
    mapRef.current = map;
  }, [L]);

  const aircraftIndex = useMemo(() => {
    if (!data) return [];
    const rows = [];
    for (const g of data.groups) {
      for (const ac of g.aircraft) {
        rows.push({ tail: ac.tail, operator: ac.operator, model: ac.model, group: g.key, ac });
      }
    }
    return rows;
  }, [data]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return aircraftIndex
      .filter((r) => r.tail.toLowerCase().includes(q) || r.operator.toLowerCase().includes(q))
      .slice(0, 30);
  }, [query, aircraftIndex]);

  const trackPopupHtml = useCallback((ac, t) => {
    return (
      "<b>" + ac.tail + "</b> — " + ac.operator + " (" + ac.model + ")" +
      "<br/>" + (t.date || "unknown date") +
      "<br/>" + fmtKm(t.km) + " km on line"
    );
  }, []);

  const buildLinesLayer = useCallback(() => {
    if (!L || !data || layersRef.current.lines) return;
    const group = L.layerGroup();
    for (const ln of data.lines) {
      const pl = L.polyline(ln.coords.map(([lon, lat]) => [lat, lon]), {
        color: LINE_COLOR, weight: 1.4, opacity: 0.55,
      });
      pl.bindPopup(
        "<b>PG&amp;E line " + ln.id + "</b><br/>" + (ln.kv != null ? ln.kv + " kV" : "Voltage unknown"),
        { className: "lp-popup" }
      );
      pl.addTo(group);
    }
    layersRef.current.lines = group;
  }, [L, data]);

  const buildGroupLayer = useCallback((key) => {
    if (!L || !data || layersRef.current[key]) return;
    const meta = GROUP_META[key];
    const g = data.groups.find((x) => String(x.key) === String(key));
    if (!g) return;
    const layerGroup = L.layerGroup();
    const refs = trackRefsRef.current;
    for (const ac of g.aircraft) {
      for (const t of ac.tracks) {
        if (!t.coords || t.coords.length < 2) continue;
        const pl = L.polyline(t.coords.map(([lon, lat]) => [lat, lon]), {
          color: meta.color, weight: meta.weight, opacity: meta.opacity,
        });
        pl.bindPopup(trackPopupHtml(ac, t), { className: "lp-popup" });
        pl.addTo(layerGroup);
        (refs[ac.tail] = refs[ac.tail] || []).push({ layer: pl, group: g.key });
      }
    }
    layersRef.current[key] = layerGroup;
  }, [L, data, trackPopupHtml]);

  // Apply enabled/disabled state to the map, building layers lazily on first enable.
  useEffect(() => {
    if (!L || !mapRef.current || !data) return;
    const map = mapRef.current;

    const apply = (key, isOn, builder) => {
      if (isOn && !layersRef.current[key]) {
        setBuilding(key);
        // Defer one tick so the "building…" note can paint before the
        // (synchronous) layer construction blocks the main thread.
        setTimeout(() => {
          builder();
          if (isOn && layersRef.current[key]) layersRef.current[key].addTo(map);
          setBuilding((b) => (b === key ? null : b));
        }, 0);
        return;
      }
      const layer = layersRef.current[key];
      if (!layer) return;
      if (isOn && !map.hasLayer(layer)) layer.addTo(map);
      if (!isOn && map.hasLayer(layer)) map.removeLayer(layer);
    };

    apply("lines", enabled.lines, buildLinesLayer);
    apply(1, enabled[1], () => buildGroupLayer(1));
    apply(2, enabled[2], () => buildGroupLayer(2));
    apply(3, enabled[3], () => buildGroupLayer(3));
  }, [L, data, enabled, buildLinesLayer, buildGroupLayer]);

  const focusAircraft = useCallback((row) => {
    setSelected(row);
    setQuery("");
    if (!enabled[row.group]) {
      setEnabled((e) => ({ ...e, [row.group]: true }));
    }
    // Give the layer a moment to exist (built on the enable effect above),
    // then fly to it and pop the first track.
    const tryFocus = (attemptsLeft) => {
      const refs = trackRefsRef.current[row.tail];
      const map = mapRef.current;
      if (!refs || !refs.length || !map) {
        if (attemptsLeft > 0) setTimeout(() => tryFocus(attemptsLeft - 1), 120);
        return;
      }
      const bounds = L.latLngBounds(refs.flatMap((r) => r.layer.getLatLngs()));
      const leftPad = panelOpen && window.innerWidth > 700 ? 336 : 40;
      map.fitBounds(bounds, { paddingTopLeft: [leftPad, 40], paddingBottomRight: [40, 40], maxZoom: 12 });
      refs.forEach((r) => r.layer.bringToFront());
      refs[0].layer.openPopup(bounds.getCenter());
    };
    tryFocus(10);
  }, [enabled, L, panelOpen]);

  const totals = data
    ? {
        lines: data.lines.length,
        1: data.groups.find((g) => String(g.key) === "1")?.aircraft.length || 0,
        2: data.groups.find((g) => String(g.key) === "2")?.aircraft.length || 0,
        3: data.groups.find((g) => String(g.key) === "3")?.aircraft.length || 0,
      }
    : null;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={mapElRef} style={{ position: "absolute", inset: 0 }} />

      {(leafletError || dataError) && (
        <div style={overlayMsg}>
          {leafletError && <div>Map library failed to load: {leafletError}</div>}
          {dataError && <div>Could not load flight data: {dataError}</div>}
        </div>
      )}

      <button
        onClick={() => setPanelOpen((v) => !v)}
        style={toggleBtn}
        aria-label={panelOpen ? "Hide panel" : "Show panel"}
      >
        {panelOpen ? "×" : "☰"}
      </button>

      {panelOpen && (
        <div style={panel}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", color: "#8b97a3", fontWeight: 700 }}>LINE PATROL</div>
          <h1 style={{ fontSize: 18, margin: "3px 0 4px", letterSpacing: "-.01em" }}>
            PG&amp;E lines &amp; 2025 helicopter activity
          </h1>
          <div style={{ fontSize: 12, color: "#8b97a3", marginBottom: 14, lineHeight: 1.5 }}>
            14 sampled UTC days (1st of each month + Jun 2–3). Tracks grouped by how
            likely the flight was power-line work.
          </div>

          <div style={{ marginBottom: 4, fontSize: 11, letterSpacing: ".1em", color: "#5c6670", fontWeight: 700 }}>
            LAYERS
          </div>
          <LayerRow
            label="PG&E transmission lines"
            swatchColor={LINE_COLOR}
            swatchOpacity={0.7}
            count={totals ? totals.lines + " segments" : null}
            checked={enabled.lines}
            loading={building === "lines"}
            onChange={(v) => setEnabled((e) => ({ ...e, lines: v }))}
          />
          {["1", "2", "3"].map((k) => (
            <LayerRow
              key={k}
              label={GROUP_META[k].label}
              swatchColor={GROUP_META[k].color}
              swatchOpacity={GROUP_META[k].opacity}
              count={totals ? totals[k] + " aircraft" : null}
              checked={enabled[k]}
              loading={building === k}
              onChange={(v) => setEnabled((e) => ({ ...e, [k]: v }))}
            />
          ))}

          <div style={{ marginTop: 16, marginBottom: 4, fontSize: 11, letterSpacing: ".1em", color: "#5c6670", fontWeight: 700 }}>
            FIND AN AIRCRAFT
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tail number or operator…"
            style={searchInput}
          />
          {searchResults.length > 0 && (
            <div style={resultsBox}>
              {searchResults.map((r) => (
                <div key={r.tail + r.group} style={resultRow} onClick={() => focusAircraft(r)}>
                  <div style={{ fontWeight: 700 }}>{r.tail}</div>
                  <div style={{ color: "#8b97a3", fontSize: 12 }}>
                    {r.operator} · {r.model} · {GROUP_META[r.group].short}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div style={selectedBox}>
              <div style={{ fontWeight: 700 }}>{selected.tail}</div>
              <div style={{ color: "#8b97a3", fontSize: 12, marginBottom: 6 }}>
                {selected.operator} · {selected.model}
              </div>
              <div style={{ fontSize: 12, color: GROUP_META[selected.group].color }}>
                {GROUP_META[selected.group].label}
              </div>
              <div style={{ fontSize: 12, color: "#8b97a3", marginTop: 6 }}>
                {selected.ac.tracks.length} sampled day{selected.ac.tracks.length === 1 ? "" : "s"}
              </div>
            </div>
          )}

          {!data && !dataError && <div style={{ color: "#8b97a3", fontSize: 12, marginTop: 12 }}>Loading flight data…</div>}
        </div>
      )}
    </div>
  );
}

function LayerRow({ label, swatchColor, swatchOpacity, count, checked, loading, onChange }) {
  return (
    <label style={layerRow}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: "#33c2b0", flex: "0 0 auto" }} />
      <span style={{ width: 14, height: 3, borderRadius: 2, background: swatchColor, opacity: swatchOpacity, flex: "0 0 auto" }} />
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 11, color: "#5c6670" }}>{loading ? "loading…" : count}</span>
    </label>
  );
}

const overlayMsg = {
  position: "absolute", top: 12, left: 12, right: 12, zIndex: 900,
  background: "#3a1f1c", color: "#f2a89b", border: "1px solid #5c2d27",
  borderRadius: 10, padding: "10px 13px", fontSize: 13,
};
const toggleBtn = {
  position: "absolute", top: 12, right: 12, zIndex: 1000,
  width: 36, height: 36, borderRadius: 9, border: "1px solid #2a333d",
  background: "#161c23", color: "#e7edf2", fontSize: 16, cursor: "pointer",
};
const panel = {
  position: "absolute", top: 12, left: 12, bottom: 12, width: 300, maxWidth: "calc(100vw - 24px)",
  zIndex: 900, background: "rgba(22,28,35,0.94)", backdropFilter: "blur(6px)",
  border: "1px solid #2a333d", borderRadius: 12, padding: "16px 16px 14px",
  overflowY: "auto", boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
};
const layerRow = { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" };
const searchInput = {
  width: "100%", background: "#0f1318", border: "1px solid #2a333d", color: "#e7edf2",
  borderRadius: 8, padding: "9px 10px", fontSize: 13, outline: "none", marginBottom: 6,
};
const resultsBox = { maxHeight: 220, overflowY: "auto", border: "1px solid #2a333d", borderRadius: 8, marginBottom: 8 };
const resultRow = { padding: "8px 10px", borderBottom: "1px solid #2a333d", cursor: "pointer" };
const selectedBox = {
  marginTop: 14, padding: "10px 12px", background: "#0f1318",
  border: "1px solid #2a333d", borderRadius: 9, fontSize: 13,
};

createRoot(document.getElementById("root")).render(<App />);
