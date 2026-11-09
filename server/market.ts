import { type MarketSymbol } from '../shared/market-catalog';
import { normalizeOfficeCharts, OFFICE_CHART_COUNT, OFFICE_CHART_LAYOUT_VERSION, type OfficeCharts } from '../shared/office-charts';
import { GameError } from './domain';
export const VOTE_RULES = Object.freeze({ durationMs: 30_000, proposalCooldownMs: 15_000 });
export interface ChartVote { id: string; slot: number; proposal: MarketSymbol; proposerId: string; proposerNickname: string; startedAt: number; deadline: number; voters: string[]; ballots: Record<string, boolean>; requiredYes: number }
export interface ChartResult { id: string; slot: number; outcome: 'passed' | 'rejected' | 'expired' | 'cancelled'; symbol: string; name: string; finishedAt: number }
export interface OfficeState { chartLayoutVersion: number; selected: MarketSymbol; charts: OfficeCharts; vote: ChartVote | null; lastResult: ChartResult | null }
export const initialOffice = (): OfficeState => { const charts = normalizeOfficeCharts(undefined); return { chartLayoutVersion: OFFICE_CHART_LAYOUT_VERSION, selected: charts[0], charts, vote: null, lastResult: null }; };
export function chartSlot(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= OFFICE_CHART_COUNT) throw new GameError('SLOT_INVALID', '바꿀 차트를 다시 선택해 주세요.');
  return value;
}
/** Apply the requested eight-wall defaults once without touching room/auth/visitor state. */
export function normalizeOfficeState(value: unknown): OfficeState {
  if (!value || typeof value !== 'object') return initialOffice();
  const state = value as Partial<OfficeState>;
  if (state.chartLayoutVersion !== OFFICE_CHART_LAYOUT_VERSION) return initialOffice();
  const charts = normalizeOfficeCharts(state.charts, state.selected);
  const storedSlot = (slot: unknown) => typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < OFFICE_CHART_COUNT ? slot : 0;
  return { chartLayoutVersion: OFFICE_CHART_LAYOUT_VERSION, selected: charts[0], charts, vote: state.vote ? { ...state.vote, slot: storedSlot(state.vote.slot) } : null, lastResult: state.lastResult ? { ...state.lastResult, slot: storedSlot(state.lastResult.slot) } : null };
}
export function finishVote(state: OfficeState, outcome: ChartResult['outcome'], now: number): OfficeState {
  const vote = state.vote;
  if (!vote) return state;
  const charts = [...state.charts] as OfficeCharts;
  if (outcome === 'passed') charts[vote.slot] = vote.proposal;
  return { ...state, selected: charts[0], charts, vote: null, lastResult: { id: vote.id, slot: vote.slot, outcome, symbol: vote.proposal.symbol, name: vote.proposal.name, finishedAt: now } };
}
export function settleVote(state: OfficeState, now: number): OfficeState {
  const vote = state.vote;
  if (!vote) return state;
  const yes = Object.values(vote.ballots).filter(Boolean).length, no = Object.values(vote.ballots).filter((value) => !value).length;
  if (yes >= vote.requiredYes) return finishVote(state, 'passed', now);
  if (vote.voters.length - no < vote.requiredYes) return finishVote(state, 'rejected', now);
  if (now >= vote.deadline) return finishVote(state, 'expired', now);
  return state;
}
export function proposeChart(state: OfficeState, proposal: MarketSymbol, proposer: { id: string; nickname: string }, onlineIds: string[], now: number, voteId: string, targetSlot?: unknown): OfficeState {
  const slot = chartSlot(targetSlot);
  if (state.vote) throw new GameError('VOTE_ACTIVE', '현재 진행 중인 투표가 끝난 뒤 제안해 주세요.');
  if (proposal.symbol === state.charts[slot]!.symbol) throw new GameError('ALREADY_SELECTED', '이 차트에서 이미 보고 있는 종목이에요.');
  const voters = [...new Set(onlineIds)];
  if (!voters.includes(proposer.id)) throw new GameError('NOT_PRESENT', '사무실에 입장한 뒤 제안해 주세요.');
  return settleVote({ ...state, vote: { id: voteId, slot, proposal, proposerId: proposer.id, proposerNickname: proposer.nickname, startedAt: now, deadline: now + VOTE_RULES.durationMs, voters, ballots: { [proposer.id]: true }, requiredYes: Math.floor(voters.length / 2) + 1 } }, now);
}
export function castChartVote(state: OfficeState, playerId: string, voteId: unknown, approve: unknown, now: number): OfficeState {
  const vote = state.vote;
  if (!vote || vote.id !== voteId || now >= vote.deadline) throw new GameError('VOTE_ENDED', '이미 끝난 투표예요.');
  if (typeof approve !== 'boolean') throw new GameError('VOTE_CHOICE', '찬성 또는 반대를 선택해 주세요.');
  if (!vote.voters.includes(playerId)) throw new GameError('VOTE_OBSERVER', '투표 시작 후 입장했어요. 다음 투표에 참여해 주세요.');
  if (Object.hasOwn(vote.ballots, playerId)) throw new GameError('ALREADY_VOTED', '이미 투표했어요. 선택은 바꿀 수 없어요.');
  return settleVote({ ...state, vote: { ...vote, ballots: { ...vote.ballots, [playerId]: approve } } }, now);
}
export function marketView(state: OfficeState, id: string, nextProposalAt: number) {
  const vote = state.vote;
  return { selected: state.charts[0], charts: state.charts, vote: vote ? { id: vote.id, slot: vote.slot, proposal: vote.proposal, proposerId: vote.proposerId, proposerNickname: vote.proposerNickname, startedAt: vote.startedAt, deadline: vote.deadline, eligibleCount: vote.voters.length, requiredYes: vote.requiredYes, yesCount: Object.values(vote.ballots).filter(Boolean).length, noCount: Object.values(vote.ballots).filter((value) => !value).length, eligible: vote.voters.includes(id), voted: Object.hasOwn(vote.ballots, id) ? vote.ballots[id] ? 'yes' as const : 'no' as const : null } : null, lastResult: state.lastResult, nextProposalAt };
}
