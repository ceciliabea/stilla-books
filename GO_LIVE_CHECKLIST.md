# Stilla Books — checklista inför go live

## Klart i repot

- [x] Tre bokstatusar, flera samtidiga Läser och valbar huvudbok
- [x] Omdömen, hyllningsdialog och överhoppningsbar fråga
- [x] Arkivering och återställning
- [x] Extern boksökning, dubblettkontroll och hämtning av kortare bokbeskrivning
- [x] Frivilligt läsmål som följer aktuellt kalenderår
- [x] Google OAuth med `drive.file`, Google Picker och Sheets-synk
- [x] Återanslutning efter omladdning och omläsning när appfönstret åter får fokus
- [x] Funktionell utloggning
- [x] Automatiska tester, lint och produktionsbygge i GitHub Actions
- [x] Grundläggande tangentbordsfokus, hoppa-till-innehåll och reducerad rörelse
- [x] Utkast till integritets- och villkorssidor
- [x] Nya produktionsanvändare får ett tomt bibliotek och inget förvalt läsmål

## Behöver göras av Cecilia

- [ ] Granska `public/privacy.html` och `public/terms.html`, särskilt kontaktadress och formuleringar
- [ ] Kontrollera OAuth-klientens Authorized JavaScript origins:
  - `http://localhost:5173`
  - `https://ceciliabea.github.io`
- [ ] Efter första publiceringen ange dessa Google Auth-länkar:
  - Startsida: `https://ceciliabea.github.io/stilla-books/`
  - Integritet: `https://ceciliabea.github.io/stilla-books/privacy.html`
  - Villkor: `https://ceciliabea.github.io/stilla-books/terms.html`
- [ ] Kontrollera appnamn, supportmejl och kontaktmejl i Google Auth Platform
- [ ] Bestäm när Google OAuth ska flyttas från Testing till In production
- [ ] Godkänn första commit och push till `main`
- [ ] Aktivera GitHub Pages med GitHub Actions som källa
- [ ] Testa den publicerade appen i en ny webbläsare och på mobil
- [ ] Testa både Skapa mitt ark och Anslut befintligt med ett nytt Google-konto
- [ ] Kontrollera ett urval svenska boksökningar och omslag

## Permanent anti-princip

Gamification är inte backlog eller framtidsplan. Poäng, badges, streaks,
tävlingar, jämförelser och prestationsdrivande belöningar ska inte byggas.
