import type { AvatarActionView } from '../shared/avatar-actions';
import { createJumpAction, jumpStep, JUMP_RULES } from '../shared/avatar-jump';

type Request = { id: string; action: AvatarActionView; previous?: AvatarActionView; sentAt: number; pending: boolean };
type Override = AvatarActionView | null | undefined;
const ACK_TIMEOUT_MS = 7000;

/** Local cosmetic flight uses a monotonic clock, never a changing server offset. */
export class JumpPrediction {
  private requests: Request[] = [];
  private retired: string[] = [];
  private action: Override;
  private groundReadyAt = 0;
  private acknowledgedReadyAt = 0;
  private blockedUntil = 0;
  constructor(private clock: () => number, private render: (action: Override) => void) {}

  private setAction(action: Override) {
    if (this.action === action) return;
    this.action = action; this.render(action);
  }
  private retire(requests: Request[]) {
    this.retired.push(...requests.map(request => request.id));
    this.retired = this.retired.slice(-32);
  }
  tick() {
    const now = this.clock();
    if (this.requests.some(request => request.pending && now - request.sentAt >= ACK_TIMEOUT_MS)) {
      this.retire(this.requests); this.requests = []; this.setAction(null);
    }
    if (this.action && now >= this.action.expiresAt) this.setAction(null);
    if (!this.requests.some(request => request.pending) && now >= Math.max(this.groundReadyAt, this.blockedUntil) && !this.action) {
      this.retire(this.requests); this.requests = []; this.setAction(undefined);
    }
  }
  get current() { this.tick(); return this.action; }
  get busy() {
    this.tick();
    return !!this.action || this.requests.some(request => request.pending) || this.clock() < this.groundReadyAt;
  }
  get nextStep(): 1 | 2 | 0 {
    this.tick(); const now = this.clock();
    if (now < this.blockedUntil) return 0;
    if (this.action) return jumpStep(this.action) === 1 && now >= this.action.startedAt + JUMP_RULES.minBoostDelayMs ? 2 : 0;
    return !this.requests.some(request => request.pending) && now >= this.groundReadyAt ? 1 : 0;
  }
  /** Called synchronously after a successful socket send, without awaiting its acknowledgement. */
  start(id: string): boolean {
    if (!this.nextStep) return false;
    const now = this.clock(), action = createJumpAction(`local:${id}`, now, this.action);
    this.requests.push({ id, action, previous: this.action ?? undefined, sentAt: now, pending: true });
    this.groundReadyAt = Math.max(this.groundReadyAt, action.expiresAt + JUMP_RULES.landingCooldownMs);
    this.setAction(action); return true;
  }
  receive(id: unknown, action: AvatarActionView | null, serverNow: number): boolean {
    if (typeof id !== 'string') return false;
    const request = this.requests.find(value => value.id === id);
    if (!request) return this.retired.includes(id);
    if (!request.pending) return true;
    request.pending = false;
    if (action?.kind === 'jump') {
      // Keep the input-time arc. Replacing it with the delayed server arc would rewind the avatar.
      this.acknowledgedReadyAt = Math.max(this.acknowledgedReadyAt, this.clock() + Math.max(0, action.expiresAt - serverNow) + JUMP_RULES.landingCooldownMs);
      this.groundReadyAt = Math.max(this.groundReadyAt, this.acknowledgedReadyAt);
    }
    // An old first-jump replay can acknowledge null after the second jump; it is not a cancellation.
    this.tick(); return true;
  }
  reject(id: unknown, next: number | undefined, serverNow: number): boolean {
    if (typeof id !== 'string') return false;
    const index = this.requests.findIndex(value => value.id === id);
    if (index < 0) return this.retired.includes(id);
    const rejected = this.requests.splice(index);
    this.retire(rejected);
    const previous = rejected[0]?.previous;
    this.setAction(previous && this.clock() < previous.expiresAt ? previous : null);
    this.blockedUntil = next === undefined ? 0 : this.clock() + Math.max(0, next - serverNow);
    this.groundReadyAt = Math.max(this.acknowledgedReadyAt, previous ? previous.expiresAt + JUMP_RULES.landingCooldownMs : this.blockedUntil);
    this.tick(); return true;
  }
  /** Seed a reconnect snapshot only; active local input always wins over subsequent rosters. */
  seed(action: AvatarActionView | null, serverNow: number) {
    this.tick();
    if (this.requests.length || this.action !== undefined || action?.kind !== 'jump' || action.expiresAt <= serverNow) return;
    const offset = this.clock() - serverNow;
    const local = { ...action, startedAt: action.startedAt + offset, expiresAt: action.expiresAt + offset };
    this.groundReadyAt = local.expiresAt + JUMP_RULES.landingCooldownMs;
    this.acknowledgedReadyAt = this.groundReadyAt;
    this.setAction(local);
  }
  cancel() {
    this.retire(this.requests); this.requests = []; this.setAction(null); this.tick();
  }
  reset() {
    this.retire(this.requests); this.requests = []; this.groundReadyAt = 0; this.acknowledgedReadyAt = 0; this.blockedUntil = 0;
    this.setAction(undefined);
  }
  /** A single wakeup at the next input boundary avoids a permanent high-rate UI interval. */
  nextWakeDelay(): number | undefined {
    this.tick(); const now = this.clock();
    const times = [this.groundReadyAt, this.blockedUntil];
    if (this.action) {
      times.push(this.action.expiresAt);
      if (jumpStep(this.action) === 1) times.push(this.action.startedAt + JUMP_RULES.minBoostDelayMs);
    }
    times.push(...this.requests.filter(request => request.pending).map(request => request.sentAt + ACK_TIMEOUT_MS));
    const future = times.filter(time => time > now);
    return future.length ? Math.max(1, Math.ceil(Math.min(...future) - now)) : undefined;
  }
}

/** Pointer-generated clicks follow pointerdown; keyboard and assistive clicks have detail zero. */
export function isStandaloneJumpClick(detail: number): boolean { return detail === 0; }
