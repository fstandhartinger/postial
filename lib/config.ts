let checked = false;
export function validateConfig() {
  if (checked) return;
  checked = true;
  const required = ['DATABASE_URL', 'AUTH_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_AGENCY', 'STRIPE_PORTAL_CONFIG'];
  const missing = required.filter(name => !process.env[name]);
  if (!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) && !(process.env.SMTP_URL && process.env.EMAIL_FROM)) {
    missing.push('AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET or SMTP_URL + EMAIL_FROM');
  }
  try { const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? ''); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
  catch { missing.push('NEXT_PUBLIC_APP_URL or AUTH_URL (valid HTTP(S) origin)'); }
  if (missing.length) console.warn('Missing or invalid configuration:', missing.join(', '));
}
