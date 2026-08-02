// The runner. Amazon's add-to-cart is CSRF-protected and session-bound, so no
// URL from the outside can do it. What *can* is a click on Amazon's own page in
// your own browser — which is exactly what this does, one bottle at a time.
//
// Everything here is written against a hostile assumption: the tab may be
// showing a page other than the one we just asked for. Amazon redirects, serves
// bot checks, and finishes the previous add-to-cart navigation late. So the code
// never trusts a "load finished" event on its own — it polls the page until it
// can see the product it actually asked for.

import { SHELF, AMAZON, productUrl } from "./shelf.js";

const NAV_TIMEOUT_MS = 30000;   // for the right page to appear
const CONFIRM_TIMEOUT_MS = 15000; // for the cart count to move after clicking
const POLL_MS = 350;
const BETWEEN_ITEMS_MS = 900;   // don't hammer Amazon; it trips bot checks

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Left in on purpose. Amazon reshuffles its markup regularly, and a service
// worker's console vanishes when the worker is recycled — so the trail also
// goes to storage, where the popup's "Copy diagnostics" can pick it up.
async function log(...parts) {
  const line = `${new Date().toISOString().slice(11, 23)} ${parts.join(" ")}`;
  console.log("[vitamin-reorder]", line);
  try {
    const { debug } = await chrome.storage.local.get("debug");
    await chrome.storage.local.set({ debug: [...(debug || []).slice(-120), line] });
  } catch { /* logging is best-effort */ }
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { base: AMAZON, ...(settings || {}) };
}

async function setRun(patch) {
  const { run } = await chrome.storage.local.get("run");
  await chrome.storage.local.set({ run: { ...(run || {}), ...patch } });
}

async function pushResult(result) {
  const { run } = await chrome.storage.local.get("run");
  await chrome.storage.local.set({
    run: { ...(run || {}), results: [...((run && run.results) || []), result] },
  });
}

// ---------------------------------------------------------------------------
// Injected page probes. These run inside the Amazon tab.
// ---------------------------------------------------------------------------

// Ordered by specificity. Amazon's canonical id has outlived every redesign so
// far; the rest are fallbacks for the buy-box variants.
const BUTTON_SELECTORS = [
  "#add-to-cart-button",
  "input[name='submit.add-to-cart']",
  "#add-to-cart-button-ubb",
  "#buybox input[type='submit'][name*='add-to-cart']",
  "[data-feature-name='addToCart'] input[type='submit']",
  "#desktop_buybox input[type='submit']",
];

function inspectPage(selectors) {
  const q = (s) => { try { return document.querySelector(s); } catch { return null; } };
  const head = ((document.body && document.body.innerText) || "").slice(0, 2500);

  let matched = null;
  for (const s of selectors) if (q(s)) { matched = s; break; }

  const countEl = q("#nav-cart-count");
  const parsed = countEl ? parseInt((countEl.textContent || "").trim(), 10) : NaN;

  const account = q("#nav-link-accountList");
  const accountText = account ? (account.innerText || "") : "";

  return {
    url: location.href,
    title: (document.title || "").slice(0, 140),
    ready: document.readyState,
    matched,
    cartCount: Number.isNaN(parsed) ? null : parsed,
    botCheck: !!(
      q("#captchacharacters") ||
      q("form[action*='validateCaptcha']") ||
      /Enter the characters you see below|Type the characters you see in this image|Click the button below to continue shopping/i.test(head)
    ),
    signedOut: /Hello,\s*sign in|Hello,\s*Sign in/i.test(accountText),
    outOfStock: !!(q("#outOfStock") || /Currently unavailable/i.test(head)),
  };
}

function clickButtonInPage(selector, qty) {
  let quantitySet = qty === 1;
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

  const btn = document.querySelector(selector);
  if (!btn) return { clicked: false, quantitySet };
  btn.click();
  return { clicked: true, quantitySet };
}

async function inject(tabId, func, args = []) {
  try {
    const [out] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return out ? out.result : null;
  } catch (e) {
    // Expected while a navigation is in flight; the caller polls through it.
    return { injectError: e && e.message ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Waiting that actually verifies, rather than trusting a load event.
// ---------------------------------------------------------------------------

// A "complete" event can belong to the *previous* navigation — the add-to-cart
// POST finishing late, or a redirect. So we poll the page itself until it is
// the one we asked for. `marker` is the ASIN (or search term) that must appear
// in the URL.
async function waitForPage(tabId, marker, deadlineMs = NAV_TIMEOUT_MS) {
  const until = Date.now() + deadlineMs;
  let last = null;
  while (Date.now() < until) {
    const info = await inject(tabId, inspectPage, [BUTTON_SELECTORS]);
    if (info && !info.injectError) {
      last = info;
      const onTarget = !marker || decodeURIComponent(info.url).includes(marker);
      if (onTarget && info.botCheck) return { ...info, arrived: true };
      if (onTarget && info.ready === "complete" && (info.matched || info.outOfStock)) {
        return { ...info, arrived: true };
      }
    }
    await sleep(POLL_MS);
  }
  return { ...(last || {}), arrived: false, timedOut: true };
}

// After clicking, the honest signal is the header cart count moving. Poll for
// it rather than sleeping a fixed amount — the add can redirect through an
// interstitial that takes seconds.
async function waitForCartCount(tabId, before, deadlineMs = CONFIRM_TIMEOUT_MS) {
  const until = Date.now() + deadlineMs;
  let seen = null;
  while (Date.now() < until) {
    const info = await inject(tabId, inspectPage, [BUTTON_SELECTORS]);
    if (info && !info.injectError && typeof info.cartCount === "number") {
      seen = info.cartCount;
      if (typeof before !== "number" || info.cartCount > before) return { moved: true, count: seen };
    }
    await sleep(POLL_MS);
  }
  return { moved: false, count: seen };
}

// ---------------------------------------------------------------------------

async function runQueue(lines) {
  const { base } = await getSettings();
  await chrome.storage.local.set({ debug: [] });

  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  await setRun({
    active: true, total: lines.length, index: 0, results: [],
    startedAt: new Date().toISOString(), tabId: tab.id, error: null,
  });

  let stopped = null;

  for (let i = 0; i < lines.length; i++) {
    const { item, qty } = lines[i];
    await setRun({ index: i, current: item.name });

    const result = { id: item.id, name: item.name, qty };
    try {
      const url = productUrl(item, base);
      const marker = item.asin || "";
      await log(`→ ${i} ${item.name} ${url}`);
      await chrome.tabs.update(tab.id, { url });

      const page = await waitForPage(tab.id, marker);
      await log(`  page ready=${page.ready} matched=${page.matched} bot=${page.botCheck} ` +
                `oos=${page.outOfStock} cart=${page.cartCount} url=${(page.url || "").slice(0, 90)}`);
      result.page = { title: page.title, url: (page.url || "").slice(0, 140), matched: page.matched };

      if (page.botCheck) {
        result.status = "blocked";
        result.detail = "Amazon showed a bot check — solve it in the tab, then run again";
        stopped = "botcheck";
      } else if (!page.arrived) {
        result.status = "failed";
        result.detail = page.timedOut
          ? "the product page never finished loading"
          : "could not read the page";
      } else if (page.outOfStock && !page.matched) {
        result.status = "attention";
        result.detail = "no Add to Cart button — looks out of stock";
      } else if (!page.matched) {
        result.status = "attention";
        result.detail = "no Add to Cart button — the listing may need a size or option picked";
      } else {
        const before = page.cartCount;
        const click = await inject(tab.id, clickButtonInPage, [page.matched, qty]);
        await log(`  clicked=${click && click.clicked} qtySet=${click && click.quantitySet}`);

        if (!click || click.injectError || !click.clicked) {
          result.status = "failed";
          result.detail = "the Add to Cart button vanished before it could be clicked";
        } else {
          const confirm = await waitForCartCount(tab.id, before);
          await log(`  confirm moved=${confirm.moved} count=${confirm.count} (before ${before})`);
          if (confirm.moved) {
            result.status = "added";
            if (!click.quantitySet && qty > 1) {
              result.status = "unconfirmed";
              result.detail = `added, but quantity ${qty} could not be set — fix it in the cart`;
            }
          } else if (before === null) {
            result.status = "unconfirmed";
            result.detail = "clicked, but the cart count was unreadable — are you signed in?";
          } else {
            result.status = "unconfirmed";
            result.detail = "clicked, but the cart count never moved — check this one";
          }
        }
      }
    } catch (e) {
      result.status = "failed";
      result.detail = e && e.message ? e.message : String(e);
    }

    await log(`  = ${result.status} ${result.detail || ""}`);
    await pushResult(result);

    if (result.status === "added") {
      const { ordered, picked } = await chrome.storage.local.get(["ordered", "picked"]);
      const nextPicked = { ...(picked || {}) };
      delete nextPicked[item.id];
      await chrome.storage.local.set({
        ordered: { ...(ordered || {}), [item.id]: new Date().toISOString() },
        picked: nextPicked,
      });
    }

    if (stopped) {
      await log(`stopping early: ${stopped}`);
      break;
    }
    if (i < lines.length - 1) await sleep(BETWEEN_ITEMS_MS);
  }

  if (stopped === "botcheck") {
    await chrome.tabs.update(tab.id, { active: true });
    await setRun({ active: false, current: null, stopped, finishedAt: new Date().toISOString() });
    return;
  }

  await chrome.tabs.update(tab.id, { url: `${base}/gp/cart/view.html`, active: true });
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
    runQueue(lines).catch(async (e) => {
      await log("run threw:", e && e.message ? e.message : String(e));
      await setRun({ active: false, error: e && e.message ? e.message : String(e) });
    });
    sendResponse({ ok: true, count: lines.length });
    return true;
  }
  return false;
});
