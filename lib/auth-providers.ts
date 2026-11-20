import { postialSender } from './mail-sender';

export function configuredProviders() {
  return {
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
    email: Boolean(process.env.SMTP_URL && postialSender(process.env.EMAIL_FROM)),
  };
}
