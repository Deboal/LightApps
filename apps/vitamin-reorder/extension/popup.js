// Popup: pick bottles, hand the queue to the background worker, watch it go.
// State lives in chrome.storage so closing the popup mid-run loses nothing.

import { SHELF, parseAsin } from "./shelf.js";

const root = document.getElementById("root");
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return n;
};

let state = { picked: {}, ordered: {}, custom: [], hidden: [], run: null };

const items = () =>
  [...SHELF, ...state.custom].filter((i) => !state.hidden.includes(i.id));

const picked = () =>
  items().map((item) => ({ item, qty: state.picked[item.id] || 0 })).filter((l) => l.qty > 0);

function daysAgo(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "ordered today";
  if (d === 1) return "ordered yesterday";
  if (d < 60) return `ordered ${d}d ago`;
  return `ordered ${Math.round(d / 30)} months ago`;
}

async function save(patch) {
  Object.assign(state, patch);
  await chrome.storage.local.set(patch);
  render();
}

const setQty = (id, qty) => {
  const p = { ...state.picked };
  if (qty > 0) p[id] = Math.min(qty, 20);
  else delete p[id];
  return save({ picked: p });
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
const DOT = { added: "✓", failed: "✕", blocked: "✕" };
const TONE = { added: "ok", failed: "bad", blocked: "bad" };

async function copyDiagnostics(run) {
  const { debug } = await chrome.storage.local.get("debug");
  const text = [
    `vitamin-reorder run ${run.startedAt || ""}`,
    `results:`,
    ...(run.results || []).map((r) =>
      `  ${r.status} — ${r.name}${r.detail ? ` — ${r.detail}` : ""}` +
      (r.page ? `\n      page: ${r.page.title} | matched=${r.page.matched} | ${r.page.url}` : "")),
    run.error ? `error: ${run.error}` : "",
    `trail:`,
    ...(debug || []).map((l) => `  ${l}`),
  ].filter(Boolean).join("\n");
  await navigator.clipboard.writeText(text);
}

function runPanel(run) {
  const results = run.results || [];
  const done = !run.active;
  const added = results.filter((r) => r.status === "added").length;
  const flagged = results.filter((r) => r.status !== "added");
  const blocked = run.stopped === "botcheck";

  let headline;
  if (!done) headline = run.current || "Starting…";
  else if (blocked) headline = "Amazon showed a bot check";
  else headline = `${added} added${flagged.length ? `, ${flagged.length} need${flagged.length === 1 ? "s" : ""} a look` : ""}`;

  return el("div", { class: `panel${done && !blocked ? " done" : ""}` },
    el("div", { class: "kicker" },
      done ? (blocked ? "RUN STOPPED" : "RUN COMPLETE") : `ADDING ${Math.min(run.index + 1, run.total)} OF ${run.total}`),
    el("div", { style: "font-size:16px;font-weight:750;margin-top:5px;letter-spacing:-.01em" }, headline),
    blocked
      ? el("div", { class: "foot", style: "margin:6px 0 2px" },
          "It stopped rather than keep tripping the check. Switch to the tab it opened, " +
          "clear the challenge, then run again — a smaller batch usually goes through.")
      : null,
    el("div", { class: "progress" },
      Array.from({ length: run.total }, (_, n) =>
        el("div", { class: `tick${n < results.length ? " done" : n === run.index && run.active ? " now" : ""}` }))),
    ...results.map((r) =>
      el("div", { class: "res" },
        el("span", { class: `dot ${TONE[r.status] || "warn"}` }, DOT[r.status] || "!"),
        el("div", { class: "rname" },
          r.name,
          r.detail ? el("div", { class: "rdetail" }, r.detail) : null))),
    run.error ? el("div", { class: "rdetail bad", style: "margin-top:8px" }, run.error) : null,
    done
      ? el("div", { style: "display:flex;gap:6px;margin-top:10px" },
          el("button", {
            class: "cta", style: "margin-top:0",
            onclick: () => chrome.storage.local.remove("run").then(() => save({ run: null })),
          }, "Back to the list"),
          el("button", {
            class: "ghost",
            onclick: async (e) => {
              await copyDiagnostics(run);
              e.target.textContent = "Copied";
            },
          }, "Copy diagnostics"))
      : el("div", { class: "foot" },
          "Working in a background tab. You can close this popup — it keeps going."),
  );
}

function itemRow(item) {
  const qty = state.picked[item.id] || 0;
  const on = qty > 0;
  const ordered = state.ordered[item.id];

  return el("div", { class: `row${on ? " on" : ""}` },
    el("button", {
      class: `box${on ? " on" : ""}`,
      "aria-label": `${on ? "Deselect" : "Select"} ${item.name}`,
      onclick: () => setQty(item.id, on ? 0 : 1),
    }, on ? "✓" : ""),
    el("div", { style: "flex:1;min-width:0" },
      el("div", { class: "name" },
        item.name,
        item.match === "close" ? el("span", { class: "badge" }, "check") : null,
        item.match === "none" ? el("span", { class: "badge none" }, "no link") : null),
      el("div", { class: "meta" }, `${item.brand} · ${item.size}`),
      item.note ? el("div", { class: "note" }, item.note) : null,
      el("div", { class: "note", style: "font-style:normal" },
        ordered ? daysAgo(ordered) : "never ordered")),
    on
      ? el("div", { class: "qty" },
          el("button", { class: "step", "aria-label": "Fewer", onclick: () => setQty(item.id, qty - 1) }, "−"),
          el("span", { class: "n" }, String(qty)),
          el("button", { class: "step", "aria-label": "More", onclick: () => setQty(item.id, qty + 1) }, "+"))
      : null,
  );
}

function addForm() {
  let open = false;
  const mount = el("div");
  const draw = () => {
    mount.textContent = "";
    if (!open) {
      mount.appendChild(el("button", { class: "add", onclick: () => { open = true; draw(); } },
        "+ Add a bottle"));
      return;
    }
    const name = el("input", { placeholder: "What is it?" });
    const ref = el("input", { placeholder: "Amazon link or ASIN" });
    const submit = () => {
      const n = name.value.trim();
      const asin = parseAsin(ref.value);
      if (!n || !asin) return;
      save({
        custom: [...state.custom, {
          id: `c-${Date.now()}`, brand: "Added by you", name: n, size: asin,
          asin, match: "exact", search: n, custom: true,
        }],
      });
      open = false;
    };
    ref.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    mount.append(
      name, ref,
      el("div", { class: "foot", style: "margin:0 0 8px" },
        "An Amazon link is required here — the extension needs the ASIN to add it."),
      el("div", { style: "display:flex;gap:6px" },
        el("button", { class: "ghost", onclick: submit }, "Add"),
        el("button", { class: "ghost", onclick: () => { open = false; draw(); } }, "Cancel")),
    );
  };
  draw();
  return mount;
}

function render() {
  const list = items();
  const sel = picked();
  const linkable = sel.filter((l) => l.item.asin);
  const allOn = list.length > 0 && list.length === Object.keys(state.picked).length;

  root.textContent = "";
  root.append(
    el("div", { class: "kicker" }, `THE COUNTER · ${list.length} BOTTLES`),
    el("h1", {}, "Vitamin Reorder"),
    el("div", { class: "sub" },
      "Adds each one to your Amazon cart for real — it drives amazon.com in a background tab using your signed-in session."),
  );

  if (state.run) {
    root.appendChild(runPanel(state.run));
    if (state.run.active) return;
  }

  root.append(
    el("div", { class: "bar" },
      el("button", {
        class: "ghost",
        onclick: () => {
          if (allOn) return save({ picked: {} });
          const p = {};
          list.forEach((i) => { p[i.id] = state.picked[i.id] || 1; });
          return save({ picked: p });
        },
      }, allOn ? "Clear all" : "Select all"),
      el("span", { class: "count" }, sel.length ? `${sel.length} selected` : "nothing selected")),
    ...list.map(itemRow),
    addForm(),
    el("button", {
      class: "cta",
      disabled: linkable.length ? null : "true",
      onclick: async () => {
        const res = await chrome.runtime.sendMessage({
          type: "start",
          lines: linkable.map((l) => ({ id: l.item.id, qty: l.qty })),
          custom: state.custom,
        });
        if (!res || !res.ok) return;
        await save({ run: { active: true, total: linkable.length, index: 0, results: [] } });
      },
    }, linkable.length ? `Add ${linkable.length} to cart` : "Nothing selected"),
    el("div", { class: "foot" },
      "Sign in to Amazon first. Bottles marked ",
      el("b", { style: "color:#c9a15e" }, "check"),
      " matched a listing with size or bundle variants — worth a look before you check out.",
      sel.length > linkable.length
        ? " Bottles with no link are skipped; open those from the web app."
        : ""),
  );
}

// ---------------------------------------------------------------------------
async function boot() {
  const stored = await chrome.storage.local.get(["picked", "ordered", "custom", "hidden", "run"]);
  state = {
    picked: stored.picked || {},
    ordered: stored.ordered || {},
    custom: stored.custom || [],
    hidden: stored.hidden || [],
    run: stored.run || null,
  };
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let touched = false;
  for (const [k, { newValue }] of Object.entries(changes)) {
    if (k in state) { state[k] = newValue === undefined ? (k === "run" ? null : state[k]) : newValue; touched = true; }
  }
  if (touched) render();
});

boot();
