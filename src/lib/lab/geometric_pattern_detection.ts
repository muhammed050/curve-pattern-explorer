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
  /** Principal-component anisotropy; 0 is isotropic, approaching 1 is line-like. */
  anisotropy: number;
  /** Pearson chi-square statistic for equal occupancy of a 16×16 grid. */
  gridChiSquare: number;
  /** Algebraic least-squares circle candidate, null when ill-conditioned. */
  circle: { cx: number; cy: number; radius: number; rmsResidual: number } | null;
  /** DBSCAN cluster sizes, excluding noise. */
  dbscanClusters: number[];
  dbscanNoise: number;
  /** Sampled Ripley K estimate at 5% of bounding-box diagonal. */
  ripleyK: number;
  ripleyRadius: number;
  /** Cubic polynomial y(x) fit R²; diagnostic only, not a general curve detector. */
  cubicCurveR2: number;
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
    angleDeg: ((Math.atan2(-nx, ny) * 180 / Math.PI) % 180 + 180) % 180,
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

  const anisotropy = (() => {
    if (n < 2) return 0;
    let mx = 0, my = 0;
    for (const i of valid) { mx += inputX[i]!; my += inputY[i]!; }
    mx /= n; my /= n;
    let xx = 0, yy = 0, xy = 0;
    for (const i of valid) { const dx=inputX[i]!-mx, dy=inputY[i]!-my; xx+=dx*dx; yy+=dy*dy; xy+=dx*dy; }
    const trace=xx+yy, disc=Math.sqrt(Math.max(0,(xx-yy)**2+4*xy*xy));
    const l1=(trace+disc)/2, l2=(trace-disc)/2;
    return l1 > 0 ? Math.max(0, Math.min(1, 1-l2/l1)) : 0;
  })();

  // Grid occupancy chi-square: descriptive statistic, not a p-value.
  const gridChiSquare = (() => {
    if (!n || width <= 0 || height <= 0) return 0;
    const side=16, counts=new Uint32Array(side*side);
    for(const i of valid){
      const gx=Math.min(side-1,Math.floor((inputX[i]!-minX)/width*side));
      const gy=Math.min(side-1,Math.floor((inputY[i]!-minY)/height*side));
      counts[gy*side+gx]!++;
    }
    const expected=n/(side*side);
    let chi=0; for(const count of counts) chi+=(count-expected)**2/Math.max(expected,Number.EPSILON);
    return chi;
  })();

  // Algebraic circle fit: x²+y² + A*x + B*y + C = 0, solved by 3x3 elimination.
  const circle = (() => {
    if(n<6) return null;
    const m=[[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    for(const i of valid){
      const x=inputX[i]!, y=inputY[i]!, z=-(x*x+y*y), row=[x,y,1];
      for(let r=0;r<3;r++){ for(let col=0;col<3;col++) m[r]![col]!+=row[r]!*row[col]!; m[r]![3]!+=row[r]!*z; }
    }
    for(let col=0;col<3;col++){
      let pivot=col; for(let r=col+1;r<3;r++) if(Math.abs(m[r]![col]!)>Math.abs(m[pivot]![col]!)) pivot=r;
      if(Math.abs(m[pivot]![col]!)<1e-12) return null;
      [m[col],m[pivot]]=[m[pivot]!,m[col]!];
      const d=m[col]![col]!; for(let j=col;j<4;j++) m[col]![j]!/=d;
      for(let r=0;r<3;r++) if(r!==col){ const q=m[r]![col]!; for(let j=col;j<4;j++) m[r]![j]!-=q*m[col]![j]!; }
    }
    const A=m[0]![3]!, B=m[1]![3]!, C=m[2]![3]!;
    const cx=-A/2, cy=-B/2, rad2=cx*cx+cy*cy-C;
    if(!(rad2>0) || !Number.isFinite(rad2)) return null;
    const radius=Math.sqrt(rad2); let sum=0;
    for(const i of valid){ const e=Math.hypot(inputX[i]!-cx,inputY[i]!-cy)-radius; sum+=e*e; }
    return {cx,cy,radius,rmsResidual:Math.sqrt(sum/n)};
  })();

  // DBSCAN on a bounded deterministic subsample to keep browser work predictable.
  const db = (() => {
    const ids = n>1800 ? Array.from({length:1800},(_,k)=>valid[Math.floor(k*n/1800)]!) : valid;
    const eps=diagonal*0.012, minPts=6, labels=new Int32Array(ids.length);
    const neighbors=(p:number)=>{const out:number[]=[];for(let q=0;q<ids.length;q++){const dx=inputX[ids[p]!]!-inputX[ids[q]!]!,dy=inputY[ids[p]!]!-inputY[ids[q]!]!;if(dx*dx+dy*dy<=eps*eps)out.push(q);}return out;};
    let cluster=0;
    for(let p=0;p<ids.length;p++){
      if(labels[p]!==0) continue;
      const near=neighbors(p);
      if(near.length<minPts){labels[p]=-1;continue;}
      cluster++; labels[p]=cluster; const queue=near.slice(); const seen=new Set(queue);
      for(let q=0;q<queue.length;q++){
        const at=queue[q]!;
        if(labels[at]===-1) labels[at]=cluster;
        if(labels[at]!==0) continue;
        labels[at]=cluster;
        const more=neighbors(at);
        if(more.length>=minPts) for(const v of more) if(!seen.has(v)){seen.add(v);queue.push(v);}
      }
    }
    const sizes=new Array(cluster).fill(0);let noise=0;
    for(const label of labels){if(label>0)sizes[label-1]++;else noise++;}
    return {sizes:sizes.sort((a,b)=>b-a).slice(0,10),noise};
  })();

  // Ripley K estimate from a seeded pair sample; no edge correction is applied.
  const ripleyRadius=diagonal*0.05;
  let ripleyHits=0;
  for(let k=0;k<sampledPairs;k++){
    const ai=Math.floor(rnd()*n);let bi=Math.floor(rnd()*(n-1));if(bi>=ai)bi++;
    const dx=inputX[valid[ai]!]!-inputX[valid[bi]!]!,dy=inputY[valid[ai]!]!-inputY[valid[bi]!]!;
    if(dx*dx+dy*dy<=ripleyRadius*ripleyRadius)ripleyHits++;
  }
  const area=Math.max(width*height,Number.EPSILON);
  const ripleyK=n>1&&sampledPairs>0 ? area*2*ripleyHits/(sampledPairs*n) : 0;

  // Cubic y(x) least-squares R². This detects only single-valued y=f(x) shapes.
  const cubicCurveR2 = (() => {
    if(n<8||width<=0) return 0;
    const sums=new Float64Array(16), rhs=new Float64Array(4);
    let mean=0;for(const i of valid)mean+=inputY[i]!;mean/=n;
    let total=0;
    for(const i of valid){
      const x=(inputX[i]!-minX)/width, y=inputY[i]!, powers=[1,x,x*x,x*x*x,x*x*x*x,x*x*x*x*x,x*x*x*x*x*x];
      for(let r=0;r<4;r++){rhs[r]!+=powers[r]!*y;for(let col=0;col<4;col++)sums[r*4+col]!+=powers[r+col]!*1;}
      total+=(y-mean)**2;
    }
    const mat=Array.from({length:4},(_,r)=>[...Array.from({length:4},(_,col)=>sums[r*4+col]!),rhs[r]!]);
    for(let col=0;col<4;col++){let p=col;for(let r=col+1;r<4;r++)if(Math.abs(mat[r]![col]!)>Math.abs(mat[p]![col]!))p=r;if(Math.abs(mat[p]![col]!)<1e-12)return 0;[mat[col],mat[p]]=[mat[p]!,mat[col]!];const d=mat[col]![col]!;for(let j=col;j<5;j++)mat[col]![j]!/=d;for(let r=0;r<4;r++)if(r!==col){const q=mat[r]![col]!;for(let j=col;j<5;j++)mat[r]![j]!-=q*mat[col]![j]!;}}
    let residual=0;for(const i of valid){const x=(inputX[i]!-minX)/width,y=inputY[i]!,pred=mat[0]![4]!+mat[1]![4]!*x+mat[2]![4]!*x*x+mat[3]![4]!*x*x*x;residual+=(y-pred)**2;}
    return total>0?1-residual/total:0;
  })();

  return { inputCount, validCount: n, threshold, lines, directionPeaks: peaks, sampledPairs, anisotropy, gridChiSquare, circle, dbscanClusters: db.sizes, dbscanNoise: db.noise, ripleyK, ripleyRadius, cubicCurveR2 };
}
