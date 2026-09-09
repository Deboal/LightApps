// store.js — the namespaced data helper every hub app uses.
//
// store("my-app")            -> per-user PRIVATE data (each signed-in user sees only their own)
// store("my-app", {shared:true}) -> SHARED data (all signed-in users see it; owner recorded)
// store("my-app", {shared:true, anon:true})
//                            -> SHARED, and always read/written as the anon
//                               role even if the visitor is signed in to
//                               another app on this hub. For an app with no
//                               sign-in of its own: see sbAnon in client.js
//                               for why carrying somebody else's session is a
//                               trap rather than a bonus.
//
// Backing table app_data(app, collection, doc_id, data jsonb, owner uuid, visibility text).
// Row-level security enforces the private/shared rule; this helper just sets `visibility`.

import { sb, sbAnon, configured } from "./client.js";

const TABLE = "app_data";
const BUCKET = "hub-files";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
function client(anonOnly) {
  const c = anonOnly ? sbAnon : sb;
  if (!c) throw new Error("App Hub backend not configured — set SUPABASE_URL and SUPABASE_KEY in shared/config.js");
  return c;
}

export { configured };

export function store(appName, opts = {}) {
  if (!appName) throw new Error("store(appName): appName is required");
  const visibility = opts.shared ? "shared" : "private";
  const anonOnly = !!opts.anon;
  const tbl = () => client(anonOnly).from(TABLE);

  return {
    async list(collection) {
      const { data, error } = await tbl()
        .select("doc_id,data,updated_at")
        .eq("app", appName).eq("collection", collection)
        .order("updated_at", { ascending: true });
      if (error) throw error;
      return (data || []).map((r) => ({ id: r.doc_id, ...r.data }));
    },

    async get(collection, id) {
      const { data, error } = await tbl()
        .select("data").eq("app", appName).eq("collection", collection).eq("doc_id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? { id, ...data.data } : null;
    },

    // Create or replace a doc. Omit id to create one. Returns the id.
    async set(collection, doc, id) {
      const docId = id || doc.id || uid();
      const { id: _drop, ...clean } = doc;
      const { error } = await tbl().upsert(
        { app: appName, collection, doc_id: docId, data: clean, visibility, updated_at: new Date().toISOString() },
        { onConflict: "app,collection,doc_id" }
      );
      if (error) throw error;
      return docId;
    },

    async remove(collection, id) {
      const { error } = await tbl().delete().eq("app", appName).eq("collection", collection).eq("doc_id", id);
      if (error) throw error;
    },

    subscribe(onChange) {
      const c = anonOnly ? sbAnon : sb;
      if (!c) return { unsubscribe() {} };
      const ch = c.channel("hub:" + appName)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE, filter: "app=eq." + appName }, () => onChange())
        .subscribe();
      ch.unsubscribe = () => c.removeChannel(ch);
      return ch;
    },

    async uploadFile(file, prefix = "") {
      const safe = (file.name || "file").replace(/[^\w.\-]+/g, "_");
      const path = `${appName}/${prefix}${Date.now()}-${safe}`;
      const { error } = await client(anonOnly).storage.from(BUCKET).upload(path, file);
      if (error) throw error;
      const { data } = client(anonOnly).storage.from(BUCKET).getPublicUrl(path);
      return { name: file.name, mime: file.type || "", size: file.size, url: data.publicUrl, path };
    },

    async removeFile(path) {
      if (path) await client(anonOnly).storage.from(BUCKET).remove([path]);
    },

    raw: () => client(anonOnly),
  };
}
