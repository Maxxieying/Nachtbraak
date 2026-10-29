# Nachtbraak

Studentenapp met anytimers (en straks drankspellen, streeplijst, huisgenoten en Wrapped). Dit is de eerste versie: groepen, anytimers, alarm, stopwatch, ranglijst, uitstel met stemming en vijf talen (Nederlands, Engels, Spaans, Duits, Italiaans).

## Eerst proberen zonder opzet

Zolang `config.js` leeg is, draait de app in demo-modus. Alles blijft op je eigen apparaat en de andere groepsleden zijn nep. Open `index.html` via een webserver, of ga na stap 6 naar je Vercel-link. Met de knop "Demo: Sam → jij" bovenaan krijg je direct een alarm.

## Opzetten in 6 stappen (ongeveer 30 minuten)

Alle diensten zijn gratis voor dit gebruik en je kunt overal inloggen met je GitHub-account.

### Stap 1. De code op GitHub zetten

1. Ga naar github.com, klik op **New repository** en noem hem `nachtbraak`.
2. Klik op **uploading an existing file** en sleep alle bestanden en mappen uit de map `nachtbraak` erin. Zet het bestand `GEHEIM-nachtbraak-sleutels.txt` hier niet bij.
3. Klik op **Commit changes**.

### Stap 2. De database maken (Supabase)

1. Ga naar supabase.com en log in met GitHub. Klik op **New project**, kies een naam, een wachtwoord (bewaar dat) en als regio **Frankfurt** of een andere regio in de EU.
2. Ga naar **Authentication**, dan **Sign In / Providers**, en zet **Allow anonymous sign-ins** aan. Hierdoor hoeven gebruikers alleen een naam in te vullen.
3. Ga naar **SQL Editor** en klik op **New query**. Open `supabase/schema.sql`, kopieer alles, plak het erin en klik op **Run**. Je ziet "Success".

### Stap 3. De alarmfunctie plaatsen

1. Ga in Supabase naar **Edge Functions** en klik op **Deploy a new function**, dan **Via Editor**.
2. Noem de functie `tick` (precies zo). Wis de voorbeeldcode, plak de inhoud van `supabase/functions/tick/index.ts` erin en klik op **Deploy**.
3. Open de functie, ga naar de instellingen en zet **Enforce JWT verification** uit. De functie beschermt zichzelf met een eigen geheim.
4. Ga naar **Edge Functions**, dan **Secrets**, en voeg vier secrets toe. De waarden staan in `GEHEIM-nachtbraak-sleutels.txt`:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `CRON_SECRET`
   - `VAPID_SUBJECT` met de waarde `mailto:jouw@emailadres.nl`

### Stap 4. De wekker elke minuut laten tikken

1. Open `supabase/cron.sql` en vervang `JOUW_PROJECT_REF` door het stuk voor `.supabase.co` in je Project URL. Vervang `JOUW_CRON_SECRET` door dezelfde `CRON_SECRET` als bij stap 3.
2. Plak het in de **SQL Editor** en klik op **Run**.
3. Controleer na een paar minuten bij **Edge Functions**, dan `tick`, dan **Logs**, of er elke minuut een aanroep staat.

### Stap 5. Je gegevens invullen in config.js

1. Haal in Supabase onder **Project Settings**, dan **API**, de **Project URL** en de **anon public key** op. Bij nieuwere projecten heet die key **publishable key**. Beide werken.
2. Klik op GitHub op `config.js`, dan op het potlood, en vul in:
   - `SUPABASE_URL`: de Project URL
   - `SUPABASE_ANON_KEY`: de anon of publishable key
   - `VAPID_PUBLIC_KEY`: de publieke sleutel uit `GEHEIM-nachtbraak-sleutels.txt`
3. Klik op **Commit changes**. Deze drie waarden zijn bedoeld om openbaar te zijn.

### Stap 6. Online zetten (Vercel)

1. Ga naar vercel.com en log in met GitHub.
2. Klik op **Add New**, dan **Project**, en importeer `nachtbraak`.
3. Laat alles staan, zet bij **Framework Preset** `Other` en klik op **Deploy**.
4. Je krijgt een link zoals `nachtbraak.vercel.app`. Deel die met je vrienden.

## Testen

1. Open de link op je telefoon en vul je naam in.
2. **iPhone:** tik op Delen, dan **Zet op beginscherm**, en open de app vanaf het beginscherm. Zonder dit werken meldingen niet.
3. Ga naar Instellingen en tik op **Meldingen aanzetten**.
4. Maak een groep, deel de code of de uitnodiglink, en laat een vriend meedoen.
5. Zet een anytimer op die vriend met "Over 1 min". Binnen een minuut krijgt hij een melding en een alarmscherm.

## Hoe de regels werken

- De stopwatch start op het moment dat het alarm echt afgaat en stopt bij "Gedaan". Iedereen in de groep ziet de tijd.
- De ranglijst toont de snelste tijd bovenaan. Elke volbrachte anytimer staat erin, met het bewijs.
- **Uitstellen zonder reden:** de straf geldt direct. De tijd loopt door. De anytimer gaat opnieuw af na de uitsteltijd die de maker koos.
- **Uitstellen met reden:** de rest van de groep stemt. Meer dan de helft moet akkoord zijn, bij gelijkspel wordt het afgewezen. Bij goedkeuring is er geen straf en telt de uitsteltijd niet mee voor de stopwatch. Bij afwijzing geldt de straf.
- **Alarmvenster:** de ontvanger bepaalt zelf per dag wanneer anytimers mogen afgaan. Valt het moment erbuiten, dan gaat hij af zodra het venster begint.
- **Verlopen:** de maker kiest na hoeveel tijd een anytimer vervalt. Verlopen anytimers staan onder "Niet gedaan".

## Goed om te weten

- Een webapp kan geen echt alarm afspelen zoals de wekker van je telefoon. Je krijgt een pushmelding met geluid en trilling. Op iPhone volgt die de stille modus en focusstanden. Een echt alarm kan pas in een app voor de App Store en Play Store.
- Er is geen inlogwachtwoord. Wie de browsergegevens wist of een nieuwe telefoon neemt, begint opnieuw met een nieuw profiel.
- Bewijsfoto's en video's staan in een openbare map, maar met een onraadbare bestandsnaam. Alleen mensen met de link zien ze.
- Een stemming blijft openstaan tot genoeg groepsleden gestemd hebben.
- Het bestand `GEHEIM-nachtbraak-sleutels.txt` bevat de privésleutel. Zet die nooit op GitHub.

## Nog niet gebouwd

Drankspellen, streeplijst, huisgenoten en Wrapped.
