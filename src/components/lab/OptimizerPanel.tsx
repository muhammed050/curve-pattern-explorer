import { useMemo, useRef, useState } from "react";
import { Pause, Play, Square, FileDown, Check, Save, AlertTriangle } from "lucide-react";
import { generateSample, type Sample } from "@/lib/lab/cryptography_engine";
import { evaluate, genomeLabel, runOptimizer, formulaFn, FORMULA_LIBRARY, type Genome, type OptMode, type Progress, type Result } from "@/lib/lab/optimizer";
import { defaultSteps, project, STEP_DEFS } from "@/lib/lab/projection_algorithms";
import { PointCanvas, type Viz } from "./PointCanvas";

const fmt = (v: number, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : "—");

interface Stability { samples: number; bestMean: number; bestSd: number; baseMean: number; baseSd: number; perSample: { best: number; base: number }[] }

interface Props {
  sample: Sample; viz: Viz; colors: Float32Array;
  palette: (t: number) => [number, number, number]; levels: number;
  onApply: (g: Genome) => void; onSave: (name: string, g: Genome) => void;
}

export function OptimizerPanel({ sample, viz, colors, palette, levels, onApply, onSave }: Props) {
  const [mode, setMode] = useState<OptMode>("public");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [generations, setGenerations] = useState(20);
  const [population, setPopulation] = useState(24);
  const [evalSize, setEvalSize] = useState(2000);
  const [status, setStatus] = useState<"idle" | "running" | "paused" | "done" | "stopped" | "checking">("idle");
  const [results, setResults] = useState<Result[]>([]);
  const [history, setHistory] = useState<Progress[]>([]);
  const [gen, setGen] = useState(0);
  const [stability, setStability] = useState<Stability | null>(null);
  const [runMeta, setRunMeta] = useState<{ mode: OptMode; seed: number; n: number; evalSize: number; baseline: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const control = useRef({ stop: false, paused: false });

  const baselineGenome: Genome = useMemo(() => ({ steps: defaultSteps(), formula: 0 }), []);

  const start = async () => {
    control.current = { stop: false, paused: false };
    setResults([]); setHistory([]); setStability(null); setGen(0); setSaved(false); setStatus("running");
    const m = Math.min(sample.n, evalSize);
    const baseRank = mode === "label" ? sample.rank.slice(0, m) : new Float32Array(m);
    const baseline = evaluate(baselineGenome, sample.u.slice(0, m), sample.v.slice(0, m), baseRank, mode).score;
    setRunMeta({ mode, seed, n: sample.n, evalSize: m, baseline });
    const buf: Result[] = [], hbuf: Progress[] = [];
    let last = 0;
    const all = await runOptimizer({
      mode, seed, generations, population, evalSize, u: sample.u, v: sample.v, rank: sample.rank, control: control.current,
      onResult: (r, p, g) => {
        buf.push(r); hbuf.push(p);
        const now = performance.now();
        if (now - last > 150) { last = now; setResults([...buf]); setHistory([...hbuf]); setGen(g); }
      },
    });
    setResults([...all]); setHistory([...hbuf]);
    if (control.current.stop) { setStatus("stopped"); return; }
    // Stability across fresh synthetic samples.
    setStatus("checking");
    const best = [...all].sort((a, b) => b.score - a.score)[0];
    if (best) {
      const per: { best: number; base: number }[] = [];
      for (let k = 0; k < 3; k++) {
        if (control.current.stop) break;
        const s = await generateSample(1000);
        const rk = mode === "label" ? s.rank : new Float32Array(s.n);
        per.push({ best: evaluate(best.genome, s.u, s.v, rk, mode).score, base: evaluate(baselineGenome, s.u, s.v, rk, mode).score });
      }
      const ms = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return [m, Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length)] as const; };
      const [bm, bs] = ms(per.map((p) => p.best)), [am, as] = ms(per.map((p) => p.base));
      setStability({ samples: per.length, bestMean: bm, bestSd: bs, baseMean: am, baseSd: as, perSample: per });
    }
    setStatus("done");
  };

  const pause = () => { control.current.paused = !control.current.paused; setStatus(control.current.paused ? "paused" : "running"); };
  const stop = () => { control.current.stop = true; control.current.paused = false; };

  const top = useMemo(() => {
    const seen = new Set<string>(), out: Result[] = [];
    for (const r of [...results].sort((a, b) => b.score - a.score)) {
      const key = JSON.stringify(r.genome);
      if (seen.has(key) || !Number.isFinite(r.score)) continue;
      seen.add(key); out.push(r);
      if (out.length >= 10) break;
    }
    return out;
  }, [results]);
  const best = top[0];
  const algos = useMemo(() => new Set(results.map((r) => r.algorithm)).size, [results]);
  const bestProj = useMemo(() => (best ? project(sample.u, sample.v, best.genome.steps, formulaFn(best.genome.formula)) : null), [best, sample]);
  const running = status === "running" || status === "paused";

  const report = best && runMeta ? buildReport(best, runMeta, stability) : "";
  const downloadReport = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([report], { type: "text/markdown" }));
    a.download = `discovery-report-seed-${runMeta?.seed}.md`; a.click();
  };

  return (
    <div className="w-full space-y-4">
      {/* Controls */}
      <div className="glass grid gap-4 rounded-xl border border-border p-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <div className="lab-label">Optimization mode</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button disabled={running} onClick={() => setMode("public")} className={`rounded-lg border p-3 text-left text-sm transition-colors ${mode === "public" ? "border-primary bg-primary/10" : "border-border"}`}>
              <div className="font-medium">A · Public-only</div>
              <div className="text-xs text-muted-foreground">Uses only public X/Y. Maximises density structure (cell CV + clustering).</div>
            </button>
            <button disabled={running} onClick={() => setMode("label")} className={`rounded-lg border p-3 text-left text-sm transition-colors ${mode === "label" ? "border-accent bg-accent/10" : "border-border"}`}>
              <div className="font-medium">B · Synthetic colour-pattern research</div>
              <div className="text-xs text-muted-foreground">Maximises Local Colour Similarity over synthetic labels.</div>
            </button>
          </div>
          {mode === "label" && (
            <div className="flex gap-2 rounded-md border border-accent/50 bg-accent/10 p-3 text-xs">
              <AlertTriangle size={16} className="shrink-0 text-accent" />
              <div><b>Experimental label-guided optimization — synthetic data only.</b> The chosen parameters are selected <i>using</i> the synthetic colour labels, so the resulting arrangement is not independent of those labels. A high score reflects overfitting to this sample and does not demonstrate any method for recovering real private keys.</div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="text-muted-foreground">Random seed
            <div className="mt-1 flex gap-1"><input type="number" className="lab-input font-mono" value={seed} disabled={running} onChange={(e) => setSeed(+e.target.value | 0)} />
              <button className="lab-btn" disabled={running} onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>↻</button></div>
          </label>
          <label className="text-muted-foreground">Generations
            <input type="number" min={1} max={200} className="lab-input mt-1" value={generations} disabled={running} onChange={(e) => setGenerations(Math.max(1, Math.min(200, +e.target.value)))} />
          </label>
          <label className="text-muted-foreground">Population
            <input type="number" min={6} max={100} className="lab-input mt-1" value={population} disabled={running} onChange={(e) => setPopulation(Math.max(6, Math.min(100, +e.target.value)))} />
          </label>
          <label className="text-muted-foreground">Points per evaluation
            <select className="lab-input mt-1" value={evalSize} disabled={running} onChange={(e) => setEvalSize(+e.target.value)}>
              {[500, 1000, 2000, 5000].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <div className="col-span-2 flex flex-wrap gap-2">
            {!running && <button className="lab-btn-primary" onClick={start} disabled={status === "checking"}><Play size={14} />{status === "checking" ? "Checking stability…" : "Start optimization"}</button>}
            {running && <button className="lab-btn" onClick={pause}>{status === "paused" ? <><Play size={13} />Resume</> : <><Pause size={13} />Pause</>}</button>}
            {(running || status === "checking") && <button className="lab-btn" onClick={stop}><Square size={13} />Stop</button>}
            <span className="self-center font-mono text-muted-foreground">{status}{running && ` · gen ${gen + 1}/${generations}`}</span>
          </div>
          {running && <div className="col-span-2 h-1 rounded bg-muted"><div className="h-full rounded bg-primary transition-all" style={{ width: `${(results.length / (generations * population)) * 100}%` }} /></div>}
          <p className="col-span-2 text-[11px] text-muted-foreground">Strategy: seeded random search for exploration, then a genetic algorithm (tournament selection, crossover, Gaussian mutation, elitism) with 25% random immigrants each generation. Runs entirely in this browser.</p>
        </div>
      </div>

      {/* Dashboard */}
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ["Experiments", results.length.toString()],
          ["Pipelines tested", algos.toString()],
          ["Best score", fmt(best?.score ?? NaN)],
          ["Baseline score", fmt(runMeta?.baseline ?? NaN)],
          ["Improvement", best && runMeta ? `${best.score - runMeta.baseline >= 0 ? "+" : ""}${fmt(best.score - runMeta.baseline)}` : "—"],
          ["Best LCS", fmt(best?.lcs ?? NaN)],
        ].map(([l, v]) => (
          <div key={l} className="glass rounded-xl border border-border p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
            <div className="font-mono text-lg">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="glass rounded-xl border border-border p-4">
          <div className="lab-label mb-2">Optimization progress</div>
          <ProgressChart history={history} baseline={runMeta?.baseline} />
        </div>
        <div className="glass rounded-xl border border-border p-4">
          <div className="lab-label mb-2">Current best configuration</div>
          {best ? (
            <div className="space-y-2 text-xs">
              <div className="text-sm text-primary">{best.algorithm}</div>
              <GenomeParams g={best.genome} />
              <div className="flex flex-wrap gap-2 pt-2">
                <button className="lab-btn-primary" onClick={() => onApply(best.genome)}><Check size={13} />Apply to explorer</button>
                <button className="lab-btn" onClick={() => { onSave(`Optimizer ${runMeta?.mode === "label" ? "B" : "A"} · seed ${runMeta?.seed}`, best.genome); setSaved(true); }}><Save size={13} />{saved ? "Saved" : "Save as experiment"}</button>
              </div>
            </div>
          ) : <p className="text-xs text-muted-foreground">Start the optimizer to see results.</p>}
        </div>
      </div>

      {best && bestProj && (
        <div className="grid gap-4 md:grid-cols-2">
          <PointCanvas x={sample.u} y={sample.v} rank={colors} xHex={sample.xHex} yHex={sample.yHex} viz={viz} palette={palette} levels={levels} title={`Original · score ${fmt(runMeta?.baseline ?? NaN)}`} className="h-[380px]" />
          <PointCanvas x={bestProj.x} y={bestProj.y} rank={colors} xHex={sample.xHex} yHex={sample.yHex} viz={viz} palette={palette} levels={levels} title={`Best · score ${fmt(best.score)}`} className="h-[380px]" />
        </div>
      )}

      {top.length > 0 && (
        <div className="glass overflow-x-auto rounded-xl border border-border">
          <div className="lab-label p-3">Top 10 experiments</div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">#</th><th className="p-2">Pipeline</th><th className="p-2">Score</th><th className="p-2">LCS</th><th className="p-2">Clark–Evans R</th><th className="p-2">Cell CV</th><th className="p-2">Gen</th><th className="p-2">Origin</th><th /></tr></thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="p-2 font-mono">{i + 1}</td><td className="p-2">{r.algorithm}</td>
                  <td className="p-2 font-mono text-primary">{fmt(r.score)}</td><td className="p-2 font-mono">{fmt(r.lcs)}</td>
                  <td className="p-2 font-mono">{fmt(r.clarkEvans, 3)}</td><td className="p-2 font-mono">{fmt(r.cellCV, 3)}</td>
                  <td className="p-2 font-mono">{r.generation + 1}</td><td className="p-2">{r.source}</td>
                  <td className="p-2"><button className="text-primary hover:underline" onClick={() => onApply(r.genome)}>Apply</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status === "done" && report && (
        <div className="glass rounded-xl border border-border p-4">
          <div className="mb-2 flex items-center justify-between"><div className="lab-label">Automatic discovery report</div>
            <button className="lab-btn" onClick={downloadReport}><FileDown size={13} />Download .md</button></div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">{report}</pre>
        </div>
      )}
    </div>
  );
}

function GenomeParams({ g }: { g: Genome }) {
  return (
    <div className="space-y-1 font-mono text-[11px]">
      {g.steps.filter((s) => s.enabled).map((s) => (
        <div key={s.type}><span className="text-muted-foreground">{STEP_DEFS[s.type].label}:</span>{" "}
          {STEP_DEFS[s.type].params.map((p) => `${p.key}=${s.params[p.key]}`).join(", ")}
          {s.type === "custom" && ` · x′=${FORMULA_LIBRARY[g.formula]![1]}, y′=${FORMULA_LIBRARY[g.formula]![2]}`}
        </div>
      ))}
    </div>
  );
}

function ProgressChart({ history, baseline }: { history: Progress[]; baseline: number | undefined }) {
  const W = 600, H = 200;
  if (!history.length) return <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">No data yet</div>;
  const vals = history.flatMap((h) => [h.best, h.current]).concat(baseline ?? []).filter(Number.isFinite);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const X = (i: number) => (i / Math.max(1, history.length - 1)) * W;
  const Y = (v: number) => H - 8 - ((v - lo) / span) * (H - 16);
  const line = (k: "best" | "current") => history.map((h, i) => Number.isFinite(h[k]) ? `${X(i).toFixed(1)},${Y(h[k]).toFixed(1)}` : "").filter(Boolean).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full" preserveAspectRatio="none">
        {baseline !== undefined && <line x1={0} x2={W} y1={Y(baseline)} y2={Y(baseline)} className="stroke-muted-foreground" strokeDasharray="4 4" strokeWidth={1} />}
        <polyline points={line("current")} fill="none" className="stroke-accent" strokeOpacity={0.5} strokeWidth={1} />
        <polyline points={line("best")} fill="none" className="stroke-primary" strokeWidth={2.5} />
      </svg>
      <div className="mt-1 flex gap-4 text-[11px] text-muted-foreground">
        <span><span className="text-primary">━</span> best so far</span><span><span className="text-accent">━</span> each experiment</span><span>┄ baseline</span>
        <span className="ml-auto font-mono">range {lo.toFixed(3)} – {hi.toFixed(3)}</span>
      </div>
    </div>
  );
}

function buildReport(best: Result, meta: { mode: OptMode; seed: number; n: number; evalSize: number; baseline: number }, st: Stability | null): string {
  const g = best.genome;
  const params = g.steps.filter((s) => s.enabled).map((s) => `- ${STEP_DEFS[s.type].label}: ${STEP_DEFS[s.type].params.map((p) => `${p.key}=${s.params[p.key]}`).join(", ")}${s.type === "custom" ? ` (x′ = ${FORMULA_LIBRARY[g.formula]![1]}, y′ = ${FORMULA_LIBRARY[g.formula]![2]})` : ""}`).join("\n");
  const objective = meta.mode === "public" ? "Public structure score = 20×20 cell-count CV + max(0, 1 − Clark–Evans R). Uses public X/Y only." : "Local Colour Similarity Score on synthetic scalar-rank labels (label-guided).";
  let stable = "Stability check not completed.";
  if (st && st.samples) {
    const gain = st.bestMean - st.baseMean;
    const robust = gain > 2 * Math.max(st.bestSd, st.baseSd, 1e-6);
    stable = `Re-evaluated on ${st.samples} fresh synthetic samples (1,000 points each):\n- Best config: ${st.bestMean.toFixed(4)} ± ${st.bestSd.toFixed(4)}\n- Baseline:    ${st.baseMean.toFixed(4)} ± ${st.baseSd.toFixed(4)}\n- Verdict: ${robust ? "the improvement holds across new samples." : "the improvement does NOT reliably carry over to new samples."}`;
    if (meta.mode === "label") stable += `\n- For label-guided runs, a gain that disappears on new samples is the expected signature of overfitting to one sample's labels. secp256k1 public points carry no recoverable information about scalar order.`;
  }
  return `# secp256k1 Visual Pattern Explorer — Discovery Report
Date: ${new Date().toLocaleString()}
Mode: ${meta.mode === "public" ? "A · Public-only optimization" : "B · Experimental label-guided optimization — synthetic data only"}
Random seed: ${meta.seed} · Sample size: ${meta.n} · Points per evaluation: ${meta.evalSize}

## Objective
${objective}

## Best-performing projection
${genomeLabel(g)}

## Parameters
${params}

## Statistical measurements
- Score: ${best.score.toFixed(4)} (baseline original X/Y: ${meta.baseline.toFixed(4)})
- Improvement over baseline: ${(best.score - meta.baseline).toFixed(4)}
- Clark–Evans R: ${best.clarkEvans.toFixed(4)} (1 ≈ random, < 1 clustered, > 1 regular)
- Cell-count CV: ${best.cellCV.toFixed(4)}
- Local Colour Similarity: ${Number.isFinite(best.lcs) ? best.lcs.toFixed(4) : "not computed in public-only mode"}

## Stability across synthetic samples
${stable}

## Improvements and limitations
- Nonlinear projections can create visually striking density structure; this comes from the transformation, not from hidden structure in the curve. Original secp256k1 public coordinates are statistically uniform.
- Results are reproducible with the same seed on the same sample; a different sample will give different exact scores.
- ${meta.mode === "label" ? "Label-guided parameters are fitted to the synthetic labels and are therefore not independent of them." : "Private-scalar data was not used by this optimization."}
- This is a visualization statistic. It is not a probability of discovering or recovering private keys and does not weaken Bitcoin cryptography.
`;
}
