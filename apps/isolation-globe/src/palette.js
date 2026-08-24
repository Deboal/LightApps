/* Colour, and the equirectangular map the globe samples.
 *
 * Both scales here are sequential — they encode one magnitude, distance — so
 * both run monotonically light-to-dark. That is the part that actually matters
 * for reading a value off the map: hue tells you *which* scale you are on
 * (cool = open water, warm = land), lightness tells you *how far*. A rainbow
 * would be prettier at a glance and unreadable in detail, because its lightness
 * wanders and 2,000 km stops looking further than 900 km.
 */

/** Distance from a point to the nearest qualifying ground. Light = close. */
export const SEA_STOPS = [
  [0, "#d3f0ea"], [150, "#93d9d5"], [400, "#54bacb"], [800, "#3193bd"],
  [1300, "#2c6faa"], [1800, "#314f93"], [2400, "#363472"], [3200, "#2c1f4d"],
  [4500, "#160f2b"],
];

/** How far a landmass is from the nearest *other* landmass. Light = close. */
export const ISO_STOPS = [
  [0, "#f8e9ab"], [50, "#f4c672"], [150, "#ed9c50"], [400, "#de6d40"],
  [900, "#c14538"], [1600, "#98263b"], [2600, "#6c1139"], [4000, "#3e0c2d"],
];

/* Land relief tint, by elevation in metres. Pitched a little bright, because the
 * relief pass below only ever darkens what it is given. */
const HYPSO = [
  [0, "#356440"], [300, "#5a814a"], [800, "#8f8f52"], [1500, "#a9855f"],
  [2400, "#a17b6b"], [3400, "#b3ada7"], [4600, "#e6e7ea"], [6200, "#ffffff"],
];

const LUT_N = 512;

function hex(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Piecewise-linear ramp baked into a lookup table over [0, stops.last]. */
function makeLut(stops) {
  const max = stops[stops.length - 1][0];
  const rgb = stops.map((s) => hex(s[1]));
  const lut = new Uint8Array(LUT_N * 3);
  let k = 0;
  for (let i = 0; i < LUT_N; i++) {
    const v = (i / (LUT_N - 1)) * max;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const a = stops[k][0], b = stops[k + 1][0];
    const t = b === a ? 0 : (v - a) / (b - a);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * t;
  }
  lut.max = max;
  return lut;
}

const SEA_LUT = makeLut(SEA_STOPS);
const ISO_LUT = makeLut(ISO_STOPS);
const HYP_LUT = makeLut(HYPSO);

function lookup(lut, v) {
  let i = (v / lut.max) * (LUT_N - 1);
  i = i < 0 ? 0 : i > LUT_N - 1 ? LUT_N - 1 : i | 0;
  return i * 3;
}

/* Relief. At 10 arc-minutes a cell is ~18 km across, so real slopes are tiny
 * fractions and need a big vertical exaggeration before the eye sees anything.
 * The relief is doing a specific job here: at a high reference elevation almost
 * everything reads as "not land", and the shading is what keeps the continents
 * recognisable underneath the colour. */
const EXAG = 26;

function buildShade(elev, W, H) {
  const shade = new Float32Array(W * H);
  const cellDeg = 180 / H;
  const dy = 110.57 * cellDeg;
  // Light from the north-west, the cartographic convention: relief read with
  // the light from below inverts into craters for most people.
  const lx = -0.55, ly = 0.55, lz = 0.63;
  for (let r = 0; r < H; r++) {
    const lat = 90 - (r + 0.5) * cellDeg;
    const dx = Math.max(0.15, Math.cos((lat * Math.PI) / 180)) * 111.32 * cellDeg;
    const rN = r > 0 ? r - 1 : r, rS = r < H - 1 ? r + 1 : r;
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      const w = elev[r * W + (c === 0 ? W - 1 : c - 1)];
      const e = elev[r * W + (c === W - 1 ? 0 : c + 1)];
      const n = elev[rN * W + c], s = elev[rS * W + c];
      // A cell with no land reads as sea level rather than as the -1 sentinel,
      // so coastlines do not get a fake cliff drawn along them.
      const zw = w < 0 ? 0 : w, ze = e < 0 ? 0 : e;
      const zn = n < 0 ? 0 : n, zs = s < 0 ? 0 : s;
      const gx = ((ze - zw) / (2000 * dx)) * EXAG;
      const gy = ((zn - zs) / (2000 * dy)) * EXAG;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const dot = (-gx * lx - gy * ly + lz) * inv;
      // Relief only ever darkens, never brightens past the tint itself. A
      // multiplier above 1 clips the pale end of a ramp to flat white, which
      // turned every low-isolation island into a white blob.
      shade[i] = 0.7 + 0.3 * (dot < 0 ? 0 : dot);
    }
  }
  return shade;
}

let shadeCache = null;

/**
 * Paint the equirectangular map the globe samples.
 *
 * mode "sea"  – colour open water by how far it is from qualifying ground
 * mode "iso"  – colour each landmass by how far it is from the nearest other one
 */
export function paintMap(target, { elev, dist, comp, iso, threshold, mode, W, H }) {
  if (!shadeCache || shadeCache.length !== W * H) shadeCache = buildShade(elev, W, H);
  const shade = shadeCache;
  const px = target.data;

  for (let i = 0, o = 0; i < W * H; i++, o += 4) {
    const h = elev[i];
    const d = dist[i];
    let R, G, B, sh = 1;

    if (h >= threshold) {
      sh = shade[i];
      if (mode === "iso") {
        const k = comp[i];
        const v = k >= 0 ? iso[k] : -1;
        if (v < 0) {
          // Nothing else qualifies anywhere — the only mass on the planet.
          R = 250; G = 250; B = 252;
        } else {
          const j = lookup(ISO_LUT, v);
          R = ISO_LUT[j]; G = ISO_LUT[j + 1]; B = ISO_LUT[j + 2];
        }
      } else {
        const j = lookup(HYP_LUT, h);
        R = HYP_LUT[j]; G = HYP_LUT[j + 1]; B = HYP_LUT[j + 2];
      }
    } else {
      const j = lookup(SEA_LUT, d);
      R = SEA_LUT[j]; G = SEA_LUT[j + 1]; B = SEA_LUT[j + 2];
      if (mode === "iso") {
        // Push the water back so the landmass colours carry the reading.
        R = R * 0.34 + 8; G = G * 0.34 + 11; B = B * 0.38 + 20;
      }
      if (h >= 0) {
        // Land that the current reference elevation has "drowned". It keeps the
        // distance colour, because that distance is real, but it also keeps its
        // relief and a warm cast — otherwise raising the slider dissolves the
        // continents and you lose all sense of where you are looking.
        sh = shade[i];
        R = R * 0.72 + 46; G = G * 0.72 + 40; B = B * 0.72 + 30;
      }
    }

    px[o] = R * sh;
    px[o + 1] = G * sh;
    px[o + 2] = B * sh;
    px[o + 3] = 255;
  }
  return target;
}

export function resetShade() { shadeCache = null; }

/** Swatch colour for a legend entry, as CSS. */
export function swatch(stops, v) {
  const lut = stops === ISO_STOPS ? ISO_LUT : SEA_LUT;
  const j = lookup(lut, v);
  return `rgb(${lut[j]},${lut[j + 1]},${lut[j + 2]})`;
}
