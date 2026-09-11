import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { store } from "../../../shared/store.js";
import { AuthGate, signOut } from "../../../shared/auth.js";
import {
  PEOPLE, OTHER, CATEGORIES, SPLITS, nameOf, colorOf,
  money, cents, sharesFor, balance, monthKey, monthLabel, dayLabel,
  shiftMonth, todayISO, isSettle, monthSummary, monthsWithActivity, sortEntries,
} from "./model.js";

// Shared store: both of us sign in with our own email and see the same ledger.
//
// Its own private bucket, not the hub's shared one. The shared bucket is
// public, so a receipt in it is readable by anyone with the link, forever,
// signed in or not -- which would make the row-level policy on the ledger
// pointless the moment a receipt has an account number on it. Links here are
// signed and expire; schema-household.sql restricts both to the two of us.
const db = store("household", { shared: true, bucket: "household-files", privateFiles: true });
const ENTRIES = "entries";
const CLAIMS = "people"; // doc_id = person key, data = { email }

const C = {
  bg: "#0f1318", panel: "#161c23", sunk: "#111720", line: "#2a333d",
  text: "#e7edf2", dim: "#8b97a3", faint: "#5c6670",
  accent: "#33c2b0", accentInk: "#06231f", danger: "#e5604d",
};

const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 14 };
const label = { fontSize: 12, color: C.dim, marginBottom: 6, display: "block" };
const field = { width: "100%", background: C.sunk, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "11px 12px", fontSize: 15, outline: "none", fontFamily: "inherit" };
const ghost = { background: "none", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 8, padding: "6px 11px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const primary = { background: C.accent, color: C.accentInk, border: "none", borderRadius: 10, padding: "12px 18px", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit" };

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 8 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            style={{
              background: on ? "#1d2936" : C.sunk, color: on ? C.text : C.dim,
              border: `1px solid ${on ? C.accent : C.line}`, borderRadius: 9,
              padding: "11px 6px", fontSize: 13, fontWeight: on ? 700 : 500, cursor: "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// One-time question: which of the two people is this email? Stored in the
// ledger itself, so neither of us has to edit code to get set up.
function Claim({ user, claims, onClaimed }) {
  const [busy, setBusy] = useState(null);
  const taken = new Map(claims.map((c) => [c.id, c.email]));
  const open = PEOPLE.filter((p) => !taken.has(p.key));

  const pick = async (key) => {
    setBusy(key);
    await db.set(CLAIMS, { email: user.email }, key);
    await onClaimed();
    setBusy(null);
  };

  return (
    <div style={{ maxWidth: 460, margin: "0 auto", padding: "60px 20px" }}>
      <div style={card}>
        <h2 style={{ margin: "0 0 6px" }}>Who's signing in?</h2>
        <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
          {user.email} isn't linked to anyone yet. Pick yourself once and this device
          — and any other — will know you from here on.
        </p>
        {open.length === 0 ? (
          <p style={{ color: C.danger, fontSize: 14 }}>
            Both spots are already taken ({[...taken.values()].join(", ")}). Sign in with one of
            those emails, or clear a spot from the ledger.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {open.map((p) => (
              <button key={p.key} onClick={() => pick(p.key)} disabled={!!busy}
                style={{ ...primary, background: p.color, color: "#06231f" }}>
                {busy === p.key ? "Linking…" : `I'm ${p.name}`}
              </button>
            ))}
          </div>
        )}
        <button onClick={signOut} style={{ ...ghost, marginTop: 14 }}>Sign out</button>
      </div>
    </div>
  );
}

const blankForm = (me) => ({
  desc: "", amount: "", date: todayISO(), paidBy: me,
  splitMode: "even", custom: "", category: CATEGORIES[0], note: "",
});

function Ledger({ user, me, entries, reload }) {
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [form, setForm] = useState(() => blankForm(me));
  const [editing, setEditing] = useState(null);   // entry being edited
  const [keep, setKeep] = useState([]);           // already-uploaded files on the edited entry
  const [drop, setDrop] = useState([]);           // new File objects to upload on save
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [settling, setSettling] = useState(false);
  const [urls, setUrls] = useState({});         // file path -> signed link
  const fileInput = useRef(null);
  const formTop = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const bal = useMemo(() => balance(entries), [entries]);
  const sum = useMemo(() => monthSummary(entries, month), [entries, month]);
  const months = useMemo(() => monthsWithActivity(entries, monthKey(todayISO())), [entries]);
  const rows = useMemo(() => sortEntries(sum.entries), [sum.entries]);
  const lastSettle = useMemo(() => sortEntries(entries.filter(isSettle))[0], [entries]);

  const flash = (msg) => { setNote(msg); setTimeout(() => setNote(null), 2600); };

  // Signed links for the receipts on screen: one request per month rather
  // than one per file, and only for paths we do not already hold a link for
  // -- otherwise every add, edit and delete re-signs the whole month.
  // Eight hours outlives any realistic sitting with this open; a link that
  // does expire comes back on reload. `f.url` is only present on receipts
  // uploaded before the private bucket existed; those keep working.
  useEffect(() => {
    const paths = rows.flatMap((e) => (e.files || [])
      .filter((f) => !f.url && !urls[f.path]).map((f) => f.path));
    if (!paths.length) return;
    let alive = true;
    db.fileUrls(paths, 8 * 3600).then((m) => { if (alive) setUrls((u) => ({ ...u, ...m })); }).catch(() => {});
    return () => { alive = false; };
  }, [rows, urls]);

  const reset = () => { setEditing(null); setForm(blankForm(me)); setKeep([]); setDrop([]); setErr(null); };

  const addFiles = (list) => {
    const picked = [...list].filter(Boolean);
    if (picked.length) setDrop((d) => [...d, ...picked]);
  };

  const save = async () => {
    setErr(null);
    const amount = cents(form.amount);
    if (!(amount > 0)) return setErr("Enter an amount greater than zero.");
    if (!form.date) return setErr("Pick a date.");
    setBusy(true);
    try {
      const uploaded = [];
      for (const f of drop) uploaded.push(await db.uploadFile(f, `${form.date}-`));
      const doc = {
        kind: editing?.kind || "expense",
        desc: form.desc.trim() || form.category,
        amount,
        date: form.date,
        paidBy: form.paidBy,
        splitMode: form.splitMode,
        custom: form.splitMode === "custom" ? cents(form.custom) : null,
        share: sharesFor(amount, form.splitMode, form.custom),
        category: form.category,
        note: form.note.trim(),
        files: [...keep, ...uploaded],
        createdAt: editing?.createdAt || new Date().toISOString(),
        createdBy: editing?.createdBy || user.email,
        updatedBy: user.email,
      };
      await db.set(ENTRIES, doc, editing?.id);
      setMonth(monthKey(form.date));
      reset();
      await reload();
      flash(editing ? "Entry updated." : "Entry added.");
    } catch (e) {
      setErr(e.message || "Could not save.");
    }
    setBusy(false);
  };

  const edit = (e) => {
    setEditing(e);
    setForm({
      desc: e.desc || "", amount: String(e.amount ?? ""), date: e.date, paidBy: e.paidBy,
      splitMode: e.splitMode || "even", custom: e.custom == null ? "" : String(e.custom),
      category: e.category || CATEGORIES[0], note: e.note || "",
    });
    setKeep(e.files || []);
    setDrop([]);
    setErr(null);
    formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Recurring bills are the whole point of an ongoing ledger: repeat copies an
  // entry onto today rather than making you retype the rent every month.
  const repeat = (e) => {
    setEditing(null);
    setForm({
      desc: e.desc || "", amount: String(e.amount ?? ""), date: todayISO(), paidBy: e.paidBy,
      splitMode: e.splitMode || "even", custom: e.custom == null ? "" : String(e.custom),
      category: e.category || CATEGORIES[0], note: e.note || "",
    });
    setKeep([]); setDrop([]); setErr(null);
    formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const del = async (e) => {
    const verb = isSettle(e) ? "Undo" : "Delete";
    if (!window.confirm(`${verb} "${e.desc}" (${money(e.amount)})?`)) return;
    setBusy(true);
    try {
      for (const f of e.files || []) await db.removeFile(f.path);
      await db.remove(ENTRIES, e.id);
      if (editing?.id === e.id) reset();
      await reload();
      flash("Entry deleted.");
    } catch (x) { setErr(x.message || "Could not delete."); }
    setBusy(false);
  };

  // Settling up is an entry like any other: the person who owes pays, and the
  // person who is owed absorbs the whole thing. The balance lands on zero.
  const settle = async () => {
    if (!bal.creditor) return;
    const payer = OTHER[bal.creditor];
    const amount = bal.amount;
    setBusy(true);
    try {
      await db.set(ENTRIES, {
        kind: "settle",
        desc: `${nameOf(payer)} paid ${nameOf(bal.creditor)} back`,
        amount, date: todayISO(), paidBy: payer,
        splitMode: bal.creditor, custom: null,
        share: sharesFor(amount, bal.creditor),
        category: "Settle up", note: "", files: [],
        createdAt: new Date().toISOString(), createdBy: user.email,
      });
      setSettling(false);
      await reload();
      flash("Settled. Back to even.");
    } catch (e) { setErr(e.message || "Could not settle."); }
    setBusy(false);
  };

  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); flash("Link copied."); }
    catch { flash(window.location.href); }
  };

  const owedTo = bal.creditor;
  const pct = sum.total > 0 ? (sum.fronted.alex / sum.total) * 100 : 50;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px 64px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {PEOPLE.map((p) => (
          <span key={p.key} style={{
            display: "inline-flex", alignItems: "center", gap: 7, background: C.panel,
            border: `1px solid ${p.key === me ? p.color : C.line}`, borderRadius: 999,
            padding: "6px 12px", fontSize: 14, fontWeight: 600,
          }}>
            <i style={{ width: 8, height: 8, borderRadius: 999, background: p.color }} />
            {p.name}{p.key === me ? " (you)" : ""}
          </span>
        ))}
        <span style={{ color: C.faint, fontSize: 13 }}>settling in USD</span>
        <span style={{ flex: 1 }} />
        <button style={ghost} onClick={reload}>Refresh</button>
        <button style={ghost} onClick={share}>Share</button>
        <button style={ghost} onClick={signOut}>Sign out</button>
      </div>

      {/* Standing balance */}
      <div style={card}>
        <div style={{ fontSize: 11, letterSpacing: ".2em", color: C.dim, fontWeight: 600 }}>STANDING BALANCE</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", margin: "8px 0 2px" }}>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-.03em", color: owedTo ? colorOf(owedTo) : C.text, fontVariantNumeric: "tabular-nums" }}>
            {money(bal.amount)}
          </div>
          {owedTo && (
            <button style={{ ...primary, padding: "9px 14px", fontSize: 14 }} onClick={() => setSettling(true)}>
              Settle up
            </button>
          )}
        </div>
        <div style={{ color: C.dim, fontSize: 15 }}>
          {owedTo ? <><b style={{ color: C.text }}>{nameOf(OTHER[owedTo])}</b> owes <b style={{ color: C.text }}>{nameOf(owedTo)}</b></> : "All square"}
        </div>
        {lastSettle && (
          <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>Last settled {dayLabel(lastSettle.date)} · {money(lastSettle.amount)}</div>
        )}

        {settling && (
          <div style={{ marginTop: 14, padding: 14, background: C.sunk, border: `1px solid ${C.line}`, borderRadius: 10 }}>
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              Record <b>{nameOf(OTHER[owedTo])}</b> paying <b>{nameOf(owedTo)}</b> {money(bal.amount)} today?
              The ledger stays; the balance goes to zero.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={{ ...primary, padding: "9px 14px", fontSize: 14 }} disabled={busy} onClick={settle}>
                {busy ? "Saving…" : "Yes, settled"}
              </button>
              <button style={ghost} onClick={() => setSettling(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Who fronted the selected month */}
        <div style={{ marginTop: 18 }}>
          <div style={{ height: 8, borderRadius: 999, overflow: "hidden", display: "flex", background: C.sunk }}>
            <div style={{ width: `${pct}%`, background: colorOf("alex") }} />
            <div style={{ width: `${100 - pct}%`, background: colorOf("jackie") }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8, fontSize: 12, color: C.dim, flexWrap: "wrap" }}>
            <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: colorOf("alex"), marginRight: 6 }} />Alex fronted {money(sum.fronted.alex)}</span>
            <span style={{ color: C.faint }}>{monthLabel(month)} spend {money(sum.total)}</span>
            <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: colorOf("jackie"), marginRight: 6 }} />Jackie fronted {money(sum.fronted.jackie)}</span>
          </div>
        </div>
      </div>

      {/* Add / edit */}
      <div style={card} ref={formTop}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <b style={{ fontSize: 17 }}>{editing ? "Edit entry" : "Add expense"}</b>
          {editing && <button style={ghost} onClick={reset}>Cancel</button>}
        </div>

        <label style={label}>What was it</label>
        <input style={{ ...field, marginBottom: 14 }} value={form.desc} placeholder="Groceries, power bill, dog food…"
          onChange={(e) => set("desc", e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={label}>Amount (USD)</label>
            <input style={field} value={form.amount} placeholder="0.00" type="number" step="0.01" min="0" inputMode="decimal"
              onChange={(e) => set("amount", e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          </div>
          <div>
            <label style={label}>Date</label>
            <input style={field} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </div>
        </div>

        <label style={label}>Who paid</label>
        <div style={{ marginBottom: 14 }}>
          <Segmented options={PEOPLE.map((p) => ({ key: p.key, label: p.name }))} value={form.paidBy} onChange={(v) => set("paidBy", v)} />
        </div>

        <label style={label}>Split</label>
        <div style={{ marginBottom: form.splitMode === "custom" ? 10 : 14 }}>
          <Segmented options={SPLITS} value={form.splitMode} onChange={(v) => set("splitMode", v)} />
        </div>
        {form.splitMode === "custom" && (
          <div style={{ marginBottom: 14 }}>
            <label style={label}>Alex's share (USD) — the rest is Jackie's</label>
            <input style={field} value={form.custom} placeholder="0.00" type="number" step="0.01" min="0" inputMode="decimal"
              onChange={(e) => set("custom", e.target.value)} />
            <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>
              Alex {money(sharesFor(form.amount, "custom", form.custom).alex)} · Jackie {money(sharesFor(form.amount, "custom", form.custom).jackie)}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={label}>Category</label>
            <select style={field} value={form.category} onChange={(e) => set("category", e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Note (optional)</label>
            <input style={field} value={form.note} placeholder="context" onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>

        {/* Receipts */}
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
          style={{
            border: `1px dashed ${over ? C.accent : C.line}`, borderRadius: 10, padding: "14px 14px",
            background: over ? "#13212a" : "transparent", display: "flex", alignItems: "center",
            gap: 10, flexWrap: "wrap", fontSize: 13, color: C.dim, marginBottom: 14,
          }}>
          <span>📎 Drop receipts, PDFs, or photos here, or{" "}
            <button type="button" onClick={() => fileInput.current?.click()}
              style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0 }}>browse</button>
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ color: C.faint, fontSize: 12 }}>stored in your Supabase bucket</span>
          <input ref={fileInput} type="file" multiple style={{ display: "none" }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </div>

        {(keep.length > 0 || drop.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {keep.map((f) => (
              <span key={f.path} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.sunk, border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 10px", fontSize: 12 }}>
                {f.url || urls[f.path]
                  ? <a href={f.url || urls[f.path]} target="_blank" rel="noreferrer" style={{ color: C.accent, textDecoration: "none" }}>{f.name}</a>
                  : <span style={{ color: C.dim }}>{f.name}</span>}
                <button onClick={() => setKeep((k) => k.filter((x) => x.path !== f.path))}
                  style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", padding: 0, fontSize: 14 }}>×</button>
              </span>
            ))}
            {drop.map((f, i) => (
              <span key={`${f.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.sunk, border: `1px dashed ${C.line}`, borderRadius: 999, padding: "5px 10px", fontSize: 12, color: C.dim }}>
                {f.name}
                <button onClick={() => setDrop((d) => d.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", padding: 0, fontSize: 14 }}>×</button>
              </span>
            ))}
          </div>
        )}

        {err && <div style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button style={{ ...primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>
            {busy ? "Saving…" : editing ? "Save changes" : "+ Add entry"}
          </button>
        </div>
      </div>

      {/* Month */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <button style={ghost} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <select value={month} onChange={(e) => setMonth(e.target.value)}
          style={{ ...field, width: "auto", padding: "8px 10px", fontSize: 15, fontWeight: 700 }}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button style={ghost} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        <span style={{ color: C.faint, fontSize: 13 }}>{sum.count} {sum.count === 1 ? "expense" : "expenses"} · {money(sum.total)}</span>
      </div>

      {sum.byCategory.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 11, letterSpacing: ".2em", color: C.dim, fontWeight: 600, marginBottom: 12 }}>WHERE IT WENT</div>
          {sum.byCategory.map((c) => (
            <div key={c.name} style={{ marginBottom: 9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>{c.name}</span>
                <span style={{ color: C.dim, fontVariantNumeric: "tabular-nums" }}>{money(c.amount)}</span>
              </div>
              <div style={{ height: 5, background: C.sunk, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${sum.total ? (c.amount / sum.total) * 100 : 0}%`, height: "100%", background: C.accent, opacity: 0.75 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Entries */}
      {rows.length === 0 && (
        <div style={{ ...card, color: C.dim, textAlign: "center" }}>
          Nothing logged in {monthLabel(month)} yet.
        </div>
      )}

      {rows.map((e) => {
        const s = e.share || sharesFor(e.amount, e.splitMode, e.custom);
        const settled = isSettle(e);
        return (
          <div key={e.id} style={{ ...card, padding: 14, marginBottom: 10, borderColor: settled ? C.accent : C.line }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, overflowWrap: "anywhere" }}>{e.desc}</div>
                <div style={{ color: C.dim, fontSize: 12.5, marginTop: 4 }}>
                  {dayLabel(e.date)} · {e.category}
                  {!settled && <> · <span style={{ color: colorOf(e.paidBy) }}>{nameOf(e.paidBy)} paid</span></>}
                </div>
                {!settled && (
                  <div style={{ color: C.faint, fontSize: 12, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                    Alex {money(s.alex)} · Jackie {money(s.jackie)}
                  </div>
                )}
                {e.note && <div style={{ color: C.dim, fontSize: 12.5, marginTop: 5, fontStyle: "italic", overflowWrap: "anywhere" }}>{e.note}</div>}
                {(e.files || []).length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 7 }}>
                    {e.files.map((f) => {
                      const href = f.url || urls[f.path];
                      const chip = { fontSize: 12, textDecoration: "none", border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 9px" };
                      return href
                        ? <a key={f.path} href={href} target="_blank" rel="noreferrer" style={{ ...chip, color: C.accent }}>📎 {f.name}</a>
                        : <span key={f.path} style={{ ...chip, color: C.faint }}>📎 {f.name}</span>;
                    })}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: settled ? C.accent : C.text }}>{money(e.amount)}</div>
                {/* A settlement is a payment that already happened, so it is
                    delete-or-keep. Editing it through the expense form would
                    move the balance and count a transfer as spend. */}
                <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {!settled && <button style={{ ...ghost, padding: "4px 8px" }} onClick={() => repeat(e)}>Repeat</button>}
                  {!settled && <button style={{ ...ghost, padding: "4px 8px" }} onClick={() => edit(e)}>Edit</button>}
                  <button style={{ ...ghost, padding: "4px 8px", color: C.danger, borderColor: "#3a2a2a" }}
                    onClick={() => del(e)}>{settled ? "Undo" : "Delete"}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {note && (
        <div style={{
          position: "fixed", left: 16, right: 16, bottom: 18, margin: "0 auto", maxWidth: 320,
          background: "#1d2936", border: `1px solid ${C.accent}`, color: C.text, borderRadius: 10,
          padding: "11px 14px", fontSize: 13, textAlign: "center",
        }}>{note}</div>
      )}
    </div>
  );
}

function Household({ user }) {
  const [entries, setEntries] = useState([]);
  const [claims, setClaims] = useState([]);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const [e, c] = await Promise.all([db.list(ENTRIES), db.list(CLAIMS)]);
      setEntries(e); setClaims(c); setErr(null);
    } catch (x) { setErr(x.message || "Could not load the ledger."); }
    setReady(true);
  }, []);

  useEffect(() => { load(); const ch = db.subscribe(load); return () => ch.unsubscribe(); }, [load]);

  const wrap = { maxWidth: 460, margin: "0 auto", padding: "60px 20px", color: C.dim };
  if (!ready) return <div style={wrap}>Loading…</div>;
  if (err) return <div style={wrap}><div style={{ color: C.danger, marginBottom: 12 }}>{err}</div><button style={ghost} onClick={load}>Try again</button></div>;

  const mine = claims.find((c) => (c.email || "").toLowerCase() === (user.email || "").toLowerCase());
  if (!mine) return <Claim user={user} claims={claims} onClaimed={load} />;

  return <Ledger user={user} me={mine.id} entries={entries} reload={load} />;
}

createRoot(document.getElementById("root")).render(
  <AuthGate>{(user) => <Household user={user} />}</AuthGate>
);
