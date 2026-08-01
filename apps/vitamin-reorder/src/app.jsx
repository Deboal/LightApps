import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
// One shelf, shared with the browser extension in ../extension.
import { SHELF, CART_VIEW, productUrl, parseAsin } from "../extension/shelf.js";

// Vitamin Reorder — pick the bottles that ran out and walk them into an Amazon
// cart. Nothing here can add to the cart directly: Amazon binds add-to-cart to a
// session CSRF token, so the click has to happen on their page. On the phone
// that means one tap per bottle; on a desktop the companion extension in
// ../extension does the clicking for you.
//
// Self-contained: the shelf is baked in, edits live in localStorage.

const EXTENSION_ZIP = "vitamin-reorder-extension.zip";

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

// Amazon's legacy multi-item cart form. It quietly does nothing for a signed-out
// session and for accounts without an Associates tag, so it is offered as a
// long shot, not the main path.
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

// The run: one item at a time. Every open is its own tap, which is what makes
// this survive popup blockers and Amazon's cart-link gating — the add happens
// on Amazon's own page, using your own session.
function Run({ run, onOpen, onAdded, onSkip, onClose }) {
  const { lines, i, opened, added, skipped } = run;
  const done = i >= lines.length;
  const { item, qty } = done ? lines[lines.length - 1] : lines[i];

  const pill = {
    flex: 1, borderRadius: 11, padding: "13px 10px", fontSize: 14.5, fontWeight: 700,
    cursor: "pointer", border: `1px solid ${C.line}`, background: C.panel2, color: C.text,
  };

  if (done) {
    return (
      <div style={{
        background: C.panel, border: `1px solid ${C.good}`, borderRadius: 14, padding: 18, marginBottom: 14,
      }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: C.good, marginBottom: 6 }}>
          {added} added{skipped ? `, ${skipped} skipped` : ""}
        </div>
        <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.5, marginBottom: 14 }}>
          Everything you added is sitting in your Amazon cart. Check the quantities and place
          the order there.
        </div>
        <a href={CART_VIEW} target="_blank" rel="noreferrer" style={{
          display: "block", textAlign: "center", background: C.accent, color: "#20160a",
          borderRadius: 12, padding: "15px", fontWeight: 800, fontSize: 16, textDecoration: "none",
        }}>Open my Amazon cart →</a>
        <button onClick={onClose} style={{
          width: "100%", marginTop: 8, background: "none", border: `1px solid ${C.line}`,
          color: C.dim, borderRadius: 11, padding: "11px", fontSize: 13.5, cursor: "pointer",
        }}>Back to the list</button>
      </div>
    );
  }

  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.accent}`, borderRadius: 14, padding: 18, marginBottom: 14,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
      }}>
        <span style={{ fontSize: 11, letterSpacing: ".18em", color: C.faint, fontWeight: 700 }}>
          ITEM {i + 1} OF {lines.length}
        </span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: C.faint, fontSize: 13, cursor: "pointer",
        }}>Pause</button>
      </div>

      <div style={{ display: "flex", gap: 3, marginBottom: 16 }}>
        {lines.map((l, n) => (
          <div key={l.item.id} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: n < i ? C.good : n === i ? C.accent : C.line,
          }} />
        ))}
      </div>

      <div style={{ fontSize: 21, fontWeight: 750, letterSpacing: "-.02em", lineHeight: 1.2 }}>
        {item.name}
      </div>
      <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>
        {item.brand} · {item.size}
      </div>
      {qty > 1 && (
        <div style={{ color: C.accent, fontSize: 13, fontWeight: 700, marginTop: 6 }}>
          Set the quantity to {qty} on Amazon
        </div>
      )}
      {item.note && (
        <div style={{ color: C.faint, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>{item.note}</div>
      )}

      <a href={productUrl(item)} target="_blank" rel="noreferrer" onClick={onOpen} style={{
        display: "block", textAlign: "center", marginTop: 16, borderRadius: 12, padding: "16px",
        fontWeight: 800, fontSize: 16, textDecoration: "none",
        background: opened ? C.panel2 : C.accent,
        color: opened ? C.dim : "#20160a",
        border: opened ? `1px solid ${C.line}` : "none",
      }}>
        {opened ? "Open again ↗" : (item.asin ? "Open on Amazon ↗" : "Search Amazon ↗")}
      </a>

      <div style={{ color: C.faint, fontSize: 11.5, textAlign: "center", margin: "10px 0 12px", lineHeight: 1.5 }}>
        {opened
          ? "Hit Add to Cart over there, then come back and tap Added."
          : "Opens in a new tab. Add it to your cart, then come back here."}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onAdded} style={{
          ...pill, background: opened ? C.good : C.panel2, color: opened ? "#04241a" : C.text,
          border: opened ? "none" : `1px solid ${C.line}`,
        }}>Added ✓</button>
        <button onClick={onSkip} style={{ ...pill, flex: "0 0 auto", color: C.dim }}>Skip</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// App
// ----------------------------------------------------------------------------
function App() {
  const [state, setState] = useState(loadState);
  const [run, setRun] = useState(null);

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

  const start = () => {
    if (!picked.length) return;
    setRun({ lines: picked, i: 0, opened: false, added: 0, skipped: 0 });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Marking one added stamps and deselects it immediately, so a run abandoned
  // halfway still leaves the list in the right state.
  const markAdded = () => {
    const { item } = run.lines[run.i];
    const stamp = new Date().toISOString();
    setState((s) => {
      const p = { ...s.picked };
      delete p[item.id];
      return { ...s, picked: p, ordered: { ...s.ordered, [item.id]: stamp } };
    });
    setRun((r) => ({ ...r, i: r.i + 1, opened: false, added: r.added + 1 }));
  };

  const skip = () => setRun((r) => ({ ...r, i: r.i + 1, opened: false, skipped: r.skipped + 1 }));

  const shell = { maxWidth: 560, margin: "0 auto", padding: "26px 16px 130px" };
  const allOn = items.length > 0 && items.length === Object.keys(state.picked).length;

  return (
    <div style={shell}>
      <div style={{ fontSize: 11, letterSpacing: ".22em", color: C.faint, fontWeight: 700 }}>
        THE COUNTER · {items.length} BOTTLES
      </div>
      <h1 style={{ letterSpacing: "-.025em", margin: "4px 0 6px", fontSize: 30 }}>Vitamin Reorder</h1>
      <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.5, marginBottom: 18 }}>
        Tap what ran out, then walk the list — each one opens straight to its Amazon page,
        already the right product. You add and check out there.
      </div>

      {run && (
        <Run
          run={run}
          onOpen={() => setRun((r) => ({ ...r, opened: true }))}
          onAdded={markAdded}
          onSkip={skip}
          onClose={() => setRun(null)}
        />
      )}

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

      <div style={{
        marginTop: 16, background: C.panel, border: `1px solid ${C.line}`,
        borderRadius: 12, padding: 14,
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>On a computer? Skip the tapping.</div>
        <div style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>
          The Chrome extension does the clicking for you — it drives amazon.com in a background
          tab with your own signed-in session and actually lands everything in the cart. A website
          can't do that: Amazon ties add-to-cart to a session token only its own pages hold.
        </div>
        <a href={EXTENSION_ZIP} download style={{
          display: "inline-block", background: C.panel2, border: `1px solid ${C.line}`,
          color: C.accent, borderRadius: 9, padding: "9px 13px", fontSize: 12.5,
          fontWeight: 700, textDecoration: "none",
        }}>Download the extension ↓</a>
        <div style={{ color: C.faint, fontSize: 11, lineHeight: 1.55, marginTop: 8 }}>
          Unzip it, then Chrome → Extensions → turn on Developer mode → Load unpacked → pick the
          folder. Desktop Chrome or Edge only; iOS can't install it.
        </div>
      </div>

      {cartable.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <a href={cartUrl(cartable)} target="_blank" rel="noreferrer" style={{
            color: C.faint, fontSize: 11.5, textDecoration: "underline", textUnderlineOffset: 3,
          }}>Try Amazon's old bulk-cart link ↗</a>
          <span style={{ color: C.faint, fontSize: 11.5 }}> — usually does nothing now.</span>
        </div>
      )}

      {picked.length > 0 && !run && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, background: "rgba(14,17,22,.94)",
          borderTop: `1px solid ${C.line}`, padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <button
              onClick={start}
              style={{
                width: "100%", border: "none", borderRadius: 12, padding: "16px",
                fontSize: 16.5, fontWeight: 800, cursor: "pointer",
                background: C.accent, color: "#20160a",
              }}>
              Add {picked.length} to cart →
            </button>
            <div style={{ color: C.faint, fontSize: 11.5, textAlign: "center", marginTop: 7 }}>
              {searchOnly.length > 0
                ? `${searchOnly.map((l) => l.item.name).join(", ")} has no listing yet — that one opens a search.`
                : "One tap per bottle, straight to the right product page."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
