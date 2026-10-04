import type { GraphData, GraphNode } from "./types";

function dateLabel(value: unknown): string {
  if (typeof value !== "string" || !value) return "Nie podano daty";
  return new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

function resultLabel(value: unknown): string {
  if (value === "zawarcieUmowy") return "Zawarto umowę";
  if (typeof value === "string" && value.toLowerCase().includes("uniewa")) return "Postępowanie unieważniono";
  return value ? "Wynik opisany w ogłoszeniu" : "Nie podano wyniku";
}

export default function CaseSpotlight({ data, selectedNode, loading, error, dataset, onOpenMap, onRetry }: {
  data: GraphData | null;
  selectedNode: GraphNode | null;
  loading: boolean;
  error: string | null;
  dataset: "live" | "demo";
  onOpenMap: () => void;
  onRetry: () => void;
}) {
  const byId = new Map(data?.nodes.map((node) => [node.id, node]) ?? []);
  const tender = selectedNode?.kind === "procurement" ? selectedNode : data?.edges
    .filter((edge) => edge.source_id === selectedNode?.id || edge.target_id === selectedNode?.id)
    .map((edge) => byId.get(edge.source_id === selectedNode?.id ? edge.target_id : edge.source_id))
    .find((node) => node?.kind === "procurement") ?? data?.nodes.find((node) => node.kind === "procurement");
  const buyerEdge = data?.edges.find((edge) => edge.target_id === tender?.id && byId.get(edge.source_id)?.kind === "institution");
  const buyer = buyerEdge ? byId.get(buyerEdge.source_id) : null;
  const suppliers = data?.edges
    .filter((edge) => edge.source_id === tender?.id && byId.get(edge.target_id)?.kind === "company")
    .map((edge) => byId.get(edge.target_id))
    .filter((node): node is GraphNode => Boolean(node)) ?? [];
  const source = typeof tender?.details.source_url === "string" ? tender.details.source_url : buyerEdge?.evidence_url;

  return <section className="case-spotlight" id="case" aria-label="Wybrane postępowanie" aria-live="polite" aria-busy={loading}>
    <div className="case-heading"><span>01 / WYBRANE OGŁOSZENIE</span><a href="#catalog">Wybierz inne z rejestru ↓</a></div>
    {error && !data ? <div className="case-placeholder">Nie udało się pobrać sprawy. <button onClick={onRetry}>Spróbuj ponownie</button></div> : loading && !data ? <div className="case-placeholder">Pobieram postępowanie i jego powiązania…</div> : tender ? <>
      <div className="case-lead">
        <div><span className="case-eyebrow">{dataset === "demo" ? "PRZYKŁAD DEMONSTRACYJNY" : "OGŁOSZENIE O WYNIKU · BZP"}</span><h2>{tender.label}</h2></div>
        <div className="case-reference"><span>OGŁOSZONO</span><strong>{dateLabel(tender.details.published_on)}</strong>{tender.details.reference && <small>{tender.details.reference}</small>}</div>
      </div>
      <div className="case-answers">
        <div className="case-answer"><span>01 / KTO ZAMAWIA?</span><strong>{buyer?.label ?? "Nie podano zamawiającego"}</strong><small>{buyer?.city || ""}</small></div>
        <div className="case-answer"><span>02 / KOGO WSKAZANO?</span><strong>{suppliers[0]?.label ?? "Nie wskazano wykonawcy"}</strong><small>{suppliers.length > 1 ? `oraz ${suppliers.length - 1} innych wykonawców` : suppliers.length ? "Wykonawca z ogłoszenia" : "Brak nazwy w dostępnych danych"}</small></div>
        <div className="case-answer case-outcome"><span>03 / JAKI WYNIK?</span><strong>{resultLabel(tender.details.procedure_result)}</strong><small>Sprawdź szczegóły w źródle</small></div>
      </div>
      <div className="case-actions">
        {source ? <a className="case-source" href={source} target="_blank" rel="noreferrer">Otwórz ogłoszenie źródłowe <span>↗</span></a> : <span className="case-no-source">{dataset === "demo" ? "Scenariusz demonstracyjny · bez dokumentu źródłowego" : "Brak adresu ogłoszenia w dostępnych danych"}</span>}
        <button onClick={onOpenMap}>Pokaż powiązania na mapie <span>→</span></button>
      </div>
    </> : <div className="case-placeholder">Nie znaleziono postępowań dla tego wyszukiwania. Zmień zapytanie w rejestrze poniżej.</div>}
  </section>;
}
