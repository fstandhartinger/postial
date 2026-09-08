import { tick } from "./index";
const state = globalThis as typeof globalThis & {
  socialmintWorker?: ReturnType<typeof setInterval>;
};
export function startPublishingWorker() {
  if (state.socialmintWorker || !process.env.DATABASE_URL) return;
  let running = false;
  state.socialmintWorker = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch {
      console.error("Publishing tick failed");
    } finally {
      running = false;
    }
  }, 30000);
  state.socialmintWorker.unref();
}
