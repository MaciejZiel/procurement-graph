# Jawny Ślad

**Zobacz, jak łączą się zamówienia publiczne.**

Jawny Ślad to projekt portfolio do odkrywania powiązań między instytucjami, wykonawcami i postępowaniami publicznymi. Każde połączenie w grafie ma prowadzić do dowodu w źródłowym ogłoszeniu. Aplikacja pokazuje wzorce do sprawdzenia, nie oskarżenia.

> **Demo:** obecny zestaw danych jest fikcyjny i służy wyłącznie prezentacji interfejsu. Aplikacja oznacza go jako dane demonstracyjne.

## Co działa

- interaktywny graf relacji z panelem szczegółów,
- wyszukiwanie instytucji, firm i postępowań,
- filtry po rodzaju węzła i okresie,
- profile podmiotów, źródła oraz gotowe ścieżki demonstracyjne,
- API FastAPI i warstwa PostgreSQL,
- kontenerowy start całego środowiska.

## Uruchomienie

Wymagany jest Docker z Compose.

```bash
cp .env.example .env
docker compose up --build
```

Frontend będzie dostępny pod `http://localhost:5173`, a dokumentacja API pod `http://localhost:8000/docs`.

Można też uruchomić frontend i backend oddzielnie. Instrukcje znajdują się w katalogach `frontend/` i `backend/`.

## Dane i metodologia

Docelowym źródłem krajowych ogłoszeń jest bezpłatny webserwis BZP platformy e‑Zamówienia: <https://ezamowienia.gov.pl/mo-client-board/api/notices/>. W pierwszej wersji import należy ograniczyć do ogłoszeń warszawskich instytucji; wykonawcy mogą pochodzić z całej Polski. Dane z TED oraz automatyczne wzbogacanie profili z KRS są planowane jako kolejne źródła.

Źródło: [materiały integracyjne e‑Zamówień](https://ezamowienia.gov.pl/pl/integracja/). Zakres i format danych należy weryfikować z aktualną instrukcją API przed włączeniem importu produkcyjnego.

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
