import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { configuredProviders } from "@/lib/auth-providers";
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const enabled = configuredProviders();
  return {
    adapter: DrizzleAdapter(getDb(), { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }),
    session: { strategy: "database" }, trustHost: true,
    pages: { signIn: "/login", error: "/login", verifyRequest: "/login?sent=1" },
    providers: [
      ...(enabled.google ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })] : []),
      ...(enabled.email ? [Nodemailer({ server: process.env.SMTP_URL, from: process.env.EMAIL_FROM })] : []),
    ],
    callbacks: { session({ session, user }) { session.user.id = user.id; return session; } },
    logger: { error() { console.error("Authentication request failed"); } },
  };
});
