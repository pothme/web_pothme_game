export interface PlayerView {
  id: string;
  nickname: string;
  stockProfile?: import('../shared/stock-profile').StockProfile | null;
  x: number;
  z: number;
  color: number;
  appearance?: import('../shared/avatar-appearance').AvatarAppearance;
  area?: 'office' | 'games' | 'jump';
  seat?: number | null;
  disconnected?: boolean;
  refreshments?: RefreshmentSelection | null;
  action?: AvatarActionView | null;
  shoulder?: ShoulderLinkView | null;
}

export interface ChatMessageView {
  id: string;
  playerId: string;
  text: string;
  sentAt: number;
  expiresAt: number;
  channel?: 'action';
}
import type { RefreshmentSelection } from '../shared/refreshments';
import type { AvatarActionView } from '../shared/avatar-actions';
import type { ShoulderLinkView } from '../shared/shoulder-links';
