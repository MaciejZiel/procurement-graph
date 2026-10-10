"""Import public BZP notices from a JSON snapshot or the public source endpoint.

The external API is versioned and can change shape. This importer accepts known
response envelopes and fails closed when required buyer/location fields are absent.
"""

import argparse
import hashlib
import json
import os
import re
import time
import unicodedata
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from .bzp_body import parse_notice_body, summarise_parts, supplier_values, tax_id_digits
from .database import Base, SessionLocal, engine
from .models import GraphEdge, GraphNode, ProcurementFacts

DEFAULT_BZP_URL = "https://ezamowienia.gov.pl/mo-board/api/v1/notice"
# The API terms allow blocking clients whose traffic loads the platform, and the
# endpoint answers 403 to bursts. Requests are therefore spaced and retried slowly.
DEFAULT_REQUEST_DELAY = 1.5


def _official_notice_url(row: dict[str, Any]) -> str | None:
    number = row.get("noticeNumber")
    published = _parse_date(row.get("publicationDate"))
    kind = row.get("noticeType")
    if not (number and published and kind and row.get("objectId")):
        return None
    params = urlencode(
        {
            "NoticeType": kind,
            "NoticeNumber": number,
            "PublicationDateFrom": published.isoformat(),
            "PublicationDateTo": published.isoformat(),
            "PageSize": 100,
        }
    )
    return f"{DEFAULT_BZP_URL}?{params}"


def _first(record: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _nested_name(record: dict[str, Any], *keys: str) -> str | None:
    value = _first(record, *keys)
    if isinstance(value, dict):
        value = _first(value, "name", "label", "legalName", "companyName")
    return str(value).strip() if value not in (None, "") else None


def _nested_field(record: dict[str, Any], keys: tuple[str, ...], *fields: str) -> str | None:
    value = _first(record, *keys)
    if isinstance(value, dict):
        address = value.get("address") if isinstance(value.get("address"), dict) else {}
        value = _first(value, *fields) or _first(address, *fields)
    return str(value).strip() if value not in (None, "") else None


def _entity_key(name: str, tax_id: str | None) -> str:
    identity = tax_id or "".join(
        char
        for char in unicodedata.normalize("NFKD", name.casefold())
        if not unicodedata.combining(char)
    )
    normalized = re.sub(r"[^a-z0-9]+", "-", identity).strip("-")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:18]


def extract_rows(payload: Any) -> list[dict[str, Any]]:
    """Find notice objects in common list and pagination response envelopes."""
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        raise ValueError("Expected an array or an object containing JSON notices.")

    for key in ("notices", "items", "content", "results", "data", "records"):
        candidate = payload.get(key)
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, dict)]
        if isinstance(candidate, dict):
            try:
                return extract_rows(candidate)
            except ValueError:
                continue
    if any(key in payload for key in ("noticeId", "noticeNumber", "announcementNumber", "id")):
        return [payload]
    raise ValueError("Unrecognized BZP response structure; saved it for inspection.")


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _parse_amount(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value))
    normalized = str(value).replace("\u00a0", "").replace(" ", "").replace("zł", "")
    if "," in normalized and "." in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")
    else:
        normalized = normalized.replace(",", ".")
    try:
        return Decimal(normalized)
    except InvalidOperation:
        return None


def normalise_notice(row: dict[str, Any], city_filter: str = "Warszawa") -> dict[str, Any] | None:
    """Map one BZP notice to a conservative, source-linked graph record."""
    notice_number = _first(
        row,
        "noticeNumber",
        "announcementNumber",
        "publicationNumber",
        "numberBZP",
        "id",
        "noticeId",
    )
    buyer = _nested_name(
        row,
        "contractingAuthorityName",
        "contractingEntityName",
        "buyerName",
        "organizationName",
        "contractingAuthority",
        "buyer",
    )
    city = _nested_field(
        row,
        (
            "contractingAuthorityCity",
            "buyerCity",
            "organizationCity",
            "city",
            "locality",
            "contractingAuthority",
            "buyer",
        ),
        "city",
        "locality",
    )
    title = _nested_name(
        row, "orderObject", "title", "contractName", "subject", "objectName", "name"
    )
    contractors = row.get("contractors")
    contractor = (
        next(
            (item for item in contractors if isinstance(item, dict) and item.get("contractorName")),
            None,
        )
        if isinstance(contractors, list)
        else None
    )
    supplier = _nested_name(
        row,
        "contractorName",
        "winnerName",
        "winningSupplierName",
        "supplierName",
        "winner",
        "contractor",
        "supplier",
    ) or (_nested_name(contractor, "contractorName") if contractor else None)
    buyer_tax_id = _nested_field(
        row,
        ("contractingAuthority", "buyer"),
        "nip",
        "taxId",
        "nationalId",
        "regon",
    ) or _first(row, "organizationNationalId", "contractingAuthorityNip", "buyerNip", "buyerRegon")
    supplier_tax_id = (
        _nested_field(
            row,
            ("winner", "contractor", "supplier"),
            "nip",
            "taxId",
            "nationalId",
            "regon",
        )
        or (contractor.get("contractorNationalId") if contractor else None)
        or _first(row, "winnerNip", "contractorNip", "supplierNip", "winnerRegon")
    )
    suppliers = (
        [
            {
                "name": str(item["contractorName"]).strip(),
                "tax_id": str(item["contractorNationalId"])
                if item.get("contractorNationalId")
                else None,
                "city": str(item["contractorCity"]).strip() if item.get("contractorCity") else None,
            }
            for item in contractors
            if isinstance(item, dict) and item.get("contractorName")
        ]
        if isinstance(contractors, list)
        else []
    )
    if not suppliers and supplier:
        suppliers = [{"name": supplier, "tax_id": supplier_tax_id, "city": None}]
    source_url = _first(row, "noticeUrl", "sourceUrl", "detailUrl", "url") or _official_notice_url(
        row
    )
    published = _parse_date(_first(row, "publicationDate", "publishedAt", "noticeDate", "date"))
    extracted = row.get("extracted")
    if not isinstance(extracted, dict):
        extracted = parse_notice_body(row.get("htmlBody"))
    summary = summarise_parts(extracted)
    amount = _parse_amount(
        _first(row, "awardValue", "contractAmount", "awardedValue", "contractValue")
    )
    if amount is None:
        amount = summary["contract_value"]
    offers = row.get("offersCount")
    if offers is None:
        offers = summary["offers_count"]

    if (
        not notice_number
        or not buyer
        or not city
        or city_filter.casefold() not in city.casefold()
        or not source_url
    ):
        return None
    if not title:
        return None

    notice_key = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(notice_number)).strip("-")
    if not notice_key:
        notice_key = hashlib.sha1(str(notice_number).encode()).hexdigest()[:16]
    return {
        "notice_key": notice_key,
        "notice_number": str(notice_number),
        "buyer": buyer,
        "buyer_tax_id": str(buyer_tax_id) if buyer_tax_id else None,
        "city": city,
        "title": title,
        "supplier": supplier,
        "supplier_tax_id": str(supplier_tax_id) if supplier_tax_id else None,
        "suppliers": suppliers,
        "published": published,
        "amount": amount,
        "source_url": str(source_url) if source_url else None,
        "order_type": row.get("orderType"),
        "cpv_code": row.get("cpvCode"),
        "procedure_result": row.get("procedureResult"),
        "notice_type": row.get("noticeType"),
        "tender_id": row.get("tenderId"),
        "offers": offers,
        "extracted": extracted,
        "summary": summary,
    }


def _supplier_amount(
    supplier: dict[str, Any],
    values_by_tax_id: dict[str, Decimal],
    notice_amount: Decimal | None,
    single_supplier: bool,
) -> Decimal | None:
    """Value of the parts this supplier won; whole amount only when it is the sole supplier."""
    tax_id = tax_id_digits(supplier.get("tax_id"))
    if tax_id and tax_id in values_by_tax_id:
        return values_by_tax_id[tax_id]
    if single_supplier and not values_by_tax_id:
        return notice_amount
    if single_supplier and values_by_tax_id:
        return sum(values_by_tax_id.values(), Decimal("0"))
    return None


def polite_get(
    client: httpx.Client,
    url: str,
    params: dict[str, Any],
    delay: float = DEFAULT_REQUEST_DELAY,
    retries: int = 5,
) -> Any:
    """GET JSON with a pause after each request and a growing back-off on 403/429/5xx."""
    for attempt in range(retries + 1):
        response = client.get(url, params=params)
        if response.status_code in (403, 429) or response.status_code >= 500:
            if attempt == retries:
                response.raise_for_status()
            time.sleep(max(delay, 1) * 20 * (attempt + 1))
            continue
        response.raise_for_status()
        time.sleep(delay)
        return response.json()
    raise RuntimeError("unreachable")


def _preceding_notice_number(number: str) -> str:
    """BZP result notices cite the procedure notice without its version suffix."""
    return number if re.search(r"/\d{2}$", number) else f"{number}/01"


def resolve_procedure_starts(
    rows: list[dict[str, Any]],
    client: httpx.Client,
    url: str = DEFAULT_BZP_URL,
    cache: dict[str, str | None] | None = None,
    delay: float = DEFAULT_REQUEST_DELAY,
) -> dict[str, str | None]:
    """Look up when each procedure was announced and store it as ``procedure_started_on``.

    The result notice only cites the number of the contract notice that opened the
    procedure (field 2.14). One request per distinct number fetches that notice's
    publication date; ``cache`` maps numbers to dates so reruns do not repeat requests.
    Numbers that cannot be found (for example TED references) stay ``None``.
    """
    cache = {} if cache is None else cache
    for row in rows:
        extracted = row.get("extracted")
        if not isinstance(extracted, dict):
            extracted = parse_notice_body(row.get("htmlBody"))
            row["extracted"] = extracted
        number = (extracted or {}).get("preceding_notice")
        if not number:
            continue
        if number not in cache:
            published = _parse_date(row.get("publicationDate")) or date.today()
            year = int(number[:4]) if number[:4].isdigit() else published.year
            found = polite_get(
                client,
                url,
                {
                    "NoticeType": "ContractNotice",
                    "NoticeNumber": _preceding_notice_number(number),
                    "PublicationDateFrom": date(year - 1, 1, 1).isoformat(),
                    "PublicationDateTo": published.isoformat(),
                    "PageSize": 5,
                },
                delay=delay,
            )
            dates = sorted(str(item["publicationDate"])[:10] for item in extract_rows(found))
            cache[number] = dates[0] if dates else None
        extracted["procedure_started_on"] = cache[number]
    return cache


def compact_notice(row: dict[str, Any]) -> dict[str, Any]:
    """Replace the bulky HTML body with the facts extracted from it.

    The bundled snapshot keeps the structured API fields verbatim and stores the
    figures read from ``htmlBody`` under ``extracted``. Contact details that appear
    only in the HTML (e-mail addresses, street addresses) are not kept.
    """
    compact = {key: value for key, value in row.items() if key != "htmlBody"}
    if "extracted" not in compact:
        compact["extracted"] = parse_notice_body(row.get("htmlBody"))
    return compact


def save_notices(
    session: Session,
    rows: list[dict[str, Any]],
    city_filter: str = "Warszawa",
    since: date | None = None,
) -> int:
    """Persist accepted notices and their buyer/award links, idempotently."""
    imported = 0
    for row in rows:
        notice = normalise_notice(row, city_filter=city_filter)
        if notice is None or (
            since is not None and (notice["published"] is None or notice["published"] < since)
        ):
            continue

        notice_id = f"bzp-{notice['notice_key']}"
        buyer_id = f"buyer-{_entity_key(notice['buyer'], notice['buyer_tax_id'])}"
        title = notice["title"][:240]
        buyer = notice["buyer"][:240]
        city = f"{notice['city']} · dane BZP"
        source_url = notice["source_url"]

        session.merge(
            GraphNode(
                id=buyer_id,
                kind="institution",
                label=buyer,
                subtitle="Buyer · source data",
                city=city,
                details={"source": "BZP", "tax_id": notice["buyer_tax_id"]},
                is_demo=False,
            )
        )
        session.merge(
            GraphNode(
                id=notice_id,
                kind="procurement",
                label=title,
                subtitle="Procurement · BZP data",
                city=city,
                details={
                    "reference": notice["notice_number"],
                    "published_on": notice["published"].isoformat()
                    if notice["published"]
                    else None,
                    "status": "Procurement result notice"
                    if notice["notice_type"] == "TenderResultNotice"
                    else "BZP notice",
                    "amount_pln": float(notice["amount"]) if notice["amount"] is not None else None,
                    "offers": notice["offers"],
                    "procedure_kind": (notice["extracted"] or {}).get("procedure_kind"),
                    "source": "BZP",
                    "source_url": source_url,
                    "order_type": notice["order_type"],
                    "cpv_code": notice["cpv_code"],
                    "procedure_result": notice["procedure_result"],
                    "tender_id": notice["tender_id"],
                },
                is_demo=False,
            )
        )
        occurred_at = notice["published"]
        evidence = f"BZP notice {notice['notice_number']}"
        session.merge(
            GraphEdge(
                id=f"{notice_id}-published-by",
                source_id=buyer_id,
                target_id=notice_id,
                relationship_type="ogłosiła",
                evidence_label=evidence,
                evidence_url=source_url,
                occurred_at=occurred_at,
                is_demo=False,
            )
        )

        values_by_tax_id = supplier_values(notice["extracted"])
        single_supplier = len(notice["suppliers"]) == 1
        seen_suppliers: set[str] = set()
        for supplier_index, supplier in enumerate(notice["suppliers"]):
            supplier_id = f"supplier-{_entity_key(supplier['name'], supplier['tax_id'])}"
            if supplier_id in seen_suppliers:
                continue
            seen_suppliers.add(supplier_id)
            session.merge(
                GraphNode(
                    id=supplier_id,
                    kind="company",
                    label=supplier["name"][:240],
                    subtitle="Supplier named in BZP data",
                    city=supplier["city"] or "Not provided",
                    details={"source": "BZP", "tax_id": supplier["tax_id"]},
                    is_demo=False,
                )
            )
            session.merge(
                GraphEdge(
                    id=f"{notice_id}-awarded-to"
                    if supplier_index == 0
                    else f"{notice_id}-awarded-to-{supplier_id}",
                    source_id=notice_id,
                    target_id=supplier_id,
                    relationship_type="wybrano wykonawcę"
                    if notice["procedure_result"] in (None, "zawarcieUmowy")
                    else "wskazano wykonawcę",
                    evidence_label=evidence,
                    evidence_url=source_url,
                    occurred_at=occurred_at,
                    amount_pln=_supplier_amount(
                        supplier, values_by_tax_id, notice["amount"], single_supplier
                    ),
                    is_demo=False,
                )
            )
        summary = notice["summary"]
        extracted = notice["extracted"] or {}
        estimated = extracted.get("estimated_value")
        signed = summary["contract_signed_on"]
        session.merge(
            ProcurementFacts(
                procurement_id=notice_id,
                buyer_id=buyer_id,
                is_demo=False,
                city=notice["city"][:120],
                published_on=notice["published"],
                order_type=notice["order_type"],
                procedure_kind=extracted.get("procedure_kind"),
                parts_count=summary["parts_count"],
                awarded_parts=summary["awarded_parts"],
                offers_count=notice["offers"],
                contract_value_pln=notice["amount"],
                estimated_value_pln=Decimal(estimated) if estimated else None,
                contract_signed_on=date.fromisoformat(signed) if signed else None,
                preceding_notice=extracted.get("preceding_notice"),
                procedure_started_on=_parse_date(extracted.get("procedure_started_on")),
            )
        )
        session.flush()
        imported += 1
    session.commit()
    return imported


def fetch_notices(
    client: httpx.Client,
    *,
    url: str = DEFAULT_BZP_URL,
    city: str,
    since: date,
    until: date,
    notice_type: str = "TenderResultNotice",
    page_size: int = 250,
    max_pages: int = 10,
    delay: float = DEFAULT_REQUEST_DELAY,
) -> tuple[list[dict[str, Any]], bool]:
    """Page through the BZP endpoint with its ``SearchAfter`` cursor.

    Returns the rows and whether the page limit stopped the download early.
    """
    rows: list[dict[str, Any]] = []
    search_after = None
    for _ in range(max_pages):
        params: dict[str, Any] = {
            "NoticeType": notice_type,
            "PublicationDateFrom": since.isoformat(),
            "PublicationDateTo": until.isoformat(),
            "OrganizationCity": city,
            "PageSize": page_size,
        }
        if search_after:
            params["SearchAfter"] = search_after
        page_rows = extract_rows(polite_get(client, url, params, delay=delay))
        rows.extend(page_rows)
        if len(page_rows) < page_size:
            return rows, False
        next_cursor = page_rows[-1].get("objectId")
        if not next_cursor or next_cursor == search_after:
            raise SystemExit("No new ObjectId cursor; import stopped.")
        search_after = next_cursor
    return rows, True


def main() -> None:
    parser = argparse.ArgumentParser(description="Import BZP notices into Procurement Graph.")
    parser.add_argument("--input", type=Path, help="JSON file with a BZP API response")
    parser.add_argument("--url", default=os.getenv("BZP_API_URL", DEFAULT_BZP_URL))
    parser.add_argument("--city", default="Warszawa", help="Buyer city; defaults to Warsaw")
    parser.add_argument(
        "--since", default=None, help="Start date YYYY-MM-DD; defaults to the last 2 years"
    )
    parser.add_argument("--notice-type", default="TenderResultNotice")
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--max-pages", type=int, default=10)
    parser.add_argument(
        "--resolve-start-dates",
        action="store_true",
        help="Look up when each procedure was announced (one extra request per notice)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_REQUEST_DELAY,
        help="Seconds to wait between API requests",
    )
    args = parser.parse_args()
    today = date.today()
    cutoff = date.fromisoformat(args.since) if args.since else today - timedelta(days=730)

    if args.input:
        payload = json.loads(args.input.read_text(encoding="utf-8"))
    else:
        if not 1 <= args.page_size <= 500 or args.max_pages < 1:
            parser.error("Page size must be 1–500 and max-pages must be positive.")
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            payload, truncated = fetch_notices(
                client,
                url=args.url,
                city=args.city,
                since=cutoff,
                until=today,
                notice_type=args.notice_type,
                page_size=args.page_size,
                max_pages=args.max_pages,
                delay=args.delay,
            )
        if truncated:
            print(f"Reached the limit of {args.max_pages} pages; more notices may exist.")

    try:
        rows = extract_rows(payload)
    except ValueError as error:
        snapshot = (
            Path(os.getenv("BZP_SNAPSHOT_DIR", "/tmp/procurement-graph-bzp")) / "bzp-response.json"
        )
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        snapshot.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        raise SystemExit(f"{error} Response saved to {snapshot}.") from error

    if args.resolve_start_dates:
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            resolve_procedure_starts(rows, client, url=args.url, delay=args.delay)

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        count = save_notices(session, rows, city_filter=args.city, since=cutoff)
    print(f"Imported or updated {count} notices for city: {args.city}.")


if __name__ == "__main__":
    main()
