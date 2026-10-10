import type { AnalyticsSummary, BuyerConcentration, GraphData, ProcurementFlags, ProcurementPage, RankedEntity, RedFlagSummary, Story, TrendPoint } from "./types";

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}/api/${path}`);
  if (!response.ok) {
    throw new Error(`API returned status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchGraph(options: {
  query?: string;
  kinds?: string[];
  dataset?: "demo" | "live";
  since?: string;
  until?: string;
  focus?: string;
  orderType?: string;
  offset?: number;
} = {}): Promise<GraphData> {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set("q", options.query.trim());
  for (const kind of options.kinds ?? []) params.append("kinds", kind);
  params.set("dataset", options.dataset ?? "demo");
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  if (options.focus) params.set("focus", options.focus);
  if (options.orderType) params.set("order_type", options.orderType);
  if (options.offset) params.set("offset", String(options.offset));
  return getJson<GraphData>(`graph?${params.toString()}`);
}

export function fetchProcurements(options: {
  query?: string;
  dataset: "demo" | "live";
  since?: string;
  until?: string;
  orderType?: string;
  hasSupplier?: boolean;
  flag?: string;
  sort: "newest" | "oldest" | "title";
  page: number;
  pageSize?: number;
}): Promise<ProcurementPage> {
  const params = new URLSearchParams({
    dataset: options.dataset,
    sort: options.sort,
    page: String(options.page),
    page_size: String(options.pageSize ?? 12),
  });
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  if (options.orderType) params.set("order_type", options.orderType);
  if (options.hasSupplier !== undefined) params.set("has_supplier", String(options.hasSupplier));
  if (options.flag) params.set("flag", options.flag);
  return getJson<ProcurementPage>(`procurements?${params.toString()}`);
}

export function fetchStories(): Promise<Story[]> {
  return getJson<Story[]>("stories");
}

export interface AnalyticsScope {
  dataset: "demo" | "live";
  city?: string;
}

function scopeParams(scope: AnalyticsScope, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams({ dataset: scope.dataset });
  if (scope.city) params.set("city", scope.city);
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return params.toString();
}

export function fetchAnalyticsSummary(scope: AnalyticsScope): Promise<AnalyticsSummary> {
  return getJson<AnalyticsSummary>(`analytics/summary?${scopeParams(scope)}`);
}

export function fetchTopEntities(kind: "buyers" | "suppliers", scope: AnalyticsScope, by: "value" | "count", limit = 8): Promise<RankedEntity[]> {
  return getJson<RankedEntity[]>(`analytics/top-${kind}?${scopeParams(scope, { by, limit })}`);
}

export function fetchConcentration(scope: AnalyticsScope, basis: "value" | "count", minAwards = 5, limit = 8): Promise<BuyerConcentration[]> {
  return getJson<BuyerConcentration[]>(`analytics/concentration?${scopeParams(scope, { basis, min_awards: minAwards, limit })}`);
}

export function fetchTrends(scope: AnalyticsScope, granularity: "week" | "month"): Promise<TrendPoint[]> {
  return getJson<TrendPoint[]>(`analytics/trends?${scopeParams(scope, { granularity })}`);
}

export function fetchProcurementFlags(id: string): Promise<ProcurementFlags> {
  return getJson<ProcurementFlags>(`procurements/${encodeURIComponent(id)}/flags`);
}

export function fetchRedFlagSummary(dataset: "demo" | "live"): Promise<RedFlagSummary> {
  return getJson<RedFlagSummary>(`red-flags?dataset=${dataset}`);
}
