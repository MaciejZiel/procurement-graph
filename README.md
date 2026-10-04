# Jawny Ślad

**Kto zamawia, kogo wskazano i gdzie jest źródło?**

Jawny Ślad pozwala przeczytać jedno ogłoszenie o wyniku w prosty sposób: pokazuje zamawiającego, przedmiot, wskazanego wykonawcę i wynik, a następnie prowadzi do danych BZP. Rejestr służy do wyboru kolejnej sprawy. Mapa powiązań jest dodatkowym widokiem do eksploracji relacji.

![Przykładowe postępowanie w aplikacji](docs/dashboard.jpg)

Po pierwszym uruchomieniu domyślnie otwiera się zbiór BZP: do repozytorium dołączono 1214 prawdziwych ogłoszeń warszawskich zamawiających z okresu 1 września – 3 października 2026 r. Dane fikcyjne są dostępne oddzielnie jako „Scenariusz demo”. Dołączony zbiór jest migawką, więc do pracy na aktualnych danych użyj importera.

## Co działa

- czytelna karta jednego postępowania z odpowiedziami i linkiem do źródła,
- wyszukiwarka rejestru, która otwiera wybraną sprawę w tej karcie,
- interaktywny atlas relacji: przechodzenie między wszystkimi postępowaniami, losowy widok, powiększanie, przesuwanie i pełny ekran,
- podświetlanie ścieżki zamawiający → postępowanie → wykonawca, z panelem szczegółów i źródłem,
- katalog wszystkich zaimportowanych postępowań z wyszukiwaniem, filtrowaniem, sortowaniem i stronicowaniem,
- wyszukiwanie po tytule, numerze, CPV, zamawiającym i wykonawcy,
- filtry po rodzaju węzła i okresie,
- profile podmiotów, źródła oraz gotowe ścieżki demonstracyjne,
- API FastAPI i warstwa PostgreSQL,
- importer BZP z filtrem lokalizacji, wieloma wykonawcami w jednym ogłoszeniu i ponawialnym upsertem,
- kontenerowy start całego środowiska.

## Uruchomienie

Wymagany jest Docker z Compose.

```bash
cp .env.example .env
docker compose up --build
```

Frontend będzie dostępny pod `http://localhost:5173`, a dokumentacja API pod `http://localhost:8000/docs`.

Do lokalnej pracy bez Dockera można utworzyć środowisko backendu i uruchomić oba serwery razem:

```bash
uv venv backend/.venv
uv pip install --python backend/.venv/bin/python -e 'backend[dev]'
cd frontend && npm ci
npm run dev
```

Tryb lokalny uruchamia API i frontend razem oraz używa pliku SQLite w ignorowanym katalogu `data/`. Compose uruchamia PostgreSQL i pozostaje właściwą konfiguracją do sprawdzania zachowania aplikacji na docelowej bazie.

Po uruchomieniu Compose można pobrać więcej ogłoszeń z BZP:

```bash
docker compose exec backend python -m app.import_bzp --city Warszawa --since 2026-09-01
```

Bez `--since` importer pobiera z oficjalnego API ogłoszenia o wyniku postępowania (`TenderResultNotice`) dla Warszawy z ostatnich dwóch lat. Można ustawić `--since YYYY-MM-DD`, `--notice-type`, `--page-size` (maks. 500), `--max-pages` (domyślnie 10) albo podać lokalny JSON przez `--input /app/data/bzp.json`. Po osiągnięciu limitu stron importer informuje, że zbiór może być niepełny. Krawędź do wykonawcy powstaje wyłącznie wtedy, gdy API podaje jego nazwę; jedno postępowanie może mieć wielu wykonawców. Dowód prowadzi do zapytania BZP o konkretne ogłoszenie. Dane demonstracyjne i źródłowe są dostępne osobno w API (`dataset=demo` lub `dataset=live`).

## Dane i metodologia

Źródłem ogłoszeń jest bezpłatny webserwis BZP platformy e‑Zamówienia: <https://ezamowienia.gov.pl/mo-board/api/v1/notice>. Obecny zakres obejmuje ogłoszenia warszawskich instytucji; wykonawcy mogą pochodzić z całej Polski. Dane z TED oraz automatyczne wzbogacanie profili z KRS są planowane jako kolejne źródła.

Źródło: [materiały integracyjne e‑Zamówień](https://ezamowienia.gov.pl/pl/integracja/), w tym specyfikacja OpenAPI BZP. Mapowanie sprawdzono z rzeczywistą odpowiedzią API; przed uruchomieniem produkcyjnym warto ponownie zweryfikować format dostawcy.

### Zasady prezentacji

- Fakt, obliczona statystyka i możliwe dopasowanie podmiotu są oznaczane osobno.
- Każda relacja zawiera typ, źródło i datę.
- Brak danych nie jest przedstawiany jako brak zdarzenia.
- Sygnały analityczne opisują wzorzec i nie stanowią oceny prawnej ani zarzutu.

## Stos technologiczny

- **Frontend:** React, TypeScript, Vite, własny graf SVG.
- **Backend:** Python, FastAPI, SQLAlchemy.
- **Baza:** PostgreSQL.
- **Lokalne środowisko:** Docker Compose.

## Plan projektu

1. Szkielet repozytorium i lokalne środowisko.
2. Schemat danych, dane demonstracyjne i API.
3. Widok grafu, profile oraz ścieżki demonstracyjne.
4. Import źródeł, dokumentacja metodologii i przygotowanie wdrożenia.

## Licencja

Projekt portfolio. Dane zewnętrzne podlegają warunkom ich źródeł.
