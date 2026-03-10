import { NextResponse } from "next/server";
import { analyzeTattooWithOpenAI } from "@/lib/openaiVision";
import { calculatePrice, getTopMatches } from "@/lib/matching";
import { getTattooDatabase, toThumbnailUrl, type TattooRecord } from "@/lib/database";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64Image = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/jpeg";

    const { features: newTattooFeatures, vision_analysis: visionAnalysis } =
      await analyzeTattooWithOpenAI(base64Image, mimeType);
    const database = getTattooDatabase();
    if (!database.length) {
      return NextResponse.json(
        {
          error: "Database is empty. Build and import tattoo_database.json first.",
        },
        { status: 400 },
      );
    }

    const matches = getTopMatches(newTattooFeatures, database, 15);
    const pricing = calculatePrice(matches);
    const topMatches = matches.slice(0, 5).map((m) => {
      const record = m.record as TattooRecord;
      return {
        record_id: m.record.record_id,
        image_uri: m.record.image_uri ?? null,
        thumbnail_url: toThumbnailUrl(m.record.record_id),
        final_price: m.record.final_price ?? null,
        similarity: m.similarity,
        category_primary: m.record.category_primary ?? null,
        natural_size_category: m.record.natural_size_category ?? null,
        vision_analysis: record.vision_analysis ?? null,
      };
    });

    return NextResponse.json({
      pricing,
      top_matches: topMatches,
      vision_analysis: visionAnalysis,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to analyze tattoo image.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
