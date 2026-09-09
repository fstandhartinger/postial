import { workerState } from './state';
import { deliverWebhooksTick } from "@/lib/api/webhooks";
import { tick } from "./index";
const state = globalThis as typeof globalThis & {
  postialWorker?: ReturnType<typeof setInterval>;
};
export function startPublishingWorker() {
  if (state.postialWorker || !process.env.DATABASE_URL || process.env.WORKER_ENABLED === "false") return;
  workerState.startedAt = Date.now();
  let running = false;
  state.postialWorker = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
      workerState.lastTickAt = new Date().toISOString();
    } catch {
      console.error("Publishing tick failed");
    } finally {
      running = false;
      void deliverWebhooksTick().catch(() => console.error("Webhook tick failed"));
    }
  }, 30000);
  state.postialWorker.unref();
}
