import { JUMP_SOCIAL_RULES, type JumpChatMessage } from '../shared/jump-social';
import { chatBurstReplay, chatBurstTake } from '../shared/chat-burst';
import { GameError } from './domain';
import { normalizeChat, socialRequestId } from './social';

type Receipt={requestId:string;message:JumpChatMessage};
type Hooks={
  /** Tower room of a connected player who is inside the tower, otherwise null. */
  room(id:string):string|null;
  enabled():boolean;nickname(id:string):string;send(id:string,packet:unknown):void;
  /** Deliver to the members of one tower room; without a room, to everyone inside the tower. */
  broadcast(packet:unknown,roomId?:string):void;
};
/** A bounded conversation per tower room; never mixed into the office log or another room. */
export class JumpSocial {
  private histories=new Map<string,JumpChatMessage[]>();
  /** Burst allowance per player while this object lives; after a restart the stored receipts stand in for it. */
  private bursts=new Map<string,number>();
  constructor(private storage:DurableObjectStorage,private hooks:Hooks){
    storage.sql.exec('CREATE TABLE IF NOT EXISTS jump_room_chat(room_id TEXT PRIMARY KEY,updated_at INTEGER NOT NULL,history_json TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS jump_chat_receipts(id TEXT PRIMARY KEY,updated_at INTEGER NOT NULL,receipts_json TEXT NOT NULL)');
    // The single shared log of the room-less tower is not carried into any room.
    storage.sql.exec('DROP TABLE IF EXISTS jump_chat');
  }
  private history(roomId:string,now:number):JumpChatMessage[] {
    let history=this.histories.get(roomId);
    if(!history){
      const row=this.storage.sql.exec<{history_json:string}>('SELECT history_json FROM jump_room_chat WHERE room_id=?',roomId).toArray()[0];
      history=row?JSON.parse(row.history_json) as JumpChatMessage[]:[];
      if(this.histories.size>=32)this.histories.delete(this.histories.keys().next().value!);
      this.histories.set(roomId,history);
    }
    return history.filter(message=>message.sentAt>now-JUMP_SOCIAL_RULES.historyTtlMs);
  }
  joined(id:string,now=Date.now()){
    const roomId=this.hooks.room(id);
    if(roomId!==null)this.hooks.send(id,{type:'jump-chat-history',roomId,messages:this.history(roomId,now)});
  }
  handle(id:string,input:Record<string,unknown>,now=Date.now()):boolean {
    if(input.type!=='jump-chat')return false;
    const roomId=this.hooks.room(id);
    if(roomId===null)throw new GameError('JUMP_INACTIVE','점프 타워에 입장한 뒤 대화해 주세요.');
    if(!this.hooks.enabled())throw new GameError('CHAT_DISABLED','관리자가 채팅을 잠시 중지했어요.');
    const requestId=socialRequestId(input.requestId),text=normalizeChat(input.text);
    const row=this.storage.sql.exec<{receipts_json:string}>('SELECT receipts_json FROM jump_chat_receipts WHERE id=?',id).toArray()[0];
    const receipts:Receipt[]=row?JSON.parse(row.receipts_json):[],receipt=receipts.find(item=>item.requestId===requestId);
    if(receipt){if(receipt.message.text!==text)throw new GameError('REQUEST_REUSED','이미 보낸 요청의 내용을 바꿀 수 없어요.');this.hooks.send(id,{type:'jump-chat',message:receipt.message,requestId});return true;}
    const burst=chatBurstTake(Math.max(this.bursts.get(id)??0,chatBurstReplay(receipts.map(item=>item.message.sentAt))),now);
    if(!burst.ok)throw new GameError('CHAT_COOLDOWN','조금 천천히 이야기해 주세요.',burst.retryAt);
    const message:JumpChatMessage={id:crypto.randomUUID(),playerId:id,nickname:this.hooks.nickname(id),text,sentAt:now,expiresAt:now+JUMP_SOCIAL_RULES.chatTtlMs};
    const history=[...this.history(roomId,now),message].slice(-JUMP_SOCIAL_RULES.historyLimit);
    this.storage.transactionSync(()=>{
      this.storage.sql.exec('DELETE FROM jump_chat_receipts WHERE updated_at<?',now-JUMP_SOCIAL_RULES.historyTtlMs);
      this.storage.sql.exec('DELETE FROM jump_room_chat WHERE updated_at<?',now-JUMP_SOCIAL_RULES.historyTtlMs);
      this.storage.sql.exec('INSERT INTO jump_chat_receipts(id,updated_at,receipts_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,receipts_json=excluded.receipts_json',id,now,JSON.stringify([...receipts,{requestId,message}].slice(-20)));
      this.storage.sql.exec('INSERT INTO jump_room_chat(room_id,updated_at,history_json) VALUES(?,?,?) ON CONFLICT(room_id) DO UPDATE SET updated_at=excluded.updated_at,history_json=excluded.history_json',roomId,now,JSON.stringify(history));
    });
    if(!this.bursts.has(id)&&this.bursts.size>=256)this.bursts.delete(this.bursts.keys().next().value!);
    this.bursts.set(id,burst.fullAt);this.histories.set(roomId,history);this.hooks.broadcast({type:'jump-chat',message,requestId},roomId);return true;
  }
  clear(){this.storage.transactionSync(()=>{this.storage.sql.exec('DELETE FROM jump_room_chat');this.storage.sql.exec('DELETE FROM jump_chat_receipts');});this.histories.clear();this.hooks.broadcast({type:'jump-chat-clear'});}
}
