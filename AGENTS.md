# Stilla Books — beslutad produktplan för v1

## Uppdrag

Bygg en lugn, privat bokapp där användaren håller ordning på böcker hen vill läsa, läser och har läst.

Appen ska stödja extern boksökning, bokomslag och kort bokinformation, flera samtidiga pågående böcker samt enkla omdömen. Varje användare loggar in med sitt eget Google-konto och använder ett eget Google Sheet som datakälla.

Första versionen ska publiceras som en publik statisk webbapp på GitHub Pages. Appen har ingen egen backend.

## Bindande kreativ riktning

Stilla Books ska kännas som att öppna en ny anteckningsbok en tidig sommarmorgon på landet. Det är en lugn plats för läsning, berättelser och eftertanke — inte en produktivitetsapp, ett socialt nätverk, en dashboard eller ett gamification-system.

Gamification är en permanent anti-princip, inte en funktion som väntar på en senare version. Poäng, badges, streaks, tävlingar och prestationsdrivande belöningar ska inte byggas.

Ledord:

- Lugn
- Luft
- Linjer
- Berättelser

Designfrågan som avgör osäkra beslut är: **Gör detta appen lugnare?** Om svaret är nej ska elementet förenklas eller tas bort.

### Visuellt språk

- Bakgrund: Warm White `#FAF8F3`, alternativt Soft Paper `#F6F3ED`
- Text: Dark Charcoal `#2E2E2C`
- Sekundär text: Warm Grey `#8C867E`
- Accent: Soft Sage `#A8B69A`
- Sparsam detalj/progress: Champagne Gold `#C8A96A`
- Rubriker: Cormorant Garamond eller Newsreader, lätt och litterär
- Brödtext/UI: Inter eller Manrope, ren och diskret
- Mycket whitespace, låg visuell densitet, mjuka hörn och nästan inga skuggor
- Illustrationer och ikoner ska vara tunn, konsekvent line art med lätt handritad känsla
- Ingen glasmorfism, inga fyllda ikoner och inga stora accentytor
- Bokomslag ska i första hand motsvara språket användaren läst eller tänker läsa boken på, oftast svenska
- Ett snyggt och korrekt omslag på ett annat språk är tillåtet när ett passande svenskt omslag saknas
- Använd aldrig katalogbilder märkta exempelvis ”cover to be revealed”, uppenbart felaktiga utgåvor eller lågkvalitativa omslag
- Stillas illustrerade placeholder används endast när inget visuellt acceptabelt, korrekt omslag finns

### Den kontinuerliga linjen

En tunn, svagt organisk linje löper högst upp i appen och övergår i en liten line art-bok längst till höger.

- Utan läsmål är linjen en ren identitetsbärare.
- Med ett frivilligt läsmål fylls den diskret utifrån antal färdiglästa böcker under kalenderåret.
- Ifyllnaden använder ett tunt guldskimmer eller en mjuk salviaton.
- Linjen ska kännas som att någon dragit pennan lite längre, aldrig som en konventionell progressbar.
- En liten text som ”7 av 12 böcker” får visas men får inte dominera.

### Rörelse

- Linjen ritas upp vid öppning på cirka 300–500 ms
- Hover-effekter är diskreta och högst 150–200 ms
- Ingen studs eller elasticitet
- Markering som läst får en antydan till sidvändning eller ett bokmärke som landar
- Rörelse ska kännas snarare än synas
- Reducerad rörelse ska respekteras

### Emotionell målbild

Användaren ska känna att hen öppnar en plats, inte ett verktyg: en ny bok, första raden i en anteckningsbok, en brygga en stilla sommarkväll, vind genom vass eller några sidor före läggdags.

## Beslutad teknisk riktning

- React med TypeScript
- Tailwind CSS
- shadcn/ui som komponentgrund, varsamt anpassad till Stillas uttryck
- Responsiv webbapp med mobil användning som förstklassigt användningsfall
- Statisk publicering på GitHub Pages utan egen backend
- Google-inloggning och Google Sheets-åtkomst direkt från webbläsaren med användarens behörighet
- Användaren kan skapa ett nytt standardiserat Stilla Books-ark eller ansluta ett befintligt
- Extern bokkatalog används för sökning efter titel eller författare
- Inga service account-nycklar, klienthemligheter eller privata dokument får finnas i repot eller levereras till webbläsaren

Den separata ChatGPT-chatten ska kunna läsa och uppdatera samma Google Sheet när användaren har gett den åtkomst.

## Informationsarkitektur

### Min läsning

Startsidan innehåller:

1. Den kontinuerliga topplinjen och eventuell årsprogress.
2. En framhävd pågående bok.
3. Övriga pågående böcker i en mindre, tydligt synlig samling.
4. Ett lugnt urval från Vill läsa.
5. En diskret väg vidare till hela biblioteket.

Flera böcker får ha statusen Läser samtidigt. Den senast startade blir automatiskt huvudbok, men användaren kan välja en annan pågående bok som huvudbok.

### Biblioteket

Biblioteket har tre vyer:

- Vill läsa
- Läser
- Läst

Användaren kan söka i det egna biblioteket efter titel, författare och genre.

En bok öppnas i en panel ovanpå biblioteket, inte på en egen sida. Panelen innehåller omslag, titel, författare, en mycket kort beskrivning, genre, status, eventuellt omdöme och relevanta åtgärder.

### Lägg till bok

Användaren börjar skriva titel eller författare och får externa sökresultat med:

- omslag
- titel
- författare
- kort beskrivning
- genre när uppgiften finns

Efter val kan boken läggas till som Vill läsa eller Läser.

### Inställningar

Inställningar innehåller:

- anslutet Google Sheet
- möjlighet att byta eller ansluta ark
- frivilligt läsmål för innevarande kalenderår

## Beslutade användarflöden

### Första användningen

1. Användaren loggar in med sitt Google-konto.
2. Användaren väljer **Skapa mitt Stilla Books-ark** eller **Anslut ett befintligt ark**.
3. Ett nytt ark skapas med rätt struktur.
4. Ett befintligt ark kontrolleras innan strukturella förändringar föreslås eller görs.
5. Arkets ID kan sparas lokalt i användarens webbläsare; bokdata ligger i användarens Sheet.

### Markera som läst

1. Boken får statusen Läst och ett slutdatum.
2. En mycket diskret hyllningsanimation visas.
3. En kort, varm text visas, exempelvis: ”Ännu en berättelse att bära med sig.”
4. Upplevelsen övergår till frågan: ”Hur kändes den?”
5. Användaren kan välja:
   - tumme ner: Inte för mig
   - tumme upp: Tyckte om
   - hjärta: Älskade
6. Frågan kan hoppas över utan uppgift, varning eller påminnelse.
7. Omdömet kan ändras senare i bokpanelen.

Omdömen används endast för lästa böcker.

### Ta bort från biblioteket

- Åtgärden heter **Ta bort från mitt bibliotek**.
- Användaren får en enkel bekräftelse.
- Boken arkiveras i datakällan i stället för att raden raderas permanent.
- Arkiverade böcker visas inte i det vanliga biblioteket men kan återställas senare.

### Årets läsmål

- Målet är frivilligt.
- Målet följer kalenderåret januari–december.
- Progress räknas från böcker med slutdatum under året.
- Utan mål visar topplinjen ingen progress.
- Det finns ingen sid- eller procentprogress för enskilda böcker.

## Föreslagen datamodell

En rad per bok med ett stabilt internt ID:

| Fält | Innehåll |
| --- | --- |
| `id` | Stabilt internt ID |
| `externalId` | ID från den externa bokkatalogen |
| `title` | Titel |
| `authors` | En eller flera författare |
| `coverUrl` | Omslagsbild |
| `description` | Mycket kort beskrivning |
| `genres` | En eller flera genrer |
| `language` | Språket för den utgåva användaren läser eller vill läsa |
| `status` | `want_to_read`, `reading` eller `read` |
| `feedback` | tomt, `not_for_me`, `liked` eller `loved` |
| `isFeaturedReading` | Anger om boken har huvudplatsen |
| `archived` | Ja/nej |
| `startedAt` | När boken markerades som Läser |
| `finishedAt` | När boken markerades som Läst |
| `createdAt` | När posten skapades |
| `updatedAt` | Senaste ändring |

En separat inställningsyta i arket lagrar frivilligt läsmål per kalenderår.

## Genomförandeplan

### Etapp 1 — Flödes- och layoutplanering

- Gör textbaserade skisser för Min läsning, Biblioteket, bokpanelen, Lägg till bok och första användningen
- Bestäm navigation på mobil och desktop
- Bestäm tomlägen, laddningstillstånd och felmeddelanden
- Kontrollera att varje vy följer Creative Direction

### Etapp 2 — Grund och visuell prototyp

- Sätt upp React, TypeScript och Tailwind
- Lägg till shadcn-kompatibla grundkomponenter och design tokens
- Implementera typografi, papperspalett och topplinje
- Skapa responsiv navigation och realistisk svensk demonstrationsdata
- Bygg Min läsning, Biblioteket, bokpanelen och Lägg till bok

### Etapp 3 — Kärnflöden

- Implementera sökning och statusfilter i biblioteket
- Implementera extern sökning efter titel och författare
- Implementera tillägg som Vill läsa eller Läser
- Implementera statusbyten, flera pågående böcker och val av huvudbok
- Implementera hyllningsanimation och överhoppningsbar omdömesfråga
- Implementera de tre omdömena
- Implementera arkivering med bekräftelse
- Implementera frivilligt läsmål

### Etapp 4 — Google och beständig data

- Definiera arkets flikar, kolumner och valideringsregler
- Implementera säker Google-inloggning för en statisk klientapp
- Implementera skapa nytt ark och anslut befintligt ark
- Implementera läsning, skapande, uppdatering och arkivering av bokrader
- Hantera fel och optimistiska uppdateringar utan att störa den lugna känslan
- Dokumentera Google-konfiguration och arkstruktur

### Etapp 5 — Förfining och publicering

- Lägg till beslutade diskreta övergångar
- Säkerställ responsivitet, tangentbordsstöd, kontrast och reducerad rörelse
- Genomför visuell kvalitetskontroll mot Creative Direction
- Publicera den statiska appen på GitHub Pages

## Acceptanskriterier för v1

- Alla tre statusar fungerar och flera böcker kan vara Läser samtidigt
- Senast påbörjad bok blir huvudbok och kan bytas manuellt
- Övriga pågående böcker syns på startsidan
- Extern sökning hittar böcker via titel eller författare
- Sökning i biblioteket hittar titel, författare och genre
- Bokinformation visas i en panel ovanpå biblioteket
- Omdömena Inte för mig, Tyckte om och Älskade kan sättas, hoppas över och ändras
- Markera som läst visar en diskret hyllning före omdömesfrågan
- Ta bort från mitt bibliotek arkiverar boken efter bekräftelse
- Frivilligt kalenderårsmål fungerar som en lågmäld reflektion utan poäng, belöningar eller prestationsspråk
- Varje användare kan skapa eller ansluta ett eget Google Sheet
- Mobil och desktop känns som samma lugna produkt
- Inga privata nycklar eller klienthemligheter exponeras
- Designen följer palett, typografi, whitespace, line art och rörelseprinciper

## Utanför v1

- AI-baserade bokrekommendationer
- Texten ”Varför boken kan passa dig”
- Swipe-flöde
- Permanent lista över avvisade rekommendationer
- Statistik, grafer och Läsåret-sida
- Sidnummer eller procentprogress för enskilda böcker
- Re-read
- Sociala funktioner
- Egen backend

## Permanent avgränsning

Följande hör uttryckligen inte hemma i Stilla Books och ska inte föreslås som framtida utveckling:

- Gamification
- Poäng och nivåer
- Badges
- Streaks
- Tävlingar och jämförelser
- Prestationsdrivande mål eller belöningar

## Arbetsregler för agenter

- Läs denna fil före implementation.
- Bevara Creative Direction även när standardkomponenter används.
- Lägg inte till funktioner från avsnittet Utanför v1.
- Behandla den permanenta avgränsningen som en anti-princip, inte som en framtida backlog.
- Introducera inte nya stora funktioner utan uttryckligt beslut.
- Använd realistiska svenska texter i gränssnittet.
- Publiceringsmålet för v1 är GitHub Pages.
- Hemligheter, Google-uppgifter och privata dokument får aldrig checkas in.
