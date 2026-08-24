/* Isolation field worker.
 *
 * Given a global elevation grid and a reference elevation E, it answers two
 * questions for every cell on Earth:
 *
 *   1. How far is the nearest ground that reaches E?      -> dist[]
 *   2. For ground that reaches E: how far is the nearest   -> comp[] + compIso[]
 *      *separate* mass of ground that also reaches E?
 *
 * At E = 0 that is "distance to the nearest land or island" and "how isolated is
 * this island". Raise E and "land" shrinks to only the terrain above that line,
 * so the same two questions become "how far to the nearest 3,000 m ground" and
 * "how isolated is this massif" — which is the whole point of the slider.
 *
 * Everything runs off-thread because a full pass is ~2.3M cells.
 */

// km, IUGG mean radius. Elevation carries -1 for "no land in this cell", which
// no threshold ever reaches, so the sentinel needs no separate test.
const R_EARTH = 6371.0088;

let W = 0, H = 0, N = 0;
let elev = null;
let sinLat = null, cosLat = null, cosDlon = null;

// Scratch buffers, allocated once and reused across slider moves.
let near = null, bestDot = null, parent = null, comp = null, dist = null;

function initTables() {
  sinLat = new Float64Array(H);
  cosLat = new Float64Array(H);
  for (let r = 0; r < H; r++) {
    const lat = ((90 - ((r + 0.5) * 180) / H) * Math.PI) / 180;
    sinLat[r] = Math.sin(lat);
    cosLat[r] = Math.cos(lat);
  }
  // Longitude only ever enters as a *difference* of whole columns, so the cosine
  // of every possible difference fits in one table and the inner loop needs no
  // trigonometry at all.
  cosDlon = new Float64Array(W);
  for (let d = 0; d < W; d++) cosDlon[d] = Math.cos((d * 2 * Math.PI) / W);

  near = new Int32Array(N);
  bestDot = new Float64Array(N);
  parent = new Int32Array(N);
  comp = new Int32Array(N);
  dist = new Float32Array(N);
}

/** Cosine of the angle between two cells — larger means closer. */
function dotOf(r1, c1, idx2) {
  const r2 = (idx2 / W) | 0;
  let d = c1 - (idx2 - r2 * W);
  if (d < 0) d += W;
  return sinLat[r1] * sinLat[r2] + cosLat[r1] * cosLat[r2] * cosDlon[d];
}

function kmBetween(a, b) {
  const r1 = (a / W) | 0;
  const c1 = a - r1 * W;
  return R_EARTH * Math.acos(Math.max(-1, Math.min(1, dotOf(r1, c1, b))));
}

/* ---- connected components (8-connected, wrapping at the date line) -------- */

function find(x) {
  let root = x;
  while (parent[root] !== root) root = parent[root];
  while (parent[x] !== root) { const nx = parent[x]; parent[x] = root; x = nx; }
  return root;
}

function union(a, b) {
  const ra = find(a), rb = find(b);
  if (ra !== rb) parent[rb > ra ? rb : ra] = rb > ra ? ra : rb;
}

function label(threshold) {
  // Every cell is seeded as its own root BEFORE any merging. The scan below
  // reaches west across the date line, which is the one neighbour it has not
  // visited yet, so seeding lazily would have it merge into whatever stale
  // pointer that cell was left holding — quietly tearing apart exactly the two
  // landmasses that span 180 degrees, Antarctica and Afro-Eurasia.
  for (let i = 0; i < N; i++) {
    parent[i] = i;
    if (elev[i] < threshold) comp[i] = -1;
  }
  for (let r = 0, i = 0; r < H; r++) {
    for (let c = 0; c < W; c++, i++) {
      if (elev[i] < threshold) continue;
      const w = c === 0 ? i + W - 1 : i - 1;
      if (elev[w] >= threshold) union(i, w);
      if (r > 0) {
        const up = i - W;
        if (elev[up] >= threshold) union(i, up);
        const ul = c === 0 ? up + W - 1 : up - 1;
        if (elev[ul] >= threshold) union(i, ul);
        const ur = c === W - 1 ? up - W + 1 : up + 1;
        if (elev[ur] >= threshold) union(i, ur);
      }
    }
  }
  // Every cell in the top row touches every other one at the pole itself, and
  // likewise at the bottom — without this, Antarctica can come apart into wedges.
  for (const row of [0, H - 1]) {
    let first = -1;
    for (let c = 0, i = row * W; c < W; c++, i++) {
      if (elev[i] < threshold) continue;
      if (first < 0) first = i; else union(first, i);
    }
  }

  // Compact the roots into 0..n-1. union() always keeps the *smallest* member as
  // the root, so scanning upwards reaches a set's root before any of its other
  // members and comp[root] is already numbered by the time we need it — no
  // lookup table required.
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (elev[i] < threshold) continue;
    const root = find(i);
    comp[i] = root === i ? n++ : comp[root];
  }
  return n;
}

/* ---- distance transform -------------------------------------------------- */

/* Sequential vector propagation (Danielsson): each cell carries the index of the
 * nearest source found so far and inherits its neighbours' candidates. Because
 * the *source index* travels rather than an accumulated path length, the final
 * distance is a true great-circle distance, not a sum of grid steps. Four scans
 * (two forward/backward rounds) also give the label time to cross the date line,
 * which a single round cannot do. */
function transform(threshold) {
  for (let i = 0; i < N; i++) {
    if (elev[i] >= threshold) { near[i] = i; bestDot[i] = 1; }
    else { near[i] = -1; bestDot[i] = -2; }
  }

  const relax = (i, r, c, j) => {
    const cand = near[j];
    if (cand < 0 || cand === near[i]) return;
    const d = dotOf(r, c, cand);
    if (d > bestDot[i]) { bestDot[i] = d; near[i] = cand; }
  };

  for (let round = 0; round < 2; round++) {
    for (let r = 0, i = 0; r < H; r++) {
      for (let c = 0; c < W; c++, i++) {
        if (bestDot[i] === 1) continue;
        relax(i, r, c, c === 0 ? i + W - 1 : i - 1);
        if (r > 0) {
          const up = i - W;
          relax(i, r, c, up);
          relax(i, r, c, c === 0 ? up + W - 1 : up - 1);
          relax(i, r, c, c === W - 1 ? up - W + 1 : up + 1);
        }
      }
    }
    for (let r = H - 1, i = N - 1; r >= 0; r--) {
      for (let c = W - 1; c >= 0; c--, i--) {
        if (bestDot[i] === 1) continue;
        relax(i, r, c, c === W - 1 ? i - W + 1 : i + 1);
        if (r < H - 1) {
          const dn = i + W;
          relax(i, r, c, dn);
          relax(i, r, c, c === W - 1 ? dn - W + 1 : dn + 1);
          relax(i, r, c, c === 0 ? dn + W - 1 : dn - 1);
        }
      }
    }
  }

  for (let i = 0; i < N; i++) {
    const d = bestDot[i];
    dist[i] = d <= -2 ? -1 : R_EARTH * Math.acos(d > 1 ? 1 : d < -1 ? -1 : d);
  }
}

/* ---- how far apart are two separate masses? ------------------------------ */

/* The closest pair of two masses always shows up on the boundary between their
 * two territories in the distance field: walk the geodesic between them and the
 * "nearest source" label has to flip somewhere. So scanning adjacent cells whose
 * labels belong to different masses finds that closest pair exactly, at a
 * fraction of the cost of an all-pairs search. */
function separations(n) {
  const iso = new Float64Array(n).fill(Infinity);
  const other = new Int32Array(n).fill(-1);
  const endA = new Int32Array(n).fill(-1);
  const endB = new Int32Array(n).fill(-1);

  const consider = (i, j) => {
    const a = near[i], b = near[j];
    if (a < 0 || b < 0) return;
    const ca = comp[a], cb = comp[b];
    if (ca === cb) return;
    const d = kmBetween(a, b);
    if (d < iso[ca]) { iso[ca] = d; other[ca] = cb; endA[ca] = a; endB[ca] = b; }
    if (d < iso[cb]) { iso[cb] = d; other[cb] = ca; endA[cb] = b; endB[cb] = a; }
  };

  for (let r = 0, i = 0; r < H; r++) {
    for (let c = 0; c < W; c++, i++) {
      consider(i, c === W - 1 ? i - W + 1 : i + 1);
      if (r < H - 1) consider(i, i + W);
    }
  }
  return { iso, other, endA, endB };
}

/* ---- per-mass summary ---------------------------------------------------- */

function summarise(n, threshold) {
  const cells = new Int32Array(n);
  const area = new Float64Array(n); // km^2, cos-latitude weighted
  const peak = new Int32Array(n).fill(-1);
  const peakM = new Int32Array(n).fill(-32768);
  const cellDeg = 180 / H;
  const cellKm = (cellDeg * Math.PI * R_EARTH) / 180;

  for (let r = 0, i = 0; r < H; r++) {
    const a = cellKm * cellKm * cosLat[r];
    for (let c = 0; c < W; c++, i++) {
      const id = comp[i];
      if (id < 0) continue;
      cells[id]++;
      area[id] += a;
      if (elev[i] > peakM[id]) { peakM[id] = elev[i]; peak[id] = i; }
    }
  }
  return { cells, area, peak, peakM, threshold };
}

/* ---- message plumbing ---------------------------------------------------- */

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    W = msg.W; H = msg.H; N = W * H;
    elev = new Int16Array(msg.elev);
    initTables();
    self.postMessage({ type: "ready" });
    return;
  }
  if (msg.type !== "compute") return;

  const t0 = Date.now();
  const threshold = msg.threshold;
  const n = label(threshold);
  transform(threshold);
  const sep = separations(n);
  const sum = summarise(n, threshold);

  // The single most remote spot in the ocean at this threshold — the pole of
  // inaccessibility, which is the headline number people come for.
  let far = 0;
  for (let i = 1; i < N; i++) if (dist[i] > dist[far]) far = i;

  const out = {
    type: "result",
    seq: msg.seq,
    threshold,
    ms: Date.now() - t0,
    count: n,
    dist,
    near,
    comp,
    cells: sum.cells,
    area: Float32Array.from(sum.area),
    peak: sum.peak,
    peakM: sum.peakM,
    iso: Float32Array.from(sep.iso, (v) => (v === Infinity ? -1 : v)),
    other: sep.other,
    endA: sep.endA,
    endB: sep.endB,
    farthest: far,
    farthestKm: dist[far],
  };
  // Copies, not transfers: the buffers are reused for the next slider position.
  self.postMessage(out);
};
