// Colormap + binning helpers for the canvas renderer.
const STOPS: [number, number, number][] = [
  [20, 34, 110], [36, 98, 210], [40, 182, 228], [130, 100, 245], [236, 112, 206],
];
export function colormap(t: number): [number, number, number] {
  t = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i;
  const a = STOPS[i]!, b = STOPS[i + 1]!;
  return [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f];
}
export const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]! | 0},${c[1]! | 0},${c[2]! | 0},${a})`;

export type VizMode = "points" | "density" | "hist2d" | "kde" | "neighborhood" | "colordist";
export const MODES: { id: VizMode; label: string }[] = [
  { id: "points", label: "Points" },
  { id: "density", label: "Density heatmap" },
  { id: "hist2d", label: "2D histogram" },
  { id: "kde", label: "Kernel density" },
  { id: "neighborhood", label: "Neighbourhood map" },
  { id: "colordist", label: "Colour distribution" },
];

export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

export function bounds(x: Float64Array, y: Float64Array): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) continue;
    if (x[i]! < minX) minX = x[i]!; if (x[i]! > maxX) maxX = x[i]!;
    if (y[i]! < minY) minY = y[i]!; if (y[i]! > maxY) maxY = y[i]!;
  }
  if (!Number.isFinite(minX)) return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };
  const pw = (maxX - minX || 1) * 0.04, ph = (maxY - minY || 1) * 0.04;
  return { minX: minX - pw, maxX: maxX + pw, minY: minY - ph, maxY: maxY + ph };
}

/** Bin counts (and optional mean of a value) on a B×B grid over bounds. */
export function bin(x: Float64Array, y: Float64Array, b: Bounds, B: number, val?: ArrayLike<number>) {
  const cnt = new Float64Array(B * B), sum = new Float64Array(B * B);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) continue;
    const gx = Math.min(B - 1, Math.floor(((x[i]! - b.minX) / w) * B));
    const gy = Math.min(B - 1, Math.floor(((y[i]! - b.minY) / h) * B));
    if (gx < 0 || gy < 0) continue;
    cnt[gy * B + gx]!++;
    if (val) sum[gy * B + gx]! += val[i]!;
  }
  return { cnt, sum };
}

/** Separable Gaussian blur → kernel density estimate. */
export function gaussianBlur(src: Float64Array, B: number, sigma: number) {
  const r = Math.ceil(sigma * 3), k: number[] = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); ks += v; }
  const tmp = new Float64Array(B * B), out = new Float64Array(B * B);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < B) s += src[y * B + xx]! * k[i + r]!; }
    tmp[y * B + x]! = s / ks;
  }
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) { const yy = y + i; if (yy >= 0 && yy < B) s += tmp[yy * B + x]! * k[i + r]!; }
    out[y * B + x]! = s / ks;
  }
  return out;
}

export function rankArray(vals: Float64Array): Float32Array {
  const idx = Array.from(vals.keys()).filter((i) => Number.isFinite(vals[i]!)).sort((a, b) => vals[a]! - vals[b]!);
  const out = new Float32Array(vals.length).fill(NaN);
  idx.forEach((i, r) => { out[i]! = idx.length > 1 ? r / (idx.length - 1) : 0; });
  return out;
}
