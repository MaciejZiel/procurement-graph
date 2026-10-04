import type { RefObject } from "react";
import type { ProcurementItem, ProcurementPage } from "./types";
import { t, type Language } from "./i18n";

const orderLabels: Record<string, string> = {
  Delivery: "Supplies",
  Services: "Services",
  Works: "Works",
};

function shortDate(value: string | null, language: Language): string {
  if (!value) return t("Date unavailable", language);
  return new Intl.DateTimeFormat(language === "pl" ? "pl-PL" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

interface CatalogProps {
  data: ProcurementPage | null;
  language: Language;
  loading: boolean;
  error: string | null;
  query: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery: (value: string) => void;
  dataset: "demo" | "live";
  selectedId: string | null;
  orderType: string;
  supplierFilter: "all" | "with" | "without";
  sort: "newest" | "oldest" | "title";
  onOrderType: (value: string) => void;
  onSupplierFilter: (value: "all" | "with" | "without") => void;
  onSort: (value: "newest" | "oldest" | "title") => void;
  onPage: (value: number) => void;
  onSelect: (item: ProcurementItem) => void;
  onReset: () => void;
}

export default function Catalog({
  data, language, loading, error, query, inputRef, onQuery, dataset, selectedId, orderType, supplierFilter, sort,
  onOrderType, onSupplierFilter, onSort, onPage, onSelect, onReset,
}: CatalogProps) {
  const first = data?.total ? (data.page - 1) * data.page_size + 1 : 0;
  const last = data ? Math.min(data.page * data.page_size, data.total) : 0;

  return (
    <section className="catalog-section" id="catalog" aria-label={t("Procurement registry", language)}>
      <div className="catalog-heading">
        <div>
          <span className="catalog-kicker">{t("02 / PROCUREMENT REGISTRY", language)}</span>
          <h2>{t("Find another", language)} <em>{t("case.", language)}</em></h2>
          <p>{t("Search by supplier, buyer, subject, or notice number. Select a result to inspect it above.", language)}</p>
        </div>
        <div className="catalog-count"><strong>{data?.total.toLocaleString(language === "pl" ? "pl-PL" : "en-GB") ?? "—"}</strong><span>{dataset === "demo" ? t("DEMO RECORDS", language) : t("BZP NOTICES", language)}</span></div>
      </div>

      <div className="catalog-search">
        <label htmlFor="catalog-query">{t("SEARCH NOTICES", language)}</label>
        <div><input ref={inputRef} id="catalog-query" name="catalog-query" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("Try USG, Warszawa, or a notice number…", language)} /><span>⌘ / Ctrl K</span></div>
      </div>

      <details className="catalog-filter-panel">
        <summary>{t("Filters and sorting", language)} <span aria-hidden="true">↓</span></summary>
        <div className="catalog-controls">
          <div className="catalog-summary">
            <strong>{data?.buyers_count ?? "—"}</strong> {t("buyers", language)} <span>·</span> <strong>{data?.suppliers_count ?? "—"}</strong> {t("suppliers", language)}
          </div>
          <label>{t("TYPE", language)}
            <select name="order-type" value={orderType} onChange={(event) => onOrderType(event.target.value)} aria-label={t("Filter by procurement type", language)}>
              <option value="">{t("All", language)}</option>
              <option value="Services">{t("Services", language)}</option>
              <option value="Delivery">{t("Supplies", language)}</option>
              <option value="Works">{t("Works", language)}</option>
            </select>
          </label>
          <label>{t("SUPPLIER", language)}
            <select name="supplier" value={supplierFilter} onChange={(event) => onSupplierFilter(event.target.value as CatalogProps["supplierFilter"])} aria-label={t("Filter by supplier", language)}>
              <option value="all">{t("All", language)}</option>
              <option value="with">{t("Named", language)}</option>
              <option value="without">{t("Missing", language)}</option>
            </select>
          </label>
          <label>{t("SORT", language)}
            <select name="sort" value={sort} onChange={(event) => onSort(event.target.value as CatalogProps["sort"])} aria-label={t("Sort registry", language)}>
              <option value="newest">{t("Newest", language)}</option>
              <option value="oldest">{t("Oldest", language)}</option>
              <option value="title">{t("Title A–Z", language)}</option>
            </select>
          </label>
        </div>
      </details>

      <div className="catalog-table" aria-live="polite" aria-busy={loading}>
        <div className="catalog-column-head" aria-hidden="true"><span>{t("DATE / TYPE", language)}</span><span>{t("PROCUREMENT", language)}</span><span>{t("BUYER", language)}</span><span>{t("SUPPLIER", language)}</span><span>{t("SOURCE", language)}</span></div>
        {error && <div className="catalog-message catalog-error"><strong>{t("Could not load the registry.", language)}</strong><span>{t(error, language)}</span></div>}
        {loading && !data && <div className="catalog-message">{t("Loading procurements…", language)}</div>}
        {!loading && !error && data?.items.length === 0 && <div className="catalog-message"><strong>{t("No results for these filters.", language)}</strong><span>{t("Try another search, type, or date range.", language)}</span><button onClick={onReset}>{t("Clear filters", language)}</button></div>}
        {data?.items.map((item, index) => (
          <article className={`catalog-row ${item.id === selectedId ? "catalog-selected" : ""}`} key={item.id}>
            <button className="catalog-open" onClick={() => onSelect(item)} aria-label={`${t("Open case:", language)} ${item.title}`}>
              <span className="catalog-date"><strong>{shortDate(item.published_on, language)}</strong><small>{t(orderLabels[item.order_type ?? ""] ?? "Procurement", language)}</small></span>
              <span className="catalog-title"><small>{String((data.page - 1) * data.page_size + index + 1).padStart(3, "0")} / {item.reference ?? t("NO NUMBER", language)}</small><strong>{item.title}</strong></span>
              <span className="catalog-entity">{item.buyer?.label ?? t("Not provided", language)}</span>
              <span className="catalog-supplier">{item.suppliers.length ? <>{item.suppliers[0].label}{item.suppliers.length > 1 && <small>+{item.suppliers.length - 1} {t("suppliers", language)}</small>}</> : <i>{t("Not named in the notice", language)}</i>}</span>
            </button>
            {item.source_url ? <a className="catalog-source" href={item.source_url} target="_blank" rel="noreferrer" aria-label={`${t("Open BZP source:", language)} ${item.reference ?? item.title}`}>BZP ↗</a> : <span className="catalog-source catalog-no-source">DEMO</span>}
          </article>
        ))}
      </div>

      <div className="catalog-pagination">
        <span>{data?.total ? `${first}–${last} ${t("of", language)} ${data.total.toLocaleString(language === "pl" ? "pl-PL" : "en-GB")}` : t("0 records", language)}</span>
        <div><button onClick={() => onPage((data?.page ?? 1) - 1)} disabled={!data || data.page <= 1 || loading}>← {t("Previous", language)}</button><strong>{data?.page ?? 1} / {Math.max(data?.pages ?? 1, 1)}</strong><button onClick={() => onPage((data?.page ?? 1) + 1)} disabled={!data || data.page >= data.pages || loading}>{t("Next", language)} →</button></div>
      </div>
    </section>
  );
}
