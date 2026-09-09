# Prepared portal handoffs — 2026-09-09

Drafts only; the central HANDOFFS.md was not changed and no message was sent.

## [offen] socialmint — X Developer App fuer Kanalverbindung (2026-09-09)
Was: Im X Developer Portal/console.x.com eigenes Projekt, falls angeboten, und App `SocialMint` anlegen. Use case: Nutzer verbinden ihre eigenen Konten, erstellen/managen Markenbeitraege, geben diese frei und veroeffentlichen sie zeitgesteuert; kein Scraping, keine automatischen Replies/DMs.
- User authentication settings: OAuth 2.0 einschalten, Web App / Automated App (confidential client), Read and write. Scopes im Consent: `tweet.read tweet.write users.read offline.access media.write`.
- Callback URL exakt: https://socialmint.app.mintapis.com/api/oauth/x/callback
- Website: https://socialmint.app.mintapis.com
- Terms: https://socialmint.app.mintapis.com/terms
- Privacy: https://socialmint.app.mintapis.com/privacy
- Benoetigt werden OAuth 2 Client ID und Client Secret, keine OAuth-1-Consumer-Keys und kein App-only Bearer Token.
- Zugang/Kosten: Aktuelle offizielle Doku nennt Pay-per-use ohne Free/Basic/Pro-Abonnement. Schreiben $0.015/Post ohne URL, $0.200/Post mit URL; User-Read $0.010. Endpunktpreise in der Konsole gegenpruefen. Beispiel 100 Linkposts: $20 allein fuer Erstellung. Credits/Spending-Limit erst nach ausdruecklicher Budgetfreigabe setzen; keine automatische Aufladung aktivieren. Es besteht hier KEINE Kaufgenehmigung.
Wohin: Bestehende Eintraege in `~/.config/dev-secrets.env` erhalten; `SOCIALMINT_X_CLIENT_ID` und `SOCIALMINT_X_CLIENT_SECRET` eintragen. In Uebergaben nur Variablennamen und App-ID, keine Secrets. Orchestrator mappt sie auf `X_CLIENT_ID` und `X_CLIENT_SECRET` der Sandy-App `socialmint`, setzt `APP_URL=https://socialmint.app.mintapis.com` und migriert vor Neustart.
Warum: Ohne vollstaendiges Clientpaar zeigt SocialMint X als coming soon. Danach verbindet Florian ein freigegebenes QA-Konto manuell. Erst nach separater Freigabe fuer Kosten und Publikation einen Testpost senden und pruefen.
Quellen, geprueft 2026-09-09: https://docs.x.com/x-api/getting-started/pricing und https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code ; Details in docs/connect-x.md.

## [offen] socialmint — Meta Threads Developer App und Review (2026-09-09)
Was: developers.facebook.com → My Apps → Create App → Name `SocialMint`, Use case `Access the Threads API`. Wenn der alternative Dialog nach einem App-Typ fragt: Other/Business mit Threads-Use-Case waehlen; die konkrete aktuelle Auswahl im Portal gegenpruefen. Kein Instagram-/Facebook-Login-Client als Ersatz.
- App settings / Basic: Threads App ID und Threads App Secret sichern; Website https://socialmint.app.mintapis.com, App domain socialmint.app.mintapis.com.
- Threads API / Settings: Redirect URI exakt https://socialmint.app.mintapis.com/api/oauth/threads/callback
- Privacy https://socialmint.app.mintapis.com/privacy ; Terms https://socialmint.app.mintapis.com/terms.
- Data deletion instructions: https://socialmint.app.mintapis.com/privacy ; vor Review kontrollieren, dass dort tatsaechlich ein nachvollziehbarer Loeschweg/Kontakt steht, andernfalls eigene Instructions-Seite ergaenzen.
- Roles / Threads testers: persoenlich freigegebenes QA-Threads-Konto hinzufuegen; Einladung im Threads-Konto annehmen. Testnutzer-Konto selbst anlegen/anmelden, keine erfundenen Personendaten. App zunaechst in Development lassen.
- Permissions: `threads_basic` fuer Kontopruefung/Identitaet; `threads_content_publish` fuer freigegebene Posts. Fuer Kunden ohne App-Rolle Advanced Access/App Review beantragen, verlangte Business Verification abschliessen, danach Live schalten.
- Review-Text threads_basic: "SocialMint lets a user connect their own Threads account to a brand. We retrieve id and username to identify the account that will receive their posts and show the connected account to the user."
- Review-Text threads_content_publish: "The user writes a post, selects their connected Threads account and explicitly schedules publication. SocialMint creates the requested text or image/carousel container and publishes it at the chosen time. We do not publish unsolicited messages or replies."
- Screencast-Drehbuch: (1) SocialMint-Login, (2) Marke → Connect Threads, (3) kompletter Consent mit beiden Berechtigungen, (4) sichtbarer Kontoname, (5) Text und Bild/Carousel verfassen, (6) bewusste Freigabe/Terminwahl, (7) Worker-Ergebnis und derselbe Post in Threads, (8) Disconnect. Keine Secrets filmen. Reviewer-Testzugang in Metas privatem Review-Feld bereitstellen; Review-Schritte und erreichbare URLs dort wiederholen.
- Vor dem Screencast muessen Deployment, QA-Konto und echte Publikation separat freigegeben sein. Keine App-Review-Freigabe oder Testkonten wurden hier vorgetaeuscht.
Wohin: In `~/.config/dev-secrets.env` als `SOCIALMINT_THREADS_APP_ID` und `SOCIALMINT_THREADS_APP_SECRET`, bestehende Eintraege erhalten. Orchestrator mappt auf `THREADS_APP_ID` und `THREADS_APP_SECRET`, setzt APP_URL, migriert und deployt. Nur Status/App-ID/Variablennamen weitergeben; keine Tokens in Chats oder Git.
Warum: Ohne Clientpaar bleibt Threads coming soon; ohne Review bleibt Zugriff auf App-Rollen begrenzt. Long-lived Tokens werden verschluesselt gespeichert und vor Ablauf beim Publishing erneuert; nach >60 Tagen Inaktivitaet kann Reconnect erforderlich sein.
Quellen/Stand: docs/connect-threads.md, 2026-09-09. Direkte Meta-Doku lieferte 429; offizielle Meta-Postman-Referenz wurde verwendet. Portal-Auswahl und Review-Unterlagen bei manueller Anlage kontrollieren.

## Integration notes for the orchestrator

- Publisher contract adds optional `refreshCredentials(credentials): Promise<Credentials | null>`. The worker locks/re-reads the channel, refreshes and commits encrypted rotated tokens before publishing. Rejected refresh marks `token_expired`; overview offers Reconnect X/Threads.
- X/Threads have no supplied idempotency guarantee. Uncertain network/5xx results and interrupted attempts enter `needs_review`, just like Telegram, instead of automatically risking duplicates.
- OAuth state migration is generated after rebasing on main. Rebase again and regenerate if another cycle-5 schema migration lands before integration; do not reuse a conflicting migration number.
- The parallel Media owner controls `components/core/composer.tsx`. Its per-channel counter should consume exported `countChannelText(finalText, provider)` for X. This branch updates server validation and adapter counting and deliberately does not modify that concurrently owned component.
- OAuth connections currently require workspace owner role. Coordinate any admin/member connection permissions with the Team owner.
