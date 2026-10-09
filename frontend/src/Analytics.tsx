import { useEffect, useState } from "react";
import { fetchAnalyticsSummary, fetchConcentration, fetchTopEntities, fetchTrends, type AnalyticsScope } from "./api";
import { t, type Language } from "./i18n";
import type { AnalyticsSummary, BuyerConcentration, RankedEntity, TrendPoint } from "./types";

type Measure = "value" | "count";

interface AnalyticsData {
  summary: AnalyticsSummary;
  buyers: RankedEntity[];
  suppliers: RankedEntity[];
  concentration: BuyerConcentration[];
  trends: TrendPoint[];
}

function locale(language: Language): string {
  return language === "pl" ? "pl-PL" : "en-GB";
}

function money(value: string | number | null | undefined, language: Language, compact = false): string {
  if (value === null || value === undefined) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(locale(language), {
    style: "currency",
    currency: "PLN",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(amount);
}

function percent(value: number | null | undefined, language: Language): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(locale(language), { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function count(value: number, language: Language): string {
  return value.toLocaleString(locale(language));
}

function periodLabel(value: string, granularity: "week" | "month", language: Language): string {
  const date = new Date(`${value}T00:00:00`);
  const options: Intl.DateTimeFormatOptions = granularity === "week" ? { day: "numeric", month: "short" } : { month: "short", year: "numeric" };
  return new Intl.DateTimeFormat(locale(language), options).format(date);
}

function dateRange(summary: AnalyticsSummary, language: Language): string {
  if (!summary.first_published_on || !summary.last_published_on) return "—";
  const format = new Intl.DateTimeFormat(locale(language), { day: "numeric", month: "short", year: "numeric" });
  return `${format.format(new Date(summary.first_published_on))} – ${format.format(new Date(summary.last_published_on))}`;
}

function cityName(city: string, language: Language): string {
  if (language === "pl") return city;
  return ({ Warszawa: "Warsaw", "Kraków": "Kraków", "Wrocław": "Wrocław" } as Record<string, string>)[city] ?? city;
}

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return <div className="analytics-toggle" role="group" aria-label={label}>
    {options.map((option) => <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>{option.label}</button>)}
  </div>;
}

function RankingList({ title, kicker, items, measure, language, onSearch }: { title: string; kicker: string; items: RankedEntity[]; measure: Measure; language: Language; onSearch: (label: string) => void }) {
  const max = Math.max(...items.map((item) => (measure === "value" ? Number(item.value_pln) : item.notices)), 1);
  return <section className="analytics-card" aria-label={title}>
    <div className="analytics-card-head"><span>{kicker}</span><h3>{title}</h3></div>
    {items.length === 0 ? <p className="analytics-empty">{t("No data for this selection.", language)}</p> : <ol className="ranking-list">
      {items.map((item) => {
        const amount = measure === "value" ? Number(item.value_pln) : item.notices;
        return <li key={item.id}>
          <button type="button" onClick={() => onSearch(item.label)} title={t("Show in the registry", language)}>
            <span className="ranking-rank">{String(item.rank).padStart(2, "0")}</span>
            <span className="ranking-body">
              <span className="ranking-label">{item.label}</span>
              <span className="ranking-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (amount / max) * 100)}%` }} /></span>
              <small>{count(item.notices, language)} {t("notices", language)} · {count(item.counterparts, language)} {t("counterparties", language)} · {count(item.single_bid_notices, language)} {t("single-bid", language)}</small>
            </span>
            <span className="ranking-value"><strong>{measure === "value" ? money(item.value_pln, language, true) : count(item.notices, language)}</strong><small>{measure === "value" ? percent(item.value_share, language) : money(item.value_pln, language, true)}</small></span>
          </button>
        </li>;
      })}
    </ol>}
  </section>;
}

function TrendChart({ points, granularity, language }: { points: TrendPoint[]; granularity: "week" | "month"; language: Language }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const barHeight = 150;
  const rateHeight = 70;
  const left = 8;
  const step = points.length ? (width - left * 2) / points.length : 0;
  const maxValue = Math.max(...points.map((point) => Number(point.value_pln)), 1);
  const ratePoints = points.map((point, index) => ({ index, rate: point.single_bid_rate })).filter((point): point is { index: number; rate: number } => point.rate !== null);
  const rateY = (rate: number) => barHeight + 40 + rateHeight - rate * rateHeight;
  const active = hover === null ? null : points[hover];
  if (points.length === 0) return <p className="analytics-empty">{t("No data for this selection.", language)}</p>;
  return <div className="trend-chart">
    <div className="trend-tooltip" aria-live="polite">
      {active ? <>
        <strong>{periodLabel(active.period, granularity, language)}</strong>
        <span>{t("Contract value", language)}: <b>{money(active.value_pln, language)}</b></span>
        <span>{t("Notices", language)}: <b>{count(active.notices, language)}</b></span>
        <span>{t("Single-bid rate", language)}: <b>{percent(active.single_bid_rate, language)}</b></span>
        <span>{t("Running total", language)}: <b>{money(active.cumulative_value_pln, language, true)}</b></span>
      </> : <span>{t("Point at a period to see its figures.", language)}</span>}
    </div>
    <svg viewBox={`0 0 ${width} ${barHeight + rateHeight + 70}`} role="img" aria-label={t("Contract value and single-bid rate per period", language)} onPointerLeave={() => setHover(null)}>
      <text className="trend-axis-title" x={left} y={12}>{t("CONTRACT VALUE", language)}</text>
      <line className="trend-baseline" x1={left} x2={width - left} y1={barHeight + 18} y2={barHeight + 18} />
      {points.map((point, index) => {
        const height = (Number(point.value_pln) / maxValue) * (barHeight - 20);
        const x = left + index * step + step * 0.18;
        const barWidth = step * 0.64;
        return <g key={point.period}>
          <rect className={`trend-bar ${hover === index ? "trend-active" : ""}`} x={x} y={barHeight + 18 - height} width={barWidth} height={Math.max(height, 1)} rx={4} />
          <text className="trend-label" x={x + barWidth / 2} y={barHeight + 32} textAnchor="middle">{periodLabel(point.period, granularity, language)}</text>
          {hover === index && <text className="trend-value" x={x + barWidth / 2} y={barHeight + 12 - height} textAnchor="middle">{money(point.value_pln, language, true)}</text>}
        </g>;
      })}
      <text className="trend-axis-title" x={left} y={barHeight + 52}>{t("SINGLE-BID RATE", language)}</text>
      <line className="trend-gridline" x1={left} x2={width - left} y1={rateY(0.5)} y2={rateY(0.5)} />
      <text className="trend-grid-label" x={width - left} y={rateY(0.5) - 4} textAnchor="end">50%</text>
      <polyline className="trend-rate" points={ratePoints.map((point) => `${left + point.index * step + step / 2},${rateY(point.rate)}`).join(" ")} />
      {ratePoints.map((point) => <circle key={point.index} className={`trend-dot ${hover === point.index ? "trend-active" : ""}`} cx={left + point.index * step + step / 2} cy={rateY(point.rate)} r={hover === point.index ? 5 : 4} />)}
      {points.map((point, index) => <rect key={`hit-${point.period}`} className="trend-hit" x={left + index * step} y={0} width={step} height={barHeight + rateHeight + 70} onPointerEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={0} aria-label={`${periodLabel(point.period, granularity, language)}: ${money(point.value_pln, language)}`} />)}
    </svg>
  </div>;
}

export default function Analytics({ language, dataset, onSearch }: { language: Language; dataset: "demo" | "live"; onSearch: (label: string) => void }) {
  const [city, setCity] = useState("");
  const [measure, setMeasure] = useState<Measure>("value");
  const [basis, setBasis] = useState<Measure>("value");
  const [granularity, setGranularity] = useState<"week" | "month">("week");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const scope: AnalyticsScope = { dataset, city: city || undefined };
    setLoading(true);
    setError(null);
    Promise.all([
      fetchAnalyticsSummary(scope),
      fetchTopEntities("buyers", scope, measure),
      fetchTopEntities("suppliers", scope, measure),
      fetchConcentration(scope, basis, dataset === "demo" ? 1 : 5),
      fetchTrends(scope, granularity),
    ]).then(([summary, buyers, suppliers, concentration, trends]) => {
      if (!cancelled) setData({ summary, buyers, suppliers, concentration, trends });
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load analytics.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [dataset, city, measure, basis, granularity, reload]);

  const summary = data?.summary;
  const measureOptions = [{ id: "value" as const, label: t("By value", language) }, { id: "count" as const, label: t("By count", language) }];

  return <section className="analytics-page" id="analytics" aria-label={t("Analytics", language)} aria-busy={loading}>
    <div className="analytics-heading">
      <div>
        <span className="catalog-kicker">{t("03 / ANALYTICS", language)}</span>
        <h2>{t("Who buys,", language)} <em>{t("who wins.", language)}</em></h2>
        <p>{t("Aggregates computed in SQL from the notices in the database. Values are the contract values stated in result notices; a notice without a stated value counts towards the number of notices only.", language)}</p>
      </div>
      <div className="analytics-filters">
        <label>{t("CITY", language)}
          <select value={city} onChange={(event) => setCity(event.target.value)} aria-label={t("Filter by buyer city", language)}>
            <option value="">{t("All cities", language)}</option>
            {summary?.cities.map((item) => <option key={item} value={item}>{cityName(item, language)}</option>)}
          </select>
        </label>
        <span className="analytics-range">{summary ? dateRange(summary, language) : "—"}</span>
      </div>
    </div>

    {dataset === "demo" && <p className="analytics-demo-note">{t("You are viewing the fictional demo dataset. Switch to BZP data on the map to analyse real notices.", language)}</p>}
    {error && <div className="catalog-message catalog-error"><strong>{t("Could not load analytics.", language)}</strong><span>{t(error, language)}</span><button onClick={() => setReload((value) => value + 1)}>{t("Try again", language)}</button></div>}
    {!data && loading && <div className="catalog-message">{t("Loading analytics…", language)}</div>}

    {summary && data && <>
      <div className="analytics-kpis">
        <div><span>{t("NOTICES", language)}</span><strong>{count(summary.notices, language)}</strong><small>{count(summary.awarded_notices, language)} {t("with a contract", language)}</small></div>
        <div><span>{t("CONTRACT VALUE", language)}</span><strong>{money(summary.total_value_pln, language, true)}</strong><small>{t("stated in notices, PLN", language)}</small></div>
        <div><span>{t("BUYERS / SUPPLIERS", language)}</span><strong>{count(summary.buyers, language)} / {count(summary.suppliers, language)}</strong><small>{t("distinct entities", language)}</small></div>
        <div><span>{t("SINGLE-BID RATE", language)}</span><strong>{percent(summary.single_bid_rate, language)}</strong><small>{count(summary.single_bid_notices, language)} {t("of", language)} {count(summary.notices_with_offer_count, language)} {t("notices with an offer count", language)}</small></div>
        <div><span>{t("AVERAGE OFFERS", language)}</span><strong>{summary.average_offers?.toLocaleString(locale(language), { maximumFractionDigits: 1 }) ?? "—"}</strong><small>{t("per notice (smallest part)", language)}</small></div>
      </div>

      <div className="analytics-toolbar">
        <span>{t("Rank buyers and suppliers", language)}</span>
        <Toggle value={measure} options={measureOptions} onChange={setMeasure} label={t("Rank by", language)} />
      </div>
      <div className="analytics-grid">
        <RankingList title={t("Top buyers", language)} kicker={t("BUYERS", language)} items={data.buyers} measure={measure} language={language} onSearch={onSearch} />
        <RankingList title={t("Top suppliers", language)} kicker={t("SUPPLIERS", language)} items={data.suppliers} measure={measure} language={language} onSearch={onSearch} />
      </div>

      <div className="analytics-grid analytics-grid-wide">
        <section className="analytics-card" aria-label={t("Trends", language)}>
          <div className="analytics-card-head analytics-card-head-row">
            <div><span>{t("TRENDS", language)}</span><h3>{t("Value and single-bid rate over time", language)}</h3></div>
            <Toggle value={granularity} options={[{ id: "week", label: t("Weekly", language) }, { id: "month", label: t("Monthly", language) }]} onChange={setGranularity} label={t("Period length", language)} />
          </div>
          <TrendChart points={data.trends} granularity={granularity} language={language} />
        </section>
        <section className="analytics-card" aria-label={t("By procurement type", language)}>
          <div className="analytics-card-head"><span>{t("BY TYPE", language)}</span><h3>{t("Procurement types", language)}</h3></div>
          <table className="analytics-table">
            <thead><tr><th>{t("Type", language)}</th><th>{t("Notices", language)}</th><th>{t("Value", language)}</th><th>{t("Single-bid", language)}</th></tr></thead>
            <tbody>{summary.by_order_type.map((row) => <tr key={row.key}><td>{t(row.key === "Delivery" ? "Supplies" : row.key === "Unknown" ? "Not provided" : row.key, language)}</td><td>{count(row.notices, language)}</td><td>{money(row.value_pln, language, true)}</td><td>{percent(row.single_bid_rate, language)}</td></tr>)}</tbody>
          </table>
        </section>
      </div>

      <section className="analytics-card analytics-concentration" aria-label={t("Supplier concentration", language)}>
        <div className="analytics-card-head analytics-card-head-row">
          <div><span>{t("CONCENTRATION", language)}</span><h3>{t("Buyers that rely most on a single supplier", language)}</h3>
            <p>{t("HHI is the sum of squared supplier shares of a buyer's awards (0–10,000; 10,000 = one supplier received everything). Only buyers with at least five supplier awards are listed.", language)}</p></div>
          <Toggle value={basis} options={[{ id: "value", label: t("Share of value", language) }, { id: "count", label: t("Share of awards", language) }]} onChange={setBasis} label={t("Concentration basis", language)} />
        </div>
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <thead><tr><th>{t("Buyer", language)}</th><th>{t("Awards", language)}</th><th>{t("Suppliers", language)}</th><th>HHI</th><th>{t("Largest supplier", language)}</th><th>{t("Share", language)}</th></tr></thead>
            <tbody>{data.concentration.map((row) => <tr key={row.buyer_id}>
              <td><button type="button" className="analytics-link" onClick={() => onSearch(row.buyer_label)}>{row.buyer_label}</button></td>
              <td>{count(row.awards, language)}</td>
              <td>{count(row.suppliers, language)}</td>
              <td className="hhi-cell"><span className="hhi-meter"><i style={{ width: `${row.hhi / 100}%` }} /></span>{Math.round(row.hhi).toLocaleString(locale(language))}</td>
              <td><button type="button" className="analytics-link" onClick={() => onSearch(row.top_supplier_label)}>{row.top_supplier_label}</button><small>{count(row.top_supplier_wins, language)} {t("awards", language)}</small></td>
              <td>{percent(row.top_supplier_share, language)}</td>
            </tr>)}</tbody>
          </table>
          {data.concentration.length === 0 && <p className="analytics-empty">{t("No buyer has enough awards in this selection.", language)}</p>}
        </div>
      </section>

      <p className="analytics-method">{t("How to read this: figures describe what the notices report, not whether a procurement was appropriate. Contract values in other currencies are left out; for joint bids the value is attributed to the first listed contractor. Selecting a name opens it in the registry.", language)}</p>
    </>}
  </section>;
}
