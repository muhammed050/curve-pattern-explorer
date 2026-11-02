// Spatial statistics on projected coordinates. Grid-hashed nearest neighbours (O(n) average).
export interface Stats {
  n: number; valid: number;
  bboxW: number; bboxH: number; density: number;
  nnMean: number; nnMin: number; nnMax: number; nnStd: number;
  pairMean: number; pairMin: number; pairMax: number;
  clarkEvans: number; emptyCells: number; cellCV: number;
  localDiff: number; baselineDiff: number; lcs: number; lcsZ: number;
  centroidX: number; centroidY: number; stdX: number; stdY: number;
  nnIdx: Int32Array;
  nnDist: Float64Array; // normalized-space NN distance per point (NaN if invalid)
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Indices of nearest neighbour for each valid point in unit-square coords. */
export function nearestNeighbors(px: Float64Array, py: Float64Array, idx: number[]) {
  const m = idx.length;
  const G = Math.max(1, Math.floor(Math.sqrt(m / 2)));
  const cells: number[][] = Array.from({ length: G * G }, () => []);
  const cell = (t: number) => Math.min(G - 1, Math.max(0, Math.floor(t * G)));
  for (const i of idx) cells[cell(py[i]!) * G + cell(px[i]!)]!.push(i);
  const nn = new Int32Array(px.length).fill(-1), dist = new Float64Array(px.length).fill(NaN);
  for (const i of idx) {
    const cx = cell(px[i]!), cy = cell(py[i]!);
    let best = Infinity, bj = -1;
    for (let ring = 0; ring <= G; ring++) {
      for (let gy = cy - ring; gy <= cy + ring; gy++) {
        if (gy < 0 || gy >= G) continue;
        for (let gx = cx - ring; gx <= cx + ring; gx++) {
          if (gx < 0 || gx >= G) continue;
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
          for (const j of cells[gy * G + gx]!) {
            if (j === i) continue;
            const d = (px[i]! - px[j]!) ** 2 + (py[i]! - py[j]!) ** 2;
            if (d < best) { best = d; bj = j; }
          }
        }
      }
      if (bj >= 0 && Math.sqrt(best) <= ring / G) break;
    }
    nn[i]! = bj; dist[i]! = bj >= 0 ? Math.sqrt(best) : NaN;
  }
  return { nn, dist };
}

export function computeStats(x: Float64Array, y: Float64Array, rank: Float32Array): Stats {
  const n = x.length;
  const idx: number[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) continue;
    idx.push(i);
    if (x[i]! < minX) minX = x[i]!; if (x[i]! > maxX) maxX = x[i]!;
    if (y[i]! < minY) minY = y[i]!; if (y[i]! > maxY) maxY = y[i]!;
  }
  const m = idx.length;
  const w = maxX - minX || 1, h = maxY - minY || 1;
  // Normalize to unit square preserving aspect ratio for distance stats.
  const s = Math.max(w, h);
  const px = new Float64Array(n), py = new Float64Array(n);
  let sx = 0, sy = 0;
  for (const i of idx) { px[i]! = (x[i]! - minX) / s; py[i]! = (y[i]! - minY) / s; sx += x[i]!; sy += y[i]!; }
  const cX = sx / m, cY = sy / m;
  let vx = 0, vy = 0;
  for (const i of idx) { vx += (x[i]! - cX) ** 2; vy += (y[i]! - cY) ** 2; }

  const { nn, dist } = nearestNeighbors(px, py, idx);
  let nnSum = 0, nnSq = 0, nnMin = Infinity, nnMax = 0, ld = 0, ldSq = 0, cnt = 0;
  for (const i of idx) {
    if (nn[i]! < 0) continue;
    const d = dist[i]!;
    nnSum += d; nnSq += d * d; if (d < nnMin) nnMin = d; if (d > nnMax) nnMax = d;
    const diff = Math.abs(rank[i]! - rank[nn[i]!]!);
    ld += diff; ldSq += diff * diff; cnt++;
  }
  const nnMean = cnt ? nnSum / cnt : NaN;

  // Random pair baselines (deterministic seed so the same sample gives the same baseline).
  const rnd = mulberry32(m * 2654435761);
  const K = Math.min(20000, m * 4);
  let bd = 0, pm = 0, pMin = Infinity, pMax = 0, k2 = 0;
  for (let t = 0; t < K && m > 1; t++) {
    const i = idx[Math.floor(rnd() * m)]!, j = idx[Math.floor(rnd() * m)]!;
    if (i === j) continue;
    bd += Math.abs(rank[i]! - rank[j]!);
    const d = Math.hypot(px[i]! - px[j]!, py[i]! - py[j]!);
    pm += d; if (d < pMin) pMin = d; if (d > pMax) pMax = d; k2++;
  }
  const baselineDiff = k2 ? bd / k2 : NaN, localDiff = cnt ? ld / cnt : NaN;
  const sdLocal = cnt ? Math.sqrt(Math.max(0, ldSq / cnt - localDiff ** 2)) : NaN;
  const lcsZ = (baselineDiff - localDiff) / (sdLocal / Math.sqrt(cnt));

  // Occupancy on a 20x20 grid over the bounding box.
  const B = 20, counts = new Float64Array(B * B);
  for (const i of idx) {
    const gx = Math.min(B - 1, Math.floor(((x[i]! - minX) / w) * B)), gy = Math.min(B - 1, Math.floor(((y[i]! - minY) / h) * B));
    counts[gy * B + gx]!++;
  }
  let empty = 0, cs = 0, cq = 0;
  for (const c of counts) { if (c === 0) empty++; cs += c; cq += c * c; }
  const cm = cs / counts.length, cv = Math.sqrt(Math.max(0, cq / counts.length - cm * cm)) / (cm || 1);
  const areaUnit = (w / s) * (h / s);
  const expectedNN = 0.5 / Math.sqrt(m / areaUnit);

  return {
    n, valid: m, bboxW: w, bboxH: h, density: m / (w * h),
    nnMean, nnMin: cnt ? nnMin : NaN, nnMax, nnStd: cnt ? Math.sqrt(Math.max(0, nnSq / cnt - nnMean ** 2)) : NaN,
    pairMean: k2 ? pm / k2 : NaN, pairMin: k2 ? pMin : NaN, pairMax: pMax,
    clarkEvans: nnMean / expectedNN, emptyCells: empty / counts.length, cellCV: cv,
    localDiff, baselineDiff, lcs: 1 - localDiff / baselineDiff, lcsZ,
    centroidX: cX, centroidY: cY, stdX: Math.sqrt(vx / m), stdY: Math.sqrt(vy / m),
    nnDist: dist, nnIdx: nn,
  };
}

export type StatsSummary = Omit<Stats, "nnDist" | "nnIdx">;
export function summarize(s: Stats): StatsSummary {
  const { nnDist: _drop, nnIdx: _drop2, ...rest } = s;
  void _drop; void _drop2;
  return rest;
}
