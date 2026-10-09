from decimal import Decimal

from bzp_fixtures import notice_html

from app.bzp_body import (
    parse_amount,
    parse_notice_body,
    procedure_kind,
    summarise_parts,
    supplier_values,
    tax_id_digits,
)


def test_parse_amount_reads_polish_format_and_rejects_other_currencies():
    assert parse_amount("7983267,80 PLN") == Decimal("7983267.80")
    assert parse_amount("350963,89                PLN") == Decimal("350963.89")
    assert parse_amount("1 250,5 PLN") == Decimal("1250.5")
    assert parse_amount("1000,00 EUR") is None
    assert parse_amount(None) is None


def test_tax_ids_and_procedure_kinds_are_normalised():
    assert tax_id_digits("NIP: 793-145-68-98") == "7931456898"
    assert tax_id_digits(None) is None
    assert procedure_kind("w trybie zamówienia z wolnej ręki na podstawie: art. 305") == (
        "single_source"
    )
    assert procedure_kind("w trybie podstawowym na podstawie: art. 275 pkt 1") == "basic"


def test_single_part_notice_body():
    extracted = parse_notice_body(
        notice_html([{"offers": 2, "value": "7983267,80", "tax_ids": ["7931456898"]}])
    )
    assert extracted["procedure_kind"] == "basic"
    assert extracted["preceding_notice"] == "2026/BZP 00000001"
    assert extracted["parts"] == [
        {
            "part": 1,
            "outcome": "awarded",
            "offers": 2,
            "lowest_price": None,
            "highest_price": None,
            "winning_price": "7983267.80",
            "contract_signed_on": "2026-09-01",
            "contract_value": "7983267.80",
            "supplier_tax_ids": ["7931456898"],
        }
    ]


def test_multi_part_notice_is_summarised_per_part():
    extracted = parse_notice_body(
        notice_html(
            [
                {"offers": 3, "value": "100,00", "tax_ids": ["1111111111"], "signed": "2026-09-03"},
                {"offers": 1, "value": "50,00", "tax_ids": ["2222222222", "3333333333"]},
                {"cancelled": True},
            ],
            preceding=None,
        )
    )
    assert extracted["preceding_notice"] is None
    assert [part["outcome"] for part in extracted["parts"]] == ["awarded", "awarded", "cancelled"]
    summary = summarise_parts(extracted)
    assert summary == {
        "parts_count": 3,
        "awarded_parts": 2,
        "offers_count": 1,
        "contract_value": Decimal("150.00"),
        "contract_signed_on": "2026-09-01",
    }
    # A joint award is attributed to the first listed contractor (the consortium leader).
    assert supplier_values(extracted) == {
        "1111111111": Decimal("100.00"),
        "2222222222": Decimal("50.00"),
    }


def test_missing_body_yields_no_facts():
    assert parse_notice_body(None) is None
    assert summarise_parts(None)["offers_count"] is None
