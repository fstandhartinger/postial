const state = globalThis as typeof globalThis & { socialmintWorkerHealth?: {startedAt:number; lastTickAt:string|null} };
export const workerState = state.socialmintWorkerHealth ??= {startedAt:Date.now(),lastTickAt:null};
export function workerHealth(now = Date.now()) {
  const expected = process.env.WORKER_ENABLED !== 'false';
  const ageSeconds = Math.max(0, Math.floor((now - (workerState.lastTickAt ? Date.parse(workerState.lastTickAt) : workerState.startedAt)) / 1000));
  return {lastTickAt:workerState.lastTickAt,ageSeconds,expected};
}
