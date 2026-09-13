import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";

// Only Hope — the game from the ad, as the ad.
//
// The ad shows one thing: a squad running a highway, gates that multiply it,
// a horde that never thins out, and a boss the size of an apartment block that
// actually falls over. The download is a merge-three with an energy bar. This
// is the ad, playable: the gates do exactly what they print on them, the crowd
// really does reach six figures, and nothing here asks for money, a login, or
// a wait timer, because there is nothing here to sell.
//
// Self-contained by design (no shared/ imports, no assets) so `make-offline.sh`
// can hand you the whole thing as one file that runs off a plane.

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
// Figure height against road width is the whole look. The ad frames a soldier
// at roughly a ninth of the road's width and a boss at eight or ten soldiers;
// get that ratio wrong and the same code reads as a distant traffic camera.
const CFG = {
  roadW: 380,        // world units across the driving surface
  camD: 520,         // projection constant: bigger = flatter, less fisheye
  squadZ: 187,       // how far ahead of the camera the squad stands
  runSpeed: 176,     // world units per second while advancing
  soldierH: 40,
  zombieH: 34,
  spacing: 14,       // lateral gap between soldiers in the formation
  rowGap: 12,        // depth between ranks
  bulletSpeed: 1050,
  fireBase: 4.2,     // volleys per second at rate multiplier 1
  steerSpeed: 280,   // world units per second of lateral movement
  maxDrawSoldiers: 96,
  maxEnemies: 260,
  maxBullets: 150,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Deterministic per-index jitter, so a soldier keeps his own wobble frame to
// frame instead of vibrating (which is what Math.random() in a draw call does).
function hash01(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Big numbers are the entire fantasy, so they have to stay readable at a glance.
function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + "K";
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + "M";
  if (n < 1e12) return (n / 1e9).toFixed(n < 1e10 ? 1 : 0) + "B";
  return (n / 1e12).toFixed(1) + "T";
}

// Round a gate's payout to something a human reads in a quarter second.
function niceRound(v) {
  if (v < 10) return Math.max(2, Math.round(v));
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const step = v / mag < 3 ? mag / 4 : mag / 2;
  return Math.max(5, Math.round(v / step) * step);
}

// ---------------------------------------------------------------------------
// Sound: synthesised on the fly, because a 40-line oscillator beats shipping
// audio files for an app that is supposed to survive as one offline HTML file.
// ---------------------------------------------------------------------------
const Audio_ = {
  ctx: null,
  on: true,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) this.ctx = new AC();
  },
  blip(freq, dur, type = "square", gain = 0.04, slide = 0) {
    if (!this.on || !this.ctx || this.ctx.state === "suspended") return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  shot() { this.blip(rnd(720, 900), 0.045, "square", 0.016, -400); },
  hit() { this.blip(rnd(140, 200), 0.06, "sawtooth", 0.02, -90); },
  gate(good) { good ? this.blip(560, 0.13, "triangle", 0.06, 420) : this.blip(300, 0.18, "sawtooth", 0.05, -170); },
  loss() { this.blip(180, 0.12, "sawtooth", 0.045, -120); },
  bossHit() { this.blip(90, 0.09, "sawtooth", 0.03, -40); },
  bossDie() { this.blip(140, 0.9, "sawtooth", 0.09, -120); },
  clear() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.16, "triangle", 0.05), i * 80)); },
};

// ---------------------------------------------------------------------------
// Bosses. Three silhouettes, cycled, each one absurdly out of scale with the
// squad — which is the single image the ad is selling.
// ---------------------------------------------------------------------------
const BOSSES = [
  { key: "matron", name: "THE MATRON", h: 330, w: 200, tint: "#f06a96" },
  { key: "ripper", name: "THE RIPPER", h: 300, w: 230, tint: "#c43b2a" },
  { key: "colossus", name: "THE COLOSSUS", h: 390, w: 190, tint: "#46525e" },
];

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------

// One gate row. Every row offers at least one option that grows the squad, so a
// gate is a decision under time pressure rather than a tax you cannot dodge.
function makeGateRow(zAbs, count, stage) {
  const cells = [];
  const nCells = Math.random() < 0.22 ? 3 : 2;
  const badChance = clamp(0.25 + stage * 0.03, 0.25, 0.55);

  // Multipliers are the hook, so the first minute is nothing but multipliers.
  // Past that they thin out in favour of percentage-sized adds, which is the
  // difference between a number that climbs and a number that stops meaning
  // anything: unchecked ×2s put you in the billions inside two minutes, and a
  // billion soldiers reads exactly like a thousand of them.
  const goodOp = () => {
    const r = Math.random();
    if (count < 80) {
      if (r < 0.55) return { op: "x", v: pick([2, 2, 3]) };
      return { op: "+", v: niceRound(Math.max(10, count * rnd(0.5, 1.1))) };
    }
    if (r < 0.12) return { op: "x", v: 1.5 };
    if (r < 0.16) return { op: "x", v: 2 };
    return { op: "+", v: niceRound(count * rnd(0.12, 0.3)) };
  };
  const badOp = () => (Math.random() < 0.5
    ? { op: "/", v: pick([2, 2, 3]) }
    : { op: "-", v: niceRound(Math.max(8, count * rnd(0.25, 0.5))) });

  for (let i = 0; i < nCells; i++) cells.push(Math.random() < badChance ? badOp() : goodOp());
  // Guarantee an exit. Without this a row can read as "pick your punishment",
  // which is the exact feeling the real game gives you and this one does not.
  if (!cells.some((c) => c.op === "x" || c.op === "+")) cells[(Math.random() * nCells) | 0] = goodOp();

  const w = CFG.roadW / nCells;
  cells.forEach((c, i) => {
    c.x0 = -CFG.roadW / 2 + i * w;
    c.x1 = c.x0 + w;
    c.good = c.op === "x" || c.op === "+";
  });
  return { zAbs, cells, used: false, hitAt: -1 };
}

// A wave is a block of runners in loose ranks, spread wide enough that steering
// matters but never so wide that the road is a wall.
function makeWave(g, zAbs, n, stage) {
  const spread = rnd(0.72, 1) * CFG.roadW;
  const cx = rnd(-1, 1) * (CFG.roadW / 2 - spread / 2);
  const hp = Math.max(4 + stage * 3.2, baselineDps(g) * 0.05);
  for (let i = 0; i < n; i++) {
    if (g.enemies.length >= CFG.maxEnemies) break;
    g.enemies.push({
      x: clamp(cx + rnd(-0.5, 0.5) * spread, -CFG.roadW / 2 + 8, CFG.roadW / 2 - 8),
      zAbs: zAbs + rnd(0, 1) * 110,
      hp,
      speed: rnd(24, 42) + stage * 1.6,
      power: 1 + Math.floor(stage * 0.7),   // soldiers taken on contact
      seed: Math.random() * 1000,
      dead: 0,
    });
  }
}

function buildStage(g, stage) {
  const start = g.dist;
  const len = 2700 + stage * 240;
  g.stageStart = start;
  g.stageEnd = start + len;
  g.gates.length = 0;

  // Slots now, panels later. A "+120" written at stage start is an insult by
  // the time a stage-long run of multipliers has quadrupled the squad, so each
  // row is generated as it comes into view and priced against the crowd that
  // is about to walk through it.
  g.gateSlots = [];
  for (let z = start + 520; z < start + len - 760; z += rnd(500, 640)) g.gateSlots.push(z);
  g.waves = [];
  for (let z = start + 1150; z < start + len - 500; z += rnd(380, 560)) {
    g.waves.push({ zAbs: z, n: Math.round(rnd(14, 20) + stage * 4), fired: false });
  }

  const spec = BOSSES[(stage - 1) % BOSSES.length];
  // Boss health tracks what the squad can actually put out, so the kill always
  // takes a handful of seconds: a 200-strong squad and a 200,000-strong squad
  // both get the same fight, and the difference between them shows up where it
  // should — in surviving the horde that comes before it.
  const dps = baselineDps(g);
  const target = clamp(4.5 + stage * 0.35, 4.5, 8);
  g.boss = {
    ...spec,
    zAbs: start + len + 240,
    x: 0,
    hp: Math.max(360 * stage, dps * target),
    maxHp: Math.max(360 * stage, dps * target),
    engaged: false,
    dying: 0,
  };
  g.banner = { text: `STAGE ${stage}`, sub: spec.name, t: 2.6 };
}

function squadDps(g) {
  return g.count * g.dmgMul * CFG.fireBase * g.rateMul;
}

// Everything the horde and the bosses are sized against uses this — the squad's
// output BEFORE upgrades. Scaling them against real output would cancel the
// upgrades out exactly: a boss worth eight seconds of fire stays worth eight
// seconds no matter how much damage you added, and "+35% damage" would be a
// card that does nothing. Sized against the raw headcount instead, crowd growth
// stays cosmetic (which is the fantasy) and every upgrade shortens every fight
// (which is the game).
function baselineDps(g) { return g.count * CFG.fireBase; }

function newGame(best) {
  const g = {
    phase: "playing",
    stage: 1,
    count: 16,
    peak: 16,
    kills: 0,
    x: 0, targetX: 0,
    dist: 0,
    time: 0,
    fireT: 0,
    dmgMul: 1, rateMul: 1, armor: 1, volley: 1, medic: 0,
    enemies: [], bullets: [], gates: [], gateSlots: [], waves: [], parts: [], texts: [],
    boss: null, banner: null, shake: 0, flash: 0,
    stageStart: 0, stageEnd: 0,
    best: best || { stage: 0, peak: 0 },
    upgrades: [],
  };
  buildStage(g, 1);
  return g;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// How wide the crowd stands. Also how wide a target it is, which is the honest
// cost of a huge squad and the reason steering never stops mattering.
function formationCols(n) { return clamp(Math.ceil(Math.sqrt(Math.min(n, CFG.maxDrawSoldiers) * 1.1)), 1, 9); }
function formationHalfWidth(n) { return (formationCols(n) * CFG.spacing) / 2 + 8; }

function addText(g, x, zAbs, text, color, size) {
  if (g.texts.length > 26) g.texts.shift();
  g.texts.push({ x, zAbs, text, color, size: size || 1, t: 0, life: 1.1 });
}

function burst(g, x, zAbs, color, n, power) {
  for (let i = 0; i < n; i++) {
    if (g.parts.length > 260) break;
    g.parts.push({
      x, zAbs, y: rnd(2, 14),
      vx: rnd(-1, 1) * 42 * (power || 1),
      vz: rnd(-1, 1) * 42 * (power || 1),
      vy: rnd(20, 70) * (power || 1),
      color, t: 0, life: rnd(0.4, 0.9), size: rnd(1.4, 3.2),
    });
  }
}

function applyGate(g, cell) {
  const before = g.count;
  if (cell.op === "x") g.count = Math.floor(g.count * cell.v);
  else if (cell.op === "+") g.count = g.count + cell.v;
  else if (cell.op === "-") g.count = g.count - cell.v;
  else if (cell.op === "/") g.count = Math.floor(g.count / cell.v);
  g.count = Math.max(0, Math.floor(g.count));
  const delta = g.count - before;
  addText(g, g.x, g.dist + CFG.squadZ + 40,
    (delta >= 0 ? "+" : "-") + fmt(Math.abs(delta)),
    delta >= 0 ? "#6ef2a8" : "#ff6b60", 1.5);
  Audio_.gate(delta >= 0);
  if (delta < 0) { g.flash = 0.35; g.shake = Math.min(1, g.shake + 0.35); }
  g.peak = Math.max(g.peak, g.count);
}

function fireVolley(g) {
  const total = g.count * g.dmgMul;                 // damage this volley delivers
  const nb = clamp(Math.round(3 + g.volley * 2 + Math.log10(Math.max(1, g.count)) * 1.6), 3, 14);
  const hw = formationHalfWidth(g.count);
  const each = total / nb;
  for (let i = 0; i < nb; i++) {
    if (g.bullets.length >= CFG.maxBullets) break;
    g.bullets.push({
      x: g.x + (nb === 1 ? 0 : lerp(-hw * 0.8, hw * 0.8, i / (nb - 1))) + rnd(-2, 2),
      zAbs: g.dist + CFG.squadZ + 26,
      dmg: each,
    });
  }
  Audio_.shot();
}

function step(g, dt) {
  g.time += dt;
  g.shake = Math.max(0, g.shake - dt * 2.2);
  g.flash = Math.max(0, g.flash - dt * 2.5);
  if (g.banner) { g.banner.t -= dt; if (g.banner.t <= 0) g.banner = null; }

  // Steering, with a speed limit so a huge crowd swings like a crowd.
  const maxX = CFG.roadW / 2 - formationHalfWidth(g.count) - 20;
  const want = clamp(g.targetX, -maxX, maxX);
  const d = want - g.x;
  const move = CFG.steerSpeed * dt;
  g.x += Math.abs(d) <= move ? d : Math.sign(d) * move;

  const boss = g.boss;
  const bossRel = boss ? boss.zAbs - g.dist : Infinity;
  if (boss && !boss.dying && bossRel <= 330) boss.engaged = true;
  const advancing = !(boss && boss.engaged);
  if (advancing) g.dist += CFG.runSpeed * dt;

  const squadAbs = g.dist + CFG.squadZ;
  const halfW = formationHalfWidth(g.count);

  // Gates ------------------------------------------------------------------
  for (const row of g.gates) {
    if (row.used || squadAbs < row.zAbs) continue;
    row.used = true;
    row.hitAt = g.time;
    const cell = row.cells.find((c) => g.x >= c.x0 && g.x < c.x1) || row.cells[0];
    cell.taken = true;
    applyGate(g, cell);
  }

  // Gate rows materialise a little beyond the far haze.
  for (let i = g.gateSlots.length - 1; i >= 0; i--) {
    if (g.gateSlots[i] - g.dist < 1500) {
      g.gates.push(makeGateRow(g.gateSlots[i], g.count, g.stage));
      g.gateSlots.splice(i, 1);
    }
  }

  // Waves ------------------------------------------------------------------
  for (const w of g.waves) {
    if (!w.fired && w.zAbs - g.dist < 1500) { w.fired = true; makeWave(g, w.zAbs, w.n, g.stage); }
  }

  // Firing -----------------------------------------------------------------
  if (g.count > 0) {
    g.fireT += dt;
    const interval = 1 / (CFG.fireBase * g.rateMul);
    let guard = 0;
    while (g.fireT >= interval && guard++ < 3) { g.fireT -= interval; fireVolley(g); }
  }

  // Bullets, bucketed by lane so hit tests stay cheap when the screen is full.
  const NB = 14, bucketW = CFG.roadW / NB;
  const buckets = Array.from({ length: NB }, () => []);
  for (const e of g.enemies) {
    if (e.dead) continue;
    const bi = clamp(((e.x + CFG.roadW / 2) / bucketW) | 0, 0, NB - 1);
    buckets[bi].push(e);
  }

  for (let i = g.bullets.length - 1; i >= 0; i--) {
    const b = g.bullets[i];
    const prev = b.zAbs;
    b.zAbs += CFG.bulletSpeed * dt;

    let consumed = false;
    const bi = clamp(((b.x + CFG.roadW / 2) / bucketW) | 0, 0, NB - 1);
    for (let k = Math.max(0, bi - 1); k <= Math.min(NB - 1, bi + 1) && !consumed; k++) {
      for (const e of buckets[k]) {
        if (e.dead) continue;
        if (e.zAbs > prev && e.zAbs <= b.zAbs && Math.abs(e.x - b.x) < 16) {
          e.hp -= b.dmg;
          if (e.hp <= 0) {
            e.dead = 1; g.kills++;
            burst(g, e.x, e.zAbs, "#7d8f6a", 4, 1);
            Audio_.hit();
          } else burst(g, e.x, e.zAbs, "#c8b28a", 1, 0.5);
          consumed = true;
          break;
        }
      }
    }
    if (!consumed && boss && !boss.dying && boss.engaged &&
        boss.zAbs > prev && boss.zAbs <= b.zAbs && Math.abs(boss.x - b.x) < boss.w * 0.55) {
      boss.hp -= b.dmg;
      burst(g, b.x, boss.zAbs, "#ffd27a", 2, 0.8);
      if (Math.random() < 0.08) Audio_.bossHit();
      consumed = true;
      if (boss.hp <= 0 && !boss.dying) {
        boss.hp = 0; boss.dying = 1.8;
        g.shake = 1; Audio_.bossDie();
        burst(g, boss.x, boss.zAbs, boss.tint, 90, 2.4);
      }
    }
    if (consumed || b.zAbs - g.dist > 2200) g.bullets.splice(i, 1);
  }

  // Enemies ----------------------------------------------------------------
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];
    if (e.dead) { g.enemies.splice(i, 1); continue; }
    e.zAbs -= e.speed * dt;
    if (e.zAbs <= squadAbs) {
      if (Math.abs(e.x - g.x) < halfW + 7) {
        const loss = Math.max(1, Math.round(Math.max(e.power, g.count * 0.015) * g.armor));
        g.count = Math.max(0, g.count - loss);
        g.shake = Math.min(1, g.shake + 0.14);
        burst(g, e.x, squadAbs, "#ff7a5c", 5, 1.2);
        if (Math.random() < 0.25) Audio_.loss();
      }
      g.enemies.splice(i, 1);
      continue;
    }
    if (e.zAbs - g.dist < -80) g.enemies.splice(i, 1);
  }

  // Boss -------------------------------------------------------------------
  if (boss) {
    if (boss.dying > 0) {
      boss.dying -= dt;
      if (boss.dying <= 0) {
        g.boss = null;
        clearStage(g);
        return;
      }
    } else if (boss.engaged) {
      boss.zAbs -= (8 + g.stage * 0.4) * dt;
      boss.x += Math.sin(g.time * 0.8) * 26 * dt;
      boss.x = clamp(boss.x, -CFG.roadW / 2 + boss.w / 2, CFG.roadW / 2 - boss.w / 2);
      // Bosses call for help. It keeps the fight from being a static DPS test
      // and it puts bodies on the road, which is what the ad is full of.
      if ((boss.stompSpawn = (boss.stompSpawn || 0) - dt) <= 0) {
        boss.stompSpawn = clamp(2.6 - g.stage * 0.08, 1.1, 2.6);
        makeWave(g, boss.zAbs - 120, 5 + Math.round(g.stage * 1.3), g.stage);
      }
      if (boss.zAbs <= squadAbs + 55) {
        const loss = Math.max(1, Math.round(g.count * 0.3 * g.armor));
        g.count = Math.max(0, g.count - loss);
        addText(g, g.x, squadAbs + 40, "-" + fmt(loss), "#ff6b60", 1.6);
        g.shake = 1; g.flash = 0.5; Audio_.loss();
        boss.zAbs = g.dist + 330;   // stomps, then wades back in
      }
    }
  }

  // Particles and floating text -------------------------------------------
  for (let i = g.parts.length - 1; i >= 0; i--) {
    const p = g.parts[i];
    p.t += dt;
    if (p.t >= p.life) { g.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.zAbs += p.vz * dt;
    p.y += p.vy * dt; p.vy -= 190 * dt;
    if (p.y < 0) { p.y = 0; p.vy = 0; }
  }
  for (let i = g.texts.length - 1; i >= 0; i--) {
    const t = g.texts[i];
    t.t += dt;
    if (t.t >= t.life) g.texts.splice(i, 1);
  }

  g.peak = Math.max(g.peak, g.count);
  if (g.count <= 0) {
    g.phase = "dead";
    g.best = {
      stage: Math.max(g.best.stage, g.stage),
      peak: Math.max(g.best.peak, g.peak),
    };
  }
  // Reaching the end of the road without a boss left standing can only happen
  // if the boss was killed early; treat it as a clear rather than running on
  // into empty world.
  if (!g.boss && g.dist > g.stageEnd + 400) clearStage(g);
}

const UPGRADES = [
  { key: "rate", name: "Trigger discipline", desc: "+30% fire rate", apply: (g) => (g.rateMul *= 1.3) },
  { key: "dmg", name: "Heavier rounds", desc: "+35% damage", apply: (g) => (g.dmgMul *= 1.35) },
  { key: "reinf", name: "Reinforcements", desc: "+50% squad, right now", apply: (g) => (g.count = Math.floor(g.count * 1.5)) },
  { key: "armor", name: "Plate carriers", desc: "-30% losses on contact", apply: (g) => (g.armor *= 0.7) },
  { key: "volley", name: "Wider volley", desc: "More rounds per burst", apply: (g) => (g.volley += 1) },
  { key: "medic", name: "Field medics", desc: "+15% squad every stage", apply: (g) => (g.medic += 0.15) },
];

function clearStage(g) {
  if (g.phase !== "playing") return;
  g.phase = "upgrade";
  g.enemies.length = 0;
  g.bullets.length = 0;
  if (g.medic) g.count = Math.floor(g.count * (1 + g.medic));
  g.peak = Math.max(g.peak, g.count);
  g.best = { stage: Math.max(g.best.stage, g.stage), peak: Math.max(g.best.peak, g.peak) };
  const pool = UPGRADES.slice().sort(() => Math.random() - 0.5);
  g.choices = pool.slice(0, 3);
  Audio_.clear();
}

function nextStage(g, choice) {
  if (choice) { choice.apply(g); g.upgrades.push(choice.name); }
  g.stage += 1;
  g.phase = "playing";
  g.parts.length = 0;
  g.texts.length = 0;
  buildStage(g, g.stage);
}

// ---------------------------------------------------------------------------
// Rendering: one fake-3D road, drawn back to front.
// ---------------------------------------------------------------------------
function makeView(W, H) {
  const horizon = H * 0.32;
  const baseY = H * 1.0;
  const near = CFG.camD / (CFG.camD + CFG.squadZ);
  // Scale off the narrower of the two axes. Sizing the world by width alone
  // works on a phone and falls apart on a laptop: a 1280-wide window makes
  // every soldier three times the size with a third of the vertical room to
  // put him in, and the road turns into a wedge with gates stacked on top of
  // each other. Capping the playfield's width against the viewport's height
  // keeps the same portrait framing everywhere and simply leaves ground and
  // sky either side of it.
  const pw = Math.min(W, H * 0.62);
  return { W, H, cx: W / 2, horizon, baseY, px: (pw * 0.88) / (CFG.roadW * near) };
}

function proj(v, x, z) {
  const s = CFG.camD / (CFG.camD + Math.max(z, -CFG.camD * 0.7));
  return { sx: v.cx + x * s * v.px, sy: v.horizon + (v.baseY - v.horizon) * s, s: s * v.px };
}

function roadEdge(v, z) {
  const a = proj(v, -CFG.roadW / 2, z), b = proj(v, CFG.roadW / 2, z);
  return [a, b];
}

function drawWorldBackdrop(ctx, v, g) {
  const sky = ctx.createLinearGradient(0, 0, 0, v.horizon + 10);
  sky.addColorStop(0, "#0d141d");
  sky.addColorStop(0.6, "#2c3f52");
  sky.addColorStop(1, "#7e93a3");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, v.W, v.horizon + 12);

  // A ruined skyline, parallaxed a little so forward motion reads at distance.
  const off = (g.dist * 0.05) % 220;
  ctx.fillStyle = "#1b2733";
  for (let i = -2; i < 22; i++) {
    const bx = i * 58 - off - 40;
    const bh = 14 + hash01(i * 3.1) * 40;
    ctx.fillRect(bx, v.horizon - bh, 26 + hash01(i) * 24, bh + 4);
  }
  const band = ctx.createLinearGradient(0, v.horizon - 20, 0, v.horizon + 26);
  band.addColorStop(0, "rgba(126,147,163,0)");
  band.addColorStop(0.45, "rgba(126,147,163,0.62)");
  band.addColorStop(1, "rgba(126,147,163,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, v.horizon - 20, v.W, 46);

  // Ground either side of the road.
  const g2 = ctx.createLinearGradient(0, v.horizon, 0, v.H);
  g2.addColorStop(0, "#4a5b68");
  g2.addColorStop(1, "#1a232c");
  ctx.fillStyle = g2;
  ctx.fillRect(0, v.horizon, v.W, v.H - v.horizon);
}

function drawRoad(ctx, v, g) {
  const far = 2300;
  const [nl, nr] = roadEdge(v, -20);
  const [fl, fr] = roadEdge(v, far);

  const grad = ctx.createLinearGradient(0, fl.sy, 0, nl.sy);
  grad.addColorStop(0, "#5d6d79");
  grad.addColorStop(0.35, "#79848d");
  grad.addColorStop(1, "#98a1a8");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(nl.sx, nl.sy); ctx.lineTo(nr.sx, nr.sy);
  ctx.lineTo(fr.sx, fr.sy); ctx.lineTo(fl.sx, fl.sy);
  ctx.closePath(); ctx.fill();

  // Centre dashes, stepped in world units so they flow with actual speed.
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  const step = 90;
  const start = -(g.dist % step);
  for (let z = start; z < far; z += step) {
    if (z + 40 < 0) continue;
    const a = proj(v, -2.6, z), b = proj(v, 2.6, z);
    const c = proj(v, -2.6, z + 42), d = proj(v, 2.6, z + 42);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(d.sx, d.sy); ctx.lineTo(c.sx, c.sy);
    ctx.closePath(); ctx.fill();
  }

  // Barrier posts. Blue, because the ad is full of blue.
  for (let side = -1; side <= 1; side += 2) {
    for (let z = start; z < far; z += 60) {
      if (z < -10) continue;
      const p = proj(v, side * (CFG.roadW / 2 + 10), z);
      const h = 16 * p.s, w = Math.max(1, 5 * p.s);
      if (h < 0.6) continue;
      ctx.fillStyle = z % 120 < 60 ? "#2f6f9e" : "#27587d";
      ctx.fillRect(p.sx - w / 2, p.sy - h, w, h);
    }
  }

  // Distance haze so the road dissolves instead of ending in a hard line.
  const haze = ctx.createLinearGradient(0, v.horizon, 0, v.horizon + v.H * 0.16);
  haze.addColorStop(0, "rgba(126,147,163,0.95)");
  haze.addColorStop(1, "rgba(126,147,163,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, v.horizon - 2, v.W, v.H * 0.17);
}

function shadow(ctx, sx, sy, w, h) {
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.beginPath();
  ctx.ellipse(sx, sy, w, h, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSoldier(ctx, sx, sy, s, seed, t, flash) {
  const h = CFG.soldierH * s;
  if (h < 3) { ctx.fillStyle = "#6d7d4e"; ctx.fillRect(sx - h * 0.3, sy - h, h * 0.6, h); return; }
  const w = h * 0.42;
  const bob = Math.sin(t * 9 + seed * 6.3) * h * 0.05;
  const y = sy + bob;
  shadow(ctx, sx, sy + 1, w * 0.9, h * 0.1);
  // legs
  ctx.fillStyle = "#414a30";
  ctx.fillRect(sx - w * 0.42, y - h * 0.36, w * 0.34, h * 0.36);
  ctx.fillRect(sx + w * 0.08, y - h * 0.36, w * 0.34, h * 0.36);
  // torso + pack
  ctx.fillStyle = "#6d7d4e";
  ctx.fillRect(sx - w * 0.5, y - h * 0.78, w, h * 0.44);
  ctx.fillStyle = "#55613d";
  ctx.fillRect(sx - w * 0.5, y - h * 0.66, w, h * 0.12);
  // helmet
  ctx.fillStyle = "#87956a";
  ctx.beginPath();
  ctx.arc(sx, y - h * 0.83, w * 0.44, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(sx - w * 0.46, y - h * 0.84, w * 0.92, h * 0.07);
  // rifle, pointed downrange
  if (h > 8) {
    ctx.strokeStyle = "#2b2f26";
    ctx.lineWidth = Math.max(1, h * 0.06);
    ctx.beginPath();
    ctx.moveTo(sx + w * 0.1, y - h * 0.6);
    ctx.lineTo(sx + w * 0.62, y - h * 0.78);
    ctx.stroke();
    if (flash) {
      ctx.fillStyle = "#ffe27a";
      ctx.beginPath();
      ctx.arc(sx + w * 0.68, y - h * 0.8, h * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawZombie(ctx, sx, sy, s, seed, t) {
  const h = CFG.zombieH * s;
  if (h < 3) { ctx.fillStyle = "#6b7264"; ctx.fillRect(sx - h * 0.3, sy - h, h * 0.6, h); return; }
  const w = h * 0.44;
  const sway = Math.sin(t * 7 + seed) * h * 0.07;
  shadow(ctx, sx, sy + 1, w * 0.85, h * 0.09);
  ctx.save();
  ctx.translate(sx + sway * 0.4, sy);
  // legs mid-stride
  ctx.fillStyle = "#3f4740";
  ctx.fillRect(-w * 0.44, -h * 0.38, w * 0.32, h * 0.38);
  ctx.fillRect(w * 0.12, -h * 0.38, w * 0.32, h * 0.38);
  // torso
  ctx.fillStyle = "#6b7264";
  ctx.fillRect(-w * 0.5, -h * 0.8, w, h * 0.45);
  // arms out toward the camera
  ctx.strokeStyle = "#7c8375";
  ctx.lineWidth = Math.max(1, h * 0.11);
  ctx.beginPath();
  ctx.moveTo(-w * 0.45, -h * 0.72); ctx.lineTo(-w * 0.85, -h * 0.3 + sway);
  ctx.moveTo(w * 0.45, -h * 0.72); ctx.lineTo(w * 0.85, -h * 0.34 - sway);
  ctx.stroke();
  // head
  ctx.fillStyle = "#8d9382";
  ctx.beginPath();
  ctx.arc(0, -h * 0.88, w * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBoss(ctx, b, sx, sy, s, t) {
  const h = b.h * s, w = b.w * s;
  const sway = Math.sin(t * 1.6) * w * 0.03;
  shadow(ctx, sx, sy + 2, w * 0.6, h * 0.05);
  ctx.save();
  ctx.translate(sx + sway, sy);

  if (b.key === "matron") {
    ctx.fillStyle = "#d8b0a0";      // legs, so she stands on the road
    ctx.fillRect(-w * 0.22, -h * 0.1, w * 0.16, h * 0.1);
    ctx.fillRect(w * 0.06, -h * 0.1, w * 0.16, h * 0.1);
    ctx.fillStyle = "#3a2a26";
    ctx.fillRect(-w * 0.26, -h * 0.03, w * 0.22, h * 0.03);
    ctx.fillRect(w * 0.04, -h * 0.03, w * 0.22, h * 0.03);
    // Dress
    ctx.fillStyle = b.tint;
    ctx.beginPath();
    ctx.moveTo(-w * 0.52, -h * 0.08); ctx.lineTo(w * 0.52, -h * 0.08);
    ctx.quadraticCurveTo(w * 0.46, -h * 0.5, w * 0.3, -h * 0.66);
    ctx.lineTo(-w * 0.3, -h * 0.66);
    ctx.quadraticCurveTo(-w * 0.46, -h * 0.5, -w * 0.52, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(190,40,80,0.75)";
    for (let i = 0; i < 14; i++) {
      const a = hash01(i * 2.7), c = hash01(i * 5.1);
      ctx.beginPath();
      ctx.arc((a - 0.5) * w * 0.8, -c * h * 0.6, w * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    // Arms and shoulders
    ctx.fillStyle = "#e9c4b2";
    ctx.fillRect(-w * 0.68, -h * 0.62, w * 0.18, h * 0.34);
    ctx.fillRect(w * 0.5, -h * 0.62, w * 0.18, h * 0.34);
    ctx.beginPath();
    ctx.arc(0, -h * 0.7, w * 0.32, 0, Math.PI * 2);
    ctx.fill();
    // Head and hair
    ctx.beginPath();
    ctx.arc(0, -h * 0.86, w * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c8452f";
    ctx.beginPath();
    ctx.arc(0, -h * 0.93, w * 0.27, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a1a1a";
    ctx.fillRect(-w * 0.1, -h * 0.88, w * 0.05, h * 0.02);
    ctx.fillRect(w * 0.05, -h * 0.88, w * 0.05, h * 0.02);
  } else if (b.key === "ripper") {
    ctx.fillStyle = b.tint;
    ctx.beginPath();               // hunched torso
    ctx.moveTo(-w * 0.34, -h * 0.26); ctx.lineTo(w * 0.34, -h * 0.26);
    ctx.lineTo(w * 0.42, -h * 0.62); ctx.lineTo(-w * 0.42, -h * 0.62);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#8e2a1d";      // legs
    ctx.fillRect(-w * 0.3, -h * 0.3, w * 0.22, h * 0.3);
    ctx.fillRect(w * 0.08, -h * 0.3, w * 0.22, h * 0.3);
    ctx.fillStyle = "#5d1c14";      // feet
    ctx.fillRect(-w * 0.34, -h * 0.05, w * 0.3, h * 0.05);
    ctx.fillRect(w * 0.04, -h * 0.05, w * 0.3, h * 0.05);
    ctx.fillStyle = b.tint;         // shoulders
    ctx.beginPath();
    ctx.arc(-w * 0.42, -h * 0.6, w * 0.2, 0, Math.PI * 2);
    ctx.arc(w * 0.42, -h * 0.6, w * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#a53326";    // claw arms
    ctx.lineWidth = w * 0.13;
    ctx.beginPath();
    ctx.moveTo(-w * 0.46, -h * 0.58); ctx.lineTo(-w * 0.7, -h * 0.18);
    ctx.moveTo(w * 0.46, -h * 0.58); ctx.lineTo(w * 0.7, -h * 0.2);
    ctx.stroke();
    ctx.fillStyle = "#f2e6d0";
    for (let i = -1; i <= 1; i += 2) {
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(i * w * 0.7 + (k - 1) * w * 0.05, -h * 0.18);
        ctx.lineTo(i * w * 0.7 + (k - 1) * w * 0.05 + w * 0.04, -h * 0.02);
        ctx.lineTo(i * w * 0.7 + (k - 1) * w * 0.05 - w * 0.04, -h * 0.05);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.fillStyle = "#7d2418";      // head
    ctx.beginPath();
    ctx.arc(0, -h * 0.74, w * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd24a";
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.arc(i * w * 0.1, -h * 0.76, w * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#e8dcc0";    // horns
    ctx.lineWidth = w * 0.06;
    ctx.beginPath();
    ctx.moveTo(-w * 0.16, -h * 0.86); ctx.lineTo(-w * 0.3, -h * 1.0);
    ctx.moveTo(w * 0.16, -h * 0.86); ctx.lineTo(w * 0.3, -h * 1.0);
    ctx.stroke();
  } else {
    const stride = Math.sin(t * 1.4) * w * 0.06;
    ctx.fillStyle = "#3e4a55";       // legs
    ctx.fillRect(-w * 0.3 + stride, -h * 0.42, w * 0.22, h * 0.42);
    ctx.fillRect(w * 0.08 - stride, -h * 0.42, w * 0.22, h * 0.42);
    ctx.fillStyle = "#3b4750";       // boots
    ctx.fillRect(-w * 0.34 + stride, -h * 0.05, w * 0.3, h * 0.05);
    ctx.fillRect(w * 0.04 - stride, -h * 0.05, w * 0.3, h * 0.05);
    ctx.fillStyle = b.tint;          // torso
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h * 0.4); ctx.lineTo(w * 0.3, -h * 0.4);
    ctx.lineTo(w * 0.42, -h * 0.78); ctx.lineTo(-w * 0.42, -h * 0.78);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#75899a";       // shoulder plate
    ctx.fillRect(-w * 0.62, -h * 0.82, w * 0.34, h * 0.12);
    ctx.fillRect(w * 0.28, -h * 0.82, w * 0.34, h * 0.12);
    ctx.fillStyle = "#5e7182";       // chest panel
    ctx.fillRect(-w * 0.2, -h * 0.72, w * 0.4, h * 0.2);
    ctx.fillStyle = b.tint;          // arms
    ctx.fillRect(-w * 0.58, -h * 0.76, w * 0.18, h * 0.46);
    ctx.fillRect(w * 0.4, -h * 0.76, w * 0.18, h * 0.46);
    ctx.fillStyle = "#39454e";       // fists
    ctx.fillRect(-w * 0.6, -h * 0.34, w * 0.22, h * 0.08);
    ctx.fillRect(w * 0.38, -h * 0.34, w * 0.22, h * 0.08);
    ctx.fillStyle = "#39444e";       // head, seated on the shoulder line
    ctx.fillRect(-w * 0.15, -h * 0.94, w * 0.3, h * 0.15);
    ctx.fillStyle = "#9ef0ff";       // visor
    ctx.fillRect(-w * 0.12, -h * 0.89, w * 0.24, h * 0.03);
  }
  ctx.restore();
}

function drawGateRow(ctx, v, row, relZ, t) {
  const H = 96;
  for (const c of row.cells) {
    const b0 = proj(v, c.x0 + 2, relZ), b1 = proj(v, c.x1 - 2, relZ);
    const top = proj(v, 0, relZ).sy - H * b0.s;
    const fade = row.used ? clamp(1 - (t - row.hitAt) * 2.2, 0, 1) : 1;
    if (fade <= 0) continue;
    const face = c.good ? (c.op === "x" ? "70,224,208" : "110,242,168") : "255,107,96";
    const taken = row.used && c.taken;
    ctx.globalAlpha = fade * (taken ? 0.9 : 0.42);
    ctx.fillStyle = `rgba(${face},${taken ? 0.55 : 0.3})`;
    ctx.fillRect(b0.sx, top, b1.sx - b0.sx, b0.sy - top);
    ctx.fillStyle = `rgba(${face},0.95)`;
    ctx.fillRect(b0.sx, top, b1.sx - b0.sx, Math.max(2, 5 * b0.s));
    ctx.fillRect(b0.sx, top, Math.max(1.5, 3 * b0.s), b0.sy - top);
    ctx.fillRect(b1.sx - Math.max(1.5, 3 * b0.s), top, Math.max(1.5, 3 * b0.s), b0.sy - top);

    const label = (c.op === "x" ? "×" : c.op === "/" ? "÷" : c.op) + (c.op === "x" && c.v % 1 ? c.v.toFixed(1) : fmt(c.v));
    const size = Math.max(9, 26 * b0.s);
    ctx.globalAlpha = fade;
    ctx.font = `900 ${size}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillText(label, (b0.sx + b1.sx) / 2 + 1, top + (b0.sy - top) * 0.42 + 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, (b0.sx + b1.sx) / 2, top + (b0.sy - top) * 0.42);
  }
  ctx.globalAlpha = 1;
}

function drawSquad(ctx, v, g) {
  const n = Math.min(g.count, CFG.maxDrawSoldiers);
  const cols = formationCols(g.count);
  const sp = CFG.spacing;
  const rows = Math.ceil(n / cols);
  const firingPhase = (g.time * CFG.fireBase * g.rateMul) % 1 < 0.35;
  // Rank 0 is the front of the crowd and therefore the FARTHEST from the
  // camera, so it has to be painted first and the ranks nearest the lens last.
  // Painted the other way round the whole formation flattens into one solid
  // block — 90 soldiers stop being a crowd and become a hedge.
  for (let r = 0; r < rows; r++) {
    const stagger = (r % 2) * sp * 0.5;   // offset ranks, so nobody hides behind the man ahead
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= n) continue;
      const jx = (hash01(i * 1.7) - 0.5) * 4;
      const jz = (hash01(i * 3.3) - 0.5) * 4;
      const x = g.x + (c - (cols - 1) / 2) * sp + stagger + jx;
      const z = CFG.squadZ - r * CFG.rowGap + jz;
      const p = proj(v, x, z);
      drawSoldier(ctx, p.sx, p.sy, p.s, hash01(i), g.time, firingPhase && r < 2);
    }
  }
}

function draw(ctx, v, g) {
  ctx.save();
  if (g.shake > 0.01) {
    ctx.translate(rnd(-1, 1) * g.shake * 7, rnd(-1, 1) * g.shake * 5);
  }
  drawWorldBackdrop(ctx, v, g);
  drawRoad(ctx, v, g);

  const list = [];
  for (const row of g.gates) {
    const z = row.zAbs - g.dist;
    if (z > -40 && z < 2300) list.push({ z, f: () => drawGateRow(ctx, v, row, z, g.time) });
  }
  for (const e of g.enemies) {
    const z = e.zAbs - g.dist;
    if (z < -30 || z > 2300) continue;
    const p = proj(v, e.x, z);
    list.push({ z, f: () => drawZombie(ctx, p.sx, p.sy, p.s, e.seed, g.time) });
  }
  if (g.boss) {
    const b = g.boss;
    const z = b.zAbs - g.dist;
    if (z < 2600) {
      const p = proj(v, b.x, Math.max(z, 4));
      list.push({
        z, f: () => {
          if (b.dying > 0) {
            ctx.save();
            ctx.globalAlpha = clamp(b.dying / 1.8, 0, 1);
            ctx.translate(p.sx, p.sy);
            ctx.rotate((1 - b.dying / 1.8) * 1.35);
            ctx.translate(-p.sx, -p.sy);
            drawBoss(ctx, b, p.sx, p.sy, p.s, g.time);
            ctx.restore();
          } else drawBoss(ctx, b, p.sx, p.sy, p.s, g.time);
        },
      });
    }
  }
  for (const p0 of g.parts) {
    const z = p0.zAbs - g.dist;
    if (z < -30 || z > 2300) continue;
    const p = proj(v, p0.x, z);
    list.push({
      z, f: () => {
        ctx.globalAlpha = clamp(1 - p0.t / p0.life, 0, 1);
        ctx.fillStyle = p0.color;
        const s = Math.max(1, p0.size * p.s);
        ctx.fillRect(p.sx - s / 2, p.sy - p0.y * p.s - s / 2, s, s);
        ctx.globalAlpha = 1;
      },
    });
  }
  for (const b of g.bullets) {
    const z = b.zAbs - g.dist;
    if (z < -20 || z > 2300) continue;
    const a = proj(v, b.x, z), c = proj(v, b.x, Math.max(z - 44, 0));
    list.push({
      z, f: () => {
        ctx.strokeStyle = "rgba(255,208,60,0.55)";
        ctx.lineWidth = Math.max(0.8, 1.3 * a.s);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy - 26 * a.s); ctx.lineTo(c.sx, c.sy - 26 * c.s);
        ctx.stroke();
        ctx.fillStyle = "#fff2b0";
        const r = Math.max(1, 2.1 * a.s);
        ctx.fillRect(a.sx - r / 2, a.sy - 26 * a.s - r / 2, r, r * 1.6);
      },
    });
  }
  list.push({ z: CFG.squadZ, f: () => drawSquad(ctx, v, g) });

  list.sort((a, b) => b.z - a.z);
  for (const item of list) item.f();

  // Floating numbers ride above the road, in screen space, unsorted.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of g.texts) {
    const p = proj(v, t.x, t.zAbs - g.dist);
    const k = t.t / t.life;
    ctx.globalAlpha = clamp(1 - k * k, 0, 1);
    const size = Math.max(12, 22 * t.size * Math.min(p.s, 2.2));
    const y = p.sy - v.H * 0.14 - k * v.H * 0.07;
    ctx.font = `900 ${size}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillText(t.text, p.sx + 1, y + 1);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, p.sx, y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (g.flash > 0.01) {
    ctx.fillStyle = `rgba(255,60,50,${g.flash * 0.35})`;
    ctx.fillRect(0, 0, v.W, v.H);
  }
  if (g.banner) {
    const k = clamp(g.banner.t / 2.6, 0, 1);
    ctx.globalAlpha = clamp(k < 0.15 ? k / 0.15 : 1, 0, 1);
    ctx.textAlign = "center";
    ctx.font = `900 ${Math.round(v.W * 0.1)}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(g.banner.text, v.cx, v.H * 0.30);
    ctx.font = `800 ${Math.round(v.W * 0.055)}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = "#ffcf4a";
    ctx.fillText(g.banner.sub, v.cx, v.H * 0.30 + v.W * 0.085);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Shell: canvas, input, and the four screens around the loop.
// ---------------------------------------------------------------------------
const LS_KEY = "only-hope/v1";
function loadBest() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || { stage: 0, peak: 0 }; }
  catch (e) { return { stage: 0, peak: 0 }; }
}
function saveBest(b) { try { localStorage.setItem(LS_KEY, JSON.stringify(b)); } catch (e) {} }

// Attract mode drives the title screen with a real game rather than a picture,
// which is the only fair way to advertise a game about advertising.
function autopilot(g) {
  let best = null;
  for (const row of g.gates) {
    if (row.used) continue;
    const z = row.zAbs - g.dist;
    if (z < 0 || z > 900) continue;
    if (!best || row.zAbs < best.zAbs) best = row;
  }
  if (best) {
    let top = best.cells[0], topScore = -Infinity;
    for (const c of best.cells) {
      const score = c.op === "x" ? g.count * c.v : c.op === "+" ? g.count + c.v : c.op === "-" ? g.count - c.v : g.count / c.v;
      if (score > topScore) { topScore = score; top = c; }
    }
    g.targetX = (top.x0 + top.x1) / 2;
  } else {
    g.targetX = Math.sin(g.time * 0.7) * (CFG.roadW * 0.3);
  }
}

const C = { bg: "#0a0e14", panel: "#141b25", line: "#25313f", text: "#eef4fa", dim: "#8fa0b3", gold: "#ffcf4a", cyan: "#46e0d0", red: "#ff5a52", green: "#6ef2a8" };

function App() {
  const canvasRef = useRef(null);
  const gRef = useRef(null);
  const viewRef = useRef(makeView(400, 800));
  const dragRef = useRef(null);
  const [screen, setScreen] = useState("title");
  const screenRef = useRef("title");
  const [hud, setHud] = useState({ count: 12, stage: 1, kills: 0, boss: null });
  const [best, setBest] = useState(loadBest);
  const [muted, setMuted] = useState(false);

  if (!gRef.current) gRef.current = newGame(best);

  const setScreenBoth = useCallback((s) => { screenRef.current = s; setScreen(s); }, []);

  // One loop for everything: attract mode, play, and the frozen scene behind
  // the upgrade and game-over cards.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: false });
    let raf = 0, last = performance.now(), hudT = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      viewRef.current = makeView(w, h);
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.04, Math.max(0, (now - last) / 1000));
      last = now;
      const g = gRef.current;
      const sc = screenRef.current;

      if (sc === "title") {
        autopilot(g);
        step(g, dt);
        if (g.phase === "dead") { gRef.current = newGame(best); gRef.current.phase = "playing"; }
        if (g.phase === "upgrade") { nextStage(g, pick(g.choices)); }
      } else if (sc === "playing") {
        step(g, dt);
        if (g.phase === "upgrade") setScreenBoth("upgrade");
        else if (g.phase === "dead") {
          saveBest(g.best); setBest(g.best); setScreenBoth("dead");
        }
      }

      draw(ctx, viewRef.current, g);

      hudT += dt;
      if (hudT > 0.08) {
        hudT = 0;
        const b = g.boss && g.boss.engaged && !g.boss.dying
          ? { name: g.boss.name, hp: g.boss.hp, max: g.boss.maxHp } : null;
        setHud({ count: g.count, stage: g.stage, kills: g.kills, boss: b });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
    };
  }, [best, setScreenBoth]);

  // Steering. Relative drag, so the crowd never teleports out from under your
  // thumb the moment you touch the screen.
  const worldX = useCallback((clientX) => {
    const v = viewRef.current;
    const near = CFG.camD / (CFG.camD + CFG.squadZ);
    return (clientX - v.cx) / (v.px * near);
  }, []);

  const onDown = useCallback((e) => {
    if (screenRef.current !== "playing") return;
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { from: worldX(e.clientX), base: gRef.current.x };
  }, [worldX]);

  const onMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || screenRef.current !== "playing") return;
    gRef.current.targetX = d.base + (worldX(e.clientX) - d.from);
  }, [worldX]);

  const onUp = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    const key = (e) => {
      if (screenRef.current !== "playing") return;
      const g = gRef.current;
      if (e.key === "ArrowLeft" || e.key === "a") g.targetX = g.x - 60;
      if (e.key === "ArrowRight" || e.key === "d") g.targetX = g.x + 60;
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const start = () => {
    Audio_.init();
    if (Audio_.ctx && Audio_.ctx.state === "suspended") Audio_.ctx.resume();
    gRef.current = newGame(best);
    setScreenBoth("playing");
  };
  const takeUpgrade = (u) => { nextStage(gRef.current, u); setScreenBoth("playing"); };
  const toggleMute = () => { Audio_.on = muted; setMuted(!muted); };

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {screen === "playing" && <Hud hud={hud} muted={muted} onMute={toggleMute} />}
      {screen === "title" && <Title best={best} onStart={start} />}
      {screen === "upgrade" && <Upgrades g={gRef.current} onPick={takeUpgrade} />}
      {screen === "dead" && <GameOver g={gRef.current} best={best} onRetry={start} />}
    </div>
  );
}

const overlay = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", padding: "28px 20px",
  background: "linear-gradient(180deg, rgba(6,10,15,.72), rgba(6,10,15,.92))",
  textAlign: "center",
};
const titleOverlay = {
  ...overlay,
  background: "linear-gradient(180deg, rgba(6,10,15,.5) 0%, rgba(6,10,15,.72) 45%, rgba(6,10,15,.9) 100%)",
  textShadow: "0 2px 14px rgba(0,0,0,.85)",
};
const bigBtn = {
  border: "none", borderRadius: 14, padding: "17px 40px", fontWeight: 900,
  fontSize: 19, letterSpacing: ".04em", cursor: "pointer", color: "#07131a",
  background: `linear-gradient(135deg, ${C.cyan}, #7ce39b)`, boxShadow: "0 10px 30px rgba(70,224,208,.25)",
};

function Hud({ hud, muted, onMute }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", padding: "max(14px, env(safe-area-inset-top)) 14px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, textShadow: "0 2px 10px rgba(0,0,0,.7)" }}>
            {fmt(hud.count)}
          </div>
          <div style={{ fontSize: 11, letterSpacing: ".16em", color: C.dim, marginTop: 2 }}>SOLDIERS</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.gold, textShadow: "0 2px 8px rgba(0,0,0,.7)" }}>STAGE {hud.stage}</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>{fmt(hud.kills)} killed</div>
          <button onClick={onMute} style={{
            pointerEvents: "auto", marginTop: 8, border: `1px solid ${C.line}`, background: "rgba(10,14,20,.6)",
            color: C.dim, borderRadius: 8, padding: "5px 9px", fontSize: 12, cursor: "pointer",
          }}>{muted ? "🔇" : "🔊"}</button>
        </div>
      </div>
      {hud.boss && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".18em", color: C.red, textAlign: "center" }}>
            {hud.boss.name}
          </div>
          <div style={{ height: 10, background: "rgba(0,0,0,.55)", borderRadius: 6, marginTop: 5, overflow: "hidden", border: `1px solid ${C.line}` }}>
            <div style={{
              width: `${clamp((hud.boss.hp / hud.boss.max) * 100, 0, 100)}%`, height: "100%",
              background: `linear-gradient(90deg, ${C.red}, #ff9a3c)`, transition: "width .08s linear",
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Title({ best, onStart }) {
  return (
    <div style={titleOverlay}>
      <div style={{ fontSize: 13, letterSpacing: ".3em", color: C.gold, fontWeight: 800 }}>YOU ARE OUR</div>
      <h1 style={{ fontSize: 58, margin: "2px 0 6px", letterSpacing: "-.03em", fontWeight: 900 }}>ONLY HOPE</h1>
      <p style={{ color: C.dim, maxWidth: 340, margin: "0 0 20px", fontSize: 15, lineHeight: 1.5 }}>
        The game from the ad — as the ad. Run the gates, grow the crowd, drop
        the giant. That's the whole game, and it's all here.
      </p>
      <button onClick={onStart} style={bigBtn}>PLAY</button>
      <div style={{ marginTop: 22, fontSize: 12.5, color: C.dim, lineHeight: 1.85, maxWidth: 320 }}>
        <div>No energy bar. No timers. No ads.</div>
        <div>No shop, no currency, nothing to buy.</div>
        <div>The gates do exactly what they print.</div>
        <div>The crowd really does get that big.</div>
      </div>
      {best.stage > 0 && (
        <div style={{ marginTop: 20, fontSize: 13, color: C.text, opacity: .85 }}>
          Best: stage <b style={{ color: C.gold }}>{best.stage}</b> · peak squad <b style={{ color: C.cyan }}>{fmt(best.peak)}</b>
        </div>
      )}
      <div style={{ marginTop: 18, fontSize: 11.5, color: "#5d6d7d" }}>Drag anywhere to steer. Your squad fires on its own.</div>
    </div>
  );
}

function Upgrades({ g, onPick }) {
  return (
    <div style={overlay}>
      <div style={{ fontSize: 12, letterSpacing: ".26em", color: C.gold, fontWeight: 800 }}>STAGE {g.stage} CLEAR</div>
      <div style={{ fontSize: 42, fontWeight: 900, margin: "6px 0 2px" }}>{fmt(g.count)}</div>
      <div style={{ fontSize: 11.5, letterSpacing: ".16em", color: C.dim, marginBottom: 20 }}>SOLDIERS STANDING</div>
      <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 10 }}>
        {(g.choices || []).map((u) => (
          <button key={u.key} onClick={() => onPick(u)} style={{
            width: "100%", textAlign: "left", cursor: "pointer",
            background: C.panel, border: `1px solid ${C.line}`, borderRadius: 13, padding: "14px 16px", color: C.text,
          }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{u.name}</div>
            <div style={{ color: C.cyan, fontSize: 13.5, marginTop: 3 }}>{u.desc}</div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 18, fontSize: 12, color: "#5d6d7d" }}>Pick one. It's free — everything here is.</div>
    </div>
  );
}

function GameOver({ g, best, onRetry }) {
  const rows = [
    ["Stage reached", String(g.stage)],
    ["Peak squad", fmt(g.peak)],
    ["Killed", fmt(g.kills)],
    ["Best stage", String(best.stage)],
    ["Best squad", fmt(best.peak)],
  ];
  return (
    <div style={overlay}>
      <div style={{ fontSize: 13, letterSpacing: ".26em", color: C.red, fontWeight: 800 }}>SQUAD WIPED</div>
      <h2 style={{ fontSize: 34, margin: "8px 0 16px", fontWeight: 900 }}>Stage {g.stage}</h2>
      <div style={{ width: "100%", maxWidth: 330, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 13, padding: "6px 14px", marginBottom: 22 }}>
        {rows.map(([k, val]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", fontSize: 14, borderBottom: `1px solid rgba(37,49,63,.55)` }}>
            <span style={{ color: C.dim }}>{k}</span>
            <b>{val}</b>
          </div>
        ))}
      </div>
      {g.upgrades.length > 0 && (
        <div style={{ maxWidth: 330, fontSize: 12.5, color: C.dim, marginBottom: 20, lineHeight: 1.6 }}>
          Picked up: {g.upgrades.join(" · ")}
        </div>
      )}
      <button onClick={onRetry} style={bigBtn}>RUN IT AGAIN</button>
      <div style={{ marginTop: 16, fontSize: 12, color: "#5d6d7d", maxWidth: 300, lineHeight: 1.6 }}>
        No revive offer, no timer to wait out. The button just works.
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
