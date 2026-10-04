import type { RefObject } from "react";
import type { ProcurementItem, ProcurementPage } from "./types";

const orderLabels: Record<string, string> = {
  Delivery: "Dostawy",
  Services: "Usługi",
  Works: "Roboty budowlane",
};

function shortDate(value: string | null): string {
  if (!value) return "Brak daty";
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

interface CatalogProps {
  data: ProcurementPage | null;
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
  data, loading, error, query, inputRef, onQuery, dataset, selectedId, orderType, supplierFilter, sort,
  onOrderType, onSupplierFilter, onSort, onPage, onSelect, onReset,
}: CatalogProps) {
  const first = data?.total ? (data.page - 1) * data.page_size + 1 : 0;
  const last = data ? Math.min(data.page * data.page_size, data.total) : 0;

  return (
    <section className="catalog-section" id="catalog" aria-label="Katalog postępowań">
      <div className="catalog-heading">
        <div>
          <span className="catalog-kicker">02 / REJESTR POSTĘPOWAŃ</span>
          <h2>Znajdź kolejną <em>sprawę.</em></h2>
          <p>Wpisz nazwę firmy, instytucji, temat zamówienia lub numer ogłoszenia. Kliknij wynik, aby zobaczyć odpowiedzi powyżej.</p>
        </div>
        <div className="catalog-count"><strong>{data?.total.toLocaleString("pl-PL") ?? "—"}</strong><span>{dataset === "demo" ? "REKORDY DEMO" : "OGŁOSZENIA BZP"}</span></div>
      </div>

      <div className="catalog-search">
        <label htmlFor="catalog-query">SZUKAJ W OGŁOSZENIACH</label>
        <div><input ref={inputRef} id="catalog-query" name="catalog-query" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Np. szpital, remont, nazwa firmy…" /><span>⌘ / Ctrl K</span></div>
      </div>

      <details className="catalog-filter-panel">
        <summary>Filtry i sortowanie <span aria-hidden="true">↓</span></summary>
        <div className="catalog-controls">
          <div className="catalog-summary">
            <strong>{data?.buyers_count ?? "—"}</strong> zamawiających <span>·</span> <strong>{data?.suppliers_count ?? "—"}</strong> wykonawców
          </div>
          <label>RODZAJ
            <select name="order-type" value={orderType} onChange={(event) => onOrderType(event.target.value)} aria-label="Filtruj rodzaj zamówienia">
              <option value="">Wszystkie</option>
              <option value="Services">Usługi</option>
              <option value="Delivery">Dostawy</option>
              <option value="Works">Roboty budowlane</option>
            </select>
          </label>
          <label>WYKONAWCA
            <select name="supplier" value={supplierFilter} onChange={(event) => onSupplierFilter(event.target.value as CatalogProps["supplierFilter"])} aria-label="Filtruj po wykonawcy">
              <option value="all">Wszystkie</option>
              <option value="with">Wskazany</option>
              <option value="without">Brak danych</option>
            </select>
          </label>
          <label>SORTOWANIE
            <select name="sort" value={sort} onChange={(event) => onSort(event.target.value as CatalogProps["sort"])} aria-label="Sortowanie katalogu">
              <option value="newest">Najnowsze</option>
              <option value="oldest">Najstarsze</option>
              <option value="title">Nazwa A–Z</option>
            </select>
          </label>
        </div>
      </details>

      <div className="catalog-table" aria-live="polite" aria-busy={loading}>
        <div className="catalog-column-head" aria-hidden="true"><span>DATA / RODZAJ</span><span>POSTĘPOWANIE</span><span>ZAMAWIAJĄCY</span><span>WYKONAWCA</span><span>ŹRÓDŁO</span></div>
        {error && <div className="catalog-message catalog-error"><strong>Nie udało się pobrać katalogu.</strong><span>{error}</span></div>}
        {loading && !data && <div className="catalog-message">Ładowanie postępowań…</div>}
        {!loading && !error && data?.items.length === 0 && <div className="catalog-message"><strong>Brak wyników dla tych filtrów.</strong><span>Zmień wyszukiwanie, rodzaj lub okres.</span><button onClick={onReset}>Wyczyść filtry</button></div>}
        {data?.items.map((item, index) => (
          <article className={`catalog-row ${item.id === selectedId ? "catalog-selected" : ""}`} key={item.id}>
            <button className="catalog-open" onClick={() => onSelect(item)} aria-label={`Otwórz sprawę: ${item.title}`}>
              <span className="catalog-date"><strong>{shortDate(item.published_on)}</strong><small>{orderLabels[item.order_type ?? ""] ?? "Zamówienie"}</small></span>
              <span className="catalog-title"><small>{String((data.page - 1) * data.page_size + index + 1).padStart(3, "0")} / {item.reference ?? "BRAK NUMERU"}</small><strong>{item.title}</strong></span>
              <span className="catalog-entity">{item.buyer?.label ?? "Nie podano"}</span>
              <span className="catalog-supplier">{item.suppliers.length ? <>{item.suppliers[0].label}{item.suppliers.length > 1 && <small>+{item.suppliers.length - 1} wykonawców</small>}</> : <i>Nie wskazano w ogłoszeniu</i>}</span>
            </button>
            {item.source_url ? <a className="catalog-source" href={item.source_url} target="_blank" rel="noreferrer" aria-label={`Otwórz źródło BZP: ${item.reference ?? item.title}`}>BZP ↗</a> : <span className="catalog-source catalog-no-source">DEMO</span>}
          </article>
        ))}
      </div>

      <div className="catalog-pagination">
        <span>{data?.total ? `${first}–${last} z ${data.total.toLocaleString("pl-PL")}` : "0 rekordów"}</span>
        <div><button onClick={() => onPage((data?.page ?? 1) - 1)} disabled={!data || data.page <= 1 || loading}>← Poprzednia</button><strong>{data?.page ?? 1} / {Math.max(data?.pages ?? 1, 1)}</strong><button onClick={() => onPage((data?.page ?? 1) + 1)} disabled={!data || data.page >= data.pages || loading}>Następna →</button></div>
      </div>
    </section>
  );
}
