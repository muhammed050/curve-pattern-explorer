// Safe expression parser: tokenizer + recursive descent → closure. No eval.
type Node =
  | { k: "num"; v: number }
  | { k: "var"; n: string }
  | { k: "un"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; f: string; args: Node[] };

export const FUNCS: Record<string, [(...a: number[]) => number, number, number]> = {
  sin: [Math.sin, 1, 1], cos: [Math.cos, 1, 1], tan: [Math.tan, 1, 1],
  asin: [Math.asin, 1, 1], acos: [Math.acos, 1, 1], atan: [Math.atan, 1, 1], atan2: [Math.atan2, 2, 2],
  sinh: [Math.sinh, 1, 1], cosh: [Math.cosh, 1, 1], tanh: [Math.tanh, 1, 1],
  exp: [Math.exp, 1, 1], log: [Math.log, 1, 1], log10: [Math.log10, 1, 1], sqrt: [Math.sqrt, 1, 1],
  abs: [Math.abs, 1, 1], floor: [Math.floor, 1, 1], ceil: [Math.ceil, 1, 1], round: [Math.round, 1, 1],
  sign: [Math.sign, 1, 1], pow: [Math.pow, 2, 2], hypot: [Math.hypot, 1, 8],
  min: [Math.min, 1, 8], max: [Math.max, 1, 8],
  mod: [(a, b) => ((a % b) + b) % b, 2, 2], frac: [(a) => a - Math.floor(a), 1, 1],
};
export const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
export const VARS = ["u", "v", "r", "theta", "a", "b", "c"] as const;
export type Env = Record<(typeof VARS)[number], number>;

interface Tok { t: "num" | "id" | "op"; s: string; pos: number }

function tokenize(src: string): Tok[] {
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(\*\*|[-+*/^%(),]))/y;
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`Unexpected character '${src.slice(i).trim()[0]}' at position ${i + 1}`);
    const pos = m.index + m[0].length - (m[1] ?? m[2] ?? m[3]).length;
    if (m[1]) out.push({ t: "num", s: m[1], pos });
    else if (m[2]) out.push({ t: "id", s: m[2], pos });
    else out.push({ t: "op", s: m[3] === "**" ? "^" : m[3], pos });
    i = re.lastIndex;
  }
  return out;
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  if (!toks.length) throw new Error("Expression is empty");
  let p = 0;
  const peek = () => toks[p];
  const isOp = (s: string) => peek()?.t === "op" && peek().s === s;
  const expect = (s: string) => {
    if (!isOp(s)) throw new Error(`Expected '${s}'${peek() ? ` at position ${peek().pos + 1}` : " at end"}`);
    p++;
  };
  const expr = (): Node => {
    let a = term();
    while (isOp("+") || isOp("-")) { const op = toks[p++].s; a = { k: "bin", op, a, b: term() }; }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (isOp("*") || isOp("/") || isOp("%")) { const op = toks[p++].s; a = { k: "bin", op, a, b: unary() }; }
    return a;
  };
  const unary = (): Node => {
    if (isOp("-")) { p++; return { k: "un", a: unary() }; }
    if (isOp("+")) { p++; return unary(); }
    return power();
  };
  const power = (): Node => {
    const a = atom();
    if (isOp("^")) { p++; return { k: "bin", op: "^", a, b: unary() }; }
    return a;
  };
  const atom = (): Node => {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.t === "num") { p++; return { k: "num", v: parseFloat(t.s) }; }
    if (t.t === "id") {
      p++;
      if (isOp("(")) {
        const f = FUNCS[t.s];
        if (!f) throw new Error(`Unknown function '${t.s}' at position ${t.pos + 1}`);
        p++;
        const args: Node[] = [];
        if (!isOp(")")) { args.push(expr()); while (isOp(",")) { p++; args.push(expr()); } }
        expect(")");
        if (args.length < f[1] || args.length > f[2]) throw new Error(`${t.s}() expects ${f[1] === f[2] ? f[1] : `${f[1]}–${f[2]}`} argument(s), got ${args.length}`);
        return { k: "call", f: t.s, args };
      }
      if (t.s in CONSTS) return { k: "num", v: CONSTS[t.s] };
      if ((VARS as readonly string[]).includes(t.s)) return { k: "var", n: t.s };
      throw new Error(`Unknown variable '${t.s}' at position ${t.pos + 1}`);
    }
    if (isOp("(")) { p++; const e = expr(); expect(")"); return e; }
    throw new Error(`Unexpected '${t.s}' at position ${t.pos + 1}`);
  };
  const root = expr();
  if (p < toks.length) throw new Error(`Unexpected '${toks[p].s}' at position ${toks[p].pos + 1}`);
  return root;
}

function compileNode(n: Node): (e: Env) => number {
  switch (n.k) {
    case "num": { const v = n.v; return () => v; }
    case "var": { const k = n.n as keyof Env; return (e) => e[k]; }
    case "un": { const a = compileNode(n.a); return (e) => -a(e); }
    case "call": {
      const f = FUNCS[n.f][0], args = n.args.map(compileNode);
      if (args.length === 1) { const a0 = args[0]; return (e) => f(a0(e)); }
      if (args.length === 2) { const [a0, a1] = args; return (e) => f(a0(e), a1(e)); }
      return (e) => f(...args.map((g) => g(e)));
    }
    case "bin": {
      const a = compileNode(n.a), b = compileNode(n.b);
      switch (n.op) {
        case "+": return (e) => a(e) + b(e);
        case "-": return (e) => a(e) - b(e);
        case "*": return (e) => a(e) * b(e);
        case "/": return (e) => a(e) / b(e);
        case "%": return (e) => a(e) % b(e);
        default: return (e) => Math.pow(a(e), b(e));
      }
    }
  }
}

export function compile(src: string): (e: Env) => number {
  return compileNode(parse(src));
}

export type CustomFn = (u: number, v: number, a: number, b: number, c: number) => [number, number];

export function compileProjection(fx: string, fy: string): { fn: CustomFn | null; error: string | null } {
  try {
    const gx = compile(fx);
    let gy: (e: Env) => number;
    try { gy = compile(fy); } catch (e) { return { fn: null, error: `y′: ${(e as Error).message}` }; }
    const env: Env = { u: 0, v: 0, r: 0, theta: 0, a: 0, b: 0, c: 0 };
    const fn: CustomFn = (u, v, a, b, c) => {
      env.u = u; env.v = v; env.r = Math.hypot(u, v); env.theta = Math.atan2(v, u);
      env.a = a; env.b = b; env.c = c;
      return [gx(env), gy(env)];
    };
    return { fn, error: null };
  } catch (e) {
    return { fn: null, error: `x′: ${(e as Error).message}` };
  }
}
