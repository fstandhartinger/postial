# SocialMint

Approve and publish social posts across brands, with recoverable failures. API + n8n node.

Milestone 1A foundation: Next.js 16 (App Router, standalone), strict TypeScript,
Tailwind CSS v4, Geist via next/font, small UI primitives, Drizzle + PostgreSQL,
and Auth.js v5 beta with the Drizzle adapter and database sessions.

## Local development

Use Node.js 22 and a PostgreSQL database:

```sh
npm ci
cp .env.example .env.local
# Fill in environment values; keep this file private.
set -a
. ./.env.local
set +a
npm run db:migrate
npm run dev
```

Next.js reads `.env.local` automatically; the migration script reads process
environment variables, so export them as shown above. Open http://localhost:3000.

```sh
npm run db:generate  # after changing db/schema.ts; commit drizzle/ migrations
npm run lint
npm run build
npm start
```

## Environment

- `DATABASE_URL`: PostgreSQL connection string, required at runtime. All clients
  use `prepare: false` for PgBouncer transaction pooling.
- `AUTH_SECRET`: strong random session/authentication secret, required for auth.
- `AUTH_URL`: canonical app origin; production: https://socialmint.app.mintapis.com.
- `AUTH_TRUST_HOST`: set to `true` behind the trusted hosting proxy; Auth.js is
  explicitly configured with `trustHost: true`.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`: both enable Google OAuth. Register
  `/api/auth/callback/google` on the app origin as the provider callback URL.
- `SMTP_URL`, `EMAIL_FROM`: both enable Nodemailer magic links. Links return via
  `/api/auth/callback/nodemailer`. Never configure real email delivery for smoke tests.
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`: reserved
  for the billing integration; this milestone contains no Stripe logic.
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_AGENCY`: optional price identifiers exposed
  by `lib/plans.ts`; Starter €19/month, Agency €49/month, trial 14 days.
- `NEXT_PUBLIC_APP_URL`: public canonical origin, reserved for integrations.

Providers are enabled only when their complete configuration is present. With
neither provider configured, `/login` renders a friendly message and disabled
options. `/app` verifies a database session using `auth()` before accessing data.
First access creates a workspace, owner membership and 14-day trial record in one
transaction. A row lock serializes concurrent onboarding requests for a user.
Existing workspace members reuse their workspace.

## Docker / Sandy deployment

Use Sandy/Coolify with this Dockerfile and domain
https://socialmint.app.mintapis.com. Container port: **3000**. Healthcheck:
**GET /healthz** (200 with `{ok:true,db:true,version}`; database failure or a
2-second deadline returns 503 with `{ok:false}`). Supply secrets as runtime
environment variables, never build arguments. The build needs no database or auth
credentials; next/font downloads Geist during the build.

```sh
sudo -n docker build -t socialmint:dev .
sudo -n docker run --rm --env-file .env.local -p 3000:3000 socialmint:dev
```

The Node 22 Alpine image runs as UID 1001. Startup runs checked-in migrations
before `exec node server.js`; migration failure prevents server startup. Deploy
one migrating instance at a time (serialize concurrent rollouts). Ensure the
runtime database user can create/update the schema. Migration dependencies are
included explicitly alongside the standalone Next.js output.

## Scope and validation

Landing, pricing, legal pages and channel connection UI are placeholders. Legal
content must be completed before launch. Google/SMTP credentials enable their
respective providers; no mail or external login is exercised by the smoke checks.
Stripe checkout, network integrations and production deployment are separate work.

See `VERIFICATION.md` for executed milestone checks and dependency audit findings.
Implementation references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
and [Auth.js Drizzle adapter](https://authjs.dev/getting-started/adapters/drizzle).
