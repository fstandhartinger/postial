import { sessionContext } from '@/lib/core';
import { ApiError } from '@/lib/api/errors';
export async function mediaSession(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.NEXT_PUBLIC_APP_URL) throw new ApiError(403,'forbidden','Use the same origin to manage images.');
  const ctx = await sessionContext();
  if (!ctx) throw new ApiError(401,'unauthorized','Sign in to upload images.');
  return ctx;
}
