import { AVATAR_ACTIONS, type AvatarActionKind } from './avatar-actions';
import { REFRESHMENT_DRINKS, REFRESHMENT_SNACKS, type RefreshmentSelection } from './refreshments';
import { SHOULDER_LINK_RULES } from './shoulder-links';

export type ActionNoticeKind = AvatarActionKind | 'refreshments-take' | 'refreshments-clear' | 'shoulder-start' | 'shoulder-end' | 'shoulder-cheer' | 'sit' | 'stand';
export interface ActionNotice { id: string; playerId: string; nickname: string; kind: ActionNoticeKind; text: string; at: number; expiresAt: number }
export const ACTION_NOTICE_RULES = Object.freeze({ ttlMs: 5000, receiptLimit: 24 });
const NOTICE_KINDS: readonly string[] = [...AVATAR_ACTIONS.map(action => action.kind), 'refreshments-take', 'refreshments-clear', 'shoulder-start', 'shoulder-end', 'shoulder-cheer', 'sit', 'stand'];

/** Only the server supplies the selection and group state used for this text.
 * These cosmetic notices are separate from freely written user chat. */
export function actionNoticeText(kind: ActionNoticeKind, refreshments?: RefreshmentSelection | null, shoulderCount = 1): string {
  const drink = REFRESHMENT_DRINKS.find(item => item.id === refreshments?.drink)?.label;
  const snack = REFRESHMENT_SNACKS.find(item => item.id === refreshments?.snack)?.label;
  switch (kind) {
    case 'wave': return '손을 흔들어요. 안녕! 👋';
    case 'bow': return '꾸벅, 반가워요! 🙇';
    case 'clap': return '짝짝짝! 박수 보내요 👏';
    case 'cheer': return '야호! 신나요 🙌';
    case 'lets-go': return '가즈아! 🚀';
    case 'help-me': return '살려주세요! 🥺';
    case 'dance': return '리듬에 맞춰 둠칫둠칫! 🪩';
    case 'heart': return '마음을 보내요! 🫶';
    case 'jump': return '폴짝! 뛰어올랐어요 ↑';
    case 'drink': return `${drink ?? '음료'} 한 모금! ☕`;
    case 'eat': return `${snack ?? '간식'} 한 입, 냠냠! 🍪`;
    case 'refreshments-take': return `${[drink, snack].filter(Boolean).join(' · ') || '음료·간식'} 챙겼어요 ☕`;
    case 'refreshments-clear': return `${[drink, snack].filter(Boolean).join(' · ') || '음료·간식'} 내려놨어요 🧺`;
    case 'shoulder-start': return shoulderCount > 1 ? '다 같이 어깨동무! 🤝' : '어깨걸어! 같이 할 사람? 🤝';
    case 'shoulder-end': return '어깨동무를 풀었어요 🤝';
    case 'shoulder-cheer': return '으쌰! 으쌰! 💪';
    case 'sit': return '잠깐 앉아서 쉬어요 🪑';
    case 'stand': return '다시 일어났어요 🧍';
  }
}

export function isActionNotice(value: unknown): value is ActionNotice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const notice = value as Partial<ActionNotice>;
  return typeof notice.id === 'string' && notice.id.length > 0 && notice.id.length <= 100
    && typeof notice.playerId === 'string' && notice.playerId.length > 0 && notice.playerId.length <= 100
    && typeof notice.nickname === 'string' && notice.nickname.length > 0 && notice.nickname.length <= 40
    && typeof notice.kind === 'string' && NOTICE_KINDS.includes(notice.kind)
    && typeof notice.text === 'string' && notice.text.length > 0 && notice.text.length <= 160
    && Number.isFinite(notice.at) && Number.isFinite(notice.expiresAt)
    && notice.expiresAt! > notice.at! && notice.expiresAt! - notice.at! <= (notice.kind === 'shoulder-cheer' ? SHOULDER_LINK_RULES.cheerDurationMs : ACTION_NOTICE_RULES.ttlMs);
}
