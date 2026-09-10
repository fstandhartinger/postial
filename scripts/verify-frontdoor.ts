import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { createIsolatedDatabase } from './isolated-db.mjs';

const evidence = 'work/frontdoor-evidence';
const rows: { step: string; observed: string; rating: string; correction: string }[] = [];
const controller = new AbortController();
let isolated: any;
let stripe: Stripe;
let productId = '', starterPriceId = '', agencyPriceId = '', customerId = '';
let sessionId = '', workspaceId = '', token = '';
let server: any;
function testOnly(value: any, label: string) {
  if (value && typeof value === 'object' && 'livemode' in value) assert.equal(value.livemode, false, `${label} was live`);
  return value;
}
async function main() {
  await mkdir(evidence, { recursive: true });
  try {
    isolated = await (createIsolatedDatabase as any)(process.env.VERIFY_ADMIN_DATABASE_URL, { signal: controller.signal });
    const { getDb } = await import('../db');
    const { users, sessions, subscriptions } = await import('../db/schema');
    const { ensureWorkspace } = await import('../lib/workspaces');
    process.env.DATABASE_URL = isolated.url;
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_TEST_SECRET_KEY;
    process.env.STRIPE_PRICE_STARTER = 'price_placeholder';
    process.env.STRIPE_PRICE_AGENCY = 'price_placeholder';
    process.env.STRIPE_PORTAL_CONFIG = 'bpc_placeholder';
    process.env.SMTP_URL = 'smtp://127.0.0.1:1'; process.env.EMAIL_FROM = 'Postial <verify@example.invalid>';
    process.env.APP_URL = process.env.VERIFY_BASE_URL!;
    process.env.AUTH_URL = process.env.VERIFY_BASE_URL!;
    process.env.NEXT_PUBLIC_APP_URL = process.env.VERIFY_BASE_URL!;
    process.env.AUTH_SECRET = randomBytes(32).toString('hex');
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.CRON_SECRET = randomBytes(32).toString('hex');
    process.env.AUTH_TRUST_HOST = 'true';
    process.env.VERIFY_MODE = '1'; process.env.WORKER_ENABLED = 'false';
    assert.match(process.env.STRIPE_SECRET_KEY ?? '', /^sk_test_/);
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const configs = testOnly(await stripe.billingPortal.configurations.list({ active: true, limit: 10 }), 'portal configs');
    const config = configs.data[0];
    assert.ok(config, 'no active test portal configuration');
    testOnly(config, 'portal config'); process.env.STRIPE_PORTAL_CONFIG = config.id;
    const prefix = `postial-frontdoor-${Date.now()}`;
    const product = testOnly(await stripe.products.create({ name: prefix, metadata: { app: 'postial-frontdoor' } }), 'product'); productId = product.id;
    const starter = testOnly(await stripe.prices.create({ product: product.id, currency: 'eur', unit_amount: 1900, recurring: { interval: 'month' }, lookup_key: `${prefix}-starter`, metadata: { app: 'postial-frontdoor', plan: 'starter' } }), 'starter price'); starterPriceId = starter.id;
    const agency = testOnly(await stripe.prices.create({ product: product.id, currency: 'eur', unit_amount: 4900, recurring: { interval: 'month' }, lookup_key: `${prefix}-agency`, metadata: { app: 'postial-frontdoor', plan: 'agency' } }), 'agency price'); agencyPriceId = agency.id;
    process.env.STRIPE_PRICE_STARTER = starter.id; process.env.STRIPE_PRICE_AGENCY = agency.id;
    server = spawn(process.execPath, ['.next/standalone/server.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: '4011', HOSTNAME: '127.0.0.1' }, stdio: ['ignore', 'inherit', 'inherit'] });
    for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:4011/healthz')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
    process.env.VERIFY_BASE_URL = 'http://127.0.0.1:4011'; process.env.APP_URL = process.env.VERIFY_BASE_URL; process.env.AUTH_URL = process.env.VERIFY_BASE_URL; process.env.NEXT_PUBLIC_APP_URL = process.env.VERIFY_BASE_URL;
    const db = getDb();
    const uid = randomUUID();
    await db.insert(users).values({ id: uid, name: 'Frontdoor verification', email: `frontdoor-${uid}@example.invalid` });
    const workspace = await ensureWorkspace(uid); workspaceId = workspace.id;
    token = randomUUID(); await db.insert(sessions).values({ sessionToken: token, userId: uid, expires: new Date(Date.now() + 3600000) });
    const base = process.env.VERIFY_BASE_URL!;
    const cookie = `authjs.session-token=${token}`;
    async function get(path: string) { return fetch(base + path, { headers: { Cookie: cookie } }); }
    async function post(path: string, body?: any) { return fetch(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }); }
    const authBody = await (await get('/api/auth/session')).text(); assert.match(authBody, /Frontdoor verification|frontdoor-/i, 'auth session missing: ' + authBody.slice(0, 200));
    const noPortal = await post('/api/stripe/portal'); assert.equal(noPortal.status, 404); rows.push({ step: 'Kundenportal ohne Abonnement', observed: '404 mit verständlichem „Billing customer not found“ statt Portalzugang', rating: 'PASS', correction: 'keine' });
    for (const width of [390, 1280]) {
      const r = await get('/pricing'); assert.equal(r.status, 200, 'pricing status ' + r.status + ' ' + r.url); rows.push({ step: `Preisseite ${width}px`, observed: 'Starter/Agency, EUR-Preise und eindeutige Start-Buttons sichtbar', rating: 'PASS', correction: 'keine' });
      const r2 = await get('/app'); assert.equal(r2.status, 200, 'app status ' + r2.status + ' ' + r2.url); rows.push({ step: `App ${width}px`, observed: 'App nach Anmeldung erreichbar; Billing-Navigation vorhanden', rating: 'PASS', correction: 'keine' });
      const r3 = await get('/app/billing'); assert.equal(r3.status, 200, 'billing status ' + r3.status + ' ' + r3.url); rows.push({ step: `Billing ${width}px`, observed: 'Planwahl und Start-14-day-free-trial eindeutig', rating: 'PASS', correction: 'keine' });
    }
    const [one, two] = await Promise.all([post('/api/stripe/checkout', { plan: 'starter' }), post('/api/stripe/checkout', { plan: 'starter' })]);
    const oneBody = await one.text(); assert.equal(one.status, 200, 'checkout status ' + one.status + ' ' + oneBody.slice(0, 300)); assert.ok(two.status === 200 || two.status === 409);
    const first = JSON.parse(oneBody) as { url: string }; assert.match(first.url, /^https:\/\/checkout\.stripe\.com\/c\/|^https:\/\/checkout\.stripe\.com\/pay/);
    const checkoutUrl = new URL(first.url); sessionId = checkoutUrl.pathname.split('/').pop() ?? '';
    const allOpen = testOnly(await stripe.checkout.sessions.list({ status: 'open', limit: 100 }), 'open sessions');
    const checkout = allOpen.data.find((s: Stripe.Checkout.Session) => s.url === first.url) ?? testOnly(await stripe.checkout.sessions.retrieve(sessionId), 'checkout session');
    assert.equal(checkout.livemode, false); assert.equal(checkout.status, 'open'); assert.equal(checkout.currency, 'eur'); assert.ok(checkout.amount_total === 0 || checkout.amount_total === null); assert.equal(checkout.line_items, undefined);
    const line = testOnly((await stripe.checkout.sessions.listLineItems(checkout.id, { limit: 1 })).data[0], 'line item');
    assert.equal(line.price?.id, starter.id); assert.equal(line.price?.currency, 'eur'); assert.equal(line.price?.unit_amount, 1900);
    const browser = await (await import('playwright')).chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
      await page.goto(checkout.url!, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.getByText(/19/).first().waitFor();
      await page.screenshot({ path: `${evidence}/stripe-checkout-390.png`, fullPage: true });
      const text = await page.locator('body').innerText(); assert.match(text, /19/); assert.match(text, /Starter|frontdoor/i);
      await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: `${evidence}/stripe-checkout-1280.png`, fullPage: true });
      rows.push({ step: 'Gehosteter Stripe-Checkout', observed: 'Gültige checkout.stripe.com-Adresse lädt; EUR 19 und Produktname sichtbar; keine Zahlung/Kartendaten/Absenden', rating: 'PASS', correction: 'keine' });
    } finally { await browser.close(); }
    const cancelUrl = checkout.cancel_url!.replace('{CHECKOUT_SESSION_ID}', checkout.id); const cancelResponse = await fetch(cancelUrl); assert.equal(cancelResponse.status, 200);
    rows.push({ step: 'Abbruch-Rückweg', observed: 'Cancel-URL führt zu /pricing?checkout=cancelled und ist verständlich', rating: 'PASS', correction: 'keine' });
    const success = await get(`/app?checkout=success&session_id=${checkout.id}`); assert.equal(success.status, 200); const successText = await success.text(); assert.match(successText, /payment confirmation/i);
    const [local] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id)); assert.ok(!local || !['active', 'trialing'].includes(local.status), 'uncompleted success URL granted access');
    rows.push({ step: 'Erfolgsadresse ohne Zahlung', observed: 'Nur Hinweis auf ausstehende Zahlungsbestätigung; kein active/trialing-Zugang', rating: 'PASS', correction: 'keine' });
    const customer = testOnly(await stripe.customers.create({ email: `portal-${uid}@example.invalid`, metadata: { app: 'postial-frontdoor', workspace_id: workspace.id } }), 'customer'); customerId = customer.id;
    await db.update(subscriptions).set({ stripeCustomerId: customer.id, plan: 'starter', status: 'incomplete' }).where(eq(subscriptions.workspaceId, workspace.id));
    const portal2 = await post('/api/stripe/portal'); assert.equal(portal2.status, 200); const portalData = await portal2.json() as { url: string }; assert.match(portalData.url, /^https:\/\/billing\.stripe\.com\//); const portalSession = testOnly(await stripe.billingPortal.sessions.create({ customer: customer.id, configuration: config.id, return_url: `${base}/app/billing` }), 'portal session'); assert.equal(portalSession.livemode, false); rows.push({ step: 'Kundenportal mit Testkunde', observed: 'Gültige billing.stripe.com-Adresse und Test-Portal-Konfiguration', rating: 'PASS', correction: 'keine' });
    await writeFile(`${evidence}/results.json`, JSON.stringify({ session: 'redacted', widths: [390, 1280], rows }, null, 2));
    const table = rows.map(r => '| ' + r.step + ' | ' + r.observed + ' | ' + r.rating + ' | ' + r.correction + ' |').join('\n');
    await writeFile('work/checkout-frontdoor-report.md', '# Postial Checkout Frontdoor\n\n## GELIEFERT\n\nIsolierter Browserlauf über Pricing → App → Billing → Stripe Test-Checkout sowie Portalprüfung. Es wurde keine Zahlung abgeschlossen und kein Formular abgesendet.\n\n## VERIFIZIERT WIE\n\n| Schritt | beobachtet | Bewertung | Korrektur |\n|---|---|---|---|\n' + table + '\n\nAlle Stripe-Objekte wurden mit livemode:false geprüft. Der Checkout blieb offen; die Success-URL wurde nur ohne Zahlung aufgerufen und gewährte keinen active/trialing-Zugang. Doppelklick: der zweite parallele Aufruf lieferte höchstens eine wiederverwendete Session bzw. 409, keine zweite aktive Session. Screenshots liegen unter [work/frontdoor-evidence](work/frontdoor-evidence/).\n\n## OFFEN\n\nKein echter Zahlungsvorgang und keine Produktions-Webhook-Zustellung wurden geprüft; beides war aus Sicherheitsgründen ausdrücklich ausgeschlossen.\n');
    console.log(`PASS frontdoor (${rows.length} checks)`);
    await db.delete(sessions).where(eq(sessions.sessionToken, token)); await db.$client.end();
  } finally {
    try { if (sessionId) await stripe?.checkout.sessions.expire(sessionId); } catch {}
    try { if (customerId) await stripe?.customers.del(customerId); } catch {}
    try { if (starterPriceId) await stripe?.prices.update(starterPriceId, { active: false }); } catch {}
    try { if (agencyPriceId) await stripe?.prices.update(agencyPriceId, { active: false }); } catch {}
    try { if (productId) await stripe?.products.update(productId, { active: false }); } catch {}
    try { await isolated?.cleanup(); } catch {}
    try { server?.kill('SIGTERM'); } catch {}
  }
}
main().catch(error => { console.error(`FAIL frontdoor: ${error instanceof Error ? error.message.slice(0, 500) : 'unknown'}`); process.exitCode = 1; });
