# Milestone 1A verification — 2026-09-08

## Passed

- `npm run db:generate`: seven tables, checked-in SQL and Drizzle metadata.
- `npm run lint`: exit 0.
- `npm run build`: exit 0, Next.js 16.3.4, strict TypeScript and standalone output.
- `npm run db:migrate`: applied to the supplied real PostgreSQL database;
  repeated container startup migration succeeded without duplicating schema.
- `select count(*) from users` using postgres-js: succeeded (0 after cleanup).
- `PORT=3987 npm start`, then `node scripts/verify-http.mjs`: `/healthz` 200
  with `ok:true`, `db:true`, version `0.1.0`; `/login`, `/`, `/pricing`, and
  the three legal placeholders 200; unauthenticated `/app` 307 to `/login`.
- No-provider login HTML: both options disabled, “coming soon” and friendly
  availability message present.
- `npm exec --yes --package=tsx@4.21.0 -- tsx scripts/verify-workspace.ts`:
  five concurrent first requests produce exactly one workspace, one owner
  membership, and one 14-day trial; Drizzle adapter session create/read/delete
  passes. Test user and dependent records removed in `finally`. This tests the
  adapter directly; no external login or email delivery was automated.
- An unreachable database on a separate test server returned `/healthz` 503
  with exactly `{ok:false}` (76 ms).
- `sudo -n docker build -t socialmint:dev .`: exit 0, Node 22 Alpine.
- Docker startup ran migrations before server startup; HTTP smoke checks on
  port 3988 all passed. `docker exec socialmint-m1-test id -u`: `1001`.
- Required pre-push secret-pattern search: no matches.

## Supplied database TLS configuration

The supplied `DATABASE_URL_LOCAL` points to 127.0.0.1:6432 without an SSL mode.
The unmodified URL failed with `SSL required`. Enabling verified TLS initially
failed with `DEPTH_ZERO_SELF_SIGNED_CERT`; trusting the local certificate while
retaining the IP address failed hostname validation. PgBouncer's certificate
and configuration were read locally: `/etc/pgbouncer/server.crt`, certificate
CN `old-hetzner-postgres`.

For successful tests, the process-local URL used that hostname and
`sslmode=verify-full`, with `NODE_EXTRA_CA_CERTS=/etc/pgbouncer/server.crt`.
A temporary hosts entry mapped the hostname to 127.0.0.1. The supplied secrets
file was not changed. No certificate or credentials are bundled in the repo.

Docker command (with the corrected URL and exported secret in the environment):

```sh
sudo -n --preserve-env=AUTH_SECRET docker run --rm --name socialmint-m1-test --network host \
  --add-host old-hetzner-postgres:127.0.0.1 \
  -v /etc/pgbouncer/server.crt:/run/pgbouncer-ca.crt:ro \
  -e NODE_EXTRA_CA_CERTS=/run/pgbouncer-ca.crt -e PORT=3988 \
  -e DATABASE_URL="$DATABASE_URL" -e AUTH_SECRET \
  -e AUTH_URL=http://localhost:3988 -e AUTH_TRUST_HOST=true socialmint:dev
node scripts/verify-http.mjs http://localhost:3988
sudo -n docker stop socialmint-m1-test
```

Use an appropriate verified TLS URL/trust configuration in production too.
The exact originally requested Docker invocation cannot connect to this
PgBouncer without those TLS configuration additions.

## Remaining dependency findings

`npm audit`: 8 findings (4 moderate, 4 high, including inherited reports).
Nodemailer advisories GHSA-p6gq-j5cr-w38f and GHSA-8m3c-c648-2xjj propagate to
Auth.js and its adapter. The installed registry versions have no compatible
fix reported by npm. This app does not accept raw mail options or invoke the
legacy `resolveContent` interface. Drizzle Kit's development-only esbuild chain
also reports GHSA-67mh-4wv8-2f99. No esbuild development server is exposed.
Reassess upstream fixes before enabling production email; do not blindly apply
`npm audit fix --force`, which suggests incompatible package downgrades.

Provider login flows, email sending, Stripe, channel publishing and production
hosting were intentionally outside this milestone's tests. Legal pages remain
placeholders.
