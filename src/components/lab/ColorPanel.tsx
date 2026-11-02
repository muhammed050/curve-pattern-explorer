import { cssGradient, paletteLabel, PALETTE_IDS, SOURCES, type ColorCfg } from "@/lib/lab/color_engine";

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono">{value}</span></div>
      <input type="range" className="lab-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export function ColorPanel({ cfg, setCfg, inspect }: { cfg: ColorCfg; setCfg: (f: (c: ColorCfg) => ColorCfg) => void; inspect?: boolean }) {
  const set = (p: Partial<ColorCfg>) => setCfg((c) => ({ ...c, ...p }));
  const src = SOURCES.find((s) => s.id === cfg.source)!;
  return (
    <div className="space-y-3">
      <div className="lab-label">Colour engine</div>
      <label className="block text-xs text-muted-foreground">Colour source
        <select className="lab-input mt-1" value={cfg.source} onChange={(e) => set({ source: e.target.value as ColorCfg["source"] })}>
          {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label} — {s.origin === "private" ? "synthetic-scalar derived" : "public data"}</option>)}
        </select>
      </label>
      <div className={`rounded-md px-2 py-1 text-[11px] ${src.origin === "private" ? "bg-accent/15 text-accent" : "bg-primary/10 text-primary"}`}>
        Source: {src.origin === "private" ? "derived from synthetic private scalars" : "derived only from public coordinates"}
      </div>
      <label className="block text-xs text-muted-foreground">Palette
        <select className="lab-input mt-1" value={cfg.palette} onChange={(e) => set({ palette: e.target.value as ColorCfg["palette"] })}>
          {PALETTE_IDS.map((p) => <option key={p} value={p}>{paletteLabel(p)}</option>)}
        </select>
      </label>
      {cfg.palette === "custom" && (
        <div className="flex gap-2">
          {cfg.custom.map((c, i) => (
            <input key={i} type="color" className="h-8 w-full cursor-pointer rounded border border-border bg-transparent" value={c}
              onChange={(e) => { const n = [...cfg.custom] as ColorCfg["custom"]; n[i] = e.target.value; set({ custom: n }); }} />
          ))}
        </div>
      )}
      <div className="h-3 rounded-full" style={{ background: cssGradient(cfg) }} />
      <Range label="Colour levels" value={cfg.levels} min={2} max={256} step={1} onChange={(v) => set({ levels: v })} />
      <Range label="Intensity (gamma)" value={cfg.intensity} min={0.2} max={4} step={0.05} onChange={(v) => set({ intensity: v })} />
      <Range label="Saturation" value={cfg.saturation} min={0} max={2} step={0.05} onChange={(v) => set({ saturation: v })} />
      <Range label="Brightness" value={cfg.brightness} min={0.3} max={1.8} step={0.05} onChange={(v) => set({ brightness: v })} />
      <label className="block text-xs text-muted-foreground">Gradient direction
        <select className="lab-input mt-1" value={cfg.direction} onChange={(e) => set({ direction: e.target.value as ColorCfg["direction"] })}>
          <option value="linear">Linear (low → high)</option>
          <option value="diverging">Diverging (centre → edges)</option>
          <option value="cyclic">Cyclic (low → high → low)</option>
        </select>
      </label>
      <label className="flex cursor-pointer items-center justify-between text-xs">
        <span className="text-muted-foreground">Invert colours</span>
        <input type="checkbox" className="lab-check" checked={cfg.invert} onChange={(e) => set({ invert: e.target.checked })} />
      </label>
      {inspect !== undefined && <p className="text-[11px] text-muted-foreground">Transparency is the Opacity slider above.</p>}
    </div>
  );
}
