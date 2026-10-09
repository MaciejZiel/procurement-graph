"""Small, fully synthetic BZP result notices for tests.

The HTML mirrors the numbered fields of the real BZP form, but every name, number and
amount here is invented for the tests.
"""

from typing import Any


def _field(number: str, label: str, value: str) -> str:
    return f"<h3>{number}) {label}</h3><p><span class='normal'>{value}</span></p>"


def _part_html(part: dict[str, Any], number: int | None) -> str:
    suffix = f" (dla części {number})" if number is not None else ""
    header = f"<h2>Część {number}</h2>" if number is not None else ""
    body = [header, f"<h2>SEKCJA V ZAKOŃCZENIE POSTĘPOWANIA{suffix}</h2>"]
    if part.get("cancelled"):
        body.append(
            _field(
                "5.1.",
                "Postępowanie zakończyło się:",
                "Postępowanie/cześć postępowania zakończyła się unieważnieniem",
            )
        )
        return "".join(body)
    body.append(
        _field(
            "5.1.",
            "Postępowanie zakończyło się:",
            "Postępowanie/cześć postępowania zakończyła się zawarciem umowy",
        )
    )
    body.append(f"<h2>SEKCJA VI OFERTY{suffix}</h2>")
    if part.get("offers") is not None:
        body.append(_field("6.1.", "Liczba otrzymanych ofert lub wniosków:", str(part["offers"])))
    body.append(
        _field(
            "6.4.",
            "Cena lub koszt oferty wykonawcy, któremu udzielono zamówienia:",
            f"{part['value']} PLN",
        )
    )
    body.append(f"<h2>SEKCJA VII WYKONAWCA, KTÓREMU UDZIELONO ZAMÓWIENIA{suffix}</h2>")
    for tax_id in part["tax_ids"]:
        body.append(_field("7.3.1", "Nazwa (firma) wykonawcy:", "Wykonawca testowy"))
        body.append(_field("7.3.2", "Krajowy Numer Identyfikacyjny:", f"NIP: {tax_id}"))
    body.append(f"<h2>SEKCJA VIII UMOWA{suffix}</h2>")
    body.append(_field("8.1.", "Data zawarcia umowy:", part.get("signed", "2026-09-01")))
    body.append(_field("8.2.", "Wartość umowy/umowy ramowej:", f"{part['value']} PLN"))
    return "".join(body)


def notice_html(
    parts: list[dict[str, Any]],
    mode: str = "Zamówienie udzielane jest w trybie podstawowym na podstawie: art. 275 pkt 1",
    preceding: str | None = "2026/BZP 00000001",
) -> str:
    head = [
        "<html><head><style>body {font-family: sans-serif}</style></head><body>",
        _field(
            "2.13.",
            "Zamówienie było poprzedzone ogłoszeniem o zamówieniu:",
            "Tak" if preceding else "Nie",
        ),
    ]
    if preceding:
        head.append(_field("2.14.", "Numer ogłoszenia:", preceding))
    head.append(_field("3.1.", "Tryb udzielenia zamówienia wraz z podstawą prawną", mode))
    numbered = len(parts) > 1
    body = "".join(
        _part_html(part, index + 1 if numbered else None) for index, part in enumerate(parts)
    )
    if numbered:
        body = "<h2>SEKCJA V ZAKOŃCZENIE POSTĘPOWANIA</h2>" + body
    return "".join(head) + body + "</body></html>"


def result_notice(
    number: int,
    *,
    buyer: str,
    buyer_tax_id: str,
    suppliers: list[tuple[str, str]],
    parts: list[dict[str, Any]],
    published: str = "2026-09-07",
    order_type: str = "Services",
    city: str = "Warszawa",
    **html_options: Any,
) -> dict[str, Any]:
    """A notice in the shape returned by the BZP list endpoint."""
    return {
        "orderType": order_type,
        "noticeType": "TenderResultNotice",
        "noticeNumber": f"2026/BZP {number:08d}/01",
        "publicationDate": f"{published}T08:00:00Z",
        "orderObject": f"Zamówienie testowe {number}",
        "cpvCode": "79000000-4 (Usługi testowe)",
        "procedureResult": ";".join(
            "uniewaznienie" if part.get("cancelled") else "zawarcieUmowy" for part in parts
        ),
        "organizationName": buyer,
        "organizationCity": city,
        "organizationNationalId": buyer_tax_id,
        "tenderId": f"ocds-test-{number}",
        "htmlBody": notice_html(parts, **html_options),
        "contractors": [
            {"contractorName": name, "contractorCity": city, "contractorNationalId": tax_id}
            for name, tax_id in suppliers
        ],
        "objectId": f"object-{number}",
    }
