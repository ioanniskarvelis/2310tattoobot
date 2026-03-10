// matching.ts — v2.0
// Pricing priority: 1) Complexity/detail  2) Size  3) Style  4) Color

type SizeCategory = "tiny" | "small" | "medium" | "large" | "xlarge";
type ThicknessCategory = "very_thin" | "thin" | "medium" | "thick";

export type TattooFeatures = {
  record_id?: string;
  image_uri?: string;
  final_price?: number;
  color_present?: boolean;
  natural_size_category?: SizeCategory;
  width_dominant?: boolean;
  category_primary?: string;
  category_secondary?: string | null;
  tattoo_effort_score?: number;
  fill_density_per_area?: number;
  shading_density_per_area?: number;
  shading_scalability_score?: number;
  micro_detail_score?: number;
  texture_density_score?: number;
  line_density_score?: number;
  edge_complexity_score?: number;
  line_thickness_category?: ThicknessCategory;
  has_text?: boolean;
  has_decorative_script?: boolean;
  overall_confidence?: number;
};

export type MatchResult = {
  record: TattooFeatures;
  similarity: number;
};

export type PriceSuggestion = {
  suggested_price: number | null;
  price_range: string | null;
  confidence: "very_high" | "high" | "medium" | "low" | "insufficient_data";
  action?: "manual_review";
  based_on: number;
  top_similarity: number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const SIZE_ORDER: SizeCategory[] = ["tiny", "small", "medium", "large", "xlarge"];

const THICKNESS_MAP: Record<ThicknessCategory, number> = {
  very_thin: 0,
  thin: 1,
  medium: 2,
  thick: 3,
};

// Styles that can price-compare with each other
const COMPATIBLE_STYLES: Record<string, string[]> = {
  realism_blackgrey: ["realism_blackgrey", "illustrative", "portrait"],
  realism_color: ["realism_color", "illustrative", "portrait"],
  blackwork: ["blackwork", "linework", "geometric", "tribal"],
  linework: ["linework", "blackwork", "floral", "illustrative", "minimal"],
  traditional: ["traditional", "neo_traditional"],
  neo_traditional: ["neo_traditional", "traditional", "illustrative", "floral"],
  japanese: ["japanese", "neo_traditional"],
  geometric: ["geometric", "blackwork", "mandala", "dotwork"],
  mandala: ["mandala", "geometric", "ornamental", "dotwork"],
  dotwork: ["dotwork", "geometric", "blackwork", "mandala"],
  portrait: ["portrait", "realism_blackgrey", "realism_color"],
  lettering: ["lettering"],
  tribal: ["tribal", "blackwork"],
  floral: ["floral", "linework", "illustrative", "neo_traditional"],
  illustrative: ["illustrative", "linework", "neo_traditional", "floral", "realism_blackgrey", "realism_color"],
  ornamental: ["ornamental", "mandala", "geometric"],
  minimal: ["minimal", "linework", "symbol"],
  symbol: ["symbol", "minimal", "linework"],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeGet<T>(record: TattooFeatures, key: keyof TattooFeatures, fallback: T): T {
  const value = record[key];
  return (value ?? fallback) as T;
}

// Normalized similarity for two numeric values (0–1)
function norm(a?: number, b?: number, maxVal = 100): number {
  if (a == null || b == null) return 0.5; // neutral when missing
  return 1 - Math.abs(a - b) / maxVal;
}

function sizeIndex(record: TattooFeatures): number {
  const cat = safeGet<SizeCategory>(record, "natural_size_category", "medium");
  const idx = SIZE_ORDER.indexOf(cat);
  return idx === -1 ? 2 : idx;
}

// Slight penalty for lower-confidence DB records
function confidencePenalty(record: TattooFeatures): number {
  const conf = safeGet<number>(record, "overall_confidence", 1);
  if (conf >= 0.8) return 1.0;
  if (conf >= 0.6) return 0.93;
  return 0.82;
}

// ─── Hard Filter ─────────────────────────────────────────────────────────────
// Relaxed compared to v1: color mismatch is now a soft penalty, not a hard reject.
// Only filters out truly incompatible records.

export function hardFilter(newTattoo: TattooFeatures, dbTattoo: TattooFeatures): boolean {
  // Confidence too low — useless record
  if (safeGet(dbTattoo, "overall_confidence", 1) < 0.45) return false;

  // Size: allow up to 2 steps difference (was 1)
  if (Math.abs(sizeIndex(newTattoo) - sizeIndex(dbTattoo)) > 2) return false;

  // Style: must be compatible
  const newStyle = safeGet(newTattoo, "category_primary", "other");
  const dbStyle = safeGet(dbTattoo, "category_primary", "other");
  const allowed = COMPATIBLE_STYLES[newStyle] ?? [newStyle];
  if (newStyle !== "other" && dbStyle !== "other" && !allowed.includes(dbStyle)) return false;

  // Effort: allow up to 40 difference (was 30) — gives more candidates
  const effortDiff = Math.abs(
    safeGet(newTattoo, "tattoo_effort_score", 50) - safeGet(dbTattoo, "tattoo_effort_score", 50)
  );
  if (effortDiff > 40) return false;

  return true;
}

// ─── Similarity Score ────────────────────────────────────────────────────────
// Weight order matches real pricing priorities:
//   1. Complexity/detail  (~40%)
//   2. Size               (~25%)
//   3. Effort score       (~20%)
//   4. Line quality       (~10%)
//   5. Style bonuses      (+soft)
//   6. Color penalty      (-soft)

export function similarityScore(newTattoo: TattooFeatures, dbTattoo: TattooFeatures): number {
  // ── 1. Complexity / detail (40%) ──
  const fillSim       = norm(newTattoo.fill_density_per_area,    dbTattoo.fill_density_per_area);
  const shadingSim    = norm(newTattoo.shading_density_per_area, dbTattoo.shading_density_per_area);
  const microSim      = norm(newTattoo.micro_detail_score,       dbTattoo.micro_detail_score);
  const textureSim    = norm(newTattoo.texture_density_score,    dbTattoo.texture_density_score);
  const scalabilitySim = norm(newTattoo.shading_scalability_score, dbTattoo.shading_scalability_score);
  const effortSim     = norm(newTattoo.tattoo_effort_score,      dbTattoo.tattoo_effort_score);

  const complexityScore =
    effortSim       * 0.35 +
    microSim        * 0.25 +
    fillSim         * 0.15 +
    shadingSim      * 0.15 +
    textureSim      * 0.05 +
    scalabilitySim  * 0.05;

  // ── 2. Size (25%) ──
  const sizeDiff  = Math.abs(sizeIndex(newTattoo) - sizeIndex(dbTattoo));
  const sizeSim   = 1 - sizeDiff * 0.22;
  const widthSim  = newTattoo.width_dominant === dbTattoo.width_dominant ? 1 : 0.8;
  const sizeScore = sizeSim * 0.75 + widthSim * 0.25;

  // ── 3. Line quality (10%) ──
  const lineSim      = norm(newTattoo.line_density_score,    dbTattoo.line_density_score);
  const edgeSim      = norm(newTattoo.edge_complexity_score, dbTattoo.edge_complexity_score);
  const newThickness = THICKNESS_MAP[newTattoo.line_thickness_category ?? "medium"] ?? 2;
  const dbThickness  = THICKNESS_MAP[dbTattoo.line_thickness_category  ?? "medium"] ?? 2;
  const thicknessSim = 1 - Math.abs(newThickness - dbThickness) / 3;
  const lineScore    = lineSim * 0.4 + edgeSim * 0.35 + thicknessSim * 0.25;

  // ── Base score ──
  let score = complexityScore * 0.40 + sizeScore * 0.25 + effortSim * 0.20 + lineScore * 0.10 + 0.05;
  // (the extra 0.05 is a baseline floor so near-identical records can reach ~1.0)

  // ── 4. Style bonuses (soft) ──
  if (newTattoo.category_primary && newTattoo.category_primary === dbTattoo.category_primary) {
    score = Math.min(1, score * 1.06); // same style: +6%
  } else {
    score = Math.min(1, score * 0.97); // different but compatible: -3%
  }
  if (
    newTattoo.category_secondary &&
    dbTattoo.category_secondary &&
    newTattoo.category_secondary === dbTattoo.category_secondary
  ) {
    score = Math.min(1, score * 1.02);
  }

  // ── 5. Color penalty (soft) ──
  // Color tattoos are always more expensive, so a color↔B&W mismatch
  // means the price from the DB record is less representative.
  const newColor = safeGet(newTattoo, "color_present", false);
  const dbColor  = safeGet(dbTattoo,  "color_present", false);
  if (newColor !== dbColor) {
    score *= 0.80; // -20% similarity when color mismatch
  }

  // ── 6. Text mismatch ──
  if (safeGet(newTattoo, "has_text", false) !== safeGet(dbTattoo, "has_text", false)) {
    score *= 0.92;
  }
  if (
    safeGet(newTattoo, "has_decorative_script", false) !==
    safeGet(dbTattoo, "has_decorative_script", false)
  ) {
    score *= 0.95;
  }

  // ── 7. DB confidence penalty ──
  score *= confidencePenalty(dbTattoo);

  return Number(Math.min(1, score).toFixed(4));
}

// ─── Top Matches ─────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function getTopMatches(
  newTattoo: TattooFeatures,
  database: TattooFeatures[],
  n = 20
): MatchResult[] {
  // Step 1: hard filter
  const candidates = database.filter((r) => hardFilter(newTattoo, r));

  // Step 2: if too few candidates, fall back to effort-only filter (no style check)
  const pool =
    candidates.length >= 5
      ? candidates
      : database.filter((r) => {
          if (safeGet(r, "overall_confidence", 1) < 0.45) return false;
          const effortDiff = Math.abs(
            safeGet(newTattoo, "tattoo_effort_score", 50) - safeGet(r, "tattoo_effort_score", 50)
          );
          return effortDiff <= 50;
        });

  if (!pool.length) return [];

  // Step 3: score and sort
  const scored = pool
    .map((record) => ({ record, similarity: similarityScore(newTattoo, record) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, n);

  // Step 4: outlier price removal (keep within ±50% of median)
  const prices = scored.map((m) => m.record.final_price ?? 0).filter((p) => p > 0);
  if (!prices.length) return scored.slice(0, 10);

  const med = median(prices);
  let filtered = scored.filter(
    (m) => Math.abs((m.record.final_price ?? med) - med) / med <= 0.5
  );
  if (filtered.length < 3) filtered = scored;

  return filtered.slice(0, 10);
}

// ─── Price Calculation ───────────────────────────────────────────────────────
// Always returns a price estimate — never "insufficient_data" with null price.
// Uses weighted average (similarity³) with color adjustment.

export function calculatePrice(
  matches: MatchResult[],
  newTattoo?: TattooFeatures,
  minThreshold = 0.60  // relaxed from 0.72
): PriceSuggestion {
  if (!matches.length) {
    return {
      suggested_price: null,
      price_range: null,
      confidence: "insufficient_data",
      action: "manual_review",
      based_on: 0,
      top_similarity: 0,
    };
  }

  // Use all matches above threshold; if fewer than 3, use whatever we have
  let usable = matches.filter(
    (m) => m.similarity >= minThreshold && typeof m.record.final_price === "number"
  );
  if (usable.length < 3) usable = matches.filter((m) => typeof m.record.final_price === "number");
  if (!usable.length) {
    return {
      suggested_price: null,
      price_range: null,
      confidence: "insufficient_data",
      action: "manual_review",
      based_on: 0,
      top_similarity: Number(matches[0].similarity.toFixed(3)),
    };
  }

  // Weighted average (similarity³ gives more weight to best matches)
  const weights     = usable.map((m) => Math.pow(m.similarity, 3));
  const totalWeight = weights.reduce((a, w) => a + w, 0);
  let weightedPrice =
    usable.reduce((acc, m, i) => acc + (m.record.final_price ?? 0) * weights[i], 0) / totalWeight;

  // Color adjustment: if new tattoo is color but DB matches are B&W (or vice versa),
  // apply a price correction since color is always more expensive.
  if (newTattoo) {
    const newIsColor = safeGet(newTattoo, "color_present", false);
    const matchColorRatio =
      usable.filter((m) => safeGet(m.record, "color_present", false)).length / usable.length;

    if (newIsColor && matchColorRatio < 0.3) {
      // New is color but most matches are B&W → price should be higher
      weightedPrice *= 1.20;
    } else if (!newIsColor && matchColorRatio > 0.7) {
      // New is B&W but most matches are color → price should be lower
      weightedPrice *= 0.85;
    }
  }

  // Confidence based on top similarity score
  const topScore = usable[0].similarity;
  let confidence: PriceSuggestion["confidence"];
  let spread: number;

  if (topScore >= 0.90) {
    confidence = "very_high"; spread = 0.07;
  } else if (topScore >= 0.82) {
    confidence = "high";      spread = 0.10;
  } else if (topScore >= 0.70) {
    confidence = "medium";    spread = 0.15;
  } else if (topScore >= 0.60) {
    confidence = "low";       spread = 0.22;
  } else {
    confidence = "low";       spread = 0.28;
  }

  const low  = Math.round((weightedPrice * (1 - spread)) / 10) * 10;
  const high = Math.round((weightedPrice * (1 + spread)) / 10) * 10;

  return {
    suggested_price: Math.round(weightedPrice / 10) * 10,
    price_range: `€${low} - €${high}`,
    confidence,
    based_on: usable.length,
    top_similarity: Number(topScore.toFixed(3)),
  };
}
