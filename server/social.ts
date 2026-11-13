import { GameError } from './domain';
import { SEATS } from '../shared/classroom-layout';

export const CHAT_RULES = Object.freeze({ chatMaxLength: 80, chatTtlMs: 8000 });
export interface ChatMessage { id: string; playerId: string; nickname: string; text: string; sentAt: number; expiresAt: number }

export function socialRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw new GameError('INVALID', '요청 번호를 확인해 주세요.');
  return value;
}

export function normalizeChat(value: unknown): string {
  if (typeof value !== 'string') throw new GameError('CHAT_TEXT', '친구에게 할 말을 입력해 주세요.');
  const text = value.normalize('NFC').replace(/\p{C}+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text || [...text].length > CHAT_RULES.chatMaxLength) throw new GameError('CHAT_TEXT', '말풍선은 1~80글자로 적어 주세요.');
  return text;
}

export function classroomSeat(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= SEATS.length) throw new GameError('SEAT_INVALID', '사무실 소파의 자리를 선택해 주세요.');
  return SEATS[value as number]!;
}
