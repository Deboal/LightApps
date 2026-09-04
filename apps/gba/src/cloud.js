// cloud.js — the account-backed half of the emulator's storage.
//
// The local IndexedDB copy stays the thing the emulator reads and writes.
// This layer makes a copy durable and portable: ROMs are uploaded once and
// keyed by content hash, saves are versioned and synced.
//
// Two rules shape the whole design.
//
// 1. Conflict resolution never uses timestamps. Device clocks disagree, and
//    the semantics are wrong regardless: "later" is not "correct". Every save
//    carries a monotonic version, and a push is a compare-and-swap against the
//    version the client last saw. A losing push returns the remote copy and
//    the user chooses; nothing is discarded silently.
// 2. Nothing here is public. Blobs live in a private bucket under the user's
//    own id, and the shared `hub-files` bucket is deliberately not used.

import { sb, configured } from "../../../shared/client.js";
import { store } from "../../../shared/store.js";

const BUCKET = "gba";
const APP = "gba";
/** How many past versions of a save to keep. 128 KB each; storage is cheap
 *  relative to losing a playthrough. */
const HISTORY = 10;

export { configured };

const db = store(APP);

function client() {
  if (!sb) throw new Error("Backend not configured");
  return sb;
}

async function userId() {
  const { data } = await client().auth.getUser();
  const id = data?.user?.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

/** A stable per-browser identifier, so a conflict can say where the other
 *  side came from. Not a security boundary — just a label. */
export function deviceId() {
  const key = "gba:device";
  let id = null;
  try {
    id = localStorage.getItem(key);
    if (!id) {
      id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 8);
      localStorage.setItem(key, id);
    }
  } catch {
    id = "unknown";
  }
  return id;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Key a save on the cartridge, not on a filename: the same game dumped
 *  twice must land on the same slot, and two different games must not. */
export function saveKey(gameCode, romSha) {
  return `${gameCode}-${romSha.slice(0, 12)}`;
}

// app_data's primary key is (app, collection, doc_id) -- global, with no user
// column in it. Two accounts holding the same cartridge would collide on an
// identical doc_id: the second insert fails the primary key rather than being
// hidden by row-level security, which reads as a phantom conflict. Every
// doc_id is therefore prefixed with the owner.
const docId = (uid, id) => `${uid}:${id}`;
const stripOwner = (id) => id.slice(id.indexOf(":") + 1);

/** Turn a storage error into something a person can act on. */
function explain(error) {
  const message = error?.message || String(error);
  if (/bucket not found/i.test(message)) {
    return new Error("The 'gba' storage bucket is missing — run schema-gba.sql in the Supabase SQL editor.");
  }
  if (/row-level security|violates policy/i.test(message)) {
    return new Error("The storage policy rejected this — check that schema-gba.sql ran fully.");
  }
  return error instanceof Error ? error : new Error(message);
}

// -- ROMs ----------------------------------------------------------------

export async function listRoms() {
  const uid = await userId();
  const rows = await db.list("roms");
  return rows
    .filter((row) => row.id.startsWith(`${uid}:`))
    .map((row) => ({ ...row, id: stripOwner(row.id) }));
}

/** Upload a ROM unless its hash is already on the server. Returns metadata. */
export async function putRom(bytes, meta = {}) {
  const uid = await userId();
  const sha = meta.sha || (await sha256Hex(bytes));
  const path = `${uid}/roms/${sha}.gba`;

  const existing = await db.get("roms", docId(uid, sha));
  if (!existing || meta.force) {
    const { error } = await client()
      .storage.from(BUCKET)
      .upload(path, new Blob([bytes], { type: "application/octet-stream" }), {
        upsert: true,
        contentType: "application/octet-stream",
      });
    if (error) throw explain(error);
  }

  const record = {
    title: meta.title || existing?.title || "",
    gameCode: meta.gameCode || existing?.gameCode || "",
    bytes: bytes.length,
    path,
    addedAt: existing?.addedAt || new Date().toISOString(),
  };
  await db.set("roms", record, docId(uid, sha));
  return { id: sha, ...record };
}

export async function getRom(path) {
  const { data, error } = await client().storage.from(BUCKET).download(path);
  if (error) throw explain(error);
  return new Uint8Array(await data.arrayBuffer());
}

export async function forgetRom(sha, path) {
  const uid = await userId();
  await db.remove("roms", docId(uid, sha));
  if (path) await client().storage.from(BUCKET).remove([path]);
}

// -- saves ---------------------------------------------------------------

/** The server's current view of one cartridge's save, or null if it has
 *  never been pushed. */
export async function saveMeta(key) {
  const uid = await userId();
  return db.get("saves", docId(uid, key));
}

export async function pullSave(key) {
  const meta = await saveMeta(key);
  if (!meta) return null;
  const { data, error } = await client().storage.from(BUCKET).download(meta.path);
  if (error) throw explain(error);
  return { meta, bytes: new Uint8Array(await data.arrayBuffer()) };
}

/**
 * Push a save, expecting the server to still be at `parentVersion`.
 *
 * Returns `{ ok: true, meta }` when the compare-and-swap succeeded, or
 * `{ conflict: true, meta }` with the server's current metadata when someone
 * else moved it on. The caller must not resolve a conflict on its own.
 */
export async function pushSave(key, bytes, parentVersion) {
  const uid = await userId();
  const table = client().from("app_data");
  const id = docId(uid, key);

  // Read first only to choose the branch. The write itself is what makes this
  // safe: an insert is guarded by the primary key, an update by the version
  // filter, so a racing client still loses cleanly.
  const remote = await saveMeta(key);
  if (remote && remote.version !== parentVersion) {
    return { conflict: true, meta: remote };
  }

  const version = (remote?.version ?? 0) + 1;
  const path = `${uid}/saves/${key}/v${version}.sav`;

  const { error: uploadError } = await client()
    .storage.from(BUCKET)
    .upload(path, new Blob([bytes], { type: "application/octet-stream" }), {
      upsert: true,
      contentType: "application/octet-stream",
    });
  if (uploadError) throw explain(uploadError);

  const record = {
    version,
    path,
    bytes: bytes.length,
    device: deviceId(),
    updatedAt: new Date().toISOString(),
  };
  const row = {
    app: APP,
    collection: "saves",
    doc_id: id,
    data: record,
    visibility: "private",
    updated_at: record.updatedAt,
  };

  if (!remote) {
    // First push for this cartridge. A plain insert races correctly: the
    // primary key rejects the loser.
    const { error } = await table.insert(row);
    if (error) {
      if (error.code === "23505") return { conflict: true, meta: await saveMeta(key) };
      throw error;
    }
  } else {
    // The compare-and-swap. Matching on the stored version means a push built
    // on a stale read updates zero rows instead of overwriting.
    const { data, error } = await table
      .update(row)
      .eq("app", APP)
      .eq("collection", "saves")
      .eq("doc_id", id)
      .eq("data->>version", String(parentVersion))
      .select("doc_id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return { conflict: true, meta: await saveMeta(key) };
    }
  }

  pruneHistory(uid, key, version).catch(() => {});
  return { ok: true, meta: record };
}

/** Force the server to a given blob regardless of its current version: the
 *  "keep mine" branch of a conflict, taken only when the user says so. */
export async function overwriteSave(key, bytes, remoteVersion) {
  return pushSave(key, bytes, remoteVersion);
}

/** Drop the version that just fell out of the retention window. Best effort:
 *  losing this costs storage, never data. */
async function pruneHistory(uid, key, version) {
  const stale = version - HISTORY;
  if (stale < 1) return;
  await client().storage.from(BUCKET).remove([`${uid}/saves/${key}/v${stale}.sav`]);
}

/** Every retained version of a save, newest first. */
export async function saveHistory(key) {
  const uid = await userId();
  const { data, error } = await client()
    .storage.from(BUCKET)
    .list(`${uid}/saves/${key}`, { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) throw explain(error);
  return (data || [])
    .map((entry) => ({
      version: Number(entry.name.replace(/^v|\.sav$/g, "")),
      path: `${uid}/saves/${key}/${entry.name}`,
      updatedAt: entry.updated_at || entry.created_at,
      bytes: entry.metadata?.size ?? 0,
    }))
    .filter((entry) => Number.isFinite(entry.version))
    .sort((a, b) => b.version - a.version);
}

export async function getBlob(path) {
  const { data, error } = await client().storage.from(BUCKET).download(path);
  if (error) throw explain(error);
  return new Uint8Array(await data.arrayBuffer());
}
