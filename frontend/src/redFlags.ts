import type { Language } from "./i18n";
import type { RedFlag, RedFlagCode } from "./types";

const titles: Record<RedFlagCode, { en: string; pl: string }> = {
  single_bid: { en: "Single bid", pl: "Jedna oferta" },
  repeat_supplier: { en: "Repeat supplier", pl: "Powtarzający się wykonawca" },
  short_procedure: { en: "Unusually short procedure", pl: "Nietypowo krótkie postępowanie" },
  non_competitive: { en: "Awarded without competition", pl: "Udzielone bez konkurencji" },
};

export const flagCodes = Object.keys(titles) as RedFlagCode[];

export function flagTitle(code: RedFlagCode, language: Language): string {
  return titles[code][language];
}

const orderTypes: Record<string, { en: string; pl: string }> = {
  Services: { en: "services", pl: "usług" },
  Delivery: { en: "supplies", pl: "dostaw" },
  Works: { en: "works", pl: "robót budowlanych" },
  Unknown: { en: "this type", pl: "tego rodzaju" },
};

export function explainFlag(flag: RedFlag, language: Language): string {
  const p = flag.params;
  const pl = language === "pl";
  switch (flag.code) {
    case "single_bid":
      return pl
        ? "Co najmniej jedna część, w której zawarto umowę, otrzymała tylko jedną ofertę (pole 6.1 ogłoszenia). Brak konkurencji może wynikać np. z wąskiego rynku lub krótkiego terminu."
        : "At least one awarded part received only one offer (notice field 6.1). A lack of competition can have ordinary causes, such as a narrow market or a short deadline.";
    case "repeat_supplier":
      return pl
        ? `${p.supplier} wygrał ${p.wins} z ${p.buyer_awards} zamówień udzielonych przez tego zamawiającego w załadowanych danych. Może to być np. stały dostawca specjalistycznego sprzętu.`
        : `${p.supplier} won ${p.wins} of the ${p.buyer_awards} awards this buyer made in the loaded data. This can be, for example, a regular supplier of specialised equipment.`;
    case "short_procedure": {
      const type = orderTypes[String(p.order_type)] ?? orderTypes.Unknown;
      return pl
        ? `Od ogłoszenia o zamówieniu do podpisania umowy minęło ${p.days} dni, a mediana dla zamówień ${type.pl} w tych danych to ${p.median_days} dni (porównano ${p.sample} postępowań). Krótki termin bywa zgodny z prawem, np. przy prostych dostawach.`
        : `${p.days} days passed from the contract notice to signing, while the median for ${type.en} in this data is ${p.median_days} days (${p.sample} procedures compared). Short timelines can be lawful, e.g. for simple supplies.`;
    }
    case "non_competitive":
      return pl
        ? "Ogłoszenie podaje tryb z wolnej ręki lub negocjacje bez ogłoszenia, czyli bez otwartej konkurencji. Ustawa dopuszcza te tryby w określonych sytuacjach; uzasadnienie podaje ogłoszenie."
        : "The notice states a single-source procedure or negotiation without publication, i.e. no open competition. The law allows these in defined situations; the notice gives the justification.";
  }
}

export function disclaimer(language: Language): string {
  return language === "pl"
    ? "Sygnały to wzorce statystyczne, a nie zarzuty. Każdy ma zwyczajne wyjaśnienia — przed wyciągnięciem wniosków przeczytaj ogłoszenie źródłowe."
    : "Signals are statistical patterns, not accusations. Each has ordinary explanations — read the source notice before drawing conclusions.";
}
