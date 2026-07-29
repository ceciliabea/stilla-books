# Stilla Books

En lugn, privat läsplats byggd med React, TypeScript, Tailwind och shadcn-kompatibla komponenter.

## Lokal utveckling

```sh
npm install
npm run dev
```

Produktionsbygge:

```sh
npm run lint
npm test
npm run build
```

## Google Sheets

Appen använder klientbaserad Google OAuth, Google Picker, Google Sheets API och Google Books API. Aktivera Google Sheets API, Google Drive API, Google Picker API och Google Books API i Google Cloud. Lägg den publika webbkonfigurationen i en lokal `.env`:

```text
VITE_GOOGLE_CLIENT_ID=...
VITE_GOOGLE_API_KEY=...
VITE_GOOGLE_APP_ID=...
```

`VITE_GOOGLE_APP_ID` är projektets numeriska Project number. API-nyckeln ska begränsas till Google Picker API och Google Books API samt appens tillåtna webbplatser.

Ingen klienthemlighet ska användas eller checkas in. För GitHub Pages anges samma tre värden som repository variables.

Appen begär endast OAuth-behörigheten `drive.file`. Ett nytt Stilla Books-ark får flikarna `Books` och `Settings`. Efter anslutning läses biblioteket från arket och ändringar sparas tillbaka automatiskt. Webbläsarens lokala lagring fungerar som en lokal kopia och minns vilket ark användaren har valt.

När appen åter får fokus läses arket om, så att ändringar från exempelvis en separat ChatGPT-chatt kan hämtas in. Efter en omladdning behöver användaren aktivt återansluta Google; åtkomsttoken sparas inte permanent i webbläsaren.

## Bokkataloger och omslag

Libris är den ledande källan för svenska titlar, utgåvor, ISBN, förlag,
utgivningsår, översättare och ämnesord. Google Books används endast för
ISBN-matchade omslagsförslag och visas med Google-attribution och länk till
källposten. Open Library är reservkälla för omslag. När Libris saknar
beskrivning får Google Books användas som reserv endast vid exakt ISBN-matchning
och samma språk som Libris-utgåvan. Källan visas diskret i bokpanelen.

Manuellt redigerade metadatafält markeras i arket och skrivs inte över av en
senare Libris-uppdatering. Ett valt omslag ändras aldrig när bokinformationen
uppdateras.

## Tester

Vitest täcker centrala statusbyten, dubblettkontroll, konverteringen mellan bokdata och kalkylarksrader samt att rätt status och läsmål skickas till Sheets. GitHub Actions kör lint, tester och produktionsbygge före publicering.

`public/privacy.html` och `public/terms.html` innehåller utkast till de offentliga sidor som länkas från appens sidfot. Kontaktuppgifter och texter ska granskas före publicering.

## Publicering

Workflow-filen i `.github/workflows/deploy-pages.yml` bygger och publicerar `dist` på GitHub Pages när `main` uppdateras. GitHub Pages behöver vara inställt på **GitHub Actions** som källa.
