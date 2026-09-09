import { validateRuntimeConfig } from './runtime-config.cjs';
export function validateConfig() {
  if(process.env.NEXT_PHASE !== 'phase-production-build') validateRuntimeConfig();
}
