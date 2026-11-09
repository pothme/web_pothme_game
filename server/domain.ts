import { ROOM_CAPACITY } from '../shared/room-rules';

export const RULES = Object.freeze({
  capacity: ROOM_CAPACITY,
  bonus: 5000,
  winReward: 1000,
  writeCost: 5000,
  eraseCost: 1000,
  cooldownMs: 60_000,
  maxBoardEntries: 8,
  maxTextLength: 50,
  survivalIntervalMs: 120_000,
  survivalDurationMs: 20_000,
  survivalRevealMs: 5_000,
});

export const COLORS = [0xc97950, 0x688571, 0x7195a4, 0xa7809c, 0xc5a35b, 0x7680a5];
export type Choice = 'rock' | 'paper' | 'scissors';
export type Outcome = 'win' | 'draw' | 'lose';
export interface Account {
  id: string;
  nickname: string;
  balance: number;
  nextPlayAt: number;
  color: number;
  breadShuttle: boolean;
}
export interface BoardEntry {
  id: string;
  text: string;
  author: string;
  color: string;
}
export type Command =
  | { type: 'rps'; choice: Choice; requestId: string }
  | { type: 'write'; text: string; requestId: string }
  | { type: 'erase'; entryId: string; requestId: string };

export class GameError extends Error {
  readonly code: string;
  readonly retryAt?: number;
  constructor(code: string, message: string, retryAt?: number) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.retryAt = retryAt;
  }
}

export function nicknameKey(nickname: string): string {
  return nickname.normalize('NFC').toLocaleLowerCase('ko-KR');
}

export function validateNickname(value: unknown): string {
  if (typeof value !== 'string') throw new GameError('NICKNAME', '닉네임을 입력해 주세요.');
  const nickname = value.normalize('NFC').trim();
  if ([...nickname].length < 2 || [...nickname].length > 12 || /[\p{C}<>]/u.test(nickname)) {
    throw new GameError('NICKNAME', '닉네임은 2~12글자로 입력해 주세요.');
  }
  return nickname;
}

export function createAccount(id: string, nickname: string): Account {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return { id, nickname, balance: RULES.bonus, nextPlayAt: 0, color: COLORS[hash % COLORS.length]!, breadShuttle: false };
}

export function canJoin(id: string, nickname: string, online: { id: string; nickname: string }[]): void {
  const others = online.filter((player) => player.id !== id);
  if (others.length >= RULES.capacity) throw new GameError('ROOM_FULL', '사무실이 가득 찼어요. 잠시 후 다시 입장해 주세요.');
  if (others.some((player) => nicknameKey(player.nickname) === nicknameKey(nickname))) {
    throw new GameError('NICKNAME_TAKEN', '이미 사무실에서 사용 중인 닉네임이에요.');
  }
}

export function parseCommand(input: unknown): Command {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GameError('INVALID', '올바르지 않은 요청이에요.');
  const value = input as Record<string, unknown>;
  if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value.requestId)) {
    throw new GameError('INVALID', '요청 번호를 확인해 주세요.');
  }
  if (value.type === 'rps') {
    if (value.choice !== 'rock' && value.choice !== 'paper' && value.choice !== 'scissors') {
      throw new GameError('INVALID_CHOICE', '가위, 바위, 보 중 하나를 골라 주세요.');
    }
    return { type: 'rps', choice: value.choice, requestId: value.requestId };
  }
  if (value.type === 'write') {
    if (typeof value.text !== 'string') throw new GameError('TEXT', '칠판에 남길 글을 입력해 주세요.');
    const text = value.text.normalize('NFC').trim();
    if ([...text].length < 1 || [...text].length > RULES.maxTextLength || /\p{C}/u.test(text)) {
      throw new GameError('TEXT', '글은 줄바꿈 없이 1~50글자로 적어 주세요.');
    }
    return { type: 'write', text, requestId: value.requestId };
  }
  if (value.type === 'erase') {
    if (typeof value.entryId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value.entryId)) {
      throw new GameError('ENTRY', '지울 글을 선택해 주세요.');
    }
    return { type: 'erase', entryId: value.entryId, requestId: value.requestId };
  }
  throw new GameError('INVALID', '알 수 없는 요청이에요.');
}

export function validatePosition(x: unknown, z: unknown): { x: number; z: number } {
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) {
    throw new GameError('POSITION', '이동 위치를 확인해 주세요.');
  }
  return { x: Math.min(6, Math.max(-6, x)), z: Math.min(5.7, Math.max(-4.5, z)) };
}

export function outcomeFor(player: Choice, npc: Choice): Outcome {
  if (player === npc) return 'draw';
  return (player === 'rock' && npc === 'scissors') || (player === 'paper' && npc === 'rock') || (player === 'scissors' && npc === 'paper') ? 'win' : 'lose';
}

export function applyCommand(account: Account, board: BoardEntry[], command: Command, now: number, npcChoice: Choice, entryId: string) {
  const me = { ...account };
  let nextBoard = [...board];
  let details: Record<string, unknown> = {};
  if (command.type === 'rps') {
    if (now < me.nextPlayAt) throw new GameError('COOLDOWN', '다음 가위바위보까지 조금만 기다려 주세요.', me.nextPlayAt);
    const outcome = outcomeFor(command.choice, npcChoice);
    me.nextPlayAt = now + RULES.cooldownMs;
    if (outcome === 'win') me.balance += RULES.winReward;
    details = { choice: command.choice, npcChoice, outcome, reward: outcome === 'win' ? RULES.winReward : 0 };
  } else if (command.type === 'write') {
    if (board.length >= RULES.maxBoardEntries) throw new GameError('BOARD_FULL', '칠판이 가득 찼어요. 글을 하나 지운 뒤 적어 주세요.');
    if (me.balance < RULES.writeCost) throw new GameError('INSUFFICIENT_FUNDS', '글을 쓰려면 5,000원이 필요해요.');
    me.balance -= RULES.writeCost;
    const entry = { id: entryId, text: command.text, author: me.nickname, color: '#f5efd6' };
    nextBoard.push(entry);
    details = { entry };
  } else {
    if (!board.some((entry) => entry.id === command.entryId)) throw new GameError('ENTRY_NOT_FOUND', '이미 지워진 글이에요. 돈은 사용되지 않았어요.');
    if (me.balance < RULES.eraseCost) throw new GameError('INSUFFICIENT_FUNDS', '글을 지우려면 1,000원이 필요해요.');
    me.balance -= RULES.eraseCost;
    nextBoard = board.filter((entry) => entry.id !== command.entryId);
    details = { entryId: command.entryId };
  }
  me.breadShuttle = me.balance === 0;
  return {
    account: me,
    board: nextBoard,
    boardChanged: command.type !== 'rps',
    response: { type: 'result' as const, action: command.type, requestId: command.requestId, me, ...details, serverTime: now },
  };
}
