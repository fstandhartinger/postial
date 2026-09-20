# Visitor statistics consent decision (decision record)

Status: **decided by the implementation worker of this slice (2026-09-20); independent review: PASS — change review `review-change-postial-r5s2c` (run postial-r5-0958c0d5), VERDICT PASS, model-verified openrouter/z-ai/glm-5.3-flash, reviewed patch sha256 28ab0528 plus only this review-status line.**
Not legal advice. The decision binds the sources named below to the code that is actually shipped in this
repository. It follows the assessed model of the Benchmark Heaven decision CR-67.5
(`/opt/model-market-comparison/ops/ux-2026-09-12/CR-67.5-CONSENT-DECISION.md`), adapted to the code here.

## 1. What is implemented (the facts the decision rests on)

Code: `lib/visit-stats.ts` (classification, thresholds), `lib/visit-counter.ts` (memory accumulator, flush,
retention), `proxy.ts` (single guarded synchronous call), `db/schema.ts` + `drizzle/0028_visit_daily.sql`
(table), `lib/visit-report.ts` (operator report; the handler factory and the auth contract are unchanged from
the prior slice). The beacon funnel and `app/api/operator/visits/route.ts` are untouched.

| Question | Answer from the shipped code |
|---|---|
| Storage on / active reading from the device | **None by the statistics pipeline.** No cookie, `localStorage`, `sessionStorage`, script, pixel, extra request, `Accept-CH`/client hint, ETag or link decoration is used for measurement. The counter runs only on the server, on the page request the browser already makes. (The separate functional storage is listed below.) |
| Data used per request (in memory, then discarded) | Method, URL path, `Sec-Fetch-Dest`/`Accept`/`Sec-Purpose`/`Purpose` (full page load, not a prefetch or file?), the `User-Agent` string (regex bot filter only, never stored), `Referer` (reduced to the host), `Sec-GPC`/`DNT` (objection), and the internal exclusion marker (`x-postial-internal` header value or `pm_internal` cookie compared against the marker). Several of these headers are optional and not sent with every request. **No IP address or forwarded-IP header is read by the statistics code.** |
| Internal exclusion | Requests with the configured internal token header, or with the `pm_internal` cookie whose value matches the token-derived marker, are not counted. The marker cookie (`HttpOnly`, `Secure`, 1 year) is set only for staff browsers that call `/api/internal/exclude-me` with the configured token; it is set for no other visitor. The statistics pipeline reads this one cookie for exclusion only; it stores nothing from it. |
| Identifiers | **None in the statistics pipeline.** No IP, no hash, no salt, no fingerprint, no session, no workspace or account reference. Consequence: unique visitors are **not** measured. |
| What is stored | Table `postial_visit_daily(day, path, referrer_host, views, visits)` — exactly five columns, daily totals only (migration `drizzle/0028_visit_daily.sql`). `path` carries no query string and is limited to known route shapes (anything else is one `(unknown route)` row, truncated to 3 segments and 160 characters); `referrer_host` is a host name without path or query, empty for direct and same-site loads. "views" = full-page document loads reaching the application server (RSC client navigations and prefetches are not visible to the proxy and are not counted); "visits" = page loads without a same-site referrer. |
| Where | The existing first-party application database, in its own table, joined with nothing. The database runs at the host named in the privacy policy and DPA Annex 3 — Hetzner (application data hosted in Germany) — which is the hosting processor. That is a **deployment fact, proven by evidence, not by code**: the code accepts whatever `DATABASE_URL` the deployment configures. No analytics vendor; the counter has no other integration. |
| Retention | Rows older than 13 months are deleted at least hourly while the server process runs (the delete runs with or without new traffic; failures are logged and retried on the next flush). Unwritten totals normally reach the database within ~60 s; if a write fails, the totals are kept in memory for at most the current and previous UTC day, then dropped. At most 5,000 distinct daily rows are held in memory; further new rows are skipped, also when a failed write is put back. |
| Output | `GET /api/operator/visits?days=N` (admin session required, otherwise 404; `no-store`, `noindex`): exact zero-filled daily totals, top pages and referring hosts ranked by views; rows with fewer than 3 views in the window, and everything beyond the top 25, fold into one conserved `(other)` row each, so the report does not name a page or referrer with a single visit. The report sets `uniques` to `null` with the reason in the response. The database itself holds exact daily rows (reachable only with the database credential). |
| Objection | Requests carrying `Sec-GPC: 1` or `DNT: 1` are not counted (checked per request). An email objection is offered; because the stored totals cannot be traced to a person, an email objection is answered with an explanation and the GPC/DNT route rather than a per-person deletion (stated as such on `/privacy`). |

**Scope of "no IP, no log rows":** this claim is about the statistics pipeline only. Postial's privacy policy
separately discloses operational server logs (IP address, request time, requested path, browser information,
response status) that exist for fault diagnosis and abuse prevention. Those logs stay as they are; they are not
part of the visitor statistics, and the statistics pipeline neither reads nor writes them.

**Existing browser storage (outside the statistics pipeline, checked for completeness):** the Auth.js session
and CSRF cookies (functional), the `sm_ws` workspace-selection cookie (functional), and the `pm_internal`
internal exclusion cookie (functional operator tool, described above). All hold state the visitor or operator
set or needs for the function they serve, and all are disclosed on `/privacy`. None of them is read for
measurement — `pm_internal` only triggers exclusion.

**Beacon funnel:** `components/marketing/ClientBeacon.tsx` fires once per page load and POSTs only the
server-rendered path to `/api/internal/client-ready`; it stores nothing on the device and reads nothing from it
beyond executing in the page that was loaded anyway. It records funnel events (selected views, product
milestones, conversions) with the coarse client class; the events store the server-known path, the referring
host and the event class, never a raw user agent, and milestones inside the product reference the workspace.
The beacon is assessed below under the same header-evaluation logic; it is a separate subsystem from the
counter and counts conversions, not visitors.

**Third parties:** the content security policy allows `connect-src 'self' https://api.stripe.com` — no
third-party analytics host can receive statistics. The statistics code makes no outbound request (no fetch,
beacon or send call exists in `lib/visit-stats.ts` or `lib/visit-counter.ts`).

## 2. Decision

**(a) No consent is required under § 25 TDDDG for this exact configuration, and no banner is added.**

- § 25(1) TDDDG covers *storing information on* or *accessing information stored in* the terminal equipment.
  The counter stores nothing and runs nothing on the device; it only evaluates HTTP headers of the page
  request the visitor's browser already sends. LfDI Baden-Württemberg (FAQ Cookies und Tracking, A.3.1) states
  that IP address and user agent sent automatically are not an "access" under § 25 and names local log
  analysis without third parties, data-minimal configuration and no merging of usage data as the model for
  consent-free reach measurement — this implementation is stricter in the statistics pipeline (no IP header is
  read, and no statistics log rows are written; the separately disclosed operational server logs are not part
  of the measurement).
- DSK *OH Digitale Dienste* v1.2 (Nov 2024) keeps active reading via JavaScript and server-side fingerprint
  hashes (Rn. 23–24) as access; neither happens here. Rn. 88 names incrementing a per-page counter on each
  page fetch ("bei jedem Abruf einer Seite den Zähler für diese Seite um Eins zu erhöhen") as the plain
  counting case.
- EDPB Guidelines 2/2023 v2.0 (paras. 43, 54–55) bring header/IP-based **tracking and fingerprinting** into
  Art. 5(3) ePD. No identifier is derived and no visitor is recognised or tracked across loads, which puts
  this counter outside those examples. This is why the daily IP+UA hash for unique visitors was **deliberately
  not built**, and why the report answers `uniques: null` with an explicit reason instead of estimating.
- **Residual uncertainty (stated, not hidden):** the EDPB reading of "access" is broad, and DSK v1.2 Rn. 89–90
  says reach measurement must be judged per configuration and is "nicht per se" part of the base service. The
  decision is therefore our documented assessment for exactly this configuration, and `/privacy` words it as
  "in our assessment". If a supervisory authority or court treats this header evaluation as access requiring
  consent, the fallback is to switch the counter off (remove the proxy call), not to add a banner.
- **Beacon:** the beacon POST is the header-evaluation-equivalent case — it adds a same-origin request from
  the page the visitor already loaded, sends only the server-known path, stores and reads nothing on the
  device. Under the same assessment it needs no consent; it is disclosed in the statistics section of
  `/privacy` together with the counter.

**(b) GDPR.** The persisted daily totals relate to no identifiable person. The transient processing of the
request headers inside one request lifecycle rests on Art. 6(1)(f) (own reach and capacity insight; no
profile, no third-party recipient, reasonable expectation), with Art. 13 information in the statistics section
of `/privacy` and an Art. 21 objection route: GPC/DNT signals are honored per request, and an email objection
is answered with an explanation — with the honest limitation that aggregates without identifiers cannot be
traced to a person, so a per-person deletion of stored totals is not possible (stated on `/privacy`).

## 3. Conditions that would reopen this decision

Adding any of the following makes the statistics consent-relevant or needs a new record: client-side script or
beacon for statistics beyond the assessed beacon, a cookie or device storage used for statistics, any
IP-derived or hashed key (unique visitors), `Accept-CH` or client hints, stored full referrer URLs or query
strings, an external analytics provider, joining statistics with accounts, workspaces or funnel events at
person level, counting that recognizes returning devices, retention longer than 13 months, or a court or
supervisory-authority decision that header evaluation of this kind requires consent. A change to the internal
exclusion semantics (for example excluding whole networks instead of marked browsers) also reopens the record.

## 4. Technical proof (for the verifier)

1. `node --import tsx --test-reporter=tap scripts/verify-visit-stats.ts` — classification matrix (GET-only,
   GPC/DNT, prefetch/prerender, document destination, bot user agents, internal markers, route shapes,
   referrer hosts) and the assertion that the classifier reads no `x-forwarded-for`/`x-real-ip`/
   `cf-connecting-ip`/`true-client-ip` header.
2. `VERIFY_ADMIN_DATABASE_URL=… node --import tsx --test-reporter=tap scripts/verify-visit-counter.ts` —
   real disposable-PG fixtures: five-column table check, accumulation across two UTC days, additive upsert on
   repeated flush, restore after a failed flush within the key cap and current/previous day only, retention
   delete of rows older than 13 months with and without new traffic, report readback with `uniques: null`.
3. `VERIFY_ADMIN_DATABASE_URL=… node --import tsx --test-reporter=tap scripts/verify-visit-report.ts` —
   aggregate report: exact zero-filled window, future-day exclusion, `(direct)`/`(other)` folds conserving
   counts, `(unknown route)` label, `countingFrom`, definitions and coverage strings.
4. `npm run verify:all db` — the full suite including the two new scripts on the dedicated disposable cluster.
5. Live (after deploy, under the shared browser lock): `/healthz` healthy with the migration count advanced;
   anonymous `GET /api/operator/visits` → 404 with `no-store`/`noindex`; a direct type-in of `/` and `/pricing`
   in a real browser appears within one flush window as views +1/+1 and visits +1/+1 on today's UTC row; a
   same-site navigation `/` → `/pricing` adds view +1 and visit +0; internal-token and bot-UA requests are not
   counted; a third-party analytics request scan over several public pages stays clean; operator readback
   screenshots at 1440 and 390 px.
6. Source audit: the statistics modules contain no read of an IP header, no cookie write, and no import of
   auth or session code (`grep`-checkable; the only cookie read is the internal exclusion marker).

## 5. Independent review

Verdict: **PASS — `review-change-postial-r5s2c` (run postial-r5-0958c0d5), model-verified openrouter/z-ai/glm-5.3-flash; reviewed patch sha256 `28ab05286cc5dc02567523b543cb1fc7e6c1d20361001e8ef6edfe027772ca7c` (differing from the shipped tree only in this review-status section and the Status line, updated after the PASS).**
