import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Contract inventory guard. The runtime half is scripts/verify-api.ts: it creates
// isolated fixtures and exercises every operation below. Keeping this inventory
// derived from the published document prevents a route silently disappearing.
const spec = JSON.parse(readFileSync(join(process.cwd(), 'public/openapi.json'), 'utf8'));

type JsonSchema = Record<string, any>;

function resolveSchema(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const prefix = '#/components/schemas/';
  assert(schema.$ref.startsWith(prefix), `unsupported schema reference: ${schema.$ref}`);
  return spec.components.schemas[schema.$ref.slice(prefix.length)];
}

function validateExample(schemaInput: JsonSchema, value: unknown, path: string): void {
  const schema = resolveSchema(schemaInput);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate: JsonSchema) => {
      try { validateExample(candidate, value, path); return true; } catch { return false; }
    });
    assert.equal(matches.length, 1, `${path}: expected exactly one oneOf branch, got ${matches.length}`);
    return;
  }
  if (schema.allOf) for (const candidate of schema.allOf) validateExample(candidate, value, path);
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) assert.deepEqual(value, schema.const, `${path}: const mismatch`);
  if (schema.enum) assert(schema.enum.includes(value), `${path}: enum mismatch`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const valid = types.some((type: string) => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type);
    assert(valid, `${path}: expected ${types.join('|')}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined) assert(value.length >= schema.minLength, `${path}: minLength`);
    if (schema.maxLength !== undefined) assert(value.length <= schema.maxLength, `${path}: maxLength`);
    if (schema.pattern) assert(new RegExp(schema.pattern).test(value), `${path}: pattern`);
    if (schema.format === 'uuid') assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), `${path}: uuid format`);
    if (schema.format === 'date-time') assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)), `${path}: date-time format`);
    if (schema.format === 'uri') {
      try { new URL(value); } catch { assert.fail(`${path}: uri format`); }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) assert(value.length >= schema.minItems, `${path}: minItems`);
    if (schema.maxItems !== undefined) assert(value.length <= schema.maxItems, `${path}: maxItems`);
    if (schema.items) value.forEach((item, index) => validateExample(schema.items, item, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) assert(Object.prototype.hasOwnProperty.call(value, required), `${path}: missing required ${required}`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) assert(Object.prototype.hasOwnProperty.call(properties, key), `${path}: unknown property ${key}`);
    for (const [key, child] of Object.entries(properties)) if (Object.prototype.hasOwnProperty.call(value, key)) validateExample(child as JsonSchema, (value as any)[key], `${path}.${key}`);
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(properties, key)) validateExample(schema.additionalProperties, (value as any)[key], `${path}.${key}`);
  }
}

function validateExamplesForSchema(schemaInput: JsonSchema, path: string, seen = new Set<JsonSchema>()): void {
  const schema = resolveSchema(schemaInput);
  if (seen.has(schema)) return;
  seen.add(schema);
  for (const [index, example] of (Array.isArray(schema.examples) ? schema.examples : [] as unknown[]).entries()) validateExample(schema, example, `${path}.examples[${index}]`);
  for (const [key, child] of Object.entries(schema.properties ?? {})) validateExamplesForSchema(child as JsonSchema, `${path}.properties.${key}`, seen);
  for (const child of [...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) validateExamplesForSchema(child, `${path}.branch`, seen);
  if (schema.items) validateExamplesForSchema(schema.items, `${path}.items`, seen);
}

function validateMediaExamples(media: JsonSchema, schemaPath: string): void {
  const schema = media.schema;
  assert(schema, `${schemaPath}: example has no schema`);
  if (media.example !== undefined) validateExample(schema, media.example, `${schemaPath}.example`);
  for (const [name, example] of Object.entries(media.examples ?? {})) validateExample(schema, (example as any).value, `${schemaPath}.examples.${name}`);
}

for (const [name, schema] of Object.entries<JsonSchema>(spec.components.schemas)) validateExamplesForSchema(schema, `components.schemas.${name}`);
for (const [path, operations] of Object.entries<any>(spec.paths)) for (const [method, operation] of Object.entries<any>(operations)) {
  for (const [mediaType, media] of Object.entries<any>(operation.requestBody?.content ?? {})) validateMediaExamples(media, `${path} ${method} request ${mediaType}`);
  for (const [status, response] of Object.entries<any>(operation.responses ?? {})) for (const [mediaType, media] of Object.entries<any>(response.content ?? {})) validateMediaExamples(media, `${path} ${method} response ${status} ${mediaType}`);
}

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
