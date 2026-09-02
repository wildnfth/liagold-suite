export const ES_CONNECTING = 0;
export const ES_OPEN = 1;
export const ES_CLOSED = 2;
export const ES_RECONNECT_DELAY_MS = 2500;
export const ES_RECREATE_AFTER = 5;

export function planEsOnError({ readyState, failCount }) {
  const nextFailCount = failCount + 1;
  const dead = readyState === ES_CLOSED;
  const recreate = dead && nextFailCount >= ES_RECREATE_AFTER;
  return {
    nextFailCount,
    cancelPending: true,
    scheduleSync: dead && !recreate,
    recreate,
    delayMs: ES_RECONNECT_DELAY_MS,
  };
}
