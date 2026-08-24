/* Orthographic globe on a 2D canvas. No WebGL, no libraries.
 *
 * The map is an equirectangular RGBA image that something else paints (see
 * palette.js). This file only does the projection: for every screen pixel it
 * inverts the orthographic projection back to a latitude/longitude and samples
 * the map there. That is a per-pixel raycast against a sphere, which sounds
 * expensive but is well under a frame at this size — and it buys exact control
 * over the shading with none of the WebGL context-loss and mobile-driver mess
 * that a 3D library brings.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function llToVec(latDeg, lonDeg) {
  const la = latDeg * D2R, lo = lonDeg * D2R, c = Math.cos(la);
  return [c * Math.cos(lo), Math.sin(la), c * Math.sin(lo)];
}

/** Great-circle distance in km between two lat/lon pairs. */
export function haversineKm(a, b) {
  const [x1, y1, z1] = llToVec(a[0], a[1]);
  const [x2, y2, z2] = llToVec(b[0], b[1]);
  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  return 6371.0088 * Math.acos(dot);
}

/** Points along the great circle from a to b, as [lat, lon] pairs. */
export function greatCircle(a, b, steps = 180) {
  const va = llToVec(a[0], a[1]), vb = llToVec(b[0], b[1]);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const out = [];
  if (omega < 1e-9) return [a, b];
  const s = Math.sin(omega);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const k1 = Math.sin((1 - t) * omega) / s, k2 = Math.sin(t * omega) / s;
    const x = k1 * va[0] + k2 * vb[0], y = k1 * va[1] + k2 * vb[1], z = k1 * va[2] + k2 * vb[2];
    out.push([Math.asin(Math.max(-1, Math.min(1, y))) * R2D, Math.atan2(z, x) * R2D]);
  }
  return out;
}

export class Globe {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.map = null;          // {data, width, height}
    this.lat = 12;
    this.lon = -150;          // the empty Pacific: the whole point of the map
    this.zoom = 1;
    this.overlay = null;
    this.quality = 1;         // dropped while dragging, restored on settle
    this.imageData = null;
    this.space = "#05070c";
  }

  setMap(map) { this.map = map; }

  /** Screen geometry for the current canvas size and zoom. */
  geom() {
    const { width: w, height: h } = this.canvas;
    return { w, h, cx: w / 2, cy: h / 2, R: Math.min(w, h) * 0.47 * this.zoom };
  }

  /* View basis: f points from the globe's centre at the viewer, r is east on
   * screen, u is north. Memoised because drawing the graticule and the overlay
   * projects a couple of thousand points through it per frame. */
  basis() {
    const key = `${this.lat},${this.lon}`;
    if (this._bKey === key) return this._b;
    const lat = Math.max(-89.5, Math.min(89.5, this.lat));
    const f = llToVec(lat, this.lon);
    // r = normalize(f x worldUp) = east
    let rx = -f[2], rz = f[0];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    // u = r x f = north
    const u = [-rz * f[1], rz * f[0] - rx * f[2], rx * f[1]];
    this._bKey = key;
    this._b = { f, r: [rx, 0, rz], u };
    return this._b;
  }

  /** lat/lon -> screen. Returns null when the point is on the far side. */
  project(lat, lon) {
    const { cx, cy, R } = this.geom();
    const { f, r, u } = this.basis();
    const p = llToVec(lat, lon);
    const z = p[0] * f[0] + p[1] * f[1] + p[2] * f[2];
    if (z <= 0) return null;
    const x = p[0] * r[0] + p[1] * r[1] + p[2] * r[2];
    const y = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    return { x: cx + x * R, y: cy - y * R, z };
  }

  /** Canvas pixel -> lat/lon. Returns null outside the disc. */
  unproject(px, py) {
    const { cx, cy, R } = this.geom();
    const nx = (px - cx) / R, ny = (cy - py) / R;
    const q = nx * nx + ny * ny;
    if (q > 1) return null;
    const nz = Math.sqrt(1 - q);
    const { f, r, u } = this.basis();
    const x = nx * r[0] + ny * u[0] + nz * f[0];
    const y = nx * r[1] + ny * u[1] + nz * f[1];
    const z = nx * r[2] + ny * u[2] + nz * f[2];
    return [Math.asin(Math.max(-1, Math.min(1, y))) * R2D, Math.atan2(z, x) * R2D];
  }

  /** Size the backing store to the element, honouring devicePixelRatio. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.imageData = null;
    }
    return { w, h };
  }

  render() {
    const { w, h } = this.resize();
    if (!this.map) return;
    if (!this.imageData || this.imageData.width !== w) {
      this.imageData = this.ctx.createImageData(w, h);
    }
    const out = this.imageData.data;
    const { cx, cy, R } = this.geom();
    const { f, r, u } = this.basis();
    const [fx, fy, fz] = f, [rx, ry, rz] = r, [ux, uy, uz] = u;

    const src = this.map.data, MW = this.map.width, MH = this.map.height;
    const smooth = this.quality >= 1;
    const invR = 1 / R;
    // Rim glow: a couple of pixels of atmosphere so the limb is not a hard cut.
    const glowIn = 1, glowOut = 1 + 14 / R;

    for (let py = 0; py < h; py++) {
      const ny = (cy - py) * invR;
      const ny2 = ny * ny;
      let o = py * w * 4;
      for (let px = 0; px < w; px++, o += 4) {
        const nx = (px - cx) * invR;
        const q = nx * nx + ny2;
        if (q > glowIn) {
          let g = 0;
          if (q < glowOut * glowOut) {
            const t = 1 - (Math.sqrt(q) - 1) / (glowOut - 1);
            g = t * t * 46;
          }
          out[o] = 5 + g * 0.5; out[o + 1] = 7 + g * 0.75; out[o + 2] = 12 + g; out[o + 3] = 255;
          continue;
        }
        const nz = Math.sqrt(1 - q);
        const wx = nx * rx + ny * ux + nz * fx;
        const wy = nx * ry + ny * uy + nz * fy;
        const wz = nx * rz + ny * uz + nz * fz;

        // lat -> row, lon -> column, in map pixels.
        const gy = (0.5 - Math.asin(wy > 1 ? 1 : wy < -1 ? -1 : wy) / Math.PI) * MH - 0.5;
        const gx = (0.5 + Math.atan2(wz, wx) / (2 * Math.PI)) * MW - 0.5;

        let R8, G8, B8;
        if (smooth) {
          let x0 = Math.floor(gx), y0 = Math.floor(gy);
          const tx = gx - x0, ty = gy - y0;
          let x1 = x0 + 1, y1 = y0 + 1;
          x0 = ((x0 % MW) + MW) % MW; x1 = ((x1 % MW) + MW) % MW;
          y0 = y0 < 0 ? 0 : y0 > MH - 1 ? MH - 1 : y0;
          y1 = y1 < 0 ? 0 : y1 > MH - 1 ? MH - 1 : y1;
          const a = (y0 * MW + x0) << 2, b = (y0 * MW + x1) << 2;
          const c = (y1 * MW + x0) << 2, d = (y1 * MW + x1) << 2;
          const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
          const w01 = (1 - tx) * ty, w11 = tx * ty;
          R8 = src[a] * w00 + src[b] * w10 + src[c] * w01 + src[d] * w11;
          G8 = src[a + 1] * w00 + src[b + 1] * w10 + src[c + 1] * w01 + src[d + 1] * w11;
          B8 = src[a + 2] * w00 + src[b + 2] * w10 + src[c + 2] * w01 + src[d + 2] * w11;
        } else {
          let xi = Math.round(gx), yi = Math.round(gy);
          xi = ((xi % MW) + MW) % MW;
          yi = yi < 0 ? 0 : yi > MH - 1 ? MH - 1 : yi;
          const a = (yi * MW + xi) << 2;
          R8 = src[a]; G8 = src[a + 1]; B8 = src[a + 2];
        }

        // Gentle limb darkening: enough to read as a sphere, not so much that it
        // fights the data the colours are carrying.
        const sh = 0.68 + 0.32 * nz;
        out[o] = R8 * sh; out[o + 1] = G8 * sh; out[o + 2] = B8 * sh; out[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
    this.drawGraticule();
    this.drawOverlay();
  }

  drawGraticule() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(190,215,255,0.10)";
    ctx.lineWidth = Math.max(1, this.canvas.width / 900);
    for (let lat = -60; lat <= 60; lat += 30) this.strokePath(ctx, ring(lat, null));
    for (let lon = -180; lon < 180; lon += 30) this.strokePath(ctx, ring(null, lon));
    ctx.strokeStyle = "rgba(190,215,255,0.18)";
    this.strokePath(ctx, ring(0, null));
    ctx.restore();
  }

  strokePath(ctx, pts) {
    ctx.beginPath();
    let pen = false;
    for (const [lat, lon] of pts) {
      const p = this.project(lat, lon);
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; }
    }
    ctx.stroke();
  }

  setOverlay(o) { this.overlay = o; }

  drawOverlay() {
    const o = this.overlay;
    if (!o) return;
    const ctx = this.ctx;
    const s = this.canvas.width / 900;
    ctx.save();
    if (o.line) {
      ctx.strokeStyle = o.lineColor || "#ffffff";
      ctx.lineWidth = 2.4 * s;
      ctx.setLineDash([7 * s, 5 * s]);
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 6 * s;
      this.strokePath(ctx, greatCircle(o.line[0], o.line[1]));
      ctx.setLineDash([]);
    }
    for (const m of o.markers || []) {
      const p = this.project(m.lat, m.lon);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (m.r || 5) * s, 0, Math.PI * 2);
      ctx.fillStyle = m.fill || "#fff";
      ctx.strokeStyle = m.stroke || "rgba(0,0,0,0.8)";
      ctx.lineWidth = 2 * s;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

function ring(lat, lon) {
  const pts = [];
  if (lat !== null) for (let l = -180; l <= 180; l += 3) pts.push([lat, l]);
  else for (let l = -90; l <= 90; l += 3) pts.push([l, lon]);
  return pts;
}
