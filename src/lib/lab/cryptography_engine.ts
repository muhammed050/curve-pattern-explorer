// secp256k1 engine: modular arithmetic, Jacobian point ops, fixed-base scalar multiplication.
export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
export const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

export interface Jac { X: bigint; Y: bigint; Z: bigint }
export interface Aff { x: bigint; y: bigint }
export const INF: Jac = { X: 0n, Y: 1n, Z: 0n };

export const mod = (a: bigint, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };

export function inv(a: bigint, m = P): bigint {
  let lm = 1n, hm = 0n, low = mod(a, m), high = m;
  if (low === 0n) throw new Error("inverse of zero");
  while (low > 1n) {
    const r = high / low;
    [lm, hm] = [hm - lm * r, lm];
    [low, high] = [high - low * r, low];
  }
  return mod(lm, m);
}

export function jDouble(p: Jac): Jac {
  if (p.Z === 0n || p.Y === 0n) return INF;
  const A = mod(p.X * p.X), B = mod(p.Y * p.Y), C = mod(B * B);
  const D = mod(2n * (mod((p.X + B) * (p.X + B)) - A - C));
  const E = mod(3n * A), F = mod(E * E);
  const X3 = mod(F - 2n * D);
  const Y3 = mod(E * (D - X3) - 8n * C);
  const Z3 = mod(2n * p.Y * p.Z);
  return { X: X3, Y: Y3, Z: Z3 };
}

export function jAdd(p: Jac, q: Jac): Jac {
  if (p.Z === 0n) return q;
  if (q.Z === 0n) return p;
  const Z1Z1 = mod(p.Z * p.Z), Z2Z2 = mod(q.Z * q.Z);
  const U1 = mod(p.X * Z2Z2), U2 = mod(q.X * Z1Z1);
  const S1 = mod(p.Y * q.Z * Z2Z2), S2 = mod(q.Y * p.Z * Z1Z1);
  const H = mod(U2 - U1), R = mod(S2 - S1);
  if (H === 0n) return R === 0n ? jDouble(p) : INF;
  const H2 = mod(H * H), H3 = mod(H * H2), U1H2 = mod(U1 * H2);
  const X3 = mod(R * R - H3 - 2n * U1H2);
  const Y3 = mod(R * (U1H2 - X3) - S1 * H3);
  const Z3 = mod(H * p.Z * q.Z);
  return { X: X3, Y: Y3, Z: Z3 };
}

export function toAffine(p: Jac): Aff | null {
  if (p.Z === 0n) return null;
  const zi = inv(p.Z), z2 = mod(zi * zi);
  return { x: mod(p.X * z2), y: mod(p.Y * z2 * zi) };
}

/** Montgomery batch inversion: one modular inverse for the whole batch. */
export function batchToAffine(ps: Jac[]): Aff[] {
  const n = ps.length;
  const pre: bigint[] = new Array(n);
  let acc = 1n;
  for (let i = 0; i < n; i++) { pre[i] = acc; acc = mod(acc * ps[i].Z); }
  let invAcc = inv(acc);
  const out: Aff[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const zi = mod(invAcc * pre[i]);
    invAcc = mod(invAcc * ps[i].Z);
    const z2 = mod(zi * zi);
    out[i] = { x: mod(ps[i].X * z2), y: mod(ps[i].Y * z2 * zi) };
  }
  return out;
}

export const isOnCurve = (a: Aff) => mod(a.y * a.y) === mod(a.x * a.x * a.x + 7n);

/** Generic double-and-add (used for validation). */
export function scalarMul(k: bigint, p: Aff): Jac {
  let r = INF, q: Jac = { X: p.x, Y: p.y, Z: 1n };
  k = mod(k, N);
  while (k > 0n) { if (k & 1n) r = jAdd(r, q); q = jDouble(q); k >>= 1n; }
  return r;
}

let TABLE: Jac[] | null = null;
function table(): Jac[] {
  if (TABLE) return TABLE;
  const pts: Jac[] = [];
  let q: Jac = { X: Gx, Y: Gy, Z: 1n };
  for (let i = 0; i < 256; i++) { pts.push(q); q = jDouble(q); }
  TABLE = batchToAffine(pts).map((a) => ({ X: a.x, Y: a.y, Z: 1n }));
  return TABLE;
}

/** Fixed-base k·G using precomputed 2^i·G (additions only). */
export function mulG(k: bigint): Jac {
  const T = table();
  let r = INF, i = 0;
  while (k > 0n) { if (k & 1n) r = jAdd(r, T[i]); k >>= 1n; i++; }
  return r;
}

export function publicKey(k: bigint): Aff {
  if (k <= 0n || k >= N) throw new Error("scalar out of range");
  return toAffine(mulG(k))!;
}

/** CSPRNG scalar in [1, N-1] via rejection sampling. */
export function randomScalar(): bigint {
  const b = new Uint8Array(32);
  for (;;) {
    crypto.getRandomValues(b);
    let k = 0n;
    for (const x of b) k = (k << 8n) | BigInt(x);
    if (k > 0n && k < N) return k;
  }
}

export const TEST_VECTORS: { k: bigint; x: bigint; y: bigint; label: string }[] = [
  { label: "1·G", k: 1n, x: Gx, y: Gy },
  { label: "2·G", k: 2n,
    x: 0xc6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5n,
    y: 0x1ae168fea63dc339a3c58419466ceaeef7f632653266d0e1236431a950cfe52an },
  { label: "3·G", k: 3n,
    x: 0xf9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9n,
    y: 0x388f7b0f632de8140fe337e62a37f3566500a99934c2231b6cb9fd7584b8e672n },
  { label: "(N−1)·G", k: N - 1n, x: Gx, y: P - Gy },
];

export function runSelfTest(): { label: string; ok: boolean }[] {
  const res = TEST_VECTORS.map((t) => {
    const a = publicKey(t.k), b = toAffine(scalarMul(t.k, { x: Gx, y: Gy }))!;
    return { label: t.label, ok: a.x === t.x && a.y === t.y && b.x === t.x && b.y === t.y && isOnCurve(a) };
  });
  res.push({ label: "N·G = ∞", ok: jAdd(mulG(N - 1n), { X: Gx, Y: Gy, Z: 1n }).Z === 0n });
  return res;
}

export interface Sample {
  n: number;
  u: Float64Array; // X/P - 0.5
  v: Float64Array; // Y/P - 0.5
  rank: Float32Array; // rank of synthetic scalar within sample, normalized to [0,1]
  xHex: string[];
  yHex: string[];
  createdAt: number;
}

const toUnit = (a: bigint) => Number(a >> 200n) / 2 ** 56; // ≈ a / 2^256 ≈ a / P

/** Generate n synthetic key pairs in chunks; scalars are discarded after ranking. */
export async function generateSample(n: number, onProgress?: (f: number) => void): Promise<Sample> {
  const scalars: bigint[] = new Array(n);
  const jac: Jac[] = new Array(n);
  const chunk = 100;
  for (let i = 0; i < n; i += chunk) {
    const end = Math.min(n, i + chunk);
    for (let j = i; j < end; j++) { scalars[j] = randomScalar(); jac[j] = mulG(scalars[j]); }
    onProgress?.(end / n * 0.95);
    await new Promise((r) => setTimeout(r, 0));
  }
  const aff = batchToAffine(jac);
  const order = scalars.map((_, i) => i).sort((a, b) => (scalars[a] < scalars[b] ? -1 : scalars[a] > scalars[b] ? 1 : 0));
  const rank = new Float32Array(n);
  order.forEach((idx, r) => { rank[idx] = n > 1 ? r / (n - 1) : 0; });
  scalars.fill(0n);
  const u = new Float64Array(n), v = new Float64Array(n);
  const xHex: string[] = new Array(n), yHex: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = toUnit(aff[i].x) - 0.5; v[i] = toUnit(aff[i].y) - 0.5;
    xHex[i] = aff[i].x.toString(16).padStart(64, "0");
    yHex[i] = aff[i].y.toString(16).padStart(64, "0");
  }
  onProgress?.(1);
  return { n, u, v, rank, xHex, yHex, createdAt: Date.now() };
}
