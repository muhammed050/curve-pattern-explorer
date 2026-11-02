// Projection optimizer: seeded random search + genetic algorithm with local mutation.
// Mode "public" never reads rank/scalar data. Mode "label" maximises LCS over synthetic labels.
import { compileProjection, type CustomFn } from "./formula";
import { defaultSteps, describePipeline, project, STEP_DEFS, STEP_ORDER, type Step } from "./projection_algorithms";
import { computeStats, nearestNeighbors } from "./statistical_analysis";

export type OptMode = "public" | "label";

export const FORMULA_LIBRARY: [string, string, string][] = [
  ["Sine warp", "u + a*sin(2*pi*b*v)", "v + a*cos(2*pi*b*u)"],
  ["Log-polar", "atan2(v,u)/pi", "log(r + 0.001)"],
  ["Modular fold", "frac(b*u*7)", "frac(b*v*7)"],
  ["Hyperbolic", "u*v*b*10", "u^2 - v^2"],
  ["Spiral", "r*cos(theta + b*10*r)", "r*sin(theta + b*10*r)"],
  ["Tanh squash", "tanh(b*4*u + a*v)", "tanh(b*4*v - a*u)"],
];

export interface Genome { steps: Step[]; formula: number }
export interface Result {
  id: number; generation: number; score: number; lcs: number; clarkEvans: number; cellCV: number;
  algorithm: string; genome: Genome; source: "random" | "genetic" | "elite";
}
export interface Progress { experiment: number; best: number; current: number }

export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const compiled = FORMULA_LIBRARY.map(([, fx, fy]) => compileProjection(fx, fy).fn);
export const formulaFn = (i: number): CustomFn | null => compiled[i] ?? null;

/** Public-only structure objective: grid-count CV + (1 − Clark–Evans R). Uses only x,y. */
export function publicObjective(x: Float64Array, y: Float64Array) {
  const n = x.length, idx: number[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = x[i]!, b = y[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    idx.push(i);
    if (a < minX) minX = a; if (a > maxX) maxX = a; if (b < minY) minY = b; if (b > maxY) maxY = b;
  }
  const m = idx.length;
  if (m < 10) return { score: -Infinity, clarkEvans: NaN, cellCV: NaN };
  const w = maxX - minX || 1e-12, h = maxY - minY || 1e-12, s = Math.max(w, h);
  const px = new Float64Array(n), py = new Float64Array(n);
  for (const i of idx) { px[i] = (x[i]! - minX) / s; py[i] = (y[i]! - minY) / s; }
  const { dist } = nearestNeighbors(px, py, idx);
  let sum = 0, c = 0;
  for (const i of idx) if (Number.isFinite(dist[i]!)) { sum += dist[i]!; c++; }
  const R = (sum / c) / (0.5 / Math.sqrt(m / ((w / s) * (h / s))));
  const B = 20, counts = new Float64Array(B * B);
  for (const i of idx) {
    const gx = Math.min(B - 1, Math.floor(((x[i]! - minX) / w) * B)), gy = Math.min(B - 1, Math.floor(((y[i]! - minY) / h) * B));
    counts[gy * B + gx]!++;
  }
  let cs = 0, cq = 0;
  for (const v of counts) { cs += v; cq += v * v; }
  const mean = cs / counts.length, cv = Math.sqrt(Math.max(0, cq / counts.length - mean * mean)) / mean;
  // Penalise degenerate collapse (almost every point in one cell).
  const degenerate = Math.max(...counts) / m > 0.5 ? 2 : 0;
  return { score: cv + Math.max(0, 1 - R) - degenerate, clarkEvans: R, cellCV: cv };
}

export function evaluate(g: Genome, u: Float64Array, v: Float64Array, rank: Float32Array, mode: OptMode) {
  const p = project(u, v, g.steps, formulaFn(g.formula));
  const pub = publicObjective(p.x, p.y);
  if (mode === "public") return { ...pub, lcs: NaN };
  const st = computeStats(p.x, p.y, rank);
  return { score: Number.isFinite(st.lcs) ? st.lcs : -Infinity, lcs: st.lcs, clarkEvans: pub.clarkEvans, cellCV: pub.cellCV };
}

function randomGenome(rnd: () => number): Genome {
  const steps = defaultSteps();
  for (const s of steps) {
    s.enabled = rnd() < 0.3;
    for (const p of STEP_DEFS[s.type].params) s.params[p.key] = +(p.min + rnd() * (p.max - p.min)).toFixed(3);
  }
  if (!steps.some((s) => s.enabled)) steps[Math.floor(rnd() * steps.length)]!.enabled = true;
  return { steps, formula: Math.floor(rnd() * FORMULA_LIBRARY.length) };
}

function gauss(rnd: () => number) { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }

function mutate(g: Genome, rnd: () => number): Genome {
  const steps = g.steps.map((s) => {
    const n: Step = { ...s, params: { ...s.params } };
    if (rnd() < 0.1) n.enabled = !n.enabled;
    for (const p of STEP_DEFS[s.type].params) {
      if (rnd() < 0.35) {
        const val = (n.params[p.key] ?? p.def) + gauss(rnd) * 0.12 * (p.max - p.min);
        n.params[p.key] = +Math.min(p.max, Math.max(p.min, val)).toFixed(3);
      }
    }
    return n;
  });
  if (!steps.some((s) => s.enabled)) steps[Math.floor(rnd() * steps.length)]!.enabled = true;
  return { steps, formula: rnd() < 0.1 ? Math.floor(rnd() * FORMULA_LIBRARY.length) : g.formula };
}

function crossover(a: Genome, b: Genome, rnd: () => number): Genome {
  return {
    steps: STEP_ORDER.map((_, i) => {
      const src = rnd() < 0.5 ? a.steps[i]! : b.steps[i]!;
      return { ...src, params: { ...src.params } };
    }),
    formula: rnd() < 0.5 ? a.formula : b.formula,
  };
}

export function genomeLabel(g: Genome): string {
  const base = describePipeline(g.steps);
  return g.steps.some((s) => s.enabled && s.type === "custom") ? `${base} [${FORMULA_LIBRARY[g.formula]![0]}]` : base;
}

export interface RunOpts {
  mode: OptMode; seed: number; generations: number; population: number; evalSize: number;
  u: Float64Array; v: Float64Array; rank: Float32Array;
  control: { stop: boolean; paused: boolean };
  onResult: (r: Result, p: Progress, gen: number) => void;
}

export async function runOptimizer(o: RunOpts): Promise<Result[]> {
  const rnd = mulberry32(o.seed);
  const m = Math.min(o.u.length, o.evalSize);
  const u = o.u.slice(0, m), v = o.v.slice(0, m);
  // In public mode rank is replaced with zeros so labels cannot influence the objective.
  const rank = o.mode === "label" ? o.rank.slice(0, m) : new Float32Array(m);
  const all: Result[] = [];
  let id = 0, best = -Infinity;
  let pop: { g: Genome; src: Result["source"] }[] = Array.from({ length: o.population }, () => ({ g: randomGenome(rnd), src: "random" as const }));
  for (let gen = 0; gen < o.generations; gen++) {
    const scored: Result[] = [];
    for (const { g, src } of pop) {
      while (o.control.paused && !o.control.stop) await new Promise((r) => setTimeout(r, 120));
      if (o.control.stop) return all;
      const e = evaluate(g, u, v, rank, o.mode);
      const r: Result = { id: ++id, generation: gen, score: e.score, lcs: e.lcs, clarkEvans: e.clarkEvans, cellCV: e.cellCV, algorithm: genomeLabel(g), genome: g, source: src };
      if (r.score > best) best = r.score;
      scored.push(r); all.push(r);
      o.onResult(r, { experiment: id, best, current: r.score }, gen);
      if (id % 3 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    scored.sort((a, b) => b.score - a.score);
    const elite = scored.slice(0, Math.max(2, Math.round(o.population * 0.15)));
    const pick = () => {
      const a = scored[Math.floor(rnd() * scored.length)]!, b = scored[Math.floor(rnd() * scored.length)]!;
      return a.score > b.score ? a : b;
    };
    const next: typeof pop = elite.map((r) => ({ g: r.genome, src: "elite" as const }));
    while (next.length < o.population) {
      if (rnd() < 0.25) next.push({ g: randomGenome(rnd), src: "random" });
      else next.push({ g: mutate(crossover(pick().genome, pick().genome, rnd), rnd), src: "genetic" });
    }
    pop = next;
  }
  return all;
}

export function genomeToFormula(g: Genome): [string, string] {
  const f = FORMULA_LIBRARY[g.formula]!;
  return [f[1], f[2]];
}
