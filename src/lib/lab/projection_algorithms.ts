// Projection pipeline. Inputs are ONLY public coordinates (u = X/P − 0.5, v = Y/P − 0.5).
import type { CustomFn } from "./formula";

export type StepType = "linear" | "rotation" | "twist" | "polar" | "radial" | "shear" | "custom";
export interface ParamDef { key: string; label: string; min: number; max: number; step: number; def: number }
export interface Step { type: StepType; enabled: boolean; params: Record<string, number> }

export const STEP_DEFS: Record<StepType, { label: string; desc: string; params: ParamDef[] }> = {
  linear: { label: "Linear projection", desc: "[x′ y′] = M·[u v] + t", params: [
    { key: "a11", label: "m₁₁", min: -3, max: 3, step: 0.01, def: 1 },
    { key: "a12", label: "m₁₂", min: -3, max: 3, step: 0.01, def: 0 },
    { key: "a21", label: "m₂₁", min: -3, max: 3, step: 0.01, def: 0 },
    { key: "a22", label: "m₂₂", min: -3, max: 3, step: 0.01, def: 1 },
    { key: "tx", label: "tₓ", min: -1, max: 1, step: 0.01, def: 0 },
    { key: "ty", label: "t_y", min: -1, max: 1, step: 0.01, def: 0 },
  ] },
  rotation: { label: "Rotation", desc: "Rotate by θ around the origin", params: [
    { key: "deg", label: "θ (deg)", min: -180, max: 180, step: 1, def: 30 },
  ] },
  twist: { label: "Nonlinear twist", desc: "φ′ = φ + k·r^γ", params: [
    { key: "k", label: "k", min: -40, max: 40, step: 0.1, def: 8 },
    { key: "g", label: "γ", min: 0.2, max: 3, step: 0.05, def: 1 },
  ] },
  polar: { label: "Polar projection", desc: "(u,v) → (φ/π, s·r)", params: [
    { key: "s", label: "radius scale s", min: 0.2, max: 4, step: 0.05, def: 2 },
  ] },
  radial: { label: "Radial transform", desc: "r′ = s·r^p, angle kept", params: [
    { key: "p", label: "power p", min: 0.1, max: 4, step: 0.05, def: 0.5 },
    { key: "s", label: "scale s", min: 0.1, max: 3, step: 0.05, def: 1 },
  ] },
  shear: { label: "Shear", desc: "x′ = x + sₓ·y, y′ = y + s_y·x", params: [
    { key: "sx", label: "sₓ", min: -3, max: 3, step: 0.01, def: 0.6 },
    { key: "sy", label: "s_y", min: -3, max: 3, step: 0.01, def: 0 },
  ] },
  custom: { label: "Custom formula", desc: "x′ = f(u,v), y′ = g(u,v)", params: [
    { key: "a", label: "a", min: -5, max: 5, step: 0.01, def: 0.2 },
    { key: "b", label: "b", min: -5, max: 5, step: 0.01, def: 1 },
    { key: "c", label: "c", min: -5, max: 5, step: 0.01, def: 0 },
  ] },
};

export const STEP_ORDER: StepType[] = ["linear", "rotation", "twist", "polar", "radial", "shear", "custom"];

export function defaultSteps(): Step[] {
  return STEP_ORDER.map((type) => ({
    type, enabled: false,
    params: Object.fromEntries(STEP_DEFS[type]!.params.map((p) => [p.key, p.def])),
  }));
}

export function describePipeline(steps: Step[]): string {
  const on = steps.filter((s) => s.enabled);
  return on.length ? on.map((s) => STEP_DEFS[s.type]!.label).join(" → ") : "Original normalized X/Y";
}

export function project(u: Float64Array, v: Float64Array, steps: Step[], custom: CustomFn | null) {
  const n = u.length;
  const x = new Float64Array(u), y = new Float64Array(v);
  for (const s of steps) {
    if (!s.enabled) continue;
    const q = s.params;
    switch (s.type) {
      case "linear":
        for (let i = 0; i < n; i++) {
          const a = x[i]!, b = y[i]!;
          x[i]! = q["a11"]! * a + q["a12"]! * b + q["tx"]!; y[i]! = q["a21"]! * a + q["a22"]! * b + q["ty"]!;
        }
        break;
      case "rotation": {
        const t = (q["deg"]! * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
        for (let i = 0; i < n; i++) { const a = x[i]!, b = y[i]!; x[i]! = c * a - sn * b; y[i]! = sn * a + c * b; }
        break;
      }
      case "twist":
        for (let i = 0; i < n; i++) {
          const r = Math.hypot(x[i]!, y[i]!), ph = Math.atan2(y[i]!, x[i]!) + q["k"]! * Math.pow(r, q["g"]!);
          x[i]! = r * Math.cos(ph); y[i]! = r * Math.sin(ph);
        }
        break;
      case "polar":
        for (let i = 0; i < n; i++) {
          const r = Math.hypot(x[i]!, y[i]!), ph = Math.atan2(y[i]!, x[i]!);
          x[i]! = ph / Math.PI; y[i]! = q["s"]! * r;
        }
        break;
      case "radial":
        for (let i = 0; i < n; i++) {
          const r = Math.hypot(x[i]!, y[i]!);
          if (r === 0) continue;
          const k = (q["s"]! * Math.pow(r, q["p"]!)) / r;
          x[i]! *= k; y[i]! *= k;
        }
        break;
      case "shear":
        for (let i = 0; i < n; i++) { const a = x[i]!, b = y[i]!; x[i]! = a + q["sx"]! * b; y[i]! = b + q["sy"]! * a; }
        break;
      case "custom":
        if (!custom) break;
        for (let i = 0; i < n; i++) {
          const [a, b] = custom(x[i]!, y[i]!, q["a"]!, q["b"]!, q["c"]!);
          x[i]! = a; y[i]! = b;
        }
        break;
    }
  }
  return { x, y };
}
