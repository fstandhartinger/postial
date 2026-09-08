export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateConfig } = await import('./lib/config');
    validateConfig();
    const { startPublishingWorker } = await import('./lib/publishing/start');
    startPublishingWorker();
  }
}
