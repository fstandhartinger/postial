## [offen] socialmint — LinkedIn Community Management API (09.09.2026)
Was: Manueller Antragsentwurf, noch nichts eingereicht. LinkedIn Developer Portal → App „SocialMint“ → Products → „Community Management API“ → Development-Zugang beantragen. Nach Integration dort Standard beantragen.

Benötigt: Company Page der rechtlichen Betreiberin, durch deren Super-Admin verifizierte App, verifizierbare geschäftliche E-Mail, Firmenname/-adresse, Website und Datenschutz-URL https://socialmint.app.mintapis.com/privacy. Die konkrete Company-Page-URL muss Florian ergänzen.

Use-case-Entwurf: “SocialMint helps agencies prepare and schedule posts for client organization Pages. An authorized Page administrator connects the Page through OAuth. Clients review drafts through private approval links; approved posts are published on the connected organization’s behalf. The agency sees publication status and errors. We do not read unrelated private messages.” Dies beschreibt den vorgesehenen LinkedIn-Ausbau, keinen bereits funktionsfähigen Adapter.

Video/Screenshots: OAuth-Zustimmung, Page-Auswahl, Entwurf, Kundenfreigabe und echter Page-Post mit Status. Für Standard ein herunterladbares hochauflösendes Video und Reviewer-Testzugang vorbereiten. Fehlende Kommentar-/Profildatenansichten im Video ausdrücklich benennen. Screenshots allein ersetzen das geforderte Video nicht. Der funktionierende LinkedIn-Flow fehlt noch; aktuelle Marketing-Screenshots sind kein Integrationsnachweis.

Zugriff: Development zum Bauen/Testen, Standard separat für Produktion. Standard erst nach vollständiger Integration beantragen; Freigabe ist nicht garantiert.

Wartezeit laut geprüfter Doku: Die App-Review-Seite nennt keine feste Bearbeitungsdauer oder Zusage. Keine Wochenzahl versprechen. Die zwölf Monate im Access-Dokument sind die Frist für Integration/Test nach Development-Freigabe, keine Review-Wartezeit.

Technik für die spätere Implementierung:
- Redirect-URI: `https://socialmint.app.mintapis.com/api/oauth/linkedin/callback` (vorgesehen; Route noch nicht implementiert).
- Scopes: `w_organization_social` (Organisationsposts), `r_organization_social` (Posts/Ergebnis lesen), `rw_organization_admin` (Page-Verwaltung/Rollen). Nur benötigte Funktionen im Antrag begründen; API-Freigabe ersetzt nicht die passende Rolle des zustimmenden Page-Mitglieds.
- Env-Namen: `SOCIALMINT_LINKEDIN_CLIENT_ID`, `SOCIALMINT_LINKEDIN_CLIENT_SECRET`.

Wohin: Nach manueller Anlage Werte unter diesen Namen in `~/.config/dev-secrets.env`, bestehende Einträge erhalten. Nur App-/Page-ID, Status und Variablennamen an den Orchestrator melden. Dieser übernimmt Deployment und Implementierung. Keine Secrets in HANDOFFS, Screenshots oder Git.

Warum: LinkedIn ist geplant und hängt an Plattformprüfung plus Implementierung. Kein Produktionsdatum zugesagt, kein Antrag und kein Login automatisiert.

Quellen, öffentlich gelesen am 09.09.2026 UTC:
- [LinkedIn Community Management App Review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review?view=li-lms-2026-02), Dokumentstand 11.02.2026: Antragsangaben, Page-Verifizierung, Development/Standard, Screencast. Keine feste Reviewfrist genannt.
- [LinkedIn Increasing Access](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-01), Dokumentstand 17.08.2026: Zugangsweg, Scopes, Rollen und zwölfmonatige Development-Integrationsfrist.
