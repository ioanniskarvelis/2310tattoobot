import OpenAI from "openai";
import { TattooFeatures } from "@/lib/matching";
import { visionPrompt } from "@/lib/visionPrompt";

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

export async function analyzeTattooWithOpenAI(
  base64Image: string,
  mimeType: string,
): Promise<TattooFeatures> {
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

  const parsed = JSON.parse(maybeExtractJson(response.output_text));
  const features: TattooFeatures = {
    color_present: parsed?.ink_analysis?.color_present ?? false,
    natural_size_category: parsed?.natural_size?.natural_size_category ?? "medium",
    width_dominant: parsed?.natural_size?.width_dominant ?? false,
    category_primary: parsed?.style_category?.category_primary ?? "other",
    category_secondary: parsed?.style_category?.category_secondary ?? null,
    tattoo_effort_score: parsed?.tattoo_effort_score ?? 50,
    fill_density_per_area: parsed?.fill_shading_analysis?.fill_density_per_area ?? 0,
    shading_density_per_area: parsed?.fill_shading_analysis?.shading_density_per_area ?? 0,
    shading_scalability_score: parsed?.fill_shading_analysis?.shading_scalability_score ?? 0,
    micro_detail_score: parsed?.detail_complexity?.micro_detail_score ?? 0,
    texture_density_score: parsed?.detail_complexity?.texture_density_score ?? 0,
    line_density_score: parsed?.line_analysis?.line_density_score ?? 0,
    edge_complexity_score: parsed?.line_analysis?.edge_complexity_score ?? 0,
    line_thickness_category: parsed?.line_analysis?.line_thickness_category ?? "medium",
    has_text: parsed?.text_features?.has_text ?? false,
    has_decorative_script: parsed?.text_features?.has_decorative_script ?? false,
    overall_confidence: parsed?.quality_control?.overall_confidence ?? parsed?.overall_confidence ?? 0,
  };

  return features;
}
