"use client";

import { ChangeEvent, useMemo, useState } from "react";

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
  }>;
  error?: string;
  details?: string;
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  const onSelectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setResult(null);
    setError(null);
  };

  const onAnalyze = async () => {
    if (!file) {
      setError("Please upload an image first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = new FormData();
      data.append("image", file);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: data,
      });
      const body = (await response.json()) as ApiResponse;
      if (!response.ok) {
        throw new Error(body.error || "Failed to analyze image.");
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Tattoo Pricing Prediction</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Upload a customer tattoo reference and get an estimated price based on similar historical tattoos.
      </p>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <label
            htmlFor="image"
            className="flex min-h-48 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-600 hover:border-zinc-400"
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Uploaded tattoo preview" className="max-h-72 rounded-md object-contain" />
            ) : (
              <span>Click to upload or drag and drop a tattoo image</span>
            )}
          </label>
          <input id="image" type="file" accept="image/*" className="hidden" onChange={onSelectFile} />

          <button
            type="button"
            disabled={!file || loading}
            onClick={onAnalyze}
            className="mt-4 w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Analyzing..." : "Analyze Tattoo"}
          </button>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-medium">Prediction</h2>
          {!result?.pricing ? (
            <p className="mt-3 text-sm text-zinc-500">No prediction yet.</p>
          ) : (
            <div className="mt-4 space-y-2 text-sm">
              <p>
                Suggested price:{" "}
                <span className="font-semibold">
                  {result.pricing.suggested_price ? `€${result.pricing.suggested_price}` : "Manual review"}
                </span>
              </p>
              <p>Range: {result.pricing.price_range ?? "N/A"}</p>
              <p>Confidence: {result.pricing.confidence}</p>
              <p>Based on: {result.pricing.based_on} records</p>
              <p>Top similarity: {result.pricing.top_similarity}</p>
            </div>
          )}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium">Top Similar Tattoos</h2>
        {!result?.top_matches?.length ? (
          <p className="mt-3 text-sm text-zinc-500">No similar tattoos yet.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.top_matches.map((match, index) => (
              <article key={`${match.record_id ?? "match"}-${index}`} className="rounded-lg border border-zinc-200 p-3">
                {match.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={match.thumbnail_url}
                    alt="Similar tattoo"
                    className="h-36 w-full rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-36 w-full items-center justify-center rounded-md bg-zinc-100 text-xs text-zinc-500">
                    No preview
                  </div>
                )}
                <div className="mt-3 space-y-1 text-xs">
                  <p className="font-medium">Price: {match.final_price ? `€${match.final_price}` : "N/A"}</p>
                  <p>Similarity: {match.similarity.toFixed(3)}</p>
                  <p>Style: {match.category_primary ?? "unknown"}</p>
                  <p>Size: {match.natural_size_category ?? "unknown"}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
