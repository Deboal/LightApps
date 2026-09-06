// The wire between two phones: one Supabase realtime channel per room code.
//
// Nothing is stored server-side. The room is a broadcast channel named after the
// code, both players keep the game in memory, and the host is the tiebreaker for
// the one thing that must match — which 24 Pokémon are on the board. A player who
// refreshes rejoins the same channel and asks for that state again.
//
// `?link=local` swaps the channel for a BroadcastChannel between two tabs of this
// origin, which is how the whole flow can be played through on one device without
// a backend at all.

import { sb, configured } from "../../../shared/client.js";

export { configured };

export const local =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("link") === "local";

export const available = configured || local;

// No O/0 and no I/1/L: a code gets read aloud across a table or a phone call.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const cleanCode = (s) =>
  (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/[OQ]/g, "0").replace(/[IL]/g, "1").slice(0, 5);

/** How often each side says it is still here, and how long silence means gone. */
const PING_EVERY = 2000;
const PING_STALE = 9000;

function realtimeWire(code) {
  if (!sb) throw new Error("Backend not configured");
  const channel = sb.channel(`pgw-${code}`, { config: { broadcast: { self: false, ack: false } } });
  return {
    on: (event, fn) => channel.on("broadcast", { event }, ({ payload }) => fn(payload)),
    send: (event, payload) => channel.send({ type: "broadcast", event, payload }),
    subscribe: (fn) => channel.subscribe(fn),
    close: () => sb.removeChannel(channel),
  };
}

function loopbackWire(code) {
  const bus = new BroadcastChannel(`pgw-${code}`);
  const handlers = new Map();
  bus.onmessage = (e) => { const h = handlers.get(e.data.event); if (h) h(e.data.payload); };
  return {
    on: (event, fn) => handlers.set(event, fn),
    send: (event, payload) => bus.postMessage({ event, payload }),
    subscribe: (fn) => setTimeout(() => fn("SUBSCRIBED"), 0),
    close: () => bus.close(),
  };
}

/**
 * Join a room.
 *
 * `onMessage(event, payload)` gets every game message from the other player;
 * `onLink({state, peer})` reports the connection itself — "connecting" /
 * "linked" / "failed", and whether the other player has been heard from lately.
 *
 * Returns { send, close }. Messages are plain JSON objects; what they mean is
 * the game's business, not this module's.
 */
export function room({ code, seat, onMessage, onLink }) {
  const wire = local ? loopbackWire(code) : realtimeWire(code);
  let closed = false;
  let lastHeard = 0;
  let linkState = "connecting";
  let peerHere = false;

  const report = () => onLink && onLink({ state: linkState, peer: peerHere });

  const send = (event, payload = {}) => {
    if (closed) return;
    try { wire.send(event, { ...payload, seat }); } catch { /* a dropped message is a late message */ }
  };

  wire.on("ping", (p) => {
    if (!p || p.seat === seat) return;
    lastHeard = Date.now();
    if (!peerHere) { peerHere = true; report(); onMessage && onMessage("peer-joined", p); }
  });

  ["state", "ready", "ask", "answer", "guess", "result", "reveal", "rematch", "quit"].forEach((event) => {
    wire.on(event, (p) => {
      if (!p || p.seat === seat) return;
      lastHeard = Date.now();
      if (!peerHere) { peerHere = true; report(); }
      onMessage && onMessage(event, p);
    });
  });

  wire.subscribe((status) => {
    if (closed) return;
    if (status === "SUBSCRIBED") { linkState = "linked"; report(); send("ping"); }
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { linkState = "failed"; report(); }
  });

  const beat = setInterval(() => {
    send("ping");
    const gone = peerHere && Date.now() - lastHeard > PING_STALE;
    if (gone) { peerHere = false; report(); }
  }, PING_EVERY);

  // A room that never connects is a room nobody can play in; say so rather than
  // spinning forever on a "connecting" label.
  const giveUp = setTimeout(() => {
    if (linkState === "connecting") { linkState = "failed"; report(); }
  }, 12000);

  return {
    send,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(beat); clearTimeout(giveUp);
      try { wire.send("quit", { seat }); } catch {}
      wire.close();
    },
  };
}
