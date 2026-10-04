import type { GraphData, GraphNode } from "./types";
import { t, type Language } from "./i18n";

function dateLabel(value: unknown, language: Language): string {
  if (typeof value !== "string" || !value) return t("Date unavailable", language);
  return new Intl.DateTimeFormat(language === "pl" ? "pl-PL" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

function resultLabel(value: unknown, language: Language): string {
  if (value === "zawarcieUmowy") return t("Contract awarded", language);
  if (value === "Awarded") return t("Awarded", language);
  if (typeof value === "string" && value.toLowerCase().includes("uniewa")) return t("Procurement cancelled", language);
  return value ? t("Outcome reported in notice", language) : t("Outcome not provided", language);
}

export default function CaseSpotlight({ data, language, selectedNode, loading, error, dataset, onOpenMap, onRetry }: {
  data: GraphData | null;
  language: Language;
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

  return <section className="case-spotlight" id="case" aria-label={t("Selected procurement", language)} aria-live="polite" aria-busy={loading}>
    <div className="case-heading"><span>{t("01 / SELECTED NOTICE", language)}</span><a href="#catalog">{t("Choose another from the registry", language)} ↓</a></div>
    {error && !data ? <div className="case-placeholder">{t("Could not load this case.", language)} <button onClick={onRetry}>{t("Try again", language)}</button></div> : loading && !data ? <div className="case-placeholder">{t("Loading the procurement and its relationships…", language)}</div> : tender ? <>
      <div className="case-lead">
        <div><span className="case-eyebrow">{dataset === "demo" ? t("DEMO EXAMPLE", language) : t("RESULT NOTICE · BZP", language)}</span><h2>{tender.label}</h2></div>
        <div className="case-reference"><span>{t("PUBLISHED", language)}</span><strong>{dateLabel(tender.details.published_on, language)}</strong>{tender.details.reference && <small>{tender.details.reference}</small>}</div>
      </div>
      <div className="case-answers">
        <div className="case-answer"><span>{t("01 / WHO IS BUYING?", language)}</span><strong>{buyer?.label ?? t("Buyer not provided", language)}</strong><small>{t(buyer?.city || "", language)}</small></div>
        <div className="case-answer"><span>{t("02 / WHICH SUPPLIER?", language)}</span><strong>{suppliers[0]?.label ?? t("Supplier not named", language)}</strong><small>{suppliers.length > 1 ? `${t("and", language)} ${suppliers.length - 1} ${t("other suppliers", language)}` : suppliers.length ? t("Supplier named in notice", language) : t("No name in available data", language)}</small></div>
        <div className="case-answer case-outcome"><span>{t("03 / WHAT OUTCOME?", language)}</span><strong>{resultLabel(tender.details.procedure_result ?? tender.details.status, language)}</strong><small>{dataset === "demo" ? t("Fictional demo result", language) : t("Check details in the source", language)}</small></div>
      </div>
      <div className="case-actions">
        {source ? <a className="case-source" href={source} target="_blank" rel="noreferrer">{t("Open original notice", language)} <span>↗</span></a> : <span className="case-no-source">{dataset === "demo" ? t("Demo scenario · no source document", language) : t("Source URL unavailable", language)}</span>}
        <button onClick={onOpenMap}>{t("Explore on the map", language)} <span>→</span></button>
      </div>
    </> : <div className="case-placeholder">{t("No procurements match this search. Try another query in the registry below.", language)}</div>}
  </section>;
}
