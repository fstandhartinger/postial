import { identityOnlyAdapter } from '@/lib/auth-adapter';
import NextAuth from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { validateConfig } from "@/lib/config";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { configuredProviders } from "@/lib/auth-providers";
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  validateConfig();
  const enabled = configuredProviders();
  return {
    // Auth.js enumerates adapter methods during initialization. Keep wrappers
    // enumerable, but create the DB adapter only when a method is invoked.
    adapter: Object.fromEntries(([
      'createUser', 'getUser', 'getUserByEmail', 'getUserByAccount', 'updateUser',
      'deleteUser', 'linkAccount', 'unlinkAccount', 'getAccount', 'createSession',
      'getSessionAndUser', 'updateSession', 'deleteSession',
      'createVerificationToken', 'useVerificationToken',
    ] satisfies (keyof Adapter)[]).map(method => [method, (...args: unknown[]) => {
      const adapter = identityOnlyAdapter(DrizzleAdapter(getDb(), { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }));
      const operation = adapter[method] as (...values: unknown[]) => unknown;
      return operation(...args);
    }])) as Adapter,
    session: { strategy: "database" }, trustHost: process.env.AUTH_TRUST_HOST === "true",
    pages: { signIn: "/login", error: "/login", verifyRequest: "/login?sent=1" },
    providers: [
      ...(enabled.google ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })] : []),
      ...(enabled.email ? [Nodemailer({ server: process.env.SMTP_URL, from: process.env.EMAIL_FROM })] : []),
    ],
    callbacks: { session({ session, user }) { session.user.id = user.id; return session; } },
    logger: { error() { console.error("Authentication request failed"); } },
  };
});
