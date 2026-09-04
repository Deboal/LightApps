// states.js — named save states, local-first with an optional cloud mirror.
//
// The same rule as the cartridge save: this browser's IndexedDB is what the
// emulator reads and writes, so states work signed out and offline. An account
// adds a durable copy and makes them visible on the other device.
//
// A state is roughly 600 KB and is deliberately disposable — it encodes the
// emulator's internal layout, so every core change invalidates it. The `.sav`
// remains the thing that must never be lost; these are a convenience.

import * as cloud from "./cloud.js";

const INDEX = "states:index";

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The store needs a handful of IndexedDB primitives. They are passed in rather
 * than duplicated here so there is exactly one place that opens the database.
 */
export function makeStates({ dbGet, dbPut }) {
  const readIndex = async () => (await dbGet(INDEX)) || [];
  const writeIndex = (entries) => dbPut(INDEX, entries);

  return {
    /** Every state this browser knows about, merged with the account's,
     *  newest first. A state present in both is counted once. */
    async list(user) {
      const local = await readIndex();
      if (!user || !cloud.configured) return local;
      let remote = [];
      try {
        remote = await cloud.listStates();
      } catch {
        // Offline or misconfigured: local is still a complete answer.
        return local;
      }
      const merged = new Map();
      for (const entry of remote) merged.set(entry.id, { ...entry, remote: true });
      for (const entry of local) {
        merged.set(entry.id, { ...merged.get(entry.id), ...entry, local: true });
      }
      return [...merged.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    async save(user, { key, romSha, gameCode, name, device, coreVersion, state, thumbnail }) {
      const id = uid();
      const record = {
        key,
        romSha,
        gameCode,
        name: name || new Date().toLocaleString(),
        device,
        coreVersion,
        createdAt: new Date().toISOString(),
        bytes: state.length,
      };

      await dbPut(`state:${id}`, state);
      if (thumbnail) await dbPut(`shot:${id}`, thumbnail);
      await writeIndex([{ id, ...record, local: true }, ...(await readIndex())]);

      if (user && cloud.configured) {
        try {
          await cloud.putState(id, record, state, thumbnail);
        } catch (e) {
          // The local copy already landed; surfacing the reason is the
          // caller's job.
          return { id, ...record, local: true, error: e.message || String(e) };
        }
      }
      return { id, ...record, local: true, remote: !!user };
    },

    /** The state's bytes, from this browser if it has them and the account
     *  if it does not. */
    async load(entry) {
      const local = await dbGet(`state:${entry.id}`);
      if (local) return local;
      if (!entry.statePath) throw new Error("That state is not on this device");
      return cloud.getBlob(entry.statePath);
    },

    /** A blob URL for the thumbnail, or null. The caller revokes it. */
    async thumbnail(entry) {
      let bytes = await dbGet(`shot:${entry.id}`);
      if (!bytes && entry.shotPath) {
        try {
          bytes = await cloud.getBlob(entry.shotPath);
        } catch {
          return null;
        }
      }
      if (!bytes) return null;
      return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    },

    async remove(user, entry) {
      await writeIndex((await readIndex()).filter((e) => e.id !== entry.id));
      await dbPut(`state:${entry.id}`, null);
      await dbPut(`shot:${entry.id}`, null);
      if (user && cloud.configured && entry.statePath) {
        try {
          await cloud.removeState(entry.id, entry);
        } catch {
          // A leftover blob costs storage, never data.
        }
      }
    },

    async rename(user, entry, name) {
      const entries = await readIndex();
      await writeIndex(entries.map((e) => (e.id === entry.id ? { ...e, name } : e)));
      if (user && cloud.configured && entry.statePath) {
        // Metadata only: re-uploading 600 KB to change a string would be
        // absurd, and would risk losing the screenshot along the way.
        const { id, local, remote, ...record } = entry;
        try {
          await cloud.renameState(id, record, name);
        } catch {
          // Local rename stands; the next save will carry it.
        }
      }
    },
  };
}
