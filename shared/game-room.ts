import type { AvatarAppearance } from './avatar-appearance';
import type { AvatarProfile } from './avatar-catalog';

export const GAME_KINDS = ['blind-auction', 'vault-dilemma', 'cipher-race'] as const;
export type GameKind = typeof GAME_KINDS[number];
export type GameChoice = number | 'invest' | 'guard' | 'steal' | number[];
export const GAME_RULES = { roundMs: 30_000, revealMs: 5_000, maxRooms: 12, dailyRewardCap: 500, receiptLimit: 32 } as const;
export const GAME_CATALOG = [
  { id: 'blind-auction', name: '블라인드 옥션', subtitle: '같은 기회, 숨겨진 선택', icon: '◈', minPlayers: 2, maxPlayers: 6, rounds: 5,
    description: '18개의 칩을 나눠 써서 5개의 점수 보석을 차지하세요. 가장 높은 단독 입찰만 성공합니다.',
    rules: ['매 라운드 0~6칩을 비공개로 입찰합니다. 남은 칩보다 많이 쓸 수 없어요.', '입찰한 칩은 성공 여부와 관계없이 사용됩니다. 0칩은 패스입니다.', '최고 입찰자가 한 명이면 보석 점수(3·5·4·7·9)를 얻고, 최고 금액 동률이면 아무도 받지 못합니다.', '5라운드 후 보석 점수가 높은 순서로 순위를 정합니다. 미제출은 0칩입니다.'] },
  { id: 'vault-dilemma', name: '두 팀의 금고', subtitle: '함께 모을까, 혼자 챙길까', icon: '▣', minPlayers: 4, maxPlayers: 8, rounds: 5,
    description: '두 팀이 금고를 채웁니다. 팀 승리 보너스와 개인 몫 사이에서 협력·감시·배신을 선택하세요.',
    rules: ['차례대로 A·B팀에 배정됩니다. 귓속말로 협상한 뒤 투자·감시·빼돌리기 중 하나를 비공개 선택합니다.', '투자는 팀 금고에 3, 감시는 1을 더하고 같은 팀의 빼돌리기 한 명을 막습니다.', '막히지 않은 빼돌리기는 금고에서 2를 빼고 개인 몫 4를 얻습니다. 막히면 개인 몫이 1 감소합니다. 금고가 부족하면 실패합니다.', '감시가 여러 배신 중 누구를 막는지는 매 라운드 바뀌는 좌석 순서로 정합니다. 선택은 라운드 종료 후 공개됩니다.', '5라운드 후 금고가 큰 팀은 각자 12점, 동률이면 양팀 각자 6점을 받습니다. 개인 몫과 합산해 최종 순위를 정합니다. 미제출은 감시입니다.'] },
  { id: 'cipher-race', name: '시그널 코드', subtitle: '단서의 조합이 승부를 바꾼다', icon: '⌘', minPlayers: 2, maxPlayers: 6, rounds: 6,
    description: '서로 다른 숫자 3개로 된 공통 암호를 추리하세요. 자신의 단서를 공유하거나 숨길 수 있습니다.',
    rules: ['암호는 1~6 중 중복 없는 숫자 3개입니다. 모든 참가자가 같은 암호를 풉니다.', '매 라운드 숫자 3개를 비공개 제출합니다. 맞는 자리 수와 숫자만 맞는 수는 본인에게만 알려집니다.', '정답 점수는 1라운드 18점부터 라운드마다 2점씩 줄어듭니다. 같은 라운드 정답은 같은 점수입니다.', '정답을 맞힌 사람은 관전하며, 모두 풀거나 6라운드가 끝나면 종료됩니다. 그때 전체 암호를 공개합니다.', '시간 안에 제출하지 않으면 해당 라운드를 쉬고, 다른 사람의 정답이나 단서는 자동 공개되지 않습니다.'] },
] as const;
export function isGameKind(value: unknown): value is GameKind { return GAME_KINDS.includes(value as GameKind); }
export function gameDefinition(kind: GameKind) { return GAME_CATALOG.find(game => game.id === kind)!; }

export interface GameProfile extends AvatarProfile {
  earnedToday: number;
  dailyCap: number;
  wins: number;
}
export interface GameRoomSummary {
  id: string; kind: GameKind; name: string; hostId: string; count: number; maxPlayers: number;
  phase: 'waiting' | 'playing' | 'reveal' | 'finished'; practice: boolean;
}
export interface GamePlayerView {
  id: string; nickname: string; bot: boolean; connected: boolean; ready: boolean; submitted: boolean;
  team: 'A' | 'B' | null; score: number; chips: number; solved: boolean; forfeited: boolean;
  appearance?: AvatarAppearance;
}
export interface GameRoundResult {
  round: number; title: string; lines: string[];
  choices: { playerId: string; choice: GameChoice | null; points: number }[];
  myHint?: { guess: number[]; exact: number; misplaced: number };
}
export interface GameFinalRow { playerId: string; nickname: string; score: number; rank: number; reward: number; forfeited: boolean }
export interface GameChat { id: string; playerId: string; nickname: string; text: string; sentAt: number }
export interface GameRoomView extends GameRoomSummary {
  matchId: string;
  round: number; totalRounds: number; deadline: number | null; players: GamePlayerView[];
  myChoice: GameChoice | null; myHints: { round: number; guess: number[]; exact: number; misplaced: number }[];
  prize: number | null; vaults: { A: number; B: number };
  lastResult: GameRoundResult | null; history: GameRoundResult[]; results: GameFinalRow[];
  secret: number[] | null; finishReason: string | null;
  chats: GameChat[];
}
export interface GameSnapshot {
  area: 'office' | 'games'; rooms: GameRoomSummary[]; room: GameRoomView | null;
  profile: GameProfile; serverTime: number;
}
export interface GameStatePacket { type: 'game-state'; state: GameSnapshot; requestId?: string }
