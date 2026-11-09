import { REFRESHMENT_STATION } from '../shared/classroom-layout';
import { isRefreshmentSelection, REFRESHMENT_RULES, type RefreshmentSelection } from '../shared/refreshments';
import { GameError } from './domain';
import { socialRequestId } from './social';

interface Receipt { requestId: string; signature: string }
interface RefreshmentState { selection: RefreshmentSelection | null; receipts: Receipt[]; nextActionAt: number }
interface RefreshmentPlayer { id: string; x: number; z: number; seat: number | null }

/** Small cosmetic inventory is separate from retired financial accounts. */
export class Refreshments {
  constructor(private storage: DurableObjectStorage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS office_refreshments (id TEXT PRIMARY KEY, state_json TEXT NOT NULL, receipts_json TEXT NOT NULL, next_action_at INTEGER NOT NULL DEFAULT 0)');
  }
  private read(id: string): RefreshmentState {
    const row = this.storage.sql.exec<{ state_json: string; receipts_json: string; next_action_at: number }>('SELECT state_json,receipts_json,next_action_at FROM office_refreshments WHERE id=?', id).toArray()[0];
    if (!row) return { selection: null, receipts: [], nextActionAt: 0 };
    const selection: unknown = JSON.parse(row.state_json);
    return { selection: isRefreshmentSelection(selection) ? { drink: selection.drink, snack: selection.snack } : null, receipts: (JSON.parse(row.receipts_json) as Receipt[]).slice(-REFRESHMENT_RULES.receiptLimit), nextActionAt: row.next_action_at };
  }
  current(id: string): RefreshmentSelection | null { return this.read(id).selection; }
  change(player: RefreshmentPlayer, input: Record<string, unknown>, now: number): { requestId: string; refreshments: RefreshmentSelection | null; changed: boolean } {
    const requestId = socialRequestId(input.requestId), supplied = input.refreshments;
    if (supplied !== null && !isRefreshmentSelection(supplied)) throw new GameError('REFRESHMENTS_INVALID', '음료나 간식을 하나 이상 선택해 주세요.');
    const selection = supplied === null ? null : { drink: supplied.drink, snack: supplied.snack }, signature = JSON.stringify(selection);
    return this.storage.transactionSync(() => {
      const previous = this.read(player.id), receipt = previous.receipts.find(item => item.requestId === requestId);
      if (receipt) {
        if (receipt.signature !== signature) throw new GameError('REQUEST_REUSED', '이미 보낸 요청의 내용을 바꿀 수 없어요.');
        // A late retry must report current inventory, not replay an old take/return.
        return { requestId, refreshments: previous.selection, changed: false };
      }
      // Taking requires the counter; clearing one's cosmetic inventory is allowed anywhere.
      if (selection && player.seat !== null) throw new GameError('REFRESHMENTS_SEATED', '자리에서 일어나 스낵바로 와 주세요.');
      if (selection && (!Number.isFinite(player.x) || !Number.isFinite(player.z) || Math.hypot(player.x - REFRESHMENT_STATION.x, player.z - REFRESHMENT_STATION.z) > REFRESHMENT_STATION.interactionRadius)) throw new GameError('REFRESHMENTS_DISTANCE', '스낵바 가까이에서 가져갈 수 있어요.');
      if (now < previous.nextActionAt) throw new GameError('REFRESHMENTS_COOLDOWN', '잠시 후 다시 이용해 주세요.', previous.nextActionAt);
      const before = JSON.stringify(previous.selection);
      if (previous.selection && selection && before !== signature) throw new GameError('REFRESHMENTS_HELD', '들고 있는 쟁반을 먼저 반납해 주세요.');
      const receipts = [...previous.receipts, { requestId, signature }].slice(-REFRESHMENT_RULES.receiptLimit);
      this.storage.sql.exec('INSERT INTO office_refreshments(id,state_json,receipts_json,next_action_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,receipts_json=excluded.receipts_json,next_action_at=excluded.next_action_at', player.id, signature, JSON.stringify(receipts), now + REFRESHMENT_RULES.cooldownMs);
      return { requestId, refreshments: selection, changed: before !== signature };
    });
  }
}
