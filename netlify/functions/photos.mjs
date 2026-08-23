// netlify/functions/photos.mjs
//
// Photo endpoint for the Azores tracker, served at /api/photos.
//
//   GET    /api/photos                     -> JSON index, newest first (public)
//   GET    /api/photos?id=X&size=thumb     -> image bytes (public, immutable cache)
//   POST   /api/photos                     -> upload (password required)
//   DELETE /api/photos?id=X                -> remove one (password required)
//   POST   /api/photos?rebuild=1           -> rebuild the index from stored blobs
//
// Storage is Netlify Blobs rather than the shared Supabase bucket, for three
// reasons: it needs no service-role key (the repo is public, so a writable key
// could never live here), it does not depend on whether the hub's anonymous
// storage policies have been locked down yet, and it keeps a few hundred trip
// photos out of the bucket every other app shares.
//
// Required environment variable:
//   PHOTO_UPLOAD_PASSWORD   The upload gate. Uploads FAIL CLOSED when unset —
//                           an unset password never means "allow", it means
//                           "refuse and say so". Reading is always public.
//
// The password is checked here, on the server. A password checked in page
// JavaScript would be readable by anyone viewing source and would gate nothing.

import { getStore } from "@netlify/blobs";

const STORE = "azores-photos";
const INDEX_KEY = "index.json";

// A downscaled 2000px JPEG lands around 400-700 KB and its thumb around 60 KB,
// so this is generous. It also keeps the request under Netlify's own body cap.
const MAX_BYTES = 5_000_000;
const MAX_PHOTOS = 500;
const MAX_CAPTION = 280;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
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
  const expected = process.env.PHOTO_UPLOAD_PASSWORD;
  if (!expected) {
    return json({
      ok: false,
      error:
        "Uploads are not configured yet: PHOTO_UPLOAD_PASSWORD is not set on this site. " +
        "Add it under Site configuration -> Environment variables, then redeploy.",
    }, 503);
  }
  if (!sameSecret(String(supplied || ""), expected)) {
    return json({ ok: false, error: "Wrong password." }, 401);
  }
  return null;
}

const newId = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

async function readIndex(store) {
  try {
    const idx = await store.get(INDEX_KEY, { type: "json" });
    return Array.isArray(idx) ? idx : [];
  } catch {
    return [];
  }
}

// Decode a base64 data URL into bytes. Returns null on anything unexpected
// rather than throwing, so a malformed body is a 400 and not a 500.
function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    const bin = Buffer.from(m[2], "base64");
    if (!bin.length) return null;
    return { type: m[1], bytes: bin };
  } catch {
    return null;
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  let store;
  try {
    store = getStore(STORE);
  } catch (err) {
    // Surfaced rather than swallowed: if Blobs is unavailable on this site the
    // page should say so plainly instead of showing an empty gallery.
    return json({
      ok: false,
      error: "Photo storage is unavailable on this site: " + (err?.message || String(err)),
    }, 503);
  }

  // ---- Serve one image -----------------------------------------------------
  if (req.method === "GET" && id) {
    const size = url.searchParams.get("size") === "thumb" ? "thumb" : "img";
    const key = `${size}/${id}`;
    const blob = await store.get(key, { type: "arrayBuffer" });
    if (!blob) return json({ ok: false, error: "Not found." }, 404);
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        // Content at a given id never changes, so it can be cached hard.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // ---- The index -----------------------------------------------------------
  if (req.method === "GET") {
    const photos = await readIndex(store);
    // Never cached. This used to be public/max-age=30, which meant a freshly
    // posted photo could stay invisible for up to half a minute — the page's
    // own `cache: "no-store"` only bypasses the browser cache, not a shared
    // CDN one. The payload is a few hundred bytes of JSON, so caching it saved
    // nothing worth the staleness. Netlify's own header is set too, because it
    // governs the edge independently of Cache-Control.
    return json({
      ok: true,
      count: photos.length,
      photos,
      uploadsConfigured: !!process.env.PHOTO_UPLOAD_PASSWORD,
    }, 200, { "Netlify-CDN-Cache-Control": "no-store" });
  }

  // ---- Upload --------------------------------------------------------------
  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Expected a JSON body." }, 400);
    }

    const denied = checkPassword(body?.password);
    if (denied) return denied;

    // Rebuild the index from the blobs actually present. A safety valve for a
    // lost index write; never needed in normal use.
    if (url.searchParams.get("rebuild") === "1") {
      const { blobs } = await store.list({ prefix: "img/" });
      const rebuilt = [];
      for (const b of blobs) {
        const key = b.key.slice("img/".length);
        const meta = await store.getMetadata(`img/${key}`).catch(() => null);
        rebuilt.push({
          id: key,
          caption: meta?.metadata?.caption || "",
          by: meta?.metadata?.by || "",
          ts: meta?.metadata?.ts || new Date(0).toISOString(),
          w: Number(meta?.metadata?.w) || null,
          h: Number(meta?.metadata?.h) || null,
        });
      }
      rebuilt.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
      await store.setJSON(INDEX_KEY, rebuilt);
      return json({ ok: true, rebuilt: rebuilt.length });
    }

    const full = decodeDataUrl(body?.image);
    if (!full) {
      return json({
        ok: false,
        error: "That image could not be read. Expected a JPEG, PNG or WebP data URL.",
      }, 400);
    }
    const thumb = decodeDataUrl(body?.thumb) || full;

    if (full.bytes.length + thumb.bytes.length > MAX_BYTES) {
      return json({
        ok: false,
        error: "That photo is too large even after resizing. Try a smaller one.",
      }, 413);
    }

    const photos = await readIndex(store);
    if (photos.length >= MAX_PHOTOS) {
      return json({
        ok: false,
        error: `The gallery is full at ${MAX_PHOTOS} photos. Delete some before adding more.`,
      }, 409);
    }

    const pid = newId();
    const entry = {
      id: pid,
      caption: String(body?.caption || "").slice(0, MAX_CAPTION),
      by: String(body?.by || "").slice(0, 40),
      ts: new Date().toISOString(),
      w: Number(body?.w) || null,
      h: Number(body?.h) || null,
    };

    // Bytes first, index last: a failure between the two leaves an orphan blob
    // that rebuild can recover, rather than an index entry pointing at nothing.
    // The two image writes are independent, so they go together rather than
    // one after the other — one fewer round trip in the upload's critical path.
    await Promise.all([
      store.set(`img/${pid}`, full.bytes, {
        metadata: { caption: entry.caption, by: entry.by, ts: entry.ts, w: entry.w, h: entry.h },
      }),
      store.set(`thumb/${pid}`, thumb.bytes),
    ]);

    photos.unshift(entry);
    await store.setJSON(INDEX_KEY, photos);

    return json({ ok: true, photo: entry, count: photos.length });
  }

  // ---- Delete --------------------------------------------------------------
  if (req.method === "DELETE") {
    let body = {};
    try {
      body = await req.json();
    } catch {
      /* password may arrive as a header instead */
    }
    const denied = checkPassword(body?.password || req.headers.get("x-photo-password"));
    if (denied) return denied;

    if (!id) return json({ ok: false, error: "Missing id." }, 400);

    await store.delete(`img/${id}`).catch(() => {});
    await store.delete(`thumb/${id}`).catch(() => {});

    const photos = await readIndex(store);
    const next = photos.filter((p) => p.id !== id);
    await store.setJSON(INDEX_KEY, next);

    return json({ ok: true, removed: id, count: next.length });
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
};
