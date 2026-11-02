import { useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, Beaker, FlaskConical, FunctionSquare, GitCompare, LayoutDashboard, Waypoints,
  PanelRightClose, PanelRightOpen, Save, Settings, Sparkles, Trash2, Upload, ArrowUp, ArrowDown, FileDown, ShieldCheck,
} from "lucide-react";
import { generateSample, runSelfTest, type Sample, P, N } from "@/lib/lab/cryptography_engine";
import { compileProjection } from "@/lib/lab/formula";
import { defaultSteps, describePipeline, project, STEP_DEFS, type Step } from "@/lib/lab/projection_algorithms";
import { computeStats, summarize, type StatsSummary } from "@/lib/lab/statistical_analysis";
import { detectGeometricPatterns } from "@/lib/lab/geometric_pattern_detection";
import { loadExperiments, saveExperiments, type Experiment } from "@/lib/lab/experiment_manager";
import { MODES } from "@/lib/lab/visualization_engine";
import { PointCanvas, type Viz } from "./PointCanvas";

type Section = "overview" | "explorer" | "lab" | "formula" | "stats" | "geometry" | "compare" | "saved" | "settings";
const NAV: { id: Section; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "explorer", label: "Point Explorer", icon: Sparkles },
  { id: "lab", label: "Algorithm Laboratory", icon: FlaskConical },
  { id: "formula", label: "Formula Editor", icon: FunctionSquare },
  { id: "stats", label: "Statistical Analysis", icon: BarChart3 },
  { id: "geometry", label: "Geometric Patterns", icon: Waypoints },
  { id: "compare", label: "Experiment Comparison", icon: GitCompare },
  { id: "saved", label: "Saved Experiments", icon: Save },
  { id: "settings", label: "Settings", icon: Settings },
];
const SIZES = [100, 500, 1000, 5000, 10000];
const fmt = (v: number, d = 4) => (Number.isFinite(v) ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(d)) : "—");

const STAT_ROWS: { key: keyof StatsSummary; label: string; d?: number }[] = [
  { key: "valid", label: "Points (finite)", d: 0 },
  { key: "density", label: "Density (pts / unit²)" },
  { key: "nnMean", label: "Mean NN distance*" },
  { key: "nnMin", label: "Min NN distance*" },
  { key: "nnMax", label: "Max NN distance*" },
  { key: "nnStd", label: "NN distance σ*" },
  { key: "pairMean", label: "Mean pair distance*" },
  { key: "pairMin", label: "Min pair distance (sampled)*" },
  { key: "pairMax", label: "Max pair distance (sampled)*" },
  { key: "clarkEvans", label: "Clark–Evans R (1 = random)" },
  { key: "emptyCells", label: "Empty cells (20×20)" },
  { key: "cellCV", label: "Cell-count CV" },
  { key: "centroidX", label: "Centroid x" },
  { key: "centroidY", label: "Centroid y" },
  { key: "stdX", label: "σx" },
  { key: "stdY", label: "σy" },
  { key: "localDiff", label: "Mean |Δcolour| to NN" },
  { key: "baselineDiff", label: "Mean |Δcolour| random pairs" },
  { key: "lcs", label: "Local Colour Similarity Score" },
  { key: "lcsZ", label: "LCS z-score" },
];

export function LabApp() {
  const [section, setSection] = useState<Section>("explorer");
  const [panelOpen, setPanelOpen] = useState(true);
  const [size, setSize] = useState(1000);
  const [sample, setSample] = useState<Sample | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [steps, setSteps] = useState<Step[]>(defaultSteps);
  const [fx, setFx] = useState("u + a*sin(2*pi*b*v)");
  const [fy, setFy] = useState("v + a*cos(2*pi*b*u)");
  const [viz, setViz] = useState<Viz>({ pointSize: 2.2, opacity: 0.85, colorScale: true, grid: true, mode: "points", hover: true });
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selfTest, setSelfTest] = useState<{ label: string; ok: boolean }[] | null>(null);

  const generate = async (n = size) => {
    setProgress(0);
    const s = await generateSample(n, setProgress);
    setSample(s); setProgress(null);
  };
  useEffect(() => {
    setExperiments(loadExperiments());
    setTimeout(() => { setSelfTest(runSelfTest()); generate(1000); }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const custom = useMemo(() => compileProjection(fx, fy), [fx, fy]);
  const projected = useMemo(() => (sample ? project(sample.u, sample.v, steps, custom.fn) : null), [sample, steps, custom]);
  const statsO = useMemo(() => (sample ? computeStats(sample.u, sample.v, sample.rank) : null), [sample]);
  const statsP = useMemo(() => (sample && projected ? computeStats(projected.x, projected.y, sample.rank) : null), [sample, projected]);
  // Always analyze the ORIGINAL public X/Y projection, never transformed points or colour/rank labels.
  const geometry = useMemo(() => (sample ? detectGeometricPatterns(sample.u, sample.v) : null), [sample]);
  const algo = describePipeline(steps);

  const updateStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));
  const moveStep = (i: number, d: number) => setSteps((s) => {
    const j = i + d; if (j < 0 || j >= s.length) return s;
    const c = [...s]; [c[i], c[j]] = [c[j]!, c[i]!]; return c;
  });

  const exportCsv = () => {
    if (!sample || !projected) return;
    const rows = ["index,public_x_hex,public_y_hex,u,v,proj_x,proj_y"];
    for (let i = 0; i < sample.n; i++) rows.push(`${i},${sample.xHex[i]},${sample.yHex[i]},${sample.u[i]},${sample.v[i]},${projected.x[i]},${projected.y[i]}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    a.download = `secp256k1-public-points-${sample.n}.csv`; a.click();
  };

  const saveExperiment = (name: string) => {
    if (!statsO || !statsP || !sample) return;
    const e: Experiment = {
      id: crypto.randomUUID(), name: name || `Experiment ${experiments.length + 1}`, createdAt: Date.now(),
      algorithm: algo, steps, fx, fy, sampleSize: sample.n, original: summarize(statsO), projected: summarize(statsP),
    };
    const list = [e, ...experiments]; setExperiments(list); saveExperiments(list);
  };
  const deleteExperiment = (id: string) => { const l = experiments.filter((e) => e.id !== id); setExperiments(l); saveExperiments(l); };
  const loadExperiment = (e: Experiment) => { setSteps(e.steps); setFx(e.fx); setFy(e.fy); setSection("lab"); };

  const showSide = ["explorer", "lab", "formula"].includes(section);
  const mainPlot = sample && projected && (
    <PointCanvas
      x={projected.x} y={projected.y} rank={sample.rank} nnDist={statsP?.nnDist}
      xHex={sample.xHex} yHex={sample.yHex} viz={viz} className="h-full"
      title={`${algo} · n=${sample.n}`}
    />
  );

  return (
    <div className="lab-bg flex min-h-screen flex-col text-foreground lg:flex-row">
      {/* Navigation */}
      <aside className="glass z-20 flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border p-2 lg:h-screen lg:w-60 lg:flex-col lg:border-r lg:border-b-0 lg:p-4 lg:sticky lg:top-0">
        <div className="hidden lg:block mb-6">
          <div className="flex items-center gap-2 text-primary"><Beaker size={20} /><span className="font-display text-sm font-semibold tracking-wide">secp256k1</span></div>
          <div className="font-display text-lg leading-tight">Visual Pattern Explorer</div>
        </div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSection(id)} className={`lab-nav ${section === id ? "lab-nav-active" : ""}`}>
            <Icon size={16} className="shrink-0" /><span className="whitespace-nowrap">{label}</span>
          </button>
        ))}
        <div className="mt-auto hidden rounded-lg border border-border p-3 text-[11px] leading-relaxed text-muted-foreground lg:block">
          <ShieldCheck size={14} className="mb-1 text-primary" />
          Synthetic keys only. Visual patterns never reveal private keys.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="glass sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h1 className="font-display text-base">{NAV.find((n) => n.id === section)!.label}</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select className="lab-input w-auto" value={size} onChange={(e) => setSize(+e.target.value)} disabled={progress !== null}>
              {SIZES.map((s) => <option key={s} value={s}>{s.toLocaleString()} points</option>)}
            </select>
            <button className="lab-btn-primary" onClick={() => generate()} disabled={progress !== null}>
              {progress !== null ? `Generating ${Math.round(progress * 100)}%` : "Generate New Sample"}
            </button>
            <button className="lab-btn" onClick={exportCsv} disabled={!sample}><FileDown size={14} />CSV</button>
            {showSide && (
              <button className="lab-icon-btn" onClick={() => setPanelOpen((o) => !o)} title="Toggle controls">
                {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            )}
          </div>
          {progress !== null && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} /></div>}
        </header>

        <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
          {showSide && (
            <>
              <div className="h-[60vh] min-w-0 flex-1 lg:h-[calc(100vh-6rem)]">
                {mainPlot ?? <div className="flex h-full items-center justify-center rounded-xl border border-border text-muted-foreground">Computing public points…</div>}
              </div>
              {panelOpen && (
                <div className="glass w-full shrink-0 space-y-4 overflow-y-auto rounded-xl border border-border p-4 lg:h-[calc(100vh-6rem)] lg:w-80">
                  {section === "explorer" && <VizControls viz={viz} setViz={setViz} />}
                  {section === "lab" && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="lab-label">Pipeline (applied top → bottom)</span>
                        <button className="text-xs text-primary hover:underline" onClick={() => setSteps(defaultSteps())}>Original X/Y</button>
                      </div>
                      {steps.map((s, i) => (
                        <StepCard key={s.type} step={s} first={i === 0} last={i === steps.length - 1}
                          onChange={(p) => updateStep(i, p)} onMove={(d) => moveStep(i, d)} formulaError={s.type === "custom" ? custom.error : null} />
                      ))}
                      <StatMini s={statsP} />
                    </>
                  )}
                  {section === "formula" && (
                    <FormulaPanel fx={fx} fy={fy} setFx={setFx} setFy={setFy} error={custom.error}
                      step={steps.find((s) => s.type === "custom")!}
                      onChange={(p) => updateStep(steps.findIndex((s) => s.type === "custom"), p)} />
                  )}
                  {section !== "explorer" && <VizControls viz={viz} setViz={setViz} compact />}
                </div>
              )}
            </>
          )}

          {section === "overview" && <Overview sample={sample} selfTest={selfTest} go={setSection} statsO={statsO} />}
          {section === "geometry" && geometry && <GeometrySection result={geometry} />}
          {section === "stats" && statsO && statsP && (
            <div className="w-full space-y-4">
              <LcsExplainer s={statsP} />
              <StatsTable a={summarize(statsO)} b={summarize(statsP)} aLabel="Original" bLabel={algo} />
            </div>
          )}
          {section === "compare" && sample && projected && statsO && statsP && (
            <div className="w-full space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <PointCanvas x={sample.u} y={sample.v} rank={sample.rank} nnDist={statsO.nnDist} xHex={sample.xHex} yHex={sample.yHex} viz={viz} title="Original projection" className="h-[420px]" />
                <PointCanvas x={projected.x} y={projected.y} rank={sample.rank} nnDist={statsP.nnDist} xHex={sample.xHex} yHex={sample.yHex} viz={viz} title={algo} className="h-[420px]" />
                <PointCanvas x={sample.u} y={sample.v} rank={sample.rank} xHex={sample.xHex} yHex={sample.yHex} viz={{ ...viz, mode: "kde" }} title="Density · original" className="h-[260px]" />
                <PointCanvas x={projected.x} y={projected.y} rank={sample.rank} xHex={sample.xHex} yHex={sample.yHex} viz={{ ...viz, mode: "kde" }} title="Density · transformed" className="h-[260px]" />
              </div>
              <SaveForm onSave={saveExperiment} />
              <StatsTable a={summarize(statsO)} b={summarize(statsP)} aLabel="Original" bLabel={algo} />
            </div>
          )}
          {section === "saved" && <SavedPanel list={experiments} onLoad={loadExperiment} onDelete={deleteExperiment} onSave={saveExperiment} />}
          {section === "settings" && <SettingsPanel viz={viz} setViz={setViz} size={size} setSize={setSize} selfTest={selfTest} rerun={() => setSelfTest(runSelfTest())} />}
        </main>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono">{value}</span></div>
      <input type="range" className="lab-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="checkbox" className="lab-check" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function VizControls({ viz, setViz, compact }: { viz: Viz; setViz: (f: (v: Viz) => Viz) => void; compact?: boolean }) {
  const set = (p: Partial<Viz>) => setViz((v) => ({ ...v, ...p }));
  return (
    <div className="space-y-3">
      <div className="lab-label">{compact ? "Display" : "Visualization"}</div>
      <select className="lab-input" value={viz.mode} onChange={(e) => set({ mode: e.target.value as Viz["mode"] })}>
        {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <Slider label="Point size" value={viz.pointSize} min={0.5} max={8} step={0.1} onChange={(v) => set({ pointSize: v })} />
      <Slider label="Opacity" value={viz.opacity} min={0.05} max={1} step={0.05} onChange={(v) => set({ opacity: v })} />
      <Toggle label="Colour scale (scalar rank)" checked={viz.colorScale} onChange={(v) => set({ colorScale: v })} />
      <Toggle label="Grid lines" checked={viz.grid} onChange={(v) => set({ grid: v })} />
      <Toggle label="Hover details" checked={viz.hover} onChange={(v) => set({ hover: v })} />
      {!compact && (
        <>
          <div className="lab-colorbar h-2 rounded-full" />
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>lowest rank</span><span>highest rank</span></div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Scroll to zoom, drag to pan. Positions come only from public X/Y. Colour is the scalar's rank in this sample — scalar values are never shown.</p>
        </>
      )}
    </div>
  );
}

function StepCard({ step, onChange, onMove, first, last, formulaError }: { step: Step; onChange: (p: Partial<Step>) => void; onMove: (d: number) => void; first: boolean; last: boolean; formulaError: string | null }) {
  const def = STEP_DEFS[step.type];
  return (
    <div className={`rounded-lg border p-3 transition-colors ${step.enabled ? "border-primary/50 bg-primary/5" : "border-border"}`}>
      <div className="flex items-center gap-2">
        <input type="checkbox" className="lab-check" checked={step.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        <div className="min-w-0 flex-1">
          <div className="text-sm">{def.label}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{def.desc}</div>
        </div>
        <button className="lab-icon-btn" disabled={first} onClick={() => onMove(-1)}><ArrowUp size={12} /></button>
        <button className="lab-icon-btn" disabled={last} onClick={() => onMove(1)}><ArrowDown size={12} /></button>
      </div>
      {step.enabled && (
        <div className="mt-3 space-y-2">
          {def.params.map((p) => (
            <Slider key={p.key} label={p.label} value={step.params[p.key] ?? p.def} min={p.min} max={p.max} step={p.step}
              onChange={(v) => onChange({ params: { ...step.params, [p.key]: v } })} />
          ))}
          {formulaError && <p className="text-xs text-destructive">{formulaError}</p>}
        </div>
      )}
    </div>
  );
}

const PRESETS: [string, string, string][] = [
  ["Sine warp", "u + a*sin(2*pi*b*v)", "v + a*cos(2*pi*b*u)"],
  ["Log-polar", "atan2(v,u)/pi", "log(r + 0.001)"],
  ["Modular fold", "frac(b*u*7)", "frac(b*v*7)"],
  ["Hyperbolic", "u*v*b*10", "u^2 - v^2"],
  ["Spiral", "r*cos(theta + b*10*r)", "r*sin(theta + b*10*r)"],
];
function FormulaPanel({ fx, fy, setFx, setFy, error, step, onChange }: { fx: string; fy: string; setFx: (s: string) => void; setFy: (s: string) => void; error: string | null; step: Step; onChange: (p: Partial<Step>) => void }) {
  const [dx, setDx] = useState(fx), [dy, setDy] = useState(fy);
  const preview = useMemo(() => compileProjection(dx, dy), [dx, dy]);
  const apply = (x = dx, y = dy) => { setDx(x); setDy(y); setFx(x); setFy(y); onChange({ enabled: true }); };
  return (
    <div className="space-y-3">
      <div className="lab-label">Custom projection</div>
      <div className="rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        u = X/P − 0.5 · v = Y/P − 0.5<br />r = √(u²+v²) · theta = atan2(v,u)<br />params: a, b, c · consts: pi, e, tau
      </div>
      <label className="block text-xs text-muted-foreground">x′ = f(u, v)
        <input className="lab-input mt-1 font-mono" value={dx} onChange={(e) => setDx(e.target.value)} spellCheck={false} />
      </label>
      <label className="block text-xs text-muted-foreground">y′ = g(u, v)
        <input className="lab-input mt-1 font-mono" value={dy} onChange={(e) => setDy(e.target.value)} spellCheck={false} />
      </label>
      {preview.error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{preview.error}</p>
        : <p className="text-xs text-success">✓ Valid expression</p>}
      <button className="lab-btn-primary w-full justify-center" disabled={!!preview.error} onClick={() => apply()}>Apply formula</button>
      {error && <p className="text-xs text-destructive">Active formula: {error}</p>}
      <Toggle label="Custom step enabled" checked={step.enabled} onChange={(v) => onChange({ enabled: v })} />
      {STEP_DEFS.custom.params.map((p) => (
        <Slider key={p.key} label={p.label} value={step.params[p.key] ?? p.def} min={p.min} max={p.max} step={p.step} onChange={(v) => onChange({ params: { ...step.params, [p.key]: v } })} />
      ))}
      <div className="lab-label pt-2">Presets</div>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(([n, x, y]) => <button key={n} className="lab-chip" onClick={() => apply(x, y)}>{n}</button>)}
      </div>
      <p className="text-[11px] text-muted-foreground">Functions: sin cos tan asin acos atan atan2 sinh cosh tanh exp log log10 sqrt abs floor ceil round sign pow hypot min max mod frac. Operators + − * / % ^.</p>
    </div>
  );
}

function StatMini({ s }: { s: ReturnType<typeof computeStats> | null }) {
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {[["LCS", s.lcs], ["Clark–Evans", s.clarkEvans], ["Mean NN", s.nnMean], ["Empty cells", s.emptyCells]].map(([l, v]) => (
        <div key={l as string} className="rounded-md border border-border p-2">
          <div className="text-[10px] text-muted-foreground">{l}</div><div className="font-mono text-sm">{fmt(v as number)}</div>
        </div>
      ))}
    </div>
  );
}

function StatsTable({ a, b, aLabel, bLabel }: { a: StatsSummary; b: StatsSummary; aLabel: string; bLabel: string }) {
  return (
    <div className="glass overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="p-3">Metric</th><th className="p-3">{aLabel}</th><th className="max-w-[220px] truncate p-3">{bLabel}</th><th className="p-3">Δ</th>
        </tr></thead>
        <tbody>
          {STAT_ROWS.map((r) => {
            const d = (b[r.key] as number) - (a[r.key] as number);
            return (
              <tr key={r.key} className={`border-b border-border/50 ${r.key === "lcs" ? "bg-primary/10" : ""}`}>
                <td className="p-3 text-muted-foreground">{r.label}</td>
                <td className="p-3 font-mono">{fmt(a[r.key] as number, r.d)}</td>
                <td className="p-3 font-mono">{fmt(b[r.key] as number, r.d)}</td>
                <td className={`p-3 font-mono ${d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground"}`}>{d > 0 ? "+" : ""}{fmt(d, r.d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="p-3 text-[11px] text-muted-foreground">* Distances measured after scaling each projection's bounding box to the unit square (aspect preserved), so projections are comparable.</p>
    </div>
  );
}

function LcsExplainer({ s }: { s: ReturnType<typeof computeStats> }) {
  return (
    <div className="glass grid gap-4 rounded-xl border border-border p-5 md:grid-cols-[auto_1fr]">
      <div>
        <div className="lab-label">Local Colour Similarity Score</div>
        <div className="font-display text-4xl text-primary">{fmt(s.lcs, 4)}</div>
        <div className="font-mono text-xs text-muted-foreground">z = {fmt(s.lcsZ, 2)}</div>
      </div>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p><b className="text-foreground">LCS = 1 − mean|Δrank| (nearest neighbours) ÷ mean|Δrank| (random pairs).</b> 0 means neighbouring points are no more alike in colour than random pairs; positive means more alike. |z| &lt; 2 is consistent with chance.</p>
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs">This is a visualization statistic only. It is <b>not</b> a probability of discovering or recovering private keys. For secp256k1, public points are expected to show no relationship to scalar order — values near 0 confirm that.</p>
      </div>
    </div>
  );
}

function SaveForm({ onSave }: { onSave: (n: string) => void }) {
  const [name, setName] = useState("");
  const [done, setDone] = useState(false);
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSave(name); setName(""); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      <input className="lab-input" placeholder="Experiment name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="lab-btn-primary" type="submit"><Save size={14} />{done ? "Saved" : "Save experiment"}</button>
    </form>
  );
}

function SavedPanel({ list, onLoad, onDelete, onSave }: { list: Experiment[]; onLoad: (e: Experiment) => void; onDelete: (id: string) => void; onSave: (n: string) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const pick = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  const [a, b] = sel.map((id) => list.find((e) => e.id === id)).filter(Boolean) as Experiment[];
  return (
    <div className="w-full space-y-4">
      <SaveForm onSave={onSave} />
      {!list.length && <p className="text-sm text-muted-foreground">No experiments saved yet. Configure a projection and save it here or from Experiment Comparison.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((e) => (
          <div key={e.id} className={`glass rounded-xl border p-4 ${sel.includes(e.id) ? "border-primary" : "border-border"}`}>
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-display">{e.name}</div><div className="text-[11px] text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</div></div>
              <input type="checkbox" className="lab-check" checked={sel.includes(e.id)} onChange={() => pick(e.id)} title="Select to compare" />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{e.algorithm}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs">
              <div><div className="text-muted-foreground">n</div>{e.sampleSize}</div>
              <div><div className="text-muted-foreground">LCS</div>{fmt(e.projected.lcs)}</div>
              <div><div className="text-muted-foreground">R</div>{fmt(e.projected.clarkEvans, 3)}</div>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="lab-btn" onClick={() => onLoad(e)}><Upload size={13} />Load</button>
              <button className="lab-btn" onClick={() => onDelete(e.id)}><Trash2 size={13} />Delete</button>
            </div>
          </div>
        ))}
      </div>
      {a && b && <StatsTable a={a.projected} b={b.projected} aLabel={a.name} bLabel={b.name} />}
      {list.length > 1 && !(a && b) && <p className="text-xs text-muted-foreground">Tick two experiments to compare their statistics.</p>}
    </div>
  );
}

function Overview({ sample, selfTest, go, statsO }: { sample: Sample | null; selfTest: { label: string; ok: boolean }[] | null; go: (s: Section) => void; statsO: ReturnType<typeof computeStats> | null }) {
  return (
    <div className="w-full space-y-4">
      <div className="glass rounded-xl border border-border p-6">
        <h2 className="font-display text-2xl">A laboratory for the geometry of secp256k1 public points</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Generate synthetic key pairs with a cryptographically secure random source, compute their public points on y² = x³ + 7 (mod P), and study how projections reshape their spatial and colour statistics.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="lab-btn-primary" onClick={() => go("explorer")}>Open Point Explorer</button>
          <button className="lab-btn" onClick={() => go("lab")}>Algorithm Laboratory</button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="glass rounded-xl border border-border p-4">
          <div className="lab-label">Current sample</div>
          <div className="font-display text-3xl">{sample?.n.toLocaleString() ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{sample ? `generated ${new Date(sample.createdAt).toLocaleTimeString()}` : "generating…"}</div>
          {statsO && <div className="mt-2 font-mono text-xs">LCS {fmt(statsO.lcs)} · R {fmt(statsO.clarkEvans, 3)}</div>}
        </div>
        <div className="glass rounded-xl border border-border p-4">
          <div className="lab-label">Test vectors</div>
          {selfTest ? selfTest.map((t) => <div key={t.label} className="flex justify-between font-mono text-xs"><span>{t.label}</span><span className={t.ok ? "text-success" : "text-destructive"}>{t.ok ? "PASS" : "FAIL"}</span></div>) : <div className="text-xs text-muted-foreground">running…</div>}
        </div>
        <div className="glass rounded-xl border border-border p-4 font-mono text-[10px] leading-relaxed text-muted-foreground">
          <div className="lab-label font-sans">Curve parameters</div>
          <div className="break-all">P = {P.toString(16)}</div>
          <div className="break-all">N = {N.toString(16)}</div>
        </div>
      </div>
      <div className="glass rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <div className="lab-label">Scientific integrity</div>
        <ul className="list-disc space-y-1 pl-5">
          <li>All keys are synthetic, created in your browser and never stored. Scalars are discarded after ranking.</li>
          <li>Projections receive only public X/Y. Colours show scalar rank within the sample; scalar values are never displayed or exported.</li>
          <li>Clusters, colour similarity, and transformations do not reveal private keys. No wallet scanning or brute force exists here.</li>
        </ul>
      </div>
    </div>
  );
}

function SettingsPanel({ viz, setViz, size, setSize, selfTest, rerun }: { viz: Viz; setViz: (f: (v: Viz) => Viz) => void; size: number; setSize: (n: number) => void; selfTest: { label: string; ok: boolean }[] | null; rerun: () => void }) {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2">
      <div className="glass space-y-3 rounded-xl border border-border p-4">
        <div className="lab-label">Sample size</div>
        <div className="flex flex-wrap gap-1">{SIZES.map((s) => <button key={s} className={`lab-chip ${s === size ? "lab-chip-active" : ""}`} onClick={() => setSize(s)}>{s.toLocaleString()}</button>)}</div>
        <p className="text-xs text-muted-foreground">Takes effect on the next “Generate New Sample”. 10,000 points can take several seconds.</p>
        <VizControls viz={viz} setViz={setViz} compact />
      </div>
      <div className="glass space-y-3 rounded-xl border border-border p-4">
        <div className="lab-label">Cryptographic self-test</div>
        {selfTest?.map((t) => <div key={t.label} className="flex justify-between font-mono text-xs"><span>{t.label}</span><span className={t.ok ? "text-success" : "text-destructive"}>{t.ok ? "PASS" : "FAIL"}</span></div>)}
        <button className="lab-btn" onClick={rerun}>Re-run tests</button>
      </div>
    </div>
  );
}


function GeometrySection({ result }: { result: ReturnType<typeof detectGeometricPatterns> }) {
  const fmt = (v: number, digits = 5) => Number.isFinite(v) ? v.toFixed(digits) : "—";
  return (
    <div className="w-full space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex items-center gap-2 font-semibold"><Waypoints size={17} /> Geometric Pattern Detection</div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Runs on original normalized public X/Y coordinates only. It does not use scalar ranks, colours, or transformed projections.
          RANSAC reports candidate alignments; candidates are not proof of non-random structure.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Valid public points" value={result.validCount.toLocaleString()} />
        <Metric label="Candidate lines" value={String(result.lines.length)} />
        <Metric label="Residual tolerance" value={fmt(result.threshold, 7)} />
        <Metric label="Direction pairs sampled" value={result.sampledPairs.toLocaleString()} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="PCA anisotropy (0–1)" value={fmt(result.anisotropy, 4)} />
        <Metric label="Grid occupancy χ² (16×16)" value={fmt(result.gridChiSquare, 2)} />
        <Metric label="Cubic curve fit R²" value={fmt(result.cubicCurveR2, 4)} />
        <Metric label="Ripley K (sampled)" value={fmt(result.ripleyK, 6)} />
        <Metric label="DBSCAN clusters" value={String(result.dbscanClusters.length)} />
        <Metric label="DBSCAN noise points" value={result.dbscanNoise.toLocaleString()} />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 font-medium">Additional algorithm results</div>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-md bg-muted/40 p-3">
            <div className="text-muted-foreground">Algebraic least-squares circle</div>
            {result.circle ? <div className="mt-1 font-mono">center ({fmt(result.circle.cx, 5)}, {fmt(result.circle.cy, 5)}) · r {fmt(result.circle.radius, 5)}<br/>RMS residual {fmt(result.circle.rmsResidual, 7)}</div> : <div className="mt-1 text-muted-foreground">No stable circle fit for this sample.</div>}
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <div className="text-muted-foreground">Largest DBSCAN clusters</div>
            <div className="mt-1 font-mono">{result.dbscanClusters.length ? result.dbscanClusters.join(" · ") : "No clusters passed minPts"}</div>
            <div className="mt-1 text-muted-foreground">DBSCAN uses ε = 1.2% of the sample bounding-box diagonal and a bounded subsample of at most 1,800 points.</div>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <div className="text-muted-foreground">Ripley K diagnostic</div>
            <div className="mt-1 font-mono">radius {fmt(result.ripleyRadius, 6)} · K {fmt(result.ripleyK, 7)}</div>
            <div className="mt-1 text-muted-foreground">Pair-sampled; no edge correction. Compare against a matched null model.</div>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <div className="text-muted-foreground">Cubic polynomial fit</div>
            <div className="mt-1 font-mono">R² = {fmt(result.cubicCurveR2, 5)}</div>
            <div className="mt-1 text-muted-foreground">Only models y=f(x); vertical loops and general implicit curves are not captured.</div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 font-medium">Straight-line candidates</div>
        {result.lines.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-muted-foreground"><tr>
                <th className="p-2">#</th><th className="p-2">Points</th><th className="p-2">Sample %</th>
                <th className="p-2">Angle</th><th className="p-2">RMS residual</th><th className="p-2">Max residual</th>
              </tr></thead>
              <tbody>{result.lines.map((line, i) => <tr key={i} className="border-t border-border">
                <td className="p-2">{i + 1}</td><td className="p-2 font-mono">{line.count}</td>
                <td className="p-2 font-mono">{(line.fraction * 100).toFixed(3)}%</td>
                <td className="p-2 font-mono">{fmt(line.angleDeg, 3)}°</td>
                <td className="p-2 font-mono">{fmt(line.rmsResidual, 7)}</td>
                <td className="p-2 font-mono">{fmt(line.maxResidual, 7)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">No line candidate passed the current minimum-inlier and residual thresholds.</p>}
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-1 font-medium">Most common pair directions</div>
        <p className="mb-3 text-xs text-muted-foreground">Angles are unoriented (0°–180°). Histogram peaks can arise from the point-cloud shape itself.</p>
        <div className="space-y-2">{result.directionPeaks.map((peak, i) => <div key={i} className="grid grid-cols-[58px_1fr_100px] items-center gap-3 text-xs">
          <span className="font-mono">{fmt(peak.angleDeg, 1)}°</span>
          <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${Math.max(0, peak.fraction * 100)}%` }} /></div>
          <span className="text-right font-mono text-muted-foreground">{peak.count} ({(peak.fraction * 100).toFixed(2)}%)</span>
        </div>)}</div>
      </div>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Scientific caution:</strong> this first detector searches straight lines and pair-direction concentration.
        It does not yet test curved paths or statistical significance. A valid discovery requires comparison against a null model
        that samples points from the secp256k1 curve, correction for searching many candidate lines, and replication on independent samples.
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-mono text-2xl">{value}</div></div>;
}
