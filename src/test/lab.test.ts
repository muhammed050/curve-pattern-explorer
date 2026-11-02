import { describe, expect, it } from "vitest";
import { publicKey, TEST_VECTORS, runSelfTest, isOnCurve, randomScalar, N } from "@/lib/lab/cryptography_engine";
import { compileProjection, parse } from "@/lib/lab/formula";
import { computeStats } from "@/lib/lab/statistical_analysis";
import { defaultSteps, project } from "@/lib/lab/projection_algorithms";

describe("secp256k1", () => {
  for (const t of TEST_VECTORS) it(`matches ${t.label}`, () => {
    const a = publicKey(t.k);
    expect(a.x).toBe(t.x); expect(a.y).toBe(t.y);
  });
  it("self-test passes", () => expect(runSelfTest().every((r) => r.ok)).toBe(true));
  it("random scalars are in range and on curve", () => {
    const k = randomScalar();
    expect(k > 0n && k < N).toBe(true);
    expect(isOnCurve(publicKey(k))).toBe(true);
  });
});

describe("formula parser", () => {
  it("evaluates", () => {
    const { fn } = compileProjection("u^2 + sin(pi/2)", "atan2(v,u)*a");
    expect(fn!(2, 1, 3, 0, 0)[0]).toBeCloseTo(5);
    expect(fn!(1, 1, 4, 0, 0)[1]).toBeCloseTo(Math.PI);
  });
  it("rejects unsafe code", () => {
    expect(() => parse("alert(1)")).toThrow(/Unknown function/);
    expect(() => parse("constructor")).toThrow(/Unknown variable/);
    expect(compileProjection("u+", "v").error).toBeTruthy();
  });
});

describe("stats", () => {
  it("random colours give LCS near 0; correlated give high LCS", () => {
    const n = 2000, u = new Float64Array(n), v = new Float64Array(n), rr = new Float32Array(n), rc = new Float32Array(n);
    for (let i = 0; i < n; i++) { u[i] = Math.random(); v[i] = Math.random(); rr[i] = Math.random(); rc[i] = u[i]; }
    expect(Math.abs(computeStats(u, v, rr).lcs)).toBeLessThan(0.1);
    expect(computeStats(u, v, rc).lcs).toBeGreaterThan(0.8);
  });
  it("rotation preserves NN distances", () => {
    const n = 500, u = new Float64Array(n).map(() => Math.random() - 0.5), v = new Float64Array(n).map(() => Math.random() - 0.5);
    const steps = defaultSteps(); steps[1].enabled = true; steps[1].params.deg = 0;
    const p = project(u, v, steps, null);
    expect(Array.from(p.x)).toEqual(Array.from(u));
  });
});
