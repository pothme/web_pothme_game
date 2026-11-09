import { JUMP_SOCIAL_RULES, type JumpChatMessage } from '../shared/jump-social';
import { GameError } from './domain';
import { normalizeChat, socialRequestId } from './social';

type Receipt={requestId:string;message:JumpChatMessage};
type Hooks={active(id:string):boolean;enabled():boolean;nickname(id:string):string;send(id:string,packet:unknown):void;broadcast(packet:unknown):void};
/** A bounded, separate tower conversation; never mixed into the office log. */
export class JumpSocial {
  private history:JumpChatMessage[];
  constructor(private storage:DurableObjectStorage,private hooks:Hooks){
    storage.sql.exec('CREATE TABLE IF NOT EXISTS jump_chat(id INTEGER PRIMARY KEY CHECK(id=1),history_json TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS jump_chat_receipts(id TEXT PRIMARY KEY,updated_at INTEGER NOT NULL,receipts_json TEXT NOT NULL)');
    const row=storage.sql.exec<{history_json:string}>('SELECT history_json FROM jump_chat WHERE id=1').toArray()[0];
    this.history=row?JSON.parse(row.history_json):[];
  }
  joined(id:string,now=Date.now()){
    if(this.hooks.active(id))this.hooks.send(id,{type:'jump-chat-history',messages:this.history.filter(message=>message.sentAt>now-JUMP_SOCIAL_RULES.historyTtlMs)});
  }
  handle(id:string,input:Record<string,unknown>,now=Date.now()):boolean {
    if(input.type!=='jump-chat')return false;
    if(!this.hooks.active(id))throw new GameError('JUMP_INACTIVE','점프 타워에 입장한 뒤 대화해 주세요.');
    if(!this.hooks.enabled())throw new GameError('CHAT_DISABLED','관리자가 채팅을 잠시 중지했어요.');
    const requestId=socialRequestId(input.requestId),text=normalizeChat(input.text);
    const row=this.storage.sql.exec<{receipts_json:string}>('SELECT receipts_json FROM jump_chat_receipts WHERE id=?',id).toArray()[0];
    const receipts:Receipt[]=row?JSON.parse(row.receipts_json):[],receipt=receipts.find(item=>item.requestId===requestId);
    if(receipt){if(receipt.message.text!==text)throw new GameError('REQUEST_REUSED','이미 보낸 요청의 내용을 바꿀 수 없어요.');this.hooks.send(id,{type:'jump-chat',message:receipt.message,requestId});return true;}
    const retryAt=(receipts.at(-1)?.message.sentAt??-JUMP_SOCIAL_RULES.chatCooldownMs)+JUMP_SOCIAL_RULES.chatCooldownMs;
    if(now<retryAt)throw new GameError('CHAT_COOLDOWN','조금 천천히 이야기해 주세요.',retryAt);
    const message:JumpChatMessage={id:crypto.randomUUID(),playerId:id,nickname:this.hooks.nickname(id),text,sentAt:now,expiresAt:now+JUMP_SOCIAL_RULES.chatTtlMs};
    const history=[...this.history.filter(entry=>entry.sentAt>now-JUMP_SOCIAL_RULES.historyTtlMs),message].slice(-JUMP_SOCIAL_RULES.historyLimit);
    this.storage.transactionSync(()=>{
      this.storage.sql.exec('DELETE FROM jump_chat_receipts WHERE updated_at<?',now-JUMP_SOCIAL_RULES.historyTtlMs);
      this.storage.sql.exec('INSERT INTO jump_chat_receipts(id,updated_at,receipts_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,receipts_json=excluded.receipts_json',id,now,JSON.stringify([...receipts,{requestId,message}].slice(-20)));
      this.storage.sql.exec('INSERT INTO jump_chat(id,history_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET history_json=excluded.history_json',JSON.stringify(history));
    });
    this.history=history;this.hooks.broadcast({type:'jump-chat',message,requestId});return true;
  }
  clear(){this.storage.transactionSync(()=>{this.storage.sql.exec('DELETE FROM jump_chat');this.storage.sql.exec('DELETE FROM jump_chat_receipts');});this.history=[];this.hooks.broadcast({type:'jump-chat-clear'});}
}
