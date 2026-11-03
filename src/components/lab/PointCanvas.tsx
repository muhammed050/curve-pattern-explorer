import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCcw, Download } from "lucide-react";
import { bin, bounds, colormap, gaussianBlur, rankArray, rgb, type VizMode } from "@/lib/lab/visualization_engine";

export interface Viz { pointSize: number; opacity: number; colorScale: boolean; grid: boolean; mode: VizMode; hover: boolean; showKeys?: boolean }

interface Props {
  x: Float64Array; y: Float64Array; rank: Float32Array; nnDist?: Float64Array | undefined;
  xHex: string[]; yHex: string[]; viz: Viz; title: string; className?: string;
  /** maps a colour value t∈[0,1] to RGB */ palette?: (t: number) => [number, number, number];
  levels?: number;
  extraInfo?: (i: number) => ReactNode;
  /** synthetic private scalar label for point i (opt-in display only) */ keyLabel?: (i: number) => string;
}

export function PointCanvas({ x, y, rank, nnDist, xHex, yHex, viz, title, className, palette, levels, extraInfo, keyLabel }: Props) {
  const pal = palette ?? colormap;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [view, setView] = useState({ z: 1, ox: 0, oy: 0 });
  const viewRef = useRef(view); viewRef.current = view;
  const [hover, setHover] = useState<{ i: number; sx: number; sy: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const b = useMemo(() => bounds(x, y), [x, y]);
  const nnRank = useMemo(() => (nnDist ? rankArray(nnDist) : null), [nnDist]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: Math.max(100, e.contentRect.width), h: Math.max(100, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // base transform: data → screen (before zoom/pan), y flipped, aspect-preserving
  const base = useMemo(() => {
    const pad = 36, w = size.w - pad * 2, h = size.h - pad * 2;
    const k = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY));
    const offX = pad + (w - k * (b.maxX - b.minX)) / 2, offY = pad + (h - k * (b.maxY - b.minY)) / 2;
    return {
      k,
      fx: (dx: number) => offX + (dx - b.minX) * k,
      fy: (dy: number) => offY + (b.maxY - dy) * k,
    };
  }, [size, b]);
  const sx = (dx: number) => view.ox + view.z * base.fx(dx);
  const sy = (dy: number) => view.oy + view.z * base.fy(dy);

  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    const v = (n: string) => css.getPropertyValue(n).trim();
    ctx.fillStyle = v("--plot-bg"); ctx.fillRect(0, 0, size.w, size.h);

    if (viz.grid) {
      ctx.strokeStyle = v("--plot-grid"); ctx.fillStyle = v("--plot-axis");
      ctx.lineWidth = 1; ctx.font = "10px JetBrains Mono, monospace";
      for (let i = 0; i <= 10; i++) {
        const dx = b.minX + ((b.maxX - b.minX) * i) / 10, dy = b.minY + ((b.maxY - b.minY) * i) / 10;
        const X = sx(dx), Y = sy(dy);
        ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, size.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(size.w, Y); ctx.stroke();
        if (i % 2 === 0) { ctx.fillText(dx.toFixed(2), X + 3, size.h - 6); ctx.fillText(dy.toFixed(2), 4, Y - 3); }
      }
    }

    const mode = viz.mode;
    if (mode === "points" || mode === "neighborhood") {
      const BK = Math.max(2, Math.round(levels ?? 48));
      const buckets: number[][] = Array.from({ length: BK }, () => []);
      for (let i = 0; i < x.length; i++) {
        if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) continue;
        const t = mode === "neighborhood" ? (nnRank ? nnRank[i]! : 0) : viz.colorScale ? rank[i]! : 0.35;
        if (!Number.isFinite(t)) continue;
        buckets[Math.min(BK - 1, Math.floor(t * BK))]!.push(i);
      }
      const r = viz.pointSize;
      buckets.forEach((list, bi) => {
        if (!list.length) return;
        ctx.fillStyle = rgb(pal(BK > 1 ? bi / (BK - 1) : 0), viz.opacity);
        ctx.beginPath();
        for (const i of list) {
          const X = sx(x[i]!), Y = sy(y[i]!);
          if (X < -r || Y < -r || X > size.w + r || Y > size.h + r) continue;
          ctx.moveTo(X + r, Y); ctx.arc(X, Y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      });
    } else {
      const B = mode === "hist2d" ? 32 : mode === "colordist" ? 36 : mode === "kde" ? 128 : 80;
      const { cnt, sum } = bin(x, y, b, B, mode === "colordist" ? rank : undefined);
      let vals: Float64Array = cnt;
      if (mode === "kde") vals = gaussianBlur(cnt, B, Math.max(1.5, B / Math.sqrt(x.length) * 1.2));
      if (mode === "colordist") vals = cnt.map((c, i) => (c ? sum[i]! / c : NaN));
      let max = 0;
      for (const q of vals) if (Number.isFinite(q) && q > max) max = q;
      const cw = (b.maxX - b.minX) / B, ch = (b.maxY - b.minY) / B;
      for (let gy = 0; gy < B; gy++) for (let gx = 0; gx < B; gx++) {
        const q = vals[gy * B + gx]!;
        if (!Number.isFinite(q) || (mode !== "colordist" && q <= 0)) continue;
        const t = mode === "colordist" ? q : mode === "density" ? Math.log1p(q) / Math.log1p(max) : q / max;
        ctx.fillStyle = rgb(pal(t), mode === "colordist" ? viz.opacity : Math.max(0.15, viz.opacity * (0.3 + 0.7 * t)));
        const X0 = sx(b.minX + gx * cw), Y0 = sy(b.minY + (gy + 1) * ch);
        const X1 = sx(b.minX + (gx + 1) * cw), Y1 = sy(b.minY + gy * ch);
        ctx.fillRect(X0, Y0, X1 - X0 + 0.5, Y1 - Y0 + 0.5);
        if (mode === "hist2d" && X1 - X0 > 22) {
          ctx.fillStyle = v("--plot-axis"); ctx.font = "9px JetBrains Mono, monospace";
          ctx.fillText(String(q), X0 + 3, Y0 + 11);
        }
      }
    }
    if (viz.showKeys && keyLabel && (mode === "points" || mode === "neighborhood")) {
      ctx.font = "10px JetBrains Mono, monospace"; ctx.textBaseline = "middle";
      const fg = v("--plot-axis"), bg = v("--plot-bg");
      let drawn = 0;
      const full = view.z >= 6;
      for (let i = 0; i < x.length && drawn < 400; i++) {
        if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) continue;
        const X = sx(x[i]!), Y = sy(y[i]!);
        if (X < 0 || Y < 0 || X > size.w || Y > size.h) continue;
        const k = keyLabel(i), txt = full ? k : `${k.slice(0, 8)}…${k.slice(-4)}`;
        const tx = X + viz.pointSize + 3;
        ctx.fillStyle = bg; ctx.globalAlpha = 0.7; ctx.fillRect(tx - 1, Y - 6, ctx.measureText(txt).width + 2, 12);
        ctx.globalAlpha = 1; ctx.fillStyle = fg; ctx.fillText(txt, tx, Y);
        drawn++;
      }
      ctx.textBaseline = "alphabetic";
    }
    if (hover && viz.hover) {
      ctx.strokeStyle = v("--plot-axis"); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hover.sx, hover.sy, viz.pointSize + 4, 0, Math.PI * 2); ctx.stroke();
    }
  });

  // Wheel zoom anchored at cursor (native non-passive listener)
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const { z, ox, oy } = viewRef.current;
      const next = Math.min(400, Math.max(0.2, z * Math.exp(-dy * 0.0015)));
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top, k = next / z;
      setView({ z: next, ox: px - (px - ox) * k, oy: py - (py - oy) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onMove = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const d = drag.current;
    if (d) {
      const ox = d.ox + e.clientX - d.x, oy = d.oy + e.clientY - d.y;
      setView((v) => ({ ...v, ox, oy }));
      return;
    }
    if (!viz.hover) return;
    let best = 100, bi = -1;
    for (let i = 0; i < x.length; i++) {
      const X = sx(x[i]!), Y = sy(y[i]!);
      const d = (X - px) ** 2 + (Y - py) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    setHover(bi >= 0 ? { i: bi, sx: sx(x[bi]!), sy: sy(y[bi]!) } : null);
  };

  const exportPng = () => {
    const a = document.createElement("a");
    a.href = canvas.current!.toDataURL("image/png");
    a.download = `secp256k1-${title.toLowerCase().replace(/\W+/g, "-")}.png`;
    a.click();
  };

  return (
    <div className={`relative flex flex-col overflow-hidden rounded-xl border border-border bg-card ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{title}</span>
        <div className="flex gap-1">
          <button className="lab-icon-btn" onClick={() => setView({ z: 1, ox: 0, oy: 0 })} title="Reset zoom"><RotateCcw size={14} /></button>
          <button className="lab-icon-btn" onClick={exportPng} title="Export PNG"><Download size={14} /></button>
        </div>
      </div>
      <div ref={wrap} className="relative min-h-0 flex-1">
        <canvas
          ref={canvas}
          style={{ width: size.w, height: size.h, touchAction: "none" }}
          className="absolute inset-0 cursor-crosshair"
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; (e.target as Element).setPointerCapture(e.pointerId); }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
        {hover && viz.hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-[340px] rounded-md border border-border bg-popover/95 p-2 font-mono text-[10px] leading-relaxed text-popover-foreground shadow-lg backdrop-blur"
            style={{ left: Math.max(4, Math.min(hover.sx + 12, size.w - 350)), top: Math.max(4, Math.min(hover.sy + 12, size.h - (extraInfo ? 260 : 110))) }}
          >
            <div className="text-primary">point #{hover.i}</div>
            <div className="break-all">X: {xHex[hover.i]!.slice(0, 20)}…{xHex[hover.i]!.slice(-8)}</div>
            <div className="break-all">Y: {yHex[hover.i]!.slice(0, 20)}…{yHex[hover.i]!.slice(-8)}</div>
            <div>proj: ({x[hover.i]!.toFixed(5)}, {y[hover.i]!.toFixed(5)})</div>
            {keyLabel && <div className="break-all text-accent">priv: {keyLabel(hover.i)}</div>}
            {extraInfo?.(hover.i)}
          </div>
        )}
      </div>
    </div>
  );
}
