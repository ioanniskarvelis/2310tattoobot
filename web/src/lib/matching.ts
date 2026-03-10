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

const SIZE_ORDER: SizeCategory[] = ["tiny", "small", "medium", "large", "xlarge"];

const THICKNESS_MAP: Record<ThicknessCategory, number> = {
  very_thin: 0,
  thin: 1,
  medium: 2,
  thick: 3,
};

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
  illustrative: [
    "illustrative",
    "linework",
    "neo_traditional",
    "floral",
    "realism_blackgrey",
    "realism_color",
  ],
  ornamental: ["ornamental", "mandala", "geometric"],
  minimal: ["minimal", "linework", "symbol"],
  symbol: ["symbol", "minimal", "linework"],
};

function safeGet<T>(record: TattooFeatures, key: keyof TattooFeatures, fallback: T): T {
  const value = record[key];
  return (value ?? fallback) as T;
}

function norm(a?: number, b?: number, maxVal = 100): number {
  if (a === undefined || b === undefined || a === null || b === null) {
    return 0.5;
  }
  return 1 - Math.abs(a - b) / maxVal;
}

function sizeIndex(record: TattooFeatures): number {
  const category = safeGet<SizeCategory>(record, "natural_size_category", "medium");
  const idx = SIZE_ORDER.indexOf(category);
  return idx === -1 ? 2 : idx;
}

function confidencePenalty(record: TattooFeatures): number {
  const conf = safeGet<number>(record, "overall_confidence", 1);
  if (conf >= 0.8) {
    return 1;
  }
  if (conf >= 0.6) {
    return 0.92;
  }
  return 0.8;
}

export function hardFilter(newTattoo: TattooFeatures, dbTattoo: TattooFeatures): boolean {
  if (safeGet(newTattoo, "color_present", false) !== safeGet(dbTattoo, "color_present", false)) {
    return false;
  }

  if (Math.abs(sizeIndex(newTattoo) - sizeIndex(dbTattoo)) > 1) {
    return false;
  }

  const newStyle = safeGet(newTattoo, "category_primary", "");
  const dbStyle = safeGet(dbTattoo, "category_primary", "");
  const allowed = COMPATIBLE_STYLES[newStyle] ?? [newStyle];
  if (!allowed.includes(dbStyle)) {
    return false;
  }

  const effortDiff = Math.abs(
    safeGet(newTattoo, "tattoo_effort_score", 50) - safeGet(dbTattoo, "tattoo_effort_score", 50),
  );
  if (effortDiff > 30) {
    return false;
  }

  if (safeGet(newTattoo, "has_text", false) !== safeGet(dbTattoo, "has_text", false)) {
    return false;
  }

  if (safeGet(dbTattoo, "overall_confidence", 1) < 0.5) {
    return false;
  }

  return true;
}

export function similarityScore(newTattoo: TattooFeatures, dbTattoo: TattooFeatures): number {
  const effortSim = norm(newTattoo.tattoo_effort_score, dbTattoo.tattoo_effort_score);
  const sizeDiff = Math.abs(sizeIndex(newTattoo) - sizeIndex(dbTattoo));
  const sizeSim = 1 - sizeDiff * 0.25;
  const widthSim = newTattoo.width_dominant === dbTattoo.width_dominant ? 1 : 0.7;
  const primarySim = effortSim * 0.55 + sizeSim * 0.3 + widthSim * 0.15;

  const fillSim = norm(newTattoo.fill_density_per_area, dbTattoo.fill_density_per_area);
  const shadingSim = norm(newTattoo.shading_density_per_area, dbTattoo.shading_density_per_area);
  const microSim = norm(newTattoo.micro_detail_score, dbTattoo.micro_detail_score);
  const textureSim = norm(newTattoo.texture_density_score, dbTattoo.texture_density_score);
  const scalabilitySim = norm(
    newTattoo.shading_scalability_score,
    dbTattoo.shading_scalability_score,
  );
  const complexitySim =
    fillSim * 0.25 + shadingSim * 0.25 + microSim * 0.2 + textureSim * 0.15 + scalabilitySim * 0.15;

  const lineSim = norm(newTattoo.line_density_score, dbTattoo.line_density_score);
  const edgeSim = norm(newTattoo.edge_complexity_score, dbTattoo.edge_complexity_score);
  const newThickness = THICKNESS_MAP[newTattoo.line_thickness_category ?? "medium"] ?? 2;
  const dbThickness = THICKNESS_MAP[dbTattoo.line_thickness_category ?? "medium"] ?? 2;
  const thicknessSim = 1 - Math.abs(newThickness - dbThickness) / 3;
  const lineTotal = lineSim * 0.4 + edgeSim * 0.35 + thicknessSim * 0.25;

  let score = primarySim * 0.65 + complexitySim * 0.25 + lineTotal * 0.1;

  if (newTattoo.category_primary && newTattoo.category_primary === dbTattoo.category_primary) {
    score = Math.min(1, score * 1.04);
  }
  if (
    newTattoo.category_secondary &&
    dbTattoo.category_secondary &&
    newTattoo.category_secondary === dbTattoo.category_secondary
  ) {
    score = Math.min(1, score * 1.02);
  }
  if (safeGet(newTattoo, "has_decorative_script", false) !== safeGet(dbTattoo, "has_decorative_script", false)) {
    score *= 0.93;
  }

  score *= confidencePenalty(dbTattoo);
  return Number(score.toFixed(4));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function getTopMatches(newTattoo: TattooFeatures, database: TattooFeatures[], n = 15): MatchResult[] {
  const candidates = database.filter((r) => hardFilter(newTattoo, r));
  if (!candidates.length) {
    return [];
  }

  const scored = candidates
    .map((record) => ({ record, similarity: similarityScore(newTattoo, record) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, n);

  const prices = scored.map((m) => m.record.final_price ?? 0).filter((p) => p > 0);
  if (!prices.length) {
    return scored.slice(0, 7);
  }

  const medianPrice = median(prices);
  let filtered = scored.filter(
    (m) => Math.abs((m.record.final_price ?? medianPrice) - medianPrice) / medianPrice <= 0.4,
  );
  if (filtered.length < 3) {
    filtered = scored;
  }
  return filtered.slice(0, 7);
}

export function calculatePrice(matches: MatchResult[], minThreshold = 0.72): PriceSuggestion {
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

  const strong = matches.filter((m) => m.similarity >= minThreshold && typeof m.record.final_price === "number");
  if (strong.length < 3) {
    return {
      suggested_price: null,
      price_range: null,
      confidence: "insufficient_data",
      action: "manual_review",
      based_on: strong.length,
      top_similarity: Number(matches[0].similarity.toFixed(3)),
    };
  }

  const weights = strong.map((m) => m.similarity ** 3);
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  const weightedPrice =
    strong.reduce((acc, m, idx) => acc + (m.record.final_price ?? 0) * weights[idx], 0) / totalWeight;

  const topScore = strong[0].similarity;
  let confidence: PriceSuggestion["confidence"];
  let spread: number;
  if (topScore >= 0.92) {
    confidence = "very_high";
    spread = 0.08;
  } else if (topScore >= 0.85) {
    confidence = "high";
    spread = 0.1;
  } else if (topScore >= 0.75) {
    confidence = "medium";
    spread = 0.15;
  } else {
    confidence = "low";
    spread = 0.2;
  }

  const low = Math.round((weightedPrice * (1 - spread)) / 10) * 10;
  const high = Math.round((weightedPrice * (1 + spread)) / 10) * 10;
  return {
    suggested_price: Math.round(weightedPrice / 10) * 10,
    price_range: `€${low} - €${high}`,
    confidence,
    based_on: strong.length,
    top_similarity: Number(topScore.toFixed(3)),
  };
}
