'use server';
import { sessionActionBudget } from '@/lib/rate-limit';
import { coreContext } from '@/lib/core';
import { manageTeam, TeamError } from '@/lib/team';
import { revalidatePath } from 'next/cache';
export type TeamState = { error?: string; link?: string; message?: string };
export async function teamAction(_state: TeamState, form: FormData): Promise<TeamState> {
  const ctx = await coreContext();
  try {
  await sessionActionBudget(ctx.userId);
    const token = await manageTeam(ctx.workspace.id, ctx.userId, String(form.get('action')), String(form.get('target') ?? ''), String(form.get('role') ?? 'editor'), String(form.get('email') ?? ''));
    revalidatePath('/app', 'layout');
    if (token) {
      const origin = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL;
      if (!origin) return { error: 'Application URL is not configured. Ask your administrator.' };
      return { link: `${origin.replace(/\/$/, '')}/join/${token}` };
    }
    return { message: 'Team updated.' };
  } catch (e) { return { error: e instanceof TeamError ? e.message : 'Unable to update team. Please try again.' }; }
}
