"use client";

type VisionAnalysis = Record<string, unknown>;

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val)) return val.length ? val.join(", ") : "—";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function formatLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function VisionAnalysisSection({
  data,
  title,
  compact = false,
}: {
  data: VisionAnalysis | null | undefined;
  title?: string;
  compact?: boolean;
}) {
  if (!data || typeof data !== "object") return null;

  const entries = Object.entries(data).filter(
    ([k]) => k !== "error" && (compact ? !["design_bbox", "feature_confidence"].includes(k) : true)
  );
  if (!entries.length) return null;

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {title && (
        <h4 className={`font-medium text-zinc-800 ${compact ? "text-xs" : "text-sm"}`}>
          {formatLabel(title)}
        </h4>
      )}
      <dl
        className={`grid gap-x-2 ${
          compact ? "grid-cols-[auto_1fr] gap-y-0.5 text-xs" : "space-y-1 text-sm"
        }`}
      >
        {entries.map(([key, value]) => {
          const label = formatLabel(key);
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            return (
              <div key={key} className="col-span-2">
                <VisionAnalysisSection
                  data={value as VisionAnalysis}
                  title={label}
                  compact={compact}
                />
              </div>
            );
          }
          return (
            <div key={key} className={compact ? "contents" : "flex gap-2"}>
              <dt className={compact ? "text-zinc-500" : "min-w-0 text-zinc-500"}>{label}:</dt>
              <dd className={compact ? "text-zinc-800" : "text-zinc-900"}>{formatValue(value)}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function VisionAnalysisView({
  visionAnalysis,
  compact = false,
}: {
  visionAnalysis: VisionAnalysis | null | undefined;
  compact?: boolean;
}) {
  if (!visionAnalysis || (visionAnalysis as { error?: string }).error) {
    return null;
  }

  const { error, ...rest } = visionAnalysis as { error?: string } & VisionAnalysis;
  return (
    <div className={`space-y-3 ${compact ? "text-xs" : "text-sm"}`}>
      <VisionAnalysisSection data={rest} compact={compact} />
    </div>
  );
}
