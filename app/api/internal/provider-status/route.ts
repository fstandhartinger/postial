import { configuredProviders } from '@/lib/auth-providers';

export const runtime = 'nodejs';

export function GET() {
  return Response.json(configuredProviders(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
