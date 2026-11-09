import type { GameChoice, GameRoomView } from '../shared/game-room';

export type GameChoiceDraft = { key: string; bid: number; vault: 'invest' | 'guard' | 'steal'; cipher: number[] };
type ChoiceRoom = Pick<GameRoomView, 'id' | 'matchId' | 'round' | 'kind' | 'phase' | 'players' | 'myChoice'>;
const choiceKey = (room: ChoiceRoom) => `${room.id}:${room.matchId}:${room.round}`;

/** A submitted server choice wins over a local draft, including after reconnect.
 * Chips have already been spent in the acknowledged state, so never clamp a
 * submitted bid to the player's new balance. */
export function reconcileGameChoiceDraft(room: ChoiceRoom, previous: GameChoiceDraft, selfId: string | undefined): GameChoiceDraft {
  const key = choiceKey(room), own = room.players.find(player => player.id === selfId);
  const draft: GameChoiceDraft = previous.key === key
    ? { ...previous, cipher: [...previous.cipher] }
    : { key, bid: 0, vault: 'invest', cipher: [1, 2, 3] };
  draft.bid = typeof room.myChoice === 'number' ? room.myChoice : Math.min(Math.max(0, Math.floor(draft.bid)), 6, own?.chips ?? 0);
  if (typeof room.myChoice === 'string') draft.vault = room.myChoice;
  if (Array.isArray(room.myChoice)) draft.cipher = [...room.myChoice];
  return draft;
}

/** Only the currently displayed, unanswered round may create a submission.
 * The server still validates all identifiers and makes every game decision. */
export function gameChoiceSubmission(room: ChoiceRoom, draft: GameChoiceDraft, selfId: string | undefined) {
  const own = room.players.find(player => player.id === selfId);
  if (room.phase !== 'playing' || !own || !own.connected || own.forfeited || own.solved || own.submitted || room.myChoice !== null || draft.key !== choiceKey(room)) return null;
  let choice: GameChoice;
  if (room.kind === 'blind-auction') {
    if (!Number.isInteger(draft.bid) || draft.bid < 0 || draft.bid > Math.min(6, own.chips)) return null;
    choice = draft.bid;
  } else if (room.kind === 'vault-dilemma') {
    if (!['invest', 'guard', 'steal'].includes(draft.vault)) return null;
    choice = draft.vault;
  } else {
    if (draft.cipher.length !== 3 || new Set(draft.cipher).size !== 3 || !draft.cipher.every(value => Number.isInteger(value) && value >= 1 && value <= 6)) return null;
    choice = [...draft.cipher];
  }
  return { roomId: room.id, matchId: room.matchId, round: room.round, choice };
}
