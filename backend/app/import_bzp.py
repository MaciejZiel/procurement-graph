"""Import public BZP notices from a JSON snapshot or the public source endpoint.

The external API is versioned and can change shape. This importer accepts known
response envelopes and fails closed when required buyer/location fields are absent.
"""

import argparse
import hashlib
import json
import os
import re
import unicodedata
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import GraphEdge, GraphNode

DEFAULT_BZP_URL = "https://ezamowienia.gov.pl/mo-board/api/v1/notice"


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
        raise ValueError("Oczekiwano tablicy lub obiektu JSON z ogłoszeniami.")

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
    raise ValueError("Nie rozpoznaję struktury odpowiedzi BZP; zapisano ją do inspekcji.")


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
        "contractorName",
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
    source_url = _first(row, "noticeUrl", "sourceUrl", "detailUrl", "url") or _official_notice_url(
        row
    )
    published = _parse_date(_first(row, "publicationDate", "publishedAt", "noticeDate", "date"))
    amount = _parse_amount(
        _first(row, "awardValue", "contractAmount", "awardedValue", "contractValue")
    )

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
        "published": published,
        "amount": amount,
        "source_url": str(source_url) if source_url else None,
    }


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
                subtitle="Zamawiający · dane źródłowe",
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
                subtitle="Postępowanie · dane BZP",
                city=city,
                details={
                    "reference": notice["notice_number"],
                    "published_on": notice["published"].isoformat()
                    if notice["published"]
                    else None,
                    "status": "Ogłoszenie BZP",
                    "amount_pln": float(notice["amount"]) if notice["amount"] is not None else None,
                    "offers": row.get("offersCount"),
                    "source": "BZP",
                },
                is_demo=False,
            )
        )
        occurred_at = notice["published"]
        evidence = f"Ogłoszenie BZP {notice['notice_number']}"
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

        if notice["supplier"]:
            supplier_id = f"supplier-{_entity_key(notice['supplier'], notice['supplier_tax_id'])}"
            session.merge(
                GraphNode(
                    id=supplier_id,
                    kind="company",
                    label=notice["supplier"][:240],
                    subtitle="Wykonawca wskazany w danych BZP",
                    city=city,
                    details={"source": "BZP", "tax_id": notice["supplier_tax_id"]},
                    is_demo=False,
                )
            )
            session.merge(
                GraphEdge(
                    id=f"{notice_id}-awarded-to",
                    source_id=notice_id,
                    target_id=supplier_id,
                    relationship_type="wybrano wykonawcę",
                    evidence_label=evidence,
                    evidence_url=source_url,
                    occurred_at=occurred_at,
                    amount_pln=notice["amount"],
                    is_demo=False,
                )
            )
        imported += 1
    session.commit()
    return imported


def main() -> None:
    parser = argparse.ArgumentParser(description="Importuje ogłoszenia BZP do Jawnego Śladu.")
    parser.add_argument("--input", type=Path, help="Plik JSON z odpowiedzią API BZP")
    parser.add_argument("--url", default=os.getenv("BZP_API_URL", DEFAULT_BZP_URL))
    parser.add_argument(
        "--city", default="Warszawa", help="Miasto zamawiającego; domyślnie Warszawa"
    )
    parser.add_argument(
        "--since", default=None, help="Data graniczna YYYY-MM-DD; domyślnie ostatnie 2 lata"
    )
    parser.add_argument("--notice-type", default="TenderResultNotice")
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--max-pages", type=int, default=10)
    args = parser.parse_args()
    today = date.today()
    cutoff = date.fromisoformat(args.since) if args.since else today - timedelta(days=730)

    if args.input:
        payload = json.loads(args.input.read_text(encoding="utf-8"))
    else:
        if not 1 <= args.page_size <= 500 or args.max_pages < 1:
            parser.error("PageSize musi być w zakresie 1–500, a max-pages musi być dodatnie.")
        payload = []
        search_after = None
        for page in range(args.max_pages):
            params = {
                "NoticeType": args.notice_type,
                "PublicationDateFrom": cutoff.isoformat(),
                "PublicationDateTo": today.isoformat(),
                "OrganizationCity": args.city,
                "PageSize": args.page_size,
            }
            if search_after:
                params["SearchAfter"] = search_after
            response = httpx.get(args.url, params=params, timeout=30, follow_redirects=True)
            response.raise_for_status()
            page_rows = extract_rows(response.json())
            payload.extend(page_rows)
            if len(page_rows) < args.page_size:
                break
            next_cursor = page_rows[-1].get("objectId")
            if not next_cursor or next_cursor == search_after:
                raise SystemExit("Brak nowego kursora ObjectId; import przerwany.")
            search_after = next_cursor
        else:
            print(f"Osiągnięto limit {args.max_pages} stron; możliwe są dalsze ogłoszenia.")

    try:
        rows = extract_rows(payload)
    except ValueError as error:
        snapshot = Path(os.getenv("BZP_SNAPSHOT_DIR", "/tmp/jawny-slad-bzp")) / "bzp-response.json"
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        snapshot.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        raise SystemExit(f"{error} Odpowiedź zapisana do {snapshot}.") from error

    with SessionLocal() as session:
        count = save_notices(session, rows, city_filter=args.city, since=cutoff)
    print(f"Zaimportowano lub zaktualizowano {count} ogłoszeń z miasta: {args.city}.")


if __name__ == "__main__":
    main()
