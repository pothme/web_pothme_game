import { SHOP_ITEMS } from '../shared/avatar-catalog';
import type { ChatBurstMirror } from '../shared/chat-burst';
import { CHAT_HOLD_HINT } from './chat-outbox';

/** Only item IDs cross the wire; the server owns the displayed sticker text. */
export function createStickerUI(options:{send(itemId:string,requestId:string):boolean;notify(text:string):void;onShop():void;beforeOpen():void;burst?:ChatBurstMirror}) {
  const button=document.createElement('button');button.type='button';button.className='tool-button view-preset podeum-extra-tool';button.textContent='이모티콘';button.setAttribute('aria-haspopup','dialog');
  const dialog=document.createElement('dialog');dialog.className='whisper-dialog sticker-dialog';dialog.setAttribute('aria-label','채팅 이모티콘');
  const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.textContent='채팅 이모티콘';close.type='button';close.textContent='닫기 ×';close.onclick=()=>dialog.close();header.append(title,close);
  const list=document.createElement('div');list.className='sticker-choices';const help=document.createElement('p');help.textContent='구매한 이모티콘을 사무실 채팅과 말풍선으로 보내요.';
  const shop=document.createElement('button');shop.type='button';shop.textContent='포인트 상점';shop.onclick=()=>{dialog.close();options.onShop();};dialog.append(header,help,list,shop);document.body.append(dialog);
  let owned:string[]=[],online=false;
  // Stickers share the office chat allowance; several may be on the wire at once.
  const pending=new Map<string,ReturnType<typeof setTimeout>>();
  function render(){list.replaceChildren();for(const item of SHOP_ITEMS.filter(x=>x.category==='emoji'&&owned.includes(x.id))){const choice=document.createElement('button');choice.type='button';choice.textContent=item.emoji!;choice.disabled=!online;choice.onclick=()=>{if(options.burst?.retryAt()){options.notify(CHAT_HOLD_HINT);return;}const id=crypto.randomUUID();if(!options.send(item.id,id)){options.notify('사무실에 연결한 뒤 사용할 수 있어요.');return;}options.burst?.take();pending.set(id,setTimeout(()=>pending.delete(id),7000));dialog.close();};list.append(choice);}if(!list.children.length)list.textContent='상점에서 이모티콘을 해금하면 여기에 표시돼요.';button.disabled=!online;}
  button.onclick=()=>{options.beforeOpen();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other=>other.close());render();dialog.showModal();};render();
  return{button,setOwned(ids:string[]){owned=ids;render();},setConnected(value:boolean){online=value;if(!value){for(const timer of pending.values())clearTimeout(timer);pending.clear();dialog.close();}render();},receive(id:unknown){if(typeof id!=='string'||!pending.has(id))return false;clearTimeout(pending.get(id));pending.delete(id);return true;},error(id:unknown,text:string,retryAt?:unknown){if(!this.receive(id))return false;if(typeof retryAt==='number')options.burst?.reject(retryAt);options.notify(text);return true;},dispose(){for(const timer of pending.values())clearTimeout(timer);dialog.remove();button.remove();}};
}
