export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateConfig } = await import('./lib/config');
    try { validateConfig(); } catch(e) { console.error(e instanceof Error ? e.message : "Invalid runtime configuration"); process.exit(1); }
    const { recordError } = await import('./lib/error-visibility');
    process.on('uncaughtException', error => { void recordError(error, { route: 'process:uncaughtException' }); });
    process.on('unhandledRejection', reason => { void recordError(reason, { route: 'process:unhandledRejection' }); });
    const { startPublishingWorker } = await import('./lib/publishing/start');
    startPublishingWorker();
  }
}

import type { Instrumentation } from 'next';
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { recordError } = await import('./lib/error-visibility');
  const { DeploymentSkewError, isDeploymentSkewError } = await import('./lib/deployment-skew');
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  const classifiedError = isDeploymentSkewError(error) ? new DeploymentSkewError() : error;
  await recordError(classifiedError, { route: context.routeType === 'action' ? `action:${context.routePath}` : (context.routePath || request.path), status, authenticated: Boolean(request.headers.authorization || request.headers.cookie) });
};
