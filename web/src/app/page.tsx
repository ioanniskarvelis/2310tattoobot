"use client";
import { ChangeEvent, useMemo, useState } from "react";
import { VisionAnalysisView } from "@/components/VisionAnalysisView";
type VisionAnalysis = Record<string, unknown>;
type ApiResponse = {
pricing?: {
suggested_price: number | null;
price_range: string | null;
confidence: string;
based_on: number;
top_similarity: number;
action?: string;
};
top_matches?: Array<{
record_id?: string;
image_uri?: string | null;
thumbnail_url?: string | null;
final_price?: number | null;
similarity: number;
category_primary?: string | null;
natural_size_category?: string | null;
vision_analysis?: VisionAnalysis | null;
}>;
vision_analysis?: VisionAnalysis | null;
error?: string;
details?: string;
};
const CONFIDENCE_LABEL: Record<string, string> = {
very_high: "Πολύ υψηλή",
high: "Υψηλή",
medium: "Μέτρια",
low: "Χαμηλή",
insufficient_data: "Ανεπαρκή δεδομένα",
};
const CONFIDENCE_COLOR: Record<string, string> = {
very_high: "text-emerald-600",
high: "text-green-600",
medium: "text-yellow-600",
low: "text-orange-500",
insufficient_data: "text-red-500",
};
function similarityPercent(s: number) {
return `${Math.round(s * 100)}%`;
}
export default function Home() {
const [file, setFile] = useState<File | null>(null);
const [loading, setLoading] = useState(false);
const [result, setResult] = useState<ApiResponse | null>(null);
const [error, setError] = useState<string | null>(null);
const [showVision, setShowVision] = useState(false);
const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
const onSelectFile = (event: ChangeEvent<HTMLInputElement>) => {
const selected = event.target.files?.[0] ?? null;
setFile(selected);
setResult(null);
setError(null);
setShowVision(false);
};
const onAnalyze = async () => {
if (!file) {
setError("Παρακαλώ ανέβασε μια εικόνα πρώτα.");
return;
}
setLoading(true);
setError(null);
setResult(null);
setShowVision(false);
try {
const data = new FormData();
data.append("image", file);
const response = await fetch("/api/analyze", { method: "POST", body: data });
const body = (await response.json()) as ApiResponse;
if (!response.ok) throw new Error(body.error || "Failed to analyze image.");
setResult(body);
} catch (err) {
setError(err instanceof Error ? err.message : "Unexpected error.");
} finally {
setLoading(false);
}
};
const pricing = result?.pricing;
return (
<main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
<h1 className="text-2xl font-bold tracking-tight text-zinc-900">
Εκτίμηση Τιμής Τατουάζ
</h1>
<p className="mt-1 text-sm text-zinc-500">
Ανέβασε την αναφορά του πελάτη για αυτόματη εκτίμηση τιμής.
</p>
{/* ── Upload ── */}
<div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
<label
htmlFor="image"
className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 p-4 text-center transition hover:border-zinc-400"
style={{ minHeight: previewUrl ? undefined : "180px" }}
>
{previewUrl ? (
<img
src={previewUrl}
alt="Προεπισκόπηση"
className="w-full rounded-xl object-contain"
style={{ maxHeight: "420px", imageRendering: "auto" }}
/>
) : (
<div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
<svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
</svg>
<span className="text-sm font-medium">Κλικ για ανέβασμα εικόνας</span>
<span className="text-xs">PNG, JPG, WEBP</span>
</div>
)}
</label>
<input id="image" type="file" accept="image/*" className="hidden" onChange={onSelectFile} />
<button
type="button"
disabled={!file || loading}
onClick={onAnalyze}
className="mt-4 w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
>
{loading ? "Ανάλυση..." : "Ανάλυση Τατουάζ"}
</button>
{error && <p className="mt-3 text-sm text-red-600">{error}</p>}
</div>
{/* ── Pricing result ── */}
{pricing && (
<div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
<h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">
Εκτιμώμενη Τιμή
</h2>
{pricing.suggested_price ? (
<>
<p className="mt-2 text-5xl font-bold text-zinc-900">
€{pricing.suggested_price}
</p>
<p className="mt-1 text-base text-zinc-500">
Εύρος: <span className="font-medium text-zinc-700">{pricing.price_range}</span>
</p>
</>
) : (
<p className="mt-2 text-xl font-semibold text-zinc-700">Απαιτείται χειροκίνητη αξιολόγηση</p>
)}
<div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-500">
<span>
Εμπιστοσύνη:{" "}
<span className={`font-semibold ${CONFIDENCE_COLOR[pricing.confidence] ?? "text-zinc-700"}`}>
{CONFIDENCE_LABEL[pricing.confidence] ?? pricing.confidence}
</span>
</span>
<span>Βάση: <span className="font-medium text-zinc-700">{pricing.based_on} tattoos</span></span>
<span>Top ομοιότητα: <span className="font-medium text-zinc-700">{similarityPercent(pricing.top_similarity)}</span></span>
</div>
</div>
)}
{/* ── Similar tattoos ── */}
{result?.top_matches && result.top_matches.length > 0 && (
<div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
<h2 className="text-base font-semibold text-zinc-900">Παρόμοια Tattoos</h2>
<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
{result.top_matches.map((match, index) => (
<article
key={`${match.record_id ?? "match"}-${index}`}
className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
>
{match.thumbnail_url ? (
<img
src={match.thumbnail_url}
alt="Similar tattoo"
className="h-32 w-full object-cover"
/>
) : (
<div className="flex h-32 w-full items-center justify-center bg-zinc-100 text-xs text-zinc-500">
Χωρίς preview
</div>
)}
<div className="flex flex-1 flex-col gap-1 p-2.5">
{/* Price — first and prominent */}
<p className="text-xl font-bold text-zinc-900">
{match.final_price ? `€${match.final_price}` : "—"}
</p>
<p className="text-xs text-zinc-500">
Ομοιότητα:{" "}
<span className="font-semibold text-zinc-700">
{similarityPercent(match.similarity)}
</span>
</p>
<p className="text-xs text-zinc-500">
{match.category_primary ?? "—"} · {match.natural_size_category ?? "—"}
</p>
</div>
</article>
))}
</div>
</div>
)}
{/* ── Vision JSON (collapsible, για debug) ── */}
{result?.vision_analysis && (
<div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
<button
type="button"
onClick={() => setShowVision((v) => !v)}
className="flex w-full items-center justify-between text-sm font-medium text-zinc-700"
>
<span>Vision Analysis (debug)</span>
<span>{showVision ? "▲ Κλείσιμο" : "▼ Προβολή"}</span>
</button>
{showVision && (
<div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50 p-3">
<VisionAnalysisView visionAnalysis={result.vision_analysis} compact={false} />
</div>
)}
</div>
)}
</main>
);
}
