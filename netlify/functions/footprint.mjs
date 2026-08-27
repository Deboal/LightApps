// netlify/functions/footprint.mjs
//
// Saved state for the QIF Footprint Editor, served at /api/footprint.
//
//   GET  /api/footprint?password=X   -> the saved dataset, or data:null if none
//   POST /api/footprint              -> save {password, data, rev}
//
// Storage is Netlify Blobs, following netlify/functions/photos.mjs: no
// service-role key to keep out of a public repo, and no dependency on the hub's
// Supabase policies. The dataset is a few KB of JSON, so it lives under one key.
//
// This exists so edits survive a reload and follow the editor between browsers
// and machines. Everything the app knows used to live in a page variable, so a
// refresh silently reset the slide to the 18 baseline sites.
//
// Required environment variable:
//   QIF_PASSWORD   The gate on both reading and writing saved state. FAILS
//                  CLOSED when unset — an unset password means "refuse and say
//                  so", never "allow". The editor stays usable without it; it
//                  just cannot save, and says as much.
//
// Unlike the photo endpoint, reads are gated too: the saved dataset is the thing
// being protected, so it is not public the way trip photos were.
//
// What this does NOT do: hide the baseline. apps/qif-footprint/index.html is a
// public static page with the map paths, city list and starting 18 sites inlined,
// so anyone with the URL can view those without ever calling this function. The
// password gates saved state, and makes the passphrase itself real by keeping it
// in an env var instead of the repo. Serving the page itself from a function is
// what it would take to gate the baseline too.

import { getStore } from "@netlify/blobs";

const STORE = "qif-footprint";
const KEY = "dataset.json";

// The editor's dataset is ~5 KB at 18 sites. This is a generous ceiling that
// still refuses anything pathological long before Netlify's own 6 MB body cap.
const MAX_BYTES = 1_000_000;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // Set independently of Cache-Control, because it governs the edge: a
      // cached response here would serve one editor another's stale slide.
      "Netlify-CDN-Cache-Control": "no-store",
      ...extra,
    },
  });

// Length-independent comparison, so a wrong password cannot be narrowed down by
// timing. Cheap to do correctly, so do it correctly.
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// Returns null when the caller is authorised, or a Response explaining why not.
function checkPassword(supplied) {
  const expected = process.env.QIF_PASSWORD;
  if (!expected) {
    return json({
      ok: false,
      configured: false,
      error:
        "Saving is not configured on this site: QIF_PASSWORD is not set. " +
        "Add it under Site configuration -> Environment variables, then redeploy.",
    }, 503);
  }
  if (!sameSecret(String(supplied || ""), expected)) {
    return json({ ok: false, error: "Wrong passphrase." }, 401);
  }
  return null;
}

// Only the three keys the editor owns are stored, and only in the shapes it
// understands. A saved blob is read straight back into the running app, so a
// malformed or oversized POST must be refused here rather than left to break
// the page on the next load.
function validate(data) {
  if (!data || typeof data !== "object") return "Expected a dataset object.";
  if (!Array.isArray(data.sites)) return "Dataset is missing a sites array.";
  if (!Array.isArray(data.legend)) return "Dataset is missing a legend array.";
  if (!data.txt || typeof data.txt !== "object") return "Dataset is missing its text block.";
  if (!data.sites.length) return "Refusing to save a dataset with no sites.";
  return null;
}

export default async (req) => {
  let store;
  try {
    store = getStore(STORE);
  } catch (err) {
    // Surfaced rather than swallowed: the editor should say storage is
    // unavailable, not quietly behave as though nothing had been saved.
    return json({
      ok: false,
      error: "Saved-state storage is unavailable on this site: " + (err?.message || String(err)),
    }, 503);
  }

  // ---- Read ----------------------------------------------------------------
  if (req.method === "GET") {
    const url = new URL(req.url);
    const denied = checkPassword(url.searchParams.get("password"));
    if (denied) return denied;

    let saved = null;
    try {
      saved = await store.get(KEY, { type: "json" });
    } catch {
      saved = null;
    }
    if (!saved || typeof saved !== "object") {
      // No save yet is a normal, expected state, not an error: the editor falls
      // back to the baseline 18 sites baked into the page.
      return json({ ok: true, data: null, rev: 0 });
    }
    return json({
      ok: true,
      data: saved.data ?? null,
      rev: Number(saved.rev) || 0,
      ts: saved.ts || null,
      by: saved.by || "",
    });
  }

  // ---- Save ----------------------------------------------------------------
  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Expected a JSON body." }, 400);
    }

    const denied = checkPassword(body?.password);
    if (denied) return denied;

    const bad = validate(body?.data);
    if (bad) return json({ ok: false, error: bad }, 400);

    const payload = JSON.stringify(body.data);
    if (payload.length > MAX_BYTES) {
      return json({ ok: false, error: "That dataset is too large to save." }, 413);
    }

    // Last-write-wins would silently discard someone else's slide, so a save
    // carries the revision it was based on. A mismatch is reported with the
    // current state attached, letting the page offer a real choice instead of
    // overwriting. force:true is the deliberate override.
    let current = null;
    try {
      current = await store.get(KEY, { type: "json" });
    } catch {
      current = null;
    }
    const currentRev = Number(current?.rev) || 0;
    const basedOn = Number(body?.rev);

    if (!body?.force && Number.isFinite(basedOn) && basedOn !== currentRev) {
      return json({
        ok: false,
        conflict: true,
        error:
          "Someone else saved a newer version. Reload to take theirs, or save again to overwrite it.",
        rev: currentRev,
        ts: current?.ts || null,
        by: current?.by || "",
      }, 409);
    }

    const rev = currentRev + 1;
    const ts = new Date().toISOString();
    const by = String(body?.by || "").slice(0, 60);
    await store.setJSON(KEY, { data: body.data, rev, ts, by });

    return json({ ok: true, rev, ts, by });
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
};
