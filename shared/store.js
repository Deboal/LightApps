// store.js — the one helper every hub app uses.
//
// Every app shares ONE Supabase project and ONE generic table (app_data) plus ONE
// file bucket (hub-files). `store("my-app")` hands back an API automatically scoped
// to that app, so a brand-new app needs NO new tables, schema, or keys — just a name.
//
// Data shape in the table: (app, collection, doc_id, data jsonb).
// Think of `collection` as a table name and `doc_id` as a row id, both invented freely
// by the app at runtime.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const TABLE = "app_data";
const BUCKET = "hub-files";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Only build a client if config is real. With placeholders still in config.js,
// createClient would throw at import and blank every app, so we defer the error
// to call time with a clear message instead.
export const configured =
  /^https:\/\/.+\.supabase\.co/.test(SUPABASE_URL) && !!SUPABASE_KEY && !SUPABASE_KEY.startsWith("PASTE");
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
function client() {
  if (!sb) throw new Error("App Hub backend not configured — set SUPABASE_URL and SUPABASE_KEY in shared/config.js");
  return sb;
}

export function store(appName) {
  if (!appName) throw new Error("store(appName): appName is required");
  const tbl = () => client().from(TABLE);

  return {
    // List every doc in a collection, newest activity last. Returns [{id, ...fields}].
    async list(collection) {
      const { data, error } = await tbl()
        .select("doc_id,data,updated_at")
        .eq("app", appName).eq("collection", collection)
        .order("updated_at", { ascending: true });
      if (error) throw error;
      return (data || []).map((r) => ({ id: r.doc_id, ...r.data }));
    },

    // Get one doc by id, or null.
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
        { app: appName, collection, doc_id: docId, data: clean, updated_at: new Date().toISOString() },
        { onConflict: "app,collection,doc_id" }
      );
      if (error) throw error;
      return docId;
    },

    // Delete a doc.
    async remove(collection, id) {
      const { error } = await tbl().delete().eq("app", appName).eq("collection", collection).eq("doc_id", id);
      if (error) throw error;
    },

    // Live updates: calls onChange() whenever anything in this app changes.
    // Returns the channel; call sb.removeChannel(ch) to stop (or use the returned unsubscribe()).
    subscribe(onChange) {
      if (!sb) return { unsubscribe() {} }; // no-op until configured
      const ch = sb.channel("hub:" + appName)
        .on("postgres_changes",
            { event: "*", schema: "public", table: TABLE, filter: "app=eq." + appName },
            () => onChange())
        .subscribe();
      ch.unsubscribe = () => sb.removeChannel(ch);
      return ch;
    },

    // Upload a file to the shared bucket, namespaced under this app. Returns metadata
    // (store the returned object in a doc's `attachments` array, for example).
    async uploadFile(file, prefix = "") {
      const safe = (file.name || "file").replace(/[^\w.\-]+/g, "_");
      const path = `${appName}/${prefix}${Date.now()}-${safe}`;
      const { error } = await client().storage.from(BUCKET).upload(path, file);
      if (error) throw error;
      const { data } = client().storage.from(BUCKET).getPublicUrl(path);
      return { name: file.name, mime: file.type || "", size: file.size, url: data.publicUrl, path };
    },

    async removeFile(path) {
      if (path) await client().storage.from(BUCKET).remove([path]);
    },

    // Escape hatch: the raw Supabase client, if an app needs something custom.
    raw: sb,
  };
}
