import { createChatBurstMirror, type ChatBurstMirror } from '../shared/chat-burst';

export const CHAT_HOLD_HINT = '잠시 후 보낼 수 있어요.';
export interface ChatOutboxOptions {
  now: () => number;
  /** How long an echo may take before the message counts as not sent. */
  timeoutMs: number;
  timeoutText: string;
  /** The chat field. It is only ever written when it is empty. */
  read: () => string;
  write: (text: string) => void;
  status: (text: string) => void;
  /** Whether a message can be sent right now may have changed. */
  changed: () => void;
  /** A message came back; on a phone the composer may need to be shown again. */
  returned?: () => void;
  /** Channels that share one server bucket share one mirror. */
  burst?: ChatBurstMirror;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}
/**
 * What a chat field has put on the wire and not yet seen echoed. Any number of messages may be in
 * flight; the field is free again the moment one is sent, and a message that does not arrive is
 * handed back instead of being lost.
 */
export function createChatOutbox(options: ChatOutboxOptions) {
  const burst = options.burst ?? createChatBurstMirror(options.now);
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms)), clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const pending = new Map<string, { text: string; key: string; at: number; timer: unknown }>();
  // Timed-out messages whose echo may still come: the text went back to the field, and if the server did take it after all it must not be posted twice.
  const late = new Map<string, { text: string; key: string; at: number }>(), LATE_MS = 60_000;
  // What the status line is about: nothing, the hold hint, or a failure (the id of the message, '' for a lost connection).
  let wakeTimer: unknown, waking = false, hinting = false, failed: string | null = null;
  function wake(at: number) {
    if (waking) clearTimer(wakeTimer);
    waking = true;
    wakeTimer = setTimer(() => {
      waking = false;
      const next = burst.retryAt(); if (next) { wake(next); return; }
      if (hinting) { hinting = false; options.status(''); }
      options.changed();
    }, Math.max(0, at - options.now()) + 15);
  }
  function giveBack(texts: string[], reason: string, id = '') {
    hinting = false; failed = id;
    if (!options.read().trim()) { options.write(texts.join(' ')); options.status(reason); }
    else options.status(`${reason} 못 보낸 말: ${texts.join(' / ')}`);
    options.returned?.();
  }
  function fail(id: unknown, reason: string, retryAt?: unknown): boolean {
    const item = typeof id === 'string' ? pending.get(id) : undefined; if (!item) return false;
    clearTimer(item.timer); pending.delete(id as string);
    if (typeof retryAt === 'number' && Number.isFinite(retryAt)) burst.reject(retryAt);
    giveBack([item.text], reason, id as string);
    const at = burst.retryAt(); if (at) wake(at);
    options.changed(); return true;
  }
  return {
    burst,
    /** Ask before sending. False means the allowance is used up: the hint is showing and the text stays where it is. */
    ready(): boolean {
      const at = burst.retryAt(); if (!at) return true;
      hinting = true; failed = null; options.status(CHAT_HOLD_HINT); wake(at); options.changed(); return false;
    },
    /** True while the next message would have to wait. */
    waiting: () => burst.retryAt() > 0,
    /** The message is on the wire. The caller clears the field straight away. */
    sent(id: string, text: string, key = '') {
      // A notice about an earlier failure has been answered by sending again.
      if (failed !== null) { failed = null; options.status(''); }
      burst.take(); hinting = false; late.delete(id);
      pending.set(id, { text, key, at: options.now(), timer: setTimer(() => { if (fail(id, options.timeoutText)) { late.set(id, { text, key, at: options.now() }); if (late.size > 10) late.delete(late.keys().next().value!); } }, options.timeoutMs) });
      const at = burst.retryAt(); if (at) wake(at);
    },
    /** The server echoed the message; `sentAt` is the time it accepted it, where the echo says. */
    ack(id: unknown, sentAt?: unknown): boolean {
      const item = typeof id === 'string' ? pending.get(id) : undefined;
      if (item) {
        clearTimer(item.timer); pending.delete(id as string);
        if (typeof sentAt === 'number') { burst.confirm(sentAt, item.at); const at = burst.retryAt(); if (at) wake(at); options.changed(); }
        return true;
      }
      const kept = typeof id === 'string' ? late.get(id) : undefined; if (!kept) return false;
      // The echo outran its deadline: the message is in the log, so its copy leaves the field unless the person has changed it since.
      late.delete(id as string);
      if (options.read().trim() === kept.text) options.write('');
      if (failed === id) { failed = null; options.status(''); }
      options.changed(); return true;
    },
    fail,
    /** The connection is gone: everything unconfirmed comes back at once, oldest first. */
    abandon(reason: string) {
      const texts = [...pending.values()].map(item => { clearTimer(item.timer); return item.text; }); pending.clear();
      if (texts.length) { giveBack(texts, reason); options.changed(); }
    },
    /** The person edited the field: a failure notice has been read, the hold hint stays until a token arrives. */
    edited() { if (failed !== null) { failed = null; options.status(''); } },
    /**
     * The request number for a message about to be sent. Text that timed out and is sent again unchanged keeps
     * its number, so a server that did receive the first copy answers with that one instead of posting a second.
     * `key` is whatever else the request carries, such as the person a whisper is for.
     */
    requestId(text: string, fresh: () => string, key = ''): string {
      const time = options.now();
      for (const [id, kept] of late) { if (time - kept.at > LATE_MS) late.delete(id); else if (kept.text === text && kept.key === key) return id; }
      return fresh();
    },
    /** The conversation changed (another room): what was on the wire belongs to the old one. The allowance stays as it is. */
    settle() { for (const item of pending.values()) clearTimer(item.timer); pending.clear(); late.clear(); if (failed !== null) { failed = null; options.status(''); } },
    has: (id: unknown) => typeof id === 'string' && pending.has(id),
    size: () => pending.size,
    reset() { for (const item of pending.values()) clearTimer(item.timer); pending.clear(); late.clear(); if (waking) clearTimer(wakeTimer); waking = false; hinting = false; failed = null; burst.reset(); },
  };
}
