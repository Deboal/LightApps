// Pure excuse-generation logic. Kept separate from the UI so it can be
// exercised directly (see the audit in the repo's smoke test).

import { SLOTS, CIRCUMSTANCES, OPENERS, KICKERS, PROMISES, EXCUSES } from "./excuses.js";

export const pick = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;

// Slots naming a specific child. Two of these in one excuse must land on two
// different kids — "Ruby has practice and Ruby has dance" reads as a typo.
const KID_SLOTS = new Set(["kid", "daughter", "son"]);

// Resolve every {slot} once per excuse so names stay consistent inside one line.
export function fill(str, memo) {
  return str.replace(/\{(\w+)\}/g, (m, key) => {
    if (!SLOTS[key]) return m;
    if (!(key in memo)) {
      let opts = SLOTS[key];
      if (KID_SLOTS.has(key)) {
        if (!memo.$kids) memo.$kids = new Set();
        const free = opts.filter((o) => !memo.$kids.has(o));
        if (free.length) opts = free; // fall back to a repeat only if unavoidable
      }
      const chosen = pick(opts);
      if (KID_SLOTS.has(key)) memo.$kids.add(chosen);
      memo[key] = chosen;
    }
    return memo[key];
  });
}

// Openings that keep their capital even mid-sentence. Matched as PHRASES, not
// bare words: "Tractor Supply" must stay capitalized while a body starting
// "Tractor pull…" must not — checking only the first word confuses the two.
export const KEEP_CAPS = new Set(["I", "I'm", "I'd", "I'll", "I've", "Bible", "VBS", "AWANA", "AC", "FFA", "AWANA's"]);
for (const vals of Object.values(SLOTS)) {
  for (const v of vals) {
    if (/^[A-Z]/.test(v)) KEEP_CAPS.add(v);
  }
}

// Openers ending in a dash, comma or dangling conjunction run straight into the
// body, so the body's first word drops its capital — unless it's a proper noun.
const RUNS_ON = /(?:[—,;-]|\b(?:because|but|so|and|since|that|if|when|while|until))$/i;

function startsProper(body) {
  for (const phrase of KEEP_CAPS) {
    if (!body.startsWith(phrase)) continue;
    // Must end on a word boundary so "Ruby" doesn't match inside "Rubycon".
    const next = body.charAt(phrase.length);
    if (next === "" || /[^\w]/.test(next) || next === "'") return true;
  }
  return false;
}

// Join fragments into one blob, fixing only the opener→body seam. Deliberately
// not a global regex: mid-sentence commas ("Yes, I raised my hand") must survive.
export function stitch(opener, body, kicker, promise) {
  let b = body;
  if (RUNS_ON.test(opener.trim()) && !startsProper(b)) {
    b = b.charAt(0).toLowerCase() + b.slice(1);
  }
  return [opener, b, kicker, promise].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

const CRED_BANDS = { 1: [80, 97], 2: [55, 79], 3: [25, 54], 4: [2, 24] };

export function verdictFor(score) {
  if (score >= 80) return "Airtight. Nobody follows up.";
  if (score >= 55) return "He'll probably get away with it.";
  if (score >= 25) return "Lindsey would not back this up.";
  return "Nobody believes this. Everyone repeats it.";
}

const CORROBORATION = [
  "Lindsey confirms", "Lindsey confirms", "Lindsey has no comment",
  "Lindsey says that's not what happened", "Lindsey is the reason",
  "Do not ask Lindsey", "Lindsey texted about it first",
];

export function generate({ circumstance, temp, cats, avoid = new Set() }) {
  // Pool = matching temperature + selected categories. Widen gracefully rather
  // than ever handing back nothing.
  let pool = EXCUSES.filter((e) => e.t === temp && cats.includes(e.c));
  if (!pool.length) pool = EXCUSES.filter((e) => e.t === temp);
  if (!pool.length) pool = EXCUSES;

  const fresh = pool.filter((e) => !avoid.has(e.x));
  const base = pick(fresh.length ? fresh : pool);

  const memo = {};
  const circ = circumstance === "random" ? pick(CIRCUMSTANCES).key : circumstance;
  const opener = fill(pick(OPENERS[circ] || OPENERS.work), memo);
  const body = fill(base.x, memo);
  const kicker = chance(temp >= 3 ? 0.8 : 0.5) ? fill(pick(KICKERS[temp]), memo) : "";
  const promise = chance(0.3) ? pick(PROMISES) : "";

  const [lo, hi] = CRED_BANDS[temp];

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: stitch(opener, body, kicker, promise),
    raw: base.x,
    temp,
    cat: base.c,
    circ,
    score: lo + Math.floor(Math.random() * (hi - lo + 1)),
    corroboration: pick(CORROBORATION),
  };
}
