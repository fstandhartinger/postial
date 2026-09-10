import { workerState } from './state';
import { deliverWebhooksTick } from "@/lib/api/webhooks";
import { tick } from "./index";
import { recordError } from '@/lib/error-visibility';
const state = globalThis as typeof globalThis & {
  postialWorker?: ReturnType<typeof setInterval>;
};
export function startPublishingWorker() {
  if (state.postialWorker || !process.env.DATABASE_URL || process.env.WORKER_ENABLED === "false") return;
  workerState.startedAt = Date.now();
  let running = false;
  let currentTick: Promise<unknown> | undefined;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(state.postialWorker);
    state.postialWorker = undefined;
    const pending = currentTick;
    if (pending) await Promise.race([pending, new Promise(resolve => setTimeout(resolve, 95000))]);
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  state.postialWorker = setInterval(async () => {
    if (running || stopping) return;
    running = true;
    currentTick = (async () => { try {
      await tick();
      workerState.lastTickAt = new Date().toISOString();
    } catch (error) {
      void recordError(error, { route: 'worker:publishing' });
    } finally {
      running = false;
      void deliverWebhooksTick().catch(error => { void recordError(error, { route: 'worker:webhooks' }); });
    } })();
    try { await currentTick; } finally { currentTick = undefined; }
  }, Number(process.env.WORKER_INTERVAL_MS || 30000));
  state.postialWorker.unref();
}
