import OpenAI from "openai";
import { TattooFeatures } from "@/lib/matching";
import { visionPrompt } from "@/lib/visionPrompt";

const SIZE_CATEGORIES = ["tiny", "small", "medium", "large", "xlarge"] as const;
const THICKNESS_CATEGORIES = ["very_thin", "thin", "medium", "thick"] as const;

export type VisionAnalysis = Record<string, unknown>;

function maybeExtractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

export type VisionAnalysisResult = {
  features: TattooFeatures;
  vision_analysis: VisionAnalysis;
};

export async function analyzeTattooWithOpenAI(
  base64Image: string,
  mimeType: string,
): Promise<VisionAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5.4",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: visionPrompt },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${base64Image}`,
            detail: "high",
          },
        ],
      },
    ],
  });

  const parsed = JSON.parse(maybeExtractJson(response.output_text)) as Record<string, unknown>;
  const ink = parsed?.ink_analysis as Record<string, unknown> | undefined;
  const natural = parsed?.natural_size as Record<string, unknown> | undefined;
  const style = parsed?.style_category as Record<string, unknown> | undefined;
  const fillShading = parsed?.fill_shading_analysis as Record<string, unknown> | undefined;
  const detail = parsed?.detail_complexity as Record<string, unknown> | undefined;
  const line = parsed?.line_analysis as Record<string, unknown> | undefined;
  const text = parsed?.text_features as Record<string, unknown> | undefined;
  const qc = parsed?.quality_control as Record<string, unknown> | undefined;

  const sizeCat = String(natural?.natural_size_category ?? "medium");
  const thicknessCat = String(line?.line_thickness_category ?? "medium");

  const features: TattooFeatures = {
    color_present: Boolean(ink?.color_present),
    natural_size_category: (SIZE_CATEGORIES as readonly string[]).includes(sizeCat)
      ? (sizeCat as (typeof SIZE_CATEGORIES)[number])
      : "medium",
    width_dominant: Boolean(natural?.width_dominant),
    category_primary: (style?.category_primary as string) ?? "other",
    category_secondary: (style?.category_secondary as string | null) ?? null,
    tattoo_effort_score: Number(parsed?.tattoo_effort_score) || 50,
    fill_density_per_area: Number(fillShading?.fill_density_per_area) || 0,
    shading_density_per_area: Number(fillShading?.shading_density_per_area) || 0,
    shading_scalability_score: Number(fillShading?.shading_scalability_score) || 0,
    micro_detail_score: Number(detail?.micro_detail_score) || 0,
    texture_density_score: Number(detail?.texture_density_score) || 0,
    line_density_score: Number(line?.line_density_score) || 0,
    edge_complexity_score: Number(line?.edge_complexity_score) || 0,
    line_thickness_category: (THICKNESS_CATEGORIES as readonly string[]).includes(thicknessCat)
      ? (thicknessCat as (typeof THICKNESS_CATEGORIES)[number])
      : "medium",
    has_text: Boolean(text?.has_text),
    has_decorative_script: Boolean(text?.has_decorative_script),
    overall_confidence: Number(qc?.overall_confidence ?? parsed?.overall_confidence) || 0,
  };

  return { features, vision_analysis: parsed };
}
