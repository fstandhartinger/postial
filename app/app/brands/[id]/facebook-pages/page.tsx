import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '@/db';
import { oauthStates } from '@/db/schema';
import { coreContext, isUuid } from '@/lib/core';
import { decryptFacebookPick, type FacebookPick } from '@/lib/publishers/oauth';
import { Card } from '@/components/ui/card';
import { chooseFacebookPage } from './actions';

/** Pending Facebook Page selection. Reads the pending row without consuming it; the action consumes it on submit. */
export default async function FacebookPagesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pick?: string | string[] }> }) {
  const { userId } = await coreContext();
  const brandId = (await params).id;
  const pick = (await searchParams).pick;
  let pages: FacebookPick['pages'] = [];
  if (typeof pick === 'string' && /^[A-Za-z0-9_-]{43}$/.test(pick) && isUuid(brandId)) {
    const [pending] = await getDb().select({ codeVerifier: oauthStates.codeVerifier }).from(oauthStates)
      .where(and(eq(oauthStates.state, pick), eq(oauthStates.provider, 'facebook:pick'), eq(oauthStates.userId, userId), eq(oauthStates.brandId, brandId), gt(oauthStates.expiresAt, new Date()))).limit(1);
    if (pending) try { pages = decryptFacebookPick(pending.codeVerifier).pages; } catch { pages = []; }
  }
  if (typeof pick !== 'string' || !pages.length) {
    return (
      <>
        <h1 className="text-3xl font-semibold">Facebook Pages</h1>
        <p>This Page selection expired. Connect Facebook again.</p>
        <p><a href={`/app/brands/${brandId}`}>Back to your brand</a></p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">Choose the Facebook Page to connect</h1>
      <Card>
        <form action={chooseFacebookPage} className="space-y-3">
          <input type="hidden" name="pick" value={pick} />
          <input type="hidden" name="brandId" value={brandId} />
          {pages.map((page, index) => (
            <label key={page.id} className="flex items-center gap-2">
              <input type="radio" name="pageId" value={page.id} defaultChecked={index === 0} required />
              <span>{page.name}</span>
            </label>
          ))}
          <button className="rounded border px-4 py-2" type="submit">Connect this Page</button>
        </form>
      </Card>
    </>
  );
}
