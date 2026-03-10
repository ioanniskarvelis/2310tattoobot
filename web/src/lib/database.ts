import rawDatabase from "@/data/tattoo_database.json";
import { TattooFeatures } from "@/lib/matching";

export type VisionAnalysis = Record<string, unknown>;

export type TattooRecord = TattooFeatures & {
  record_id?: string;
  image_uri?: string;
  image_path?: string;
  final_price: number;
  vision_analysis?: VisionAnalysis;
};

export function getTattooDatabase(): TattooRecord[] {
  return rawDatabase as TattooRecord[];
}

export function toThumbnailUrl(recordId?: string): string | null {
  if (!recordId) {
    return null;
  }
  return `/images/${recordId}.jpg`;
}
