// The runner. Amazon's add-to-cart is CSRF-protected and session-bound, so no
// URL from the outside can do it. What *can* is a click on Amazon's own page in
// your own browser — which is exactly what this does, in a background tab, once
// per bottle.

import { SHELF, AMAZON, productUrl } from "./shelf.js";

const LOAD_TIMEOUT_MS = 25000;
const SETTLE_MS = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Left in on purpose. Amazon reshuffles its markup regularly, and a service
// worker's console vanishes when the worker is recycled — so the trail also
// goes to storage, where the popup and a bug report can still find it.
async function log(...parts) {
  const line = `${new Date().toISOString().slice(11, 23)} ${parts.join(" ")}`;
  console.log("[vitamin-reorder]", line);
  try {
    const { debug } = await chrome.storage.local.get("debug");
    await chrome.storage.local.set({ debug: [...((debug || []).slice(-80)), line] });
  } catch { /* storage is best-effort for logging */ }
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { base: AMAZON, ...(settings || {}) };
}

async function setRun(patch) {
  const { run } = await chrome.storage.local.get("run");
  const next = { ...(run || {}), ...patch };
  await chrome.storage.local.set({ run: next });
  return next;
}

async function pushResult(result) {
  const { run } = await chrome.storage.local.get("run");
  const results = [...((run && run.results) || []), result];
  await chrome.storage.local.set({ run: { ...(run || {}), results } });
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, LOAD_TIMEOUT_MS);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") finish();
    }
    function finish() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function navigate(tabId, url) {
  const done = waitForLoad(tabId);
  await chrome.tabs.update(tabId, { url });
  await done;
}

// Runs inside the Amazon page. Kept dependency-free and defensive: Amazon
// reshuffles this markup constantly, so every selector has alternates and a
// missing one is reported rather than thrown.
function addToCartInPage(qty) {
  const readCount = () => {
    const el = document.querySelector("#nav-cart-count");
    if (!el) return null;
    const n = parseInt((el.textContent || "").trim(), 10);
    return Number.isNaN(n) ? null : n;
  };
  const before = readCount();

  let quantitySet = false;
  const sel = document.querySelector("select#quantity, select[name='quantity']");
  if (sel) {
    const want = String(qty);
    if ([...sel.options].some((o) => o.value === want)) {
      sel.value = want;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      quantitySet = true;
    }
  } else {
    const input = document.querySelector("input#quantity, input[name='quantity']");
    if (input) {
      input.value = String(qty);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      quantitySet = true;
    }
  }

  const btn = document.querySelector(
    "#add-to-cart-button, input[name='submit.add-to-cart'], #add-to-cart-button-ubb, #buybox #submit\\.add-to-cart"
  );
  if (!btn) {
    const unavailable = !!document.querySelector("#outOfStock, #availability .a-color-price");
    return {
      clicked: false,
      before,
      reason: unavailable
        ? "no Add to Cart button — looks out of stock"
        : "no Add to Cart button — the listing may need a size or flavour picked",
    };
  }

  btn.click();
  return { clicked: true, before, quantitySet: quantitySet || qty === 1 };
}

function readCartCountInPage() {
  const el = document.querySelector("#nav-cart-count");
  if (!el) return null;
  const n = parseInt((el.textContent || "").trim(), 10);
  return Number.isNaN(n) ? null : n;
}

async function inject(tabId, func, args = []) {
  try {
    const [out] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return out ? out.result : null;
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

async function runQueue(lines) {
  const { base } = await getSettings();
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });

  await setRun({
    active: true, total: lines.length, index: 0, results: [],
    startedAt: new Date().toISOString(), tabId: tab.id,
  });

  for (let i = 0; i < lines.length; i++) {
    const { item, qty } = lines[i];
    await setRun({ index: i, current: item.name });

    let result = { id: item.id, name: item.name, qty };
    try {
      log("navigating", i, item.name);
      await navigate(tab.id, productUrl(item, base));
      log("loaded", i);
      const clicked = await inject(tab.id, addToCartInPage, [qty]);
      log("clicked", i, JSON.stringify(clicked));

      if (!clicked || clicked.error) {
        result.status = "failed";
        result.detail = clicked?.error || "could not reach the page";
      } else if (!clicked.clicked) {
        result.status = "attention";
        result.detail = clicked.reason;
      } else {
        // The click either navigates to the "added to cart" page or opens a
        // side sheet. Either way the header count is the honest signal.
        await sleep(SETTLE_MS);
        const after = await inject(tab.id, readCartCountInPage);
        const before = clicked.before;
        if (typeof after === "number" && typeof before === "number") {
          result.status = after > before ? "added" : "unconfirmed";
          result.detail = after > before
            ? null
            : "clicked, but the cart count did not move — check this one";
        } else {
          result.status = "unconfirmed";
          result.detail = "clicked, but the cart count was not readable — are you signed in?";
        }
        if (!clicked.quantitySet && qty > 1) {
          result.detail = `added, but quantity ${qty} could not be set — adjust it in the cart`;
          result.status = "unconfirmed";
        }
      }
    } catch (e) {
      result.status = "failed";
      result.detail = e && e.message ? e.message : String(e);
    }

    log("result", i, result.status, result.detail || "");
    await pushResult(result);

    if (result.status === "added") {
      const { ordered } = await chrome.storage.local.get("ordered");
      await chrome.storage.local.set({
        ordered: { ...(ordered || {}), [item.id]: new Date().toISOString() },
      });
      const { picked } = await chrome.storage.local.get("picked");
      const next = { ...(picked || {}) };
      delete next[item.id];
      await chrome.storage.local.set({ picked: next });
    }
  }

  await navigate(tab.id, `${base}/gp/cart/view.html`);
  await chrome.tabs.update(tab.id, { active: true });
  await setRun({ active: false, index: lines.length, current: null, finishedAt: new Date().toISOString() });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "start") {
    const byId = Object.fromEntries([...SHELF, ...(msg.custom || [])].map((i) => [i.id, i]));
    const lines = msg.lines
      .map(({ id, qty }) => ({ item: byId[id], qty }))
      .filter((l) => l.item && l.item.asin);
    if (!lines.length) {
      sendResponse({ ok: false, error: "nothing linkable selected" });
      return true;
    }
    runQueue(lines)
      .catch(async (e) => {
        await setRun({ active: false, error: e && e.message ? e.message : String(e) });
      });
    sendResponse({ ok: true, count: lines.length });
    return true;
  }
  return false;
});
