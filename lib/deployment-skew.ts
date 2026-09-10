const SERVER_ACTION_NOT_FOUND = 'Failed to find Server Action.';

export const DEPLOYMENT_SKEW_MESSAGE =
  'Postial was updated while this page was open. Reload the page once to continue. Your entries are still here.';

export function isDeploymentSkewError(value: unknown): boolean {
  if (value instanceof Error) return value.message.includes(SERVER_ACTION_NOT_FOUND);
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { message?: unknown; digest?: unknown };
  return typeof candidate.message === 'string' && candidate.message.includes(SERVER_ACTION_NOT_FOUND);
}

export class DeploymentSkewError extends Error {
  constructor() {
    super(SERVER_ACTION_NOT_FOUND + ' This request might be from an older or newer deployment.');
    this.name = 'DeploymentSkewError';
  }
}
