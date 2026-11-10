/** Chat rate rule shared by every chat channel, server and client: a short burst is free, a flood is one message a second. */
export const CHAT_BURST = Object.freeze({ capacity: 5, refillMs: 1000 });
const FULL_MS = CHAT_BURST.capacity * CHAT_BURST.refillMs, HEADROOM_MS = FULL_MS - CHAT_BURST.refillMs;
/**
 * A token bucket kept as one number: the time at which the bucket is full again.
 * A message costs one token, i.e. pushes that time `refillMs` further away.
 */
export type ChatBurstResult = { ok: true; fullAt: number } | { ok: false; retryAt: number };
/** A stored value can never be further away than a completely empty bucket, whatever clock wrote it. */
function level(fullAt: number | undefined, now: number): number { return Math.min(typeof fullAt === 'number' && !Number.isNaN(fullAt) ? fullAt : 0, now + FULL_MS); }
/** Spend one token at `now`. On refusal `retryAt` is the time the next token arrives. */
export function chatBurstTake(fullAt: number | undefined, now: number): ChatBurstResult {
  const current = level(fullAt, now), retryAt = current - HEADROOM_MS;
  return now < retryAt ? { ok: false, retryAt } : { ok: true, fullAt: Math.max(current, now) + CHAT_BURST.refillMs };
}
/** Whole messages that can be sent at `now` without waiting. */
export function chatBurstTokens(fullAt: number | undefined, now: number): number {
  return CHAT_BURST.capacity - Math.ceil(Math.max(0, level(fullAt, now) - now) / CHAT_BURST.refillMs);
}
/** The bucket after messages accepted at these times (oldest first); used where only receipts were stored. */
export function chatBurstReplay(sentAt: readonly number[], fullAt = 0): number {
  for (const at of sentAt) fullAt = Math.max(fullAt, at) + CHAT_BURST.refillMs;
  return fullAt;
}
/** The bucket of someone the server just refused until `retryAt`. */
export function chatBurstEmptyUntil(retryAt: number): number { return retryAt + HEADROOM_MS; }

export interface ChatBurstMirror {
  /** 0 when a message can go out now, otherwise the time the next one can. */
  retryAt(): number;
  /** Spend a token for a message that was just put on the wire. */
  take(): void;
  /** The server refused a message until `retryAt`: it knows the bucket better than the mirror does. */
  reject(retryAt: number): void;
  /**
   * The server accepted, at `sentAt`, a message that left at `tookAt`. Lines that left a stalled connection
   * arrive late and together, and the server charges them when they arrive: its bucket is then emptier than the
   * send times say, and the next line may travel faster than they did.
   */
  confirm(sentAt: number, tookAt: number): void;
  reset(): void;
}
/**
 * The sender's own copy of its bucket, so that the field can answer at once instead of asking the server.
 * It waits `padMs` longer than the rule for a refill: messages cross the network unevenly and the
 * server would otherwise refuse one that left a few milliseconds after the token was due.
 */
export function createChatBurstMirror(now: () => number, padMs = 150): ChatBurstMirror {
  let fullAt = 0, served = 0;
  // How long recent messages took to be accepted. The next one is assumed to be as fast as the fastest of them.
  const lags: number[] = [];
  // Only the message that empties the bucket is padded, so a burst itself is never delayed.
  const current = (time: number) => Math.min(fullAt, time + FULL_MS + padMs);
  return {
    retryAt() { const time = now(), at = current(time) - HEADROOM_MS; return time < at ? at : 0; },
    take() { const time = now(); fullAt = Math.max(current(time), time) + CHAT_BURST.refillMs; if (fullAt - time > HEADROOM_MS) fullAt += padMs; },
    reject(retryAt) { if (Number.isFinite(retryAt)) fullAt = Math.max(fullAt, chatBurstEmptyUntil(retryAt)); },
    confirm(sentAt, tookAt) {
      if (!Number.isFinite(sentAt) || !Number.isFinite(tookAt)) return;
      lags.push(sentAt - tookAt); if (lags.length > 8) lags.shift();
      served = Math.max(served, sentAt) + CHAT_BURST.refillMs;
      const sendBy = served - Math.min(...lags);
      fullAt = Math.max(fullAt, sendBy + (sendBy - now() > HEADROOM_MS ? padMs : 0));
    },
    reset() { fullAt = 0; served = 0; lags.length = 0; },
  };
}
