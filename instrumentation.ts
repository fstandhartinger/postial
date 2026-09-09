export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateConfig } = await import('./lib/config');
    try { validateConfig(); } catch(e) { console.error(e instanceof Error ? e.message : "Invalid runtime configuration"); process.exit(1); }
    const { startPublishingWorker } = await import('./lib/publishing/start');
    startPublishingWorker();
  }
}
