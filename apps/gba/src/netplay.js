// netplay.js — two people, one cable.
//
// The design decision that shapes everything here: the network carries button
// presses and nothing else. Each participant emulates *both* machines and
// feeds each one its own player's buttons, so the cable traffic is generated
// locally, by emulated hardware that both sides compute identically. Sending
// link bytes instead would put a 16 MHz serial protocol on a 100 ms wire.
//
// That only works because the core is deterministic, and it costs one thing:
// a frame cannot be simulated until *both* players' inputs for it are known.
// So inputs are scheduled a fixed number of frames ahead. You press A now, it
// lands on frame N + DELAY, and the packet carrying it has that long to arrive.
// If it does not, both sides stall rather than guess — a guess would make the
// two participants compute different sessions, which is worse than a stutter.
//
// Nothing here touches the emulator. It hands the session a pair of inputs per
// frame and reports what it knows; the caller runs the frames.

import { sb, configured } from "../../../shared/client.js";

export const available = configured || loopback;
export { configured };

/** Two tabs of this origin can be linked without a backend at all, which is
 *  how the lockstep is tested and how anyone can check the plumbing before
 *  asking a friend to sit down for it: add `?link=local` to the URL. */
export const loopback =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("link") === "local";

/** How far ahead inputs are scheduled, in frames. Eight frames is ~134 ms:
 *  enough for a round trip over a websocket most of the time, short enough
 *  that the delay reads as a slightly heavy controller rather than as lag. */
export const DELAY = 8;

/** Inputs are batched rather than sent per frame — sixty messages a second
 *  per player is a lot to ask of a shared realtime service. Each packet also
 *  repeats the frames around it, so a dropped one is covered by its
 *  neighbours instead of stalling the session. */
const SEND_EVERY = 4;
const REDUNDANCY = 16;

/** How far ahead of the partner this side may get before it idles a frame.
 *
 *  Lockstep self-paces without this -- the leader simply stalls when it runs
 *  out of the partner's input -- but it self-paces by spending the whole delay
 *  buffer on clock skew, leaving nothing to absorb a late packet. Giving up a
 *  frame here and there keeps the two level and the buffer available for what
 *  it is for.
 *
 *  It has to sit above SEND_EVERY. The partner's reported frame is only as
 *  fresh as their last packet, so a limit tighter than the sending interval
 *  stops this side against a number that is merely stale rather than behind. */
const AHEAD_LIMIT = SEND_EVERY + 2;

/** How often the two sides compare notes on where they think they are. */
const HASH_EVERY = 120;

/** Save data is chunked to stay well inside a realtime message. */
const CHUNK = 24 * 1024;

// Unambiguous alphabet: no O/0, no I/1/L. A code gets read aloud.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

const encode = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const decode = (text) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * The wire, behind one small interface, so the session logic does not know or
 * care what carries it.
 *
 * Realtime is the real one. The loopback is a BroadcastChannel between two
 * tabs of this origin: same protocol, same lockstep, no network — which makes
 * the whole thing testable, and lets anyone check the plumbing works before
 * asking a friend to sit down for it.
 */
function realtimeTransport(code) {
  if (!sb) throw new Error("Backend not configured");
  const channel = sb.channel(`gba-link-${code}`, {
    config: { broadcast: { self: false, ack: false } },
  });
  return {
    on: (event, fn) => channel.on("broadcast", { event }, ({ payload }) => fn(payload)),
    send: (event, payload) => channel.send({ type: "broadcast", event, payload }),
    subscribe: (fn) => channel.subscribe(fn),
    close: () => sb.removeChannel(channel),
  };
}

function loopbackTransport(code) {
  const bus = new BroadcastChannel(`gba-link-${code}`);
  const handlers = new Map();
  // A BroadcastChannel never echoes to the sender, which is exactly the
  // `self: false` the realtime channel is configured with.
  bus.onmessage = (event) => {
    const handler = handlers.get(event.data.event);
    if (handler) handler(event.data.payload);
  };
  return {
    on: (event, fn) => handlers.set(event, fn),
    send: (event, payload) => bus.postMessage({ event, payload }),
    subscribe: (fn) => setTimeout(() => fn("SUBSCRIBED"), 0),
    close: () => bus.close(),
  };
}

/**
 * A link session.
 *
 * `onChange` is called whenever the phase or a displayed field moves, so the
 * UI can re-render; `onEnd(reason)` when the session stops for good.
 *
 * Phases, in order: connecting, waiting (host has the room to itself),
 * greeting, saves (trading cartridge saves), live, over.
 */
export function session({ code, host, romSha, save, local = false, onChange, onEnd }) {
  const wire = local ? loopbackTransport(code) : realtimeTransport(code);

  const seat = host ? 0 : 1;
  const state = {
    seat,
    code,
    phase: "connecting",
    error: "",
    frame: 0,
    stalls: 0,
    /** Frames the partner is ahead of the last input we hold: how much slack
     *  is left before a stall. Shown as the connection's health. */
    lead: 0,
    partnerSave: null,
    ready: false,
  };

  // Inputs, indexed by frame. Sparse arrays are fine at these sizes -- a long
  // session is tens of thousands of frames, a few hundred KB of small numbers.
  const mine = [];
  const theirs = [];
  const hashes = new Map();
  let lastSent = -1;
  let theirFrame = 0;
  let stopped = false;
  let chunks = [];
  let expected = 0;

  const change = () => onChange && onChange({ ...state });
  const fail = (message) => {
    if (stopped) return;
    state.error = message;
    stop("error");
  };

  const send = (event, payload) => wire.send(event, payload);

  // -- handshake -----------------------------------------------------------

  const greet = () => {
    // The host has nobody to greet yet, and telling them it is "saying hello"
    // when there is no one there reads as a hang. It is waiting.
    state.phase = host ? "waiting" : "greeting";
    change();
    send("hello", { seat, romSha, saveLen: save ? save.length : 0 });
  };

  const sendSave = () => {
    state.phase = "saves";
    change();
    const data = save || new Uint8Array(0);
    const text = encode(data);
    const total = Math.ceil(text.length / CHUNK) || 1;
    for (let i = 0; i < total; i++) {
      send("save", { seat, i, total, body: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
  };

  const bothReady = () => {
    if (state.phase === "live" || !state.ready || state.partnerSave === null) return;
    state.phase = "live";
    change();
  };

  wire.on("hello", (payload) => {
    if (payload.seat === seat) return;
    if (payload.romSha !== romSha) {
      return fail("You are not holding the same cartridge. Both sides need the same ROM.");
    }
    // Answer exactly once. Whoever hears the other first replies, so a joiner
    // that arrives before the host has subscribed is still greeted -- but an
    // unguarded reply is two peers greeting each other forever.
    if (!state.ready) {
      state.ready = true;
      send("hello", { seat, romSha, saveLen: save ? save.length : 0 });
      sendSave();
    }
    bothReady();
  });

  wire.on("save", (payload) => {
    if (payload.seat === seat) return;
    if (state.partnerSave !== null) return;
    if (chunks.length !== payload.total) {
      chunks = new Array(payload.total).fill(null);
      expected = payload.total;
    }
    chunks[payload.i] = payload.body;
    if (chunks.filter((c) => c !== null).length !== expected) return;
    try {
      state.partnerSave = decode(chunks.join(""));
    } catch (e) {
      return fail("The partner's save arrived damaged: " + (e.message || e));
    }
    change();
    bothReady();
  });

  // -- the session ---------------------------------------------------------

  wire.on("keys", (payload) => {
    if (payload.s === seat) return;
    theirFrame = Math.max(theirFrame, payload.n ?? 0);
    for (let i = 0; i < payload.k.length; i++) {
      const frame = payload.f + i;
      if (theirs[frame] === undefined) theirs[frame] = payload.k[i];
    }
  });

  wire.on("hash", (payload) => {
    if (payload.s === seat) return;
    const ours = hashes.get(payload.f);
    if (ours === undefined) {
      hashes.set(payload.f, payload.h);
      return;
    }
    if (ours !== payload.h) {
      fail(
        `The two sides stopped agreeing at frame ${payload.f}. Stopping here rather ` +
          `than letting one of you write a save the other never saw.`
      );
    }
    hashes.delete(payload.f);
  });

  wire.on("bye", () => stop("Your partner left."));

  wire.subscribe((status) => {
    if (stopped) return;
    if (status === "SUBSCRIBED") {
      greet();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      fail("Could not reach the realtime service.");
    }
  });

  function stop(reason) {
    if (stopped) return;
    stopped = true;
    state.phase = "over";
    change();
    try {
      send("bye", { seat });
      wire.close();
    } catch {
      // Leaving is best-effort; the room expires on its own.
    }
    onEnd && onEnd(typeof reason === "string" ? reason : "");
  }

  return {
    get state() {
      return { ...state };
    },
    /** The partner's cartridge save, once it has arrived. */
    get partnerSave() {
      return state.partnerSave;
    },

    /**
     * Offer this frame's local input and ask whether the frame can run.
     *
     * Returns the pair of inputs to simulate, or null if the partner's input
     * for this frame has not arrived. Null means wait: the alternative is to
     * invent an input, and an invented input is a session where the two sides
     * are playing different games without knowing it.
     */
    advance(localKeys) {
      if (state.phase !== "live") return null;
      const frame = state.frame;

      // Schedule the local input DELAY frames out, and fill the opening
      // frames with nothing so both sides have somewhere to start.
      if (mine[frame + DELAY] === undefined) mine[frame + DELAY] = localKeys;
      for (let f = 0; f < DELAY; f++) {
        if (mine[f] === undefined) mine[f] = 0;
        if (theirs[f] === undefined) theirs[f] = 0;
      }

      // Batched, and it has to be an interval rather than "have I sent since
      // the last frame" -- the latter is true every frame, which quietly turns
      // the batch into sixty messages a second.
      // Idling to stay level is not a stall: nothing is missing, this side is
      // just early. Counting it as one would make a healthy session look sick.
      const early = frame - theirFrame > AHEAD_LIMIT;
      const missing = theirs[frame] === undefined;

      // Send before deciding to wait, and send whenever waiting -- a side that
      // stops advancing stops meeting the every-fourth-frame condition, stops
      // sending, and so never tells the partner where it is. Both sides then
      // wait for a number neither will ever send. That deadlock is most of a
      // frame rate.
      if (frame - lastSent >= SEND_EVERY || ((early || missing) && lastSent !== frame)) {
        const from = Math.max(0, frame + DELAY - REDUNDANCY + 1);
        const window = [];
        for (let f = from; f <= frame + DELAY; f++) window.push(mine[f] ?? 0);
        send("keys", { s: seat, f: from, k: window, n: frame });
        lastSent = frame;
      }

      if (early) return null;
      if (missing) {
        state.stalls++;
        state.lead = 0;
        return null;
      }
      // How much of their input is still in hand. This is the one number that
      // predicts a stutter before it happens, so it is the one worth showing.
      let ahead = 0;
      while (theirs[frame + ahead] !== undefined) ahead++;
      state.lead = ahead;

      if (frame % HASH_EVERY === 0) state.pendingHash = frame;
      state.frame = frame + 1;
      return seat === 0
        ? [mine[frame] ?? 0, theirs[frame]]
        : [theirs[frame], mine[frame] ?? 0];
    },

    /** Whether this frame wants a fingerprint.
     *
     *  Asking first matters: taking one means serializing both machines --
     *  about a megabyte -- and doing that every frame instead of every
     *  hundred-and-twentieth costs nine tenths of the frame rate. */
    needsHash() {
      return state.pendingHash !== undefined;
    },

    /** Called after a frame runs, with the session fingerprint, on the frames
     *  that asked for one. */
    report(hash) {
      const frame = state.pendingHash;
      if (frame === undefined) return;
      state.pendingHash = undefined;
      const theirsAt = hashes.get(frame);
      if (theirsAt === undefined) {
        hashes.set(frame, hash);
      } else if (theirsAt !== hash) {
        fail(
          `The two sides stopped agreeing at frame ${frame}. Stopping here rather ` +
            `than letting one of you write a save the other never saw.`
        );
      } else {
        hashes.delete(frame);
      }
      send("hash", { s: seat, f: frame, h: hash });
    },

    leave: () => stop(""),
  };
}
