import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Contract inventory guard. The runtime half is scripts/verify-api.ts: it creates
// isolated fixtures and exercises every operation below. Keeping this inventory
// derived from the published document prevents a route silently disappearing.
const spec = JSON.parse(readFileSync(join(process.cwd(), 'public/openapi.json'), 'utf8'));
const routeFiles: Record<string, string> = {
  '/me': 'app/api/v1/me/route.ts', '/brands': 'app/api/v1/brands/route.ts',
  '/brands/{id}/channels': 'app/api/v1/brands/[id]/channels/route.ts',
  '/posts': 'app/api/v1/posts/route.ts', '/posts/{id}': 'app/api/v1/posts/[id]/route.ts',
  '/posts/{id}/retry': 'app/api/v1/posts/[id]/retry/route.ts', '/webhooks': 'app/api/v1/webhooks/route.ts',
  '/webhooks/{id}': 'app/api/v1/webhooks/[id]/route.ts', '/webhooks/{id}/test': 'app/api/v1/webhooks/[id]/test/route.ts',
  '/webhooks/{id}/deliveries': 'app/api/v1/webhooks/[id]/deliveries/route.ts',
  '/media': 'app/api/v1/media/route.ts', '/posts/bulk': 'app/api/v1/posts/bulk/route.ts',
};
const expected: Record<string, string[]> = {
  '/me': ['get'], '/brands': ['get'], '/brands/{id}/channels': ['get'], '/posts': ['get', 'post'],
  '/posts/{id}': ['get', 'patch', 'delete'], '/posts/{id}/retry': ['post'], '/webhooks': ['get', 'post'],
  '/webhooks/{id}': ['delete'], '/webhooks/{id}/test': ['post'], '/webhooks/{id}/deliveries': ['get'],
  '/media': ['post'], '/posts/bulk': ['post'],
};
assert.deepEqual(Object.keys(spec.paths).sort(), Object.keys(routeFiles).sort());
for (const [path, file] of Object.entries(routeFiles)) {
  assert(existsSync(join(process.cwd(), file)), `${path}: missing route file`);
  assert.deepEqual(Object.keys(spec.paths[path]).sort(), expected[path].sort(), `${path}: operation inventory`);
  for (const [method, operation] of Object.entries<any>(spec.paths[path])) {
    assert(operation.operationId, `${path} ${method}: operationId`);
    assert(operation.responses && Object.keys(operation.responses).length > 0, `${path} ${method}: responses`);
    if (path.includes('{id}')) assert(operation.parameters?.some((p: any) => p.in === 'path' && p.name === 'id' && p.required), `${path} ${method}: required id`);
  }
}
assert.equal(spec.info.title, 'Postial API');
assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
assert.match(spec.info.description, /60 requests per key per minute/);
console.log(`PASS OpenAPI inventory: ${Object.keys(spec.paths).length} paths, ${Object.values(expected).flat().length} operations; runtime checked by verify-api`);
