import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";

// Vitamin Reorder — pick the bottles that ran out, send them to an Amazon cart
// in one tap, then sign in and check out on Amazon. Fully self-contained: the
// shelf is baked in, edits live in localStorage, nothing leaves the phone until
// you open the cart link.

// ----------------------------------------------------------------------------
// The shelf. Transcribed from the counter photos, matched to Amazon listings.
// match: "exact"  = listing title matches the bottle spec exactly.
//        "close"  = right product, but the listing has size/bundle variants —
//                   worth a glance on Amazon before checking out.
//        "none"   = no listing found; the card falls back to an Amazon search.
// ----------------------------------------------------------------------------
const SHELF = [
  {
    id: "alpha-gpc", brand: "Nutricost", name: "Alpha GPC 600mg",
    size: "120 capsules · 60 servings", asin: "B076XNXLR2", match: "exact",
    search: "Nutricost Alpha GPC 600mg 120 capsules",
  },
  {
    id: "caffeine-theanine", brand: "SmarterVitamins", name: "Caffeine 200mg + L-Theanine",
    size: "50 liquid softgels · with MCT oil", asin: "B07FP4KS3R", match: "exact",
    search: "SmarterVitamins caffeine L-theanine MCT 50 softgels",
  },
  {
    id: "probiotic", brand: "Proriginal", name: "Probiotic 100 Billion CFU",
    size: "35 strains + 5 prebiotics · 60 capsules", asin: "B0BGRD3Q1D", match: "close",
    note: "Brand sells 60ct and 120ct — confirm the count.",
    search: "Proriginal probiotics 100 billion CFU 35 strains 60 capsules",
  },
  {
    id: "iron", brand: "Nature Made", name: "Iron 65mg",
    size: "325mg ferrous sulfate · 365 tablets", asin: "B01LB6808U", match: "close",
    note: "Several 365ct listings exist, some bundled with junk.",
    search: "Nature Made Iron 65mg 365 tablets",
  },
  {
    id: "nad-resveratrol", brand: "Deal Supplement", name: "NAD+ Resveratrol 1,000mg",
    size: "120 vegetarian capsules", asin: "B0DJWRXKPX", match: "exact",
    search: "Deal Supplement NAD+ resveratrol 1000mg 120 veggie capsules",
  },
  {
    id: "lions-mane", brand: "Real Mushrooms", name: "Lion's Mane Extract",
    size: "120 capsules", asin: "B078SZX3ML", match: "exact",
    search: "Real Mushrooms Lions Mane capsules 120ct",
  },
  {
    id: "k2-d3", brand: "Nutricost", name: "Vitamin K2 (MK7) + D3",
    size: "100mcg K2 / 5000 IU D3 · 120 softgels", asin: "B07K3VFVJC", match: "exact",
    search: "Nutricost vitamin K2 D3 120 softgels",
  },
  {
    id: "joint-defend", brand: "Clean Nutraceuticals", name: "Joint Defend",
    size: "Glucosamine · Chondroitin · MSM · 120 capsules", asin: "B0CGFC5RCQ", match: "close",
    note: "Single bottle vs. 2-pack listings look nearly identical.",
    search: "Clean Nutraceuticals Joint Defend glucosamine chondroitin MSM 120",
  },
  {
    id: "turmeric-ginger", brand: "Qunol", name: "Turmeric + Ginger 2400mg",
    size: "Enhanced absorption · 105 capsules", asin: "B09YGG58LZ", match: "exact",
    search: "Qunol turmeric ginger black pepper 2400mg 105 capsules",
  },
  {
    id: "omega-3", brand: "MAV Nutrition", name: "Triple Strength Omega-3 3,600mg",
    size: "1300mg EPA / 860mg DHA · 120 softgels", asin: "B01NBTJFJB", match: "exact",
    search: "MAV Nutrition triple strength omega 3 fish oil 3600mg 120 softgels",
  },
  {
    id: "tongkat-ali", brand: "ELMNT", name: "Tongkat Ali + Fadogia Agrestis",
    size: "200:1 extract · 90 capsules", asin: "B0C4NV7Q2B", match: "close",
    note: "ELMNT lists this without the brand name in the title.",
    search: "ELMNT tongkat ali fadogia agrestis 200x strength",
  },
  {
    id: "unknown-white", brand: "Unidentified", name: "White bottle, back right",
    size: "120 count · label cut off in the photo", asin: null, match: "none",
    note: "Send a clearer photo and this gets a real listing.",
    search: "supplement",
  },
];

const C = {
  bg: "#0e1116", panel: "#171d26", panel2: "#1e2632", line: "#28323f",
  text: "#e9eef4", dim: "#8b98a8", faint: "#5d6b7c", accent: "#f5a524", good: "#3ecf8e",
};

const LS = "vitamin-reorder/v1";

// ----------------------------------------------------------------------------
// Persistence: { picked: {id:qty}, ordered: {id:iso}, custom: [...], hidden: [ids] }
// ----------------------------------------------------------------------------
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || "{}");
    return {
      picked: raw.picked || {},
      ordered: raw.ordered || {},
      custom: Array.isArray(raw.custom) ? raw.custom : [],
      hidden: Array.isArray(raw.hidden) ? raw.hidden : [],
    };
  } catch {
    return { picked: {}, ordered: {}, custom: [], hidden: [] };
  }
}

function daysAgo(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "ordered today";
  if (d === 1) return "ordered yesterday";
  if (d < 60) return `ordered ${d}d ago`;
  return `ordered ${Math.round(d / 30)} months ago`;
}

// Accepts a bare ASIN or any Amazon product URL.
function parseAsin(input) {
  const s = (input || "").trim();
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
  const m = s.match(/(?:\/dp\/|\/gp\/product\/|\/product\/|[?&]asin=)([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

const productUrl = (item) =>
  item.asin
    ? `https://www.amazon.com/dp/${item.asin}`
    : `https://www.amazon.com/s?k=${encodeURIComponent(item.search || item.name)}`;

// Amazon's long-standing multi-item cart form. Everything lands in the cart;
// sign-in and checkout happen on Amazon.
function cartUrl(lines) {
  const q = lines
    .map((l, i) => `ASIN.${i + 1}=${l.item.asin}&Quantity.${i + 1}=${l.qty}`)
    .join("&");
  return `https://www.amazon.com/gp/aws/cart/add.html?${q}`;
}

// ----------------------------------------------------------------------------
// UI bits
// ----------------------------------------------------------------------------
function Badge({ kind, children }) {
  const tone = kind === "none"
    ? { bg: "#3a2a1a", fg: "#f5a524" }
    : { bg: "#2a2620", fg: "#c9a15e" };
  return (
    <span style={{
      background: tone.bg, color: tone.fg, borderRadius: 5, padding: "2px 6px",
      fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Row({ item, qty, ordered, onToggle, onQty, onRemove }) {
  const on = qty > 0;
  const step = {
    width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line}`,
    background: C.panel2, color: C.text, fontSize: 17, lineHeight: 1, cursor: "pointer",
  };
  return (
    <div style={{
      background: on ? "#1a2430" : C.panel,
      border: `1px solid ${on ? "#3b5570" : C.line}`,
      borderRadius: 12, padding: "12px 13px", marginBottom: 8,
      display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <button
        onClick={onToggle}
        aria-label={on ? `Remove ${item.name}` : `Add ${item.name}`}
        style={{
          flex: "0 0 auto", width: 26, height: 26, marginTop: 2, borderRadius: 7, cursor: "pointer",
          border: `1.5px solid ${on ? C.accent : C.line}`,
          background: on ? C.accent : "transparent",
          color: "#20160a", fontSize: 15, fontWeight: 900, lineHeight: 1, padding: 0,
        }}>{on ? "✓" : ""}</button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }} onClick={onToggle}>
            <span style={{ fontWeight: 650, fontSize: 15.5, letterSpacing: "-.01em", marginRight: 6 }}>
              {item.name}
            </span>
            {item.match === "close" && <Badge kind="close">check</Badge>}
            {item.match === "none" && <Badge kind="none">no match</Badge>}
          </div>
          <button onClick={onRemove} aria-label={`Remove ${item.name} from the list`}
            style={{
              flex: "0 0 auto", background: "none", border: "none", color: C.faint,
              fontSize: 17, lineHeight: 1, cursor: "pointer", padding: "0 2px",
            }}>×</button>
        </div>

        <div style={{ color: C.dim, fontSize: 12.5, marginTop: 2 }} onClick={onToggle}>
          {item.brand} · {item.size}
        </div>
        {item.note && (
          <div style={{ color: C.faint, fontSize: 11.5, marginTop: 3, fontStyle: "italic" }}>{item.note}</div>
        )}

        <div style={{
          display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
          rowGap: 6, marginTop: 8, minHeight: 30,
        }}>
          <a href={productUrl(item)} target="_blank" rel="noreferrer"
            style={{ color: C.accent, fontSize: 12, textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}>
            {item.asin ? "View on Amazon ↗" : "Search Amazon ↗"}
          </a>
          <span style={{ color: C.faint, fontSize: 11.5, whiteSpace: "nowrap" }}>
            {ordered ? daysAgo(ordered) : "never ordered"}
          </span>
          {on && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
              <button style={step} onClick={() => onQty(qty - 1)} aria-label="Fewer">−</button>
              <span style={{ minWidth: 14, textAlign: "center", fontWeight: 700, fontSize: 15 }}>{qty}</span>
              <button style={step} onClick={() => onQty(qty + 1)} aria-label="More">+</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddItem({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const input = {
    width: "100%", background: C.bg, border: `1px solid ${C.line}`, color: C.text,
    borderRadius: 9, padding: "11px 12px", fontSize: 15, outline: "none", marginBottom: 8,
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        width: "100%", background: "transparent", border: `1px dashed ${C.line}`, color: C.dim,
        borderRadius: 12, padding: "13px", fontSize: 14, cursor: "pointer", marginBottom: 8,
      }}>+ Add a bottle</button>
    );
  }

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const asin = parseAsin(ref);
    onAdd({
      id: `c-${Date.now()}`, brand: "Added by you", name: n, size: asin ? asin : "search only",
      asin, match: asin ? "exact" : "none", search: asin ? n : (ref.trim() || n), custom: true,
    });
    setName(""); setRef(""); setOpen(false);
  };

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 13, marginBottom: 8 }}>
      <input style={input} value={name} placeholder="What is it? (e.g. Magnesium Glycinate)"
        onChange={(e) => setName(e.target.value)} />
      <input style={input} value={ref} placeholder="Amazon link or ASIN (optional)"
        onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <div style={{ color: C.faint, fontSize: 11.5, marginBottom: 10 }}>
        Paste the Amazon URL and it becomes one-tap reorderable. Without one, the card just searches.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} style={{
          background: C.accent, color: "#20160a", border: "none", borderRadius: 9,
          padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer",
        }}>Add</button>
        <button onClick={() => setOpen(false)} style={{
          background: "none", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 9,
          padding: "10px 16px", fontSize: 14, cursor: "pointer",
        }}>Cancel</button>
      </div>
    </div>
  );
}

// Shown after the cart link fires: Amazon's cart form is old and occasionally
// drops an item, so the one-at-a-time fallback stays one tap away.
function Sent({ lines, url, onDone }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.good}`, borderRadius: 12,
      padding: 15, marginBottom: 12,
    }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: C.good }}>
        Cart opened in a new tab
      </div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
        Sign in on Amazon and check out — {lines.length} item{lines.length === 1 ? "" : "s"} should be
        waiting. Anything missing, open it directly:
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {lines.map(({ item }) => (
          <a key={item.id} href={productUrl(item)} target="_blank" rel="noreferrer" style={{
            color: C.text, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
            padding: "6px 9px", fontSize: 12, textDecoration: "none",
          }}>{item.name} ↗</a>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={copy} style={{
          background: "none", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 9,
          padding: "9px 14px", fontSize: 13, cursor: "pointer",
        }}>{copied ? "Link copied" : "Copy cart link"}</button>
        <button onClick={onDone} style={{
          background: "none", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 9,
          padding: "9px 14px", fontSize: 13, cursor: "pointer",
        }}>Done</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// App
// ----------------------------------------------------------------------------
function App() {
  const [state, setState] = useState(loadState);
  const [sent, setSent] = useState(null);

  useEffect(() => { localStorage.setItem(LS, JSON.stringify(state)); }, [state]);

  const items = useMemo(
    () => [...SHELF, ...state.custom].filter((i) => !state.hidden.includes(i.id)),
    [state.custom, state.hidden]
  );

  const picked = items
    .map((item) => ({ item, qty: state.picked[item.id] || 0 }))
    .filter((l) => l.qty > 0);
  const cartable = picked.filter((l) => l.item.asin);
  const searchOnly = picked.filter((l) => !l.item.asin);

  const setQty = (id, qty) =>
    setState((s) => {
      const p = { ...s.picked };
      if (qty > 0) p[id] = Math.min(qty, 20); else delete p[id];
      return { ...s, picked: p };
    });

  const selectAll = () =>
    setState((s) => {
      const all = items.length === Object.keys(s.picked).length;
      if (all) return { ...s, picked: {} };
      const p = {};
      items.forEach((i) => { p[i.id] = s.picked[i.id] || 1; });
      return { ...s, picked: p };
    });

  const send = () => {
    if (!cartable.length) return;
    const url = cartUrl(cartable);
    window.open(url, "_blank", "noopener");
    const stamp = new Date().toISOString();
    setState((s) => {
      const ordered = { ...s.ordered };
      picked.forEach(({ item }) => { ordered[item.id] = stamp; });
      return { ...s, ordered, picked: {} };
    });
    setSent({ lines: picked, url });
  };

  const shell = { maxWidth: 560, margin: "0 auto", padding: "26px 16px 130px" };
  const allOn = items.length > 0 && items.length === Object.keys(state.picked).length;

  return (
    <div style={shell}>
      <div style={{ fontSize: 11, letterSpacing: ".22em", color: C.faint, fontWeight: 700 }}>
        THE COUNTER · {items.length} BOTTLES
      </div>
      <h1 style={{ letterSpacing: "-.025em", margin: "4px 0 6px", fontSize: 30 }}>Vitamin Reorder</h1>
      <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.5, marginBottom: 18 }}>
        Tap what ran out, then send it all to one Amazon cart. You sign in and place the
        order — this never touches your account.
      </div>

      {sent && <Sent lines={sent.lines} url={sent.url} onDone={() => setSent(null)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button onClick={selectAll} style={{
          background: "none", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 8,
          padding: "6px 11px", fontSize: 12.5, cursor: "pointer", fontWeight: 600,
        }}>{allOn ? "Clear all" : "Select all"}</button>
        <span style={{ color: C.faint, fontSize: 12 }}>
          {picked.length ? `${picked.length} selected` : "nothing selected"}
        </span>
      </div>

      {items.map((item) => (
        <Row
          key={item.id}
          item={item}
          qty={state.picked[item.id] || 0}
          ordered={state.ordered[item.id]}
          onToggle={() => setQty(item.id, state.picked[item.id] ? 0 : 1)}
          onQty={(q) => setQty(item.id, q)}
          onRemove={() => setState((s) => ({
            ...s,
            hidden: [...s.hidden, item.id],
            custom: s.custom.filter((c) => c.id !== item.id),
          }))}
        />
      ))}

      <AddItem onAdd={(item) => setState((s) => ({ ...s, custom: [...s.custom, item] }))} />

      <div style={{ color: C.faint, fontSize: 11.5, lineHeight: 1.6, marginTop: 16 }}>
        Cards marked <b style={{ color: "#c9a15e" }}>check</b> matched a listing that has size or
        bundle variants — worth a look before you pay. New bottle? Snap a photo, find it on Amazon,
        and paste the link above so it's here next time.
      </div>

      {picked.length > 0 && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, background: "rgba(14,17,22,.94)",
          borderTop: `1px solid ${C.line}`, padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <button
              onClick={send}
              disabled={!cartable.length}
              style={{
                width: "100%", border: "none", borderRadius: 12, padding: "16px",
                fontSize: 16.5, fontWeight: 800, cursor: cartable.length ? "pointer" : "default",
                background: cartable.length ? C.accent : C.panel2,
                color: cartable.length ? "#20160a" : C.faint,
              }}>
              {cartable.length
                ? `Add ${cartable.reduce((n, l) => n + l.qty, 0)} to Amazon cart →`
                : "No linked items selected"}
            </button>
            {searchOnly.length > 0 && (
              <div style={{ color: C.faint, fontSize: 11.5, textAlign: "center", marginTop: 7 }}>
                {searchOnly.map((l) => l.item.name).join(", ")} — no listing yet, open{" "}
                {searchOnly.length === 1 ? "it" : "them"} from the card.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
