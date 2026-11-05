# 💞 Zweisam

Eine kleine Motivations-App für zwei: Uni-Zeit und Haushalt tracken, Supplements abhaken, Serien (Streaks) aufbauen und euch gegenseitig Belohnungen einrichten, die erst freigeschaltet werden, wenn die andere Person ihr Ziel schafft.

**Was drin ist**
- 📚 Uni- und 🧺 Haushalt-Zeit pro Tag, per Schnellbutton (+15/+30/+60), genauer Eingabe oder **Timer**
- 💊 Eigene Supplements (wie oft am Tag, an welchen Wochentagen) zum Abhaken
- 🔥 Serien für Uni, Haushalt und Supplements (Tagesziele stellt jede:r selbst ein)
- 🎯 Gemeinsames Wochenziel mit zweifarbigem Fortschrittsbalken
- 🎁 Belohnungen mit geheimem Text und/oder Bild – z. B. „3 Tage in Folge mind. 5 h Uni“ → „Ich koche dir was“. Der Inhalt bleibt verborgen, bis die Bedingung erfüllt ist, dann gibt's Konfetti
- 💌 Pinnwand mit Nachrichten, Bildern, Herzchen, „Anstupsen“ & High Five; das neueste Bild/die neueste Nachricht erscheint oben auf der Startseite
- 📱 Installierbar als App auf dem Handy, Dark Mode, funktioniert auch kurz offline

Kosten: **0 €** – GitHub Pages ist gratis, Firebase läuft im kostenlosen „Spark“-Tarif. Bilder werden auf dem Handy verkleinert und direkt in der Datenbank gespeichert, dafür wird kein (kostenpflichtiges) Firebase Storage gebraucht.

---

## Einrichtung (ca. 15 Minuten)

### 1. Firebase-Projekt vorbereiten
1. Öffne <https://console.firebase.google.com> und wähle dein Projekt (oder „Projekt hinzufügen“).
2. **Web-App anlegen:** Projektübersicht → Symbol **`</>`** („Web“) → Namen eingeben (z. B. „Zweisam“) → *Firebase Hosting nicht anhaken* → „App registrieren“.
3. Es erscheint ein Codeblock mit `const firebaseConfig = { … }`. **Diese Werte kopieren** und in **`js/config.js`** an die Stelle der Platzhalter einfügen.
   *(Später findest du sie unter ⚙️ Projekteinstellungen → „Allgemein“ → ganz unten bei „Meine Apps“.)*
4. **Login aktivieren:** Build → **Authentication** → „Jetzt starten“ → Tab **Anmeldemethode** → **E-Mail/Passwort** → aktivieren → Speichern.
5. **Datenbank anlegen:** Build → **Firestore Database** → „Datenbank erstellen“ → Standort **`europe-west3 (Frankfurt)`** → **Produktionsmodus** → Erstellen.
6. **Sicherheitsregeln einfügen:** Firestore Database → Tab **Regeln** → alles löschen → kompletten Inhalt der Datei **`firestore.rules`** einfügen → **Veröffentlichen**.

> Die Werte in `config.js` sind keine Geheimnisse – das ist bei Firebase normal und gewollt. Geschützt werden eure Daten durch die Regeln aus Schritt 6: Nur ihr zwei könnt euren Raum lesen und beschreiben.

### 2. Auf GitHub veröffentlichen
1. Auf <https://github.com/new> ein neues Repository anlegen (z. B. `zweisam`, *Public* – bei kostenlosen Konten braucht GitHub Pages ein öffentliches Repo. Eure Daten liegen trotzdem geschützt in Firebase, im Repo steht nur der Code).
2. „uploading an existing file“ → **alle Dateien und Ordner** aus diesem Paket hineinziehen (so, dass `index.html` ganz oben liegt) → „Commit changes“.
3. Im Repo: **Settings → Pages** → bei *Source* „Deploy from a branch“ → Branch **`main`**, Ordner **`/ (root)`** → Save.
4. Nach 1–2 Minuten ist die Seite erreichbar unter `https://DEIN-GITHUB-NAME.github.io/zweisam/`.

### 3. Domain in Firebase freigeben (wichtig!)
Firebase → Authentication → Tab **Einstellungen** → **Autorisierte Domains** → „Domain hinzufügen“ → **`DEIN-GITHUB-NAME.github.io`** (ohne `https://` und ohne `/zweisam`).

### 4. Loslegen
1. Beide öffnen den Link und **registrieren** sich mit E-Mail + Passwort.
2. Eine:r tippt auf **„Neuen Raum erstellen“** – oben erscheint ein Code (auch unter Einstellungen).
3. Die andere Person gibt den Code bei **„Beitreten“** ein. Fertig 💞
4. In den Einstellungen (Regler-Symbol oben rechts) eigene Tagesziele und das gemeinsame Wochenziel festlegen.

### 5. Als App aufs Handy
- **iPhone:** Link in **Safari** öffnen → unten „Teilen“ (□↑) → **„Zum Home-Bildschirm“**.
- **Android:** Link in **Chrome** öffnen → Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“.

---

## So funktionieren Serien & Belohnungen
- Ein Tag zählt für die Serie, wenn das **Tagesziel** erreicht ist (Uni/Haushalt) bzw. **alle fälligen Supplements** abgehakt sind. Tage, an denen keine Supplements fällig sind, unterbrechen die Serie nicht.
- Ist heute noch nicht geschafft, bleibt die Serie von gestern stehen – erst wenn ein Tag komplett verpasst wurde, fängt sie neu an.
- Bei Belohnungen zählen nur Tage **ab dem Erstellen**. Sobald die Bedingung erfüllt ist, schaltet die App die Belohnung automatisch frei und zeigt sie mit Konfetti an.
- Titel und Bedingung sieht die andere Person schon vorher (als Ansporn), Text und Bild erst nach dem Freischalten.
- Vergangene Tage könnt ihr über die Pfeile oben nachtragen.

## Fragen & Lösungen
| Problem | Lösung |
|---|---|
| „Fast fertig 🔧“ wird angezeigt | `js/config.js` ist noch nicht ausgefüllt. |
| „Domain nicht freigegeben“ beim Login | Schritt 3 vergessen. |
| „E-Mail-Login nicht aktiviert“ | Schritt 1.4 vergessen. |
| „permission-denied“ / Raum erstellen klappt nicht | Regeln aus `firestore.rules` nicht veröffentlicht (Schritt 1.6). |
| Änderungen am Code kommen nicht an | In `sw.js` die Zeile `zweisam-v1` auf `v2` usw. hochzählen, dann App einmal schließen und neu öffnen. |

**Homescreen-Widgets** sind mit einer Web-App leider nicht möglich (iOS und Android erlauben Widgets nur für native Apps). Als Ersatz zeigt die Startseite ganz oben das neueste Bild/die neueste Nachricht deines Schatzes, und das App-Icon bekommt bei neuen Pinnwand-Beiträgen eine Zahl (wo das Handy das unterstützt).

## Optional: zusätzlich absichern
In der Google Cloud Console (APIs & Dienste → Anmeldedaten) lässt sich der API-Schlüssel auf eure Domain `DEIN-GITHUB-NAME.github.io/*` beschränken. Nicht nötig, aber eine nette Extra-Sicherung.

## Dateien
```
index.html            Grundgerüst
css/style.css         Design
js/app.js             Die App (Logik, Ansichten, Firebase)
js/util.js            Helfer (Datum, Bilder verkleinern, Konfetti)
js/config.js          ← hier deine Firebase-Werte eintragen
firestore.rules       ← Sicherheitsregeln für Firebase
manifest.webmanifest  App-Infos fürs Handy
sw.js                 Offline-Unterstützung
icons/                App-Icons
```
