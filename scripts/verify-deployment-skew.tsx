import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from 'drizzle-orm';
import { DeploymentSkewError, DEPLOYMENT_SKEW_MESSAGE, isDeploymentSkewError } from '../lib/deployment-skew';
import { DeploymentSkewMessage } from '../components/app/deployment-skew-notice';
import { getDb } from '../db';
import { errorEvents } from '../db/schema';
import { recordError } from '../lib/error-visibility';

async function verify() {
  const message = 'Failed to find Server Action. This request might be from an older or newer deployment.';
  assert.equal(isDeploymentSkewError(new Error(message)), true);
  assert.equal(isDeploymentSkewError(new Error('A different application error')), false);
  assert.equal(new DeploymentSkewError().name, 'DeploymentSkewError');
  assert.equal(new DeploymentSkewError().message, message);
  const markup = renderToStaticMarkup(<DeploymentSkewMessage />);
  assert(markup.includes(DEPLOYMENT_SKEW_MESSAGE));
  assert(!markup.includes('Failed to find Server Action'));
  assert(!markup.includes('stack'));
  assert.equal((markup.match(/Reload page/g) ?? []).length, 1);
  const marker = `deployment-skew-${Date.now()}`;
  await recordError(new DeploymentSkewError(), { route: `action:${marker}` });
  const rows = await getDb().select({ errorClass: errorEvents.errorClass }).from(errorEvents).where(sql`${errorEvents.route} = ${`action:${marker}`}`);
  assert.equal(rows[0]?.errorClass, 'DeploymentSkewError');
  await getDb().delete(errorEvents).where(sql`${errorEvents.route} = ${`action:${marker}`}`);
  console.log('deployment skew: message, no stack trace, single reload action, own class and error_events PASS');
}
verify().catch(error => { console.error(error instanceof Error ? error.message : 'verification failed'); process.exit(1); });
