/**
 * Geometric diagnostics for public secp256k1 point coordinates.
 *
 * This module only consumes normalized public X/Y coordinates. It never reads
 * private scalars, sample ranks, labels, or colour values.
 *
 * RANSAC is a candidate finder, not a significance test: random point clouds
 * can contain apparent alignments. Always compare discoveries with a
 * curve-aware null model before interpreting them as non-random structure.
 */
export interface GeometricLine {
  count: number;
  fraction: number;
  angleDeg: number;
  offset: number;
  rmsResidual: number;
  maxResidual: number;
  /** Unit normal (nx, ny); line equation nx*x + ny*y = offset. */
  nx: number;
  ny: number;
}

export interface DirectionPeak {
  angleDeg: number;
  count: number;
  fraction: number;
}

export interface GeometricPatternResult {
  inputCount: number;
  validCount: number;
  threshold: number;
  lines: GeometricLine[];
  directionPeaks: DirectionPeak[];
  sampledPairs: number;
}

export interface GeometricPatternOptions {
  /** Residual tolerance as a fraction of the bounding-box diagonal. */
  tolerance?: number;
  iterations?: number;
  maxLines?: number;
  minInliers?: number;
  directionBins?: number;
  maxDirectionPairs?: number;
  seed?: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fitLine(points: number[], x: Float64Array, y: Float64Array) {
  let mx = 0, my = 0;
  for (const i of points) { mx += x[i]!; my += y[i]!; }
  mx /= points.length; my /= points.length;
  let xx = 0, yy = 0, xy = 0;
  for (const i of points) {
    const dx = x[i]! - mx, dy = y[i]! - my;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
  }
  // Principal direction of the 2×2 covariance matrix.
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let nx = -Math.sin(angle), ny = Math.cos(angle);
  let offset = nx * mx + ny * my;
  if (offset < 0) { nx = -nx; ny = -ny; offset = -offset; }
  let sumSq = 0, maxResidual = 0;
  for (const i of points) {
    const d = Math.abs(nx * x[i]! + ny * y[i]! - offset);
    sumSq += d * d;
    if (d > maxResidual) maxResidual = d;
  }
  return {
    count: points.length, fraction: 0,
    angleDeg: ((Math.atan2(ny, -nx) * 180 / Math.PI) % 180 + 180) % 180,
    offset, rmsResidual: Math.sqrt(sumSq / points.length), maxResidual, nx, ny,
  };
}

function inliersForLine(
  x: Float64Array, y: Float64Array, indices: number[],
  nx: number, ny: number, offset: number, threshold: number,
) {
  const found: number[] = [];
  for (const i of indices) {
    if (Math.abs(nx * x[i]! + ny * y[i]! - offset) <= threshold) found.push(i);
  }
  return found;
}

/** Detect strong straight-line candidates with seeded RANSAC + TLS refinement. */
export function detectGeometricPatterns(
  inputX: Float64Array,
  inputY: Float64Array,
  options: GeometricPatternOptions = {},
): GeometricPatternResult {
  const inputCount = Math.min(inputX.length, inputY.length);
  const valid: number[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < inputCount; i++) {
    const x = inputX[i]!, y = inputY[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    valid.push(i);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const n = valid.length;
  const width = maxX - minX, height = maxY - minY;
  const diagonal = Math.hypot(width, height);
  const tolerance = options.tolerance ?? 0.0015;
  const threshold = diagonal > 0 ? diagonal * tolerance : 0;
  const lines: GeometricLine[] = [];
  if (n >= 3 && diagonal > 0 && threshold > 0) {
    const rnd = mulberry32(options.seed ?? 0x5ec256);
    let remaining = valid.slice();
    const iterations = Math.max(1, Math.floor(options.iterations ?? 1800));
    const maxLines = Math.max(0, Math.floor(options.maxLines ?? 5));
    const minInliers = Math.max(3, Math.floor(options.minInliers ?? Math.max(6, Math.ceil(n * 0.001))));
    for (let lineNo = 0; lineNo < maxLines && remaining.length >= minInliers; lineNo++) {
      let best: number[] = [];
      let bestNx = 0, bestNy = 0, bestOffset = 0;
      for (let k = 0; k < iterations; k++) {
        const ai = Math.floor(rnd() * remaining.length);
        let bi = Math.floor(rnd() * (remaining.length - 1));
        if (bi >= ai) bi++;
        const a = remaining[ai]!, b = remaining[bi]!;
        const dx = inputX[b]! - inputX[a]!, dy = inputY[b]! - inputY[a]!;
        const length = Math.hypot(dx, dy);
        if (length <= Number.EPSILON) continue;
        const nx = -dy / length, ny = dx / length;
        const offset = nx * inputX[a]! + ny * inputY[a]!;
        const candidate = inliersForLine(inputX, inputY, remaining, nx, ny, offset, threshold);
        if (candidate.length > best.length) {
          best = candidate; bestNx = nx; bestNy = ny; bestOffset = offset;
        }
      }
      if (best.length < minInliers) break;
      // Two TLS passes reduce sensitivity to the sampled seed pair.
      let refined = fitLine(best, inputX, inputY);
      let refinedInliers = inliersForLine(inputX, inputY, remaining, refined.nx, refined.ny, refined.offset, threshold);
      if (refinedInliers.length >= minInliers) {
        refined = fitLine(refinedInliers, inputX, inputY);
        refinedInliers = inliersForLine(inputX, inputY, remaining, refined.nx, refined.ny, refined.offset, threshold);
      }
      if (refinedInliers.length < minInliers) {
        refined = fitLine(best, inputX, inputY);
        refinedInliers = best;
      }
      refined.count = refinedInliers.length;
      refined.fraction = refinedInliers.length / n;
      lines.push(refined);
      const removed = new Set(refinedInliers);
      remaining = remaining.filter((i) => !removed.has(i));
      void bestNx; void bestNy; void bestOffset;
    }
  }

  // Direction histogram: unoriented pair directions, sampled deterministically.
  const bins = Math.max(4, Math.floor(options.directionBins ?? 36));
  const maxPairs = Math.max(0, Math.floor(options.maxDirectionPairs ?? 30000));
  const pairTotal = n * (n - 1) / 2;
  const sampledPairs = Math.min(pairTotal, maxPairs);
  const hist = new Uint32Array(bins);
  const rnd = mulberry32((options.seed ?? 0x5ec256) ^ 0x41c64e6d);
  for (let k = 0; k < sampledPairs; k++) {
    const ai = Math.floor(rnd() * n);
    let bi = Math.floor(rnd() * (n - 1));
    if (bi >= ai) bi++;
    const dx = inputX[valid[bi]!]! - inputX[valid[ai]!]!;
    const dy = inputY[valid[bi]!]! - inputY[valid[ai]!]!;
    if (dx === 0 && dy === 0) continue;
    const angle = (Math.atan2(dy, dx) + Math.PI) % Math.PI;
    const bin = Math.min(bins - 1, Math.floor(angle / Math.PI * bins));
    hist[bin]!++;
  }
  const peaks = Array.from(hist, (count, i) => ({
    angleDeg: (i + 0.5) * 180 / bins,
    count,
    fraction: sampledPairs ? count / sampledPairs : 0,
  })).sort((a, b) => b.count - a.count).slice(0, 5);

  return { inputCount, validCount: n, threshold, lines, directionPeaks: peaks, sampledPairs };
}
