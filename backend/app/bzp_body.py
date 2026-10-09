"""Extract structured facts from the HTML body of a BZP result notice.

The BZP list endpoint returns each notice with an ``htmlBody`` that holds the full
published form. The structured JSON fields do not include the number of offers,
contract values or contract dates, so this module reads them from the numbered
form fields (for example ``6.1.)`` for the number of offers). It only extracts
what the form states and returns ``None`` for anything it cannot read.
"""

import html
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

_PART_HEADER = re.compile(r"^SEKCJA V ZAKOŃCZENIE POSTĘPOWANIA \(dla części (\d+)\)$")
_FIELD = re.compile(r"^(\d+(?:\.\d+)*)\.?\)\s*(.*)$")
_TAX_DIGITS = re.compile(r"\d{10}")


def _lines(html_body: str) -> list[str]:
    without_style = re.sub(r"<style.*?</style>", "", html_body, flags=re.S | re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "\n", without_style))
    return [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]


def parse_amount(value: str | None) -> Decimal | None:
    """Read a Polish-formatted amount such as ``7983267,80 PLN``."""
    if not value:
        return None
    currency = re.search(r"\b([A-Z]{3})\b", value)
    if currency and currency.group(1) != "PLN":
        return None
    match = re.search(r"-?[\d\s ]+(?:,\d+)?", value)
    if not match:
        return None
    digits = match.group(0).replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        return Decimal(digits)
    except InvalidOperation:
        return None


def _parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.match(r"^\d+$", value.strip())
    return int(match.group(0)) if match else None


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def tax_id_digits(value: Any) -> str | None:
    """Normalise ``NIP: 793-145-68-98`` and similar values to ten digits."""
    if value in (None, ""):
        return None
    digits = re.sub(r"\D", "", str(value))
    match = _TAX_DIGITS.search(digits)
    return match.group(0) if match and len(digits) == 10 else digits or None


def procedure_kind(mode: str | None) -> str | None:
    """Group the legal basis text from field 3.1 into a short, stable code."""
    if not mode:
        return None
    lowered = mode.casefold()
    if "wolnej ręki" in lowered:
        return "single_source"
    if "negocjacji bez ogłoszenia" in lowered:
        return "negotiated_without_notice"
    if "trybie podstawowym" in lowered:
        return "basic"
    if "przetarg" in lowered:
        return "tender"
    return "other"


def _outcome(text: str) -> str | None:
    lowered = text.casefold()
    if "zawarciem umowy" in lowered:
        return "awarded"
    if "unieważnieniem" in lowered:
        return "cancelled"
    return None


def _empty_part(number: int) -> dict[str, Any]:
    return {
        "part": number,
        "outcome": None,
        "offers": None,
        "lowest_price": None,
        "highest_price": None,
        "winning_price": None,
        "contract_signed_on": None,
        "contract_value": None,
        "supplier_tax_ids": [],
    }


def parse_notice_body(html_body: str | None) -> dict[str, Any] | None:
    """Return procedure facts and one entry per part of the procurement.

    Amounts are returned as strings so the result can be stored in JSON without
    losing precision; dates use ISO format.
    """
    if not html_body:
        return None
    lines = _lines(html_body)
    result: dict[str, Any] = {
        "procedure_mode": None,
        "procedure_kind": None,
        "preceding_notice": None,
        "estimated_value": None,
        "parts": [],
    }

    current = _empty_part(1)
    parts: list[dict[str, Any]] = []
    started_parts = False
    preceded = False
    in_supplier_section = False

    for index, line in enumerate(lines):
        header = _PART_HEADER.match(line)
        if header:
            if started_parts and current != _empty_part(current["part"]):
                parts.append(current)
            current = _empty_part(int(header.group(1)))
            started_parts = True
            in_supplier_section = False
            continue
        if line.startswith("SEKCJA V ZAKOŃCZENIE POSTĘPOWANIA") and not started_parts:
            started_parts = True
            continue
        if line.startswith("SEKCJA VIII") or line.startswith("SEKCJA VI "):
            in_supplier_section = False
        elif line.startswith("SEKCJA VII"):
            in_supplier_section = True

        match = _FIELD.match(line)
        if not match:
            continue
        number = match.group(1)
        value = lines[index + 1] if index + 1 < len(lines) else ""
        if _FIELD.match(value):
            value = ""

        if number == "2.13":
            preceded = value.casefold().startswith("tak")
        elif number == "2.14" and preceded and value:
            result["preceding_notice"] = value
        elif number == "3.1" and value and result["procedure_mode"] is None:
            result["procedure_mode"] = value
            result["procedure_kind"] = procedure_kind(value)
        elif number == "4.3.1":
            amount = parse_amount(value)
            result["estimated_value"] = str(amount) if amount is not None else None
        elif number == "5.1":
            current["outcome"] = _outcome(value)
        elif number == "6.1":
            current["offers"] = _parse_int(value)
        elif number in ("6.2", "6.3", "6.4"):
            amount = parse_amount(value)
            key = {"6.2": "lowest_price", "6.3": "highest_price", "6.4": "winning_price"}[number]
            current[key] = str(amount) if amount is not None else None
        elif number == "7.3.2" and in_supplier_section:
            tax_id = tax_id_digits(value)
            if tax_id:
                current["supplier_tax_ids"].append(tax_id)
        elif number == "8.1":
            signed = _parse_date(value)
            current["contract_signed_on"] = signed.isoformat() if signed else None
        elif number == "8.2":
            amount = parse_amount(value)
            current["contract_value"] = str(amount) if amount is not None else None

    if started_parts:
        parts.append(current)
    result["parts"] = parts
    return result


def summarise_parts(extracted: dict[str, Any] | None) -> dict[str, Any]:
    """Collapse per-part facts into the per-notice figures used for analytics."""
    empty = {
        "parts_count": 0,
        "awarded_parts": 0,
        "offers_count": None,
        "contract_value": None,
        "contract_signed_on": None,
    }
    if not extracted:
        return empty
    parts = extracted.get("parts") or []
    awarded = [part for part in parts if part.get("outcome") == "awarded"]
    offers = [part["offers"] for part in awarded if isinstance(part.get("offers"), int)]
    values = [Decimal(part["contract_value"]) for part in awarded if part.get("contract_value")]
    signed = [part["contract_signed_on"] for part in awarded if part.get("contract_signed_on")]
    return {
        "parts_count": len(parts),
        "awarded_parts": len(awarded),
        # The smallest number of offers in any awarded part: one single-offer part
        # is enough to mark the notice as having a single-bid award.
        "offers_count": min(offers) if offers else None,
        "contract_value": sum(values, Decimal("0")) if values else None,
        "contract_signed_on": min(signed) if signed else None,
    }


def supplier_values(extracted: dict[str, Any] | None) -> dict[str, Decimal]:
    """Contract value per supplier tax ID, summed across awarded parts.

    For joint (consortium) awards the part value is attributed to the first listed
    contractor, which BZP lists as the consortium leader; other members get no value.
    """
    totals: dict[str, Decimal] = {}
    if not extracted:
        return totals
    for part in extracted.get("parts") or []:
        if part.get("outcome") != "awarded" or not part.get("contract_value"):
            continue
        tax_ids = part.get("supplier_tax_ids") or []
        if not tax_ids:
            continue
        leader = tax_ids[0]
        totals[leader] = totals.get(leader, Decimal("0")) + Decimal(part["contract_value"])
    return totals
