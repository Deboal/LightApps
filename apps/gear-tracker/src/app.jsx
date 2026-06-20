import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { store } from "../../../shared/store.js";
import { AuthGate, signOut } from "../../../shared/auth.js";

// Default store = per-user PRIVATE: each signed-in user sees only their own gear.
const db = store("gear-tracker");
const COLLECTION = "items";

function Tracker({ user }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try { setItems(await db.list(COLLECTION)); setReady(true); }
    catch (e) { setErr(e.message || "load failed"); setReady(true); }
  }, []);

  useEffect(() => { load(); const ch = db.subscribe(load); return () => ch.unsubscribe(); }, [load]);

  const add = async () => { const name = text.trim(); if (!name) return; setText(""); await db.set(COLLECTION, { name, checked: false }); load(); };
  const toggle = async (it) => { await db.set(COLLECTION, { ...it, checked: !it.checked }, it.id); load(); };
  const del = async (it) => { await db.remove(COLLECTION, it.id); load(); };

  const wrap = { maxWidth: 560, margin: "0 auto", padding: "40px 20px" };
  const row = { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#161c23", border: "1px solid #2a333d", borderRadius: 10, marginBottom: 8 };
  const input = { flex: 1, background: "#0f1318", border: "1px solid #2a333d", color: "#e7edf2", borderRadius: 9, padding: "11px 13px", fontSize: 15, outline: "none" };
  const btn = { background: "#33c2b0", color: "#06231f", border: "none", borderRadius: 9, padding: "11px 16px", fontWeight: 700, cursor: "pointer", fontSize: 14 };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 11, letterSpacing: ".22em", color: "#8b97a3", fontWeight: 600 }}>YOUR GEAR · PRIVATE</div>
        <button onClick={signOut} style={{ background: "none", border: "1px solid #2a333d", color: "#8b97a3", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>Sign out</button>
      </div>
      <h1 style={{ letterSpacing: "-.02em", margin: "2px 0 4px" }}>Gear Tracker</h1>
      <div style={{ color: "#5c6670", fontSize: 12, marginBottom: 20 }}>{user.email}</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input style={input} value={text} placeholder="Add gear (e.g. crampons)"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button style={btn} onClick={add}>Add</button>
      </div>

      {err && <div style={{ color: "#e5604d", marginBottom: 12, fontSize: 13 }}>{err}</div>}
      {!ready && <div style={{ color: "#8b97a3" }}>Loading…</div>}
      {ready && items.length === 0 && <div style={{ color: "#8b97a3" }}>No gear yet. Add the first item.</div>}

      {items.map((it) => (
        <div key={it.id} style={row}>
          <input type="checkbox" checked={!!it.checked} onChange={() => toggle(it)} style={{ width: 18, height: 18, accentColor: "#33c2b0" }} />
          <span style={{ flex: 1, textDecoration: it.checked ? "line-through" : "none", color: it.checked ? "#5c6670" : "#e7edf2" }}>{it.name}</span>
          <button onClick={() => del(it)} style={{ background: "none", border: "none", color: "#5c6670", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
      ))}
    </div>
  );
}

function App() {
  return <AuthGate>{(user) => <Tracker user={user} />}</AuthGate>;
}

createRoot(document.getElementById("root")).render(<App />);
