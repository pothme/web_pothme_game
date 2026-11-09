import type { JumpChatMessage } from '../shared/jump-social';

export const JUMP_CHAT_LIMIT = 80;
export function jumpChatDraft(value: string): string {
  return value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim();
}
export function mergeJumpChats(previous:readonly JumpChatMessage[],incoming:readonly JumpChatMessage[],limit=40):JumpChatMessage[] {
  const byId=new Map(previous.map(message=>[message.id,message]));
  for(const message of incoming){
    if(!message||typeof message.id!=='string'||typeof message.playerId!=='string'||typeof message.nickname!=='string'||typeof message.text!=='string'||!Number.isFinite(message.sentAt)||!Number.isFinite(message.expiresAt))continue;
    // The first authenticated copy wins, including history/acknowledgement races.
    if(!byId.has(message.id))byId.set(message.id,message);
  }
  return [...byId.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id)).slice(-Math.max(1,limit));
}
