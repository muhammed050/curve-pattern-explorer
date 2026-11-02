import { describe, expect, it } from "vitest";
import { detectGeometricPatterns } from "@/lib/lab/geometric_pattern_detection";

describe("geometric pattern detection", () => {
  it("finds a deliberately planted straight line among noise", () => {
    const x = new Float64Array(240), y = new Float64Array(240);
    let seed = 17;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 200; i++) { x[i] = random(); y[i] = random(); }
    for (let i = 0; i < 40; i++) { x[200 + i] = i / 39; y[200 + i] = 0.35 * (i / 39) + 0.2; }
    const result = detectGeometricPatterns(x, y, { seed: 9, tolerance: 0.002, minInliers: 20 });
    expect(result.validCount).toBe(240);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines[0]!.count).toBeGreaterThanOrEqual(35);
    expect(result.lines[0]!.rmsResidual).toBeLessThan(0.002);
  });

  it("ignores invalid coordinates and handles degenerate input", () => {
    const x = new Float64Array([1, 1, 1, NaN]);
    const y = new Float64Array([2, 2, 2, 3]);
    const result = detectGeometricPatterns(x, y);
    expect(result.validCount).toBe(3);
    expect(result.lines).toHaveLength(0);
  });

  it("is deterministic for a fixed seed", () => {
    const x = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const y = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const a = detectGeometricPatterns(x, y, { seed: 123, minInliers: 5 });
    const b = detectGeometricPatterns(x, y, { seed: 123, minInliers: 5 });
    expect(a.lines).toEqual(b.lines);
    expect(a.directionPeaks).toEqual(b.directionPeaks);
  });
});
