import type { Step } from "./projection_algorithms";
import type { StatsSummary } from "./statistical_analysis";

export interface Experiment {
  id: string; name: string; createdAt: number;
  algorithm: string; steps: Step[]; fx: string; fy: string;
  sampleSize: number; original: StatsSummary; projected: StatsSummary;
}

const KEY = "secp256k1-lab-experiments";

export function loadExperiments(): Experiment[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveExperiments(list: Experiment[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}
