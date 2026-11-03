// Multi-palette colour engine with level quantisation and HSL adjustments.
export type RGB = [number, number, number];
export type PaletteId = "rainbow" | "neon" | "electric" | "fire" | "ocean" | "plasma" | "viridis" | "turbo" | "magma" | "inferno" | "cividis" | "sunset" | "aurora" | "cyberpunk" | "pastel" | "ice" | "forest" | "gold" | "hsv" | "grayscale" | "custom";
export type Direction = "linear" | "diverging" | "cyclic";
export type ColorSource = "rank" | "x" | "y" | "hash" | "density" | "neighbor";

export interface ColorCfg {
  palette: PaletteId; custom: [string, string, string];
  levels: number; intensity: number; saturation: number; brightness: number;
  invert: boolean; direction: Direction; source: ColorSource;
}

export const DEFAULT_COLOR: ColorCfg = {
  palette: "turbo", custom: ["#0b1d51", "#7b3ff2", "#ff6ec7"],
  levels: 64, intensity: 1, saturation: 1, brightness: 1, invert: false, direction: "linear", source: "rank",
};

export const PALETTES: Record<Exclude<PaletteId, "custom">, { label: string; stops: RGB[] }> = {
  rainbow: { label: "Rainbow Spectrum", stops: [[230, 40, 40], [245, 140, 30], [245, 225, 40], [60, 200, 80], [30, 200, 220], [50, 90, 230], [150, 60, 220]] },
  neon: { label: "Extended Neon", stops: [[255, 0, 200], [0, 240, 255], [57, 255, 20], [255, 240, 0], [255, 60, 140], [30, 120, 255]] },
  electric: { label: "Electric Blue & Purple", stops: [[20, 34, 110], [36, 98, 210], [40, 182, 228], [130, 100, 245], [236, 112, 206]] },
  fire: { label: "Fire Spectrum", stops: [[25, 5, 5], [120, 10, 10], [210, 40, 15], [250, 120, 20], [255, 200, 50], [255, 250, 210]] },
  ocean: { label: "Ocean Spectrum", stops: [[5, 15, 50], [10, 50, 120], [20, 110, 170], [30, 170, 180], [100, 220, 210], [210, 250, 245]] },
  plasma: { label: "Plasma", stops: [[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33]] },
  viridis: { label: "Viridis", stops: [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]] },
  turbo: { label: "Turbo", stops: [[48, 18, 59], [70, 107, 227], [40, 187, 236], [49, 242, 153], [164, 252, 59], [237, 208, 58], [251, 128, 34], [210, 48, 5], [122, 4, 3]] },
  magma: { label: "Magma", stops: [[0, 0, 4], [40, 17, 89], [114, 31, 129], [183, 55, 121], [241, 96, 93], [254, 175, 119], [252, 253, 191]] },
  inferno: { label: "Inferno", stops: [[0, 0, 4], [50, 10, 94], [120, 28, 109], [187, 55, 84], [237, 105, 37], [251, 180, 26], [252, 255, 164]] },
  cividis: { label: "Cividis (colour-blind safe)", stops: [[0, 34, 78], [52, 68, 108], [102, 105, 112], [149, 143, 120], [203, 186, 105], [254, 232, 56]] },
  sunset: { label: "Sunset", stops: [[45, 20, 80], [140, 30, 110], [230, 60, 90], [250, 130, 60], [255, 210, 110]] },
  aurora: { label: "Aurora", stops: [[10, 20, 60], [20, 120, 140], [60, 230, 150], [160, 120, 240], [240, 90, 200]] },
  cyberpunk: { label: "Cyberpunk", stops: [[255, 0, 110], [131, 56, 236], [58, 134, 255], [0, 245, 212], [255, 230, 0]] },
  pastel: { label: "Pastel", stops: [[255, 179, 186], [255, 223, 186], [255, 255, 186], [186, 255, 201], [186, 225, 255], [215, 190, 255]] },
  ice: { label: "Ice", stops: [[10, 10, 40], [30, 60, 130], [80, 140, 210], [170, 215, 245], [250, 255, 255]] },
  forest: { label: "Forest", stops: [[20, 30, 15], [40, 80, 30], [90, 140, 50], [170, 190, 80], [235, 230, 150]] },
  gold: { label: "Gold & Copper", stops: [[40, 20, 5], [120, 60, 20], [190, 110, 40], [230, 175, 70], [255, 235, 160]] },
  hsv: { label: "Full Hue Wheel", stops: [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 0, 0]] },
  grayscale: { label: "Grayscale", stops: [[15, 15, 15], [240, 240, 240]] },
};
export const PALETTE_IDS: PaletteId[] = [...(Object.keys(PALETTES) as PaletteId[]), "custom"];
export const paletteLabel = (id: PaletteId) => (id === "custom" ? "Custom Gradient" : PALETTES[id].label);

export const SOURCES: { id: ColorSource; label: string; origin: "public" | "private" }[] = [
  { id: "rank", label: "Private scalar rank", origin: "private" },
  { id: "x", label: "Public X coordinate", origin: "public" },
  { id: "y", label: "Public Y coordinate", origin: "public" },
  { id: "hash", label: "Public coordinate hash", origin: "public" },
  { id: "density", label: "Point density (projected)", origin: "public" },
  { id: "neighbor", label: "Neighbourhood rank similarity", origin: "private" },
];

const hexToRgb = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function interp(stops: RGB[], t: number): RGB {
  t = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const a = stops[i]!, b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function adjust([r, g, b]: RGB, sat: number, bri: number): RGB {
  // Saturation: mix with luminance grey; brightness: scale.
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = (v: number) => Math.min(255, Math.max(0, (l + (v - l) * sat) * bri));
  return [c(r), c(g), c(b)];
}

/** Map a raw value t through direction/inversion/intensity. */
export function shapeT(t: number, cfg: ColorCfg): number {
  if (!Number.isFinite(t)) return t;
  t = Math.min(1, Math.max(0, t));
  if (cfg.direction === "diverging") t = Math.abs(2 * t - 1);
  else if (cfg.direction === "cyclic") t = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  if (cfg.invert) t = 1 - t;
  return Math.pow(t, 1 / Math.max(0.05, cfg.intensity));
}

/** Palette function used by the renderer: t (already a level centre) → adjusted RGB. */
export function makePalette(cfg: ColorCfg): (t: number) => RGB {
  const stops = cfg.palette === "custom" ? cfg.custom.map(hexToRgb) : PALETTES[cfg.palette].stops;
  const L = Math.max(2, Math.round(cfg.levels));
  const lut: RGB[] = Array.from({ length: L }, (_, i) => adjust(interp(stops, i / (L - 1)), cfg.saturation, cfg.brightness));
  return (t: number) => lut[Math.min(L - 1, Math.max(0, Math.round((Number.isFinite(t) ? t : 0) * (L - 1))))]!;
}

export function cssGradient(cfg: ColorCfg): string {
  const p = makePalette(cfg);
  const parts = Array.from({ length: 16 }, (_, i) => { const c = p(shapeT(i / 15, cfg)); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; });
  return `linear-gradient(90deg, ${parts.join(",")})`;
}

/** Compute raw colour values per point for a source. */
export function colorValues(
  source: ColorSource,
  s: { u: Float64Array; v: Float64Array; rank: Float32Array; xHex: string[]; yHex: string[] },
  nnDist: Float64Array | undefined, nnIdx: Int32Array | undefined,
): Float32Array {
  const n = s.u.length, out = new Float32Array(n);
  switch (source) {
    case "rank": out.set(s.rank); break;
    case "x": for (let i = 0; i < n; i++) out[i] = s.u[i]! + 0.5; break;
    case "y": for (let i = 0; i < n; i++) out[i] = s.v[i]! + 0.5; break;
    case "hash":
      for (let i = 0; i < n; i++) {
        let h = 0x811c9dc5;
        const str = s.xHex[i]! + s.yHex[i]!;
        for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 0x01000193); }
        out[i] = (h >>> 0) / 4294967296;
      }
      break;
    case "density": {
      if (!nnDist) break;
      const idx = Array.from(nnDist.keys()).filter((i) => Number.isFinite(nnDist[i]!)).sort((a, b) => nnDist[b]! - nnDist[a]!);
      out.fill(NaN);
      idx.forEach((i, r) => { out[i] = idx.length > 1 ? r / (idx.length - 1) : 0; });
      break;
    }
    case "neighbor":
      for (let i = 0; i < n; i++) { const j = nnIdx?.[i] ?? -1; out[i] = j >= 0 ? 1 - Math.abs(s.rank[i]! - s.rank[j]!) : NaN; }
      break;
  }
  return out;
}
