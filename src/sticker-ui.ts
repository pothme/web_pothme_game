import { SHOP_ITEMS } from '../shared/avatar-catalog';

/** Only item IDs cross the wire; the server owns the displayed sticker text. */
export function createStickerUI(options:{send(itemId:string,requestId:string):boolean;notify(text:string):void;onShop():void;beforeOpen():void}) {
  const button=document.createElement('button');button.type='button';button.className='tool-button view-preset podeum-extra-tool';button.textContent='이모티콘';button.setAttribute('aria-haspopup','dialog');
  const dialog=document.createElement('dialog');dialog.className='whisper-dialog sticker-dialog';dialog.setAttribute('aria-label','채팅 이모티콘');
  const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.textContent='채팅 이모티콘';close.type='button';close.textContent='닫기 ×';close.onclick=()=>dialog.close();header.append(title,close);
  const list=document.createElement('div');list.className='sticker-choices';const help=document.createElement('p');help.textContent='구매한 이모티콘을 사무실 채팅과 말풍선으로 보내요.';
  const shop=document.createElement('button');shop.type='button';shop.textContent='포인트 상점';shop.onclick=()=>{dialog.close();options.onShop();};dialog.append(header,help,list,shop);document.body.append(dialog);
  let owned:string[]=[],online=false,pending:string|null=null,timer:ReturnType<typeof setTimeout>|undefined;
  function render(){list.replaceChildren();for(const item of SHOP_ITEMS.filter(x=>x.category==='emoji'&&owned.includes(x.id))){const choice=document.createElement('button');choice.type='button';choice.textContent=item.emoji!;choice.disabled=!online||!!pending;choice.onclick=()=>{const id=crypto.randomUUID();if(!options.send(item.id,id)){options.notify('사무실에 연결한 뒤 사용할 수 있어요.');return;}pending=id;render();clearTimeout(timer);timer=setTimeout(()=>{pending=null;render();},7000);dialog.close();};list.append(choice);}if(!list.children.length)list.textContent='상점에서 이모티콘을 해금하면 여기에 표시돼요.';button.disabled=!online;}
  button.onclick=()=>{options.beforeOpen();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other=>other.close());render();dialog.showModal();};render();
  return{button,setOwned(ids:string[]){owned=ids;render();},setConnected(value:boolean){online=value;if(!value){pending=null;clearTimeout(timer);dialog.close();}render();},receive(id:unknown){if(!pending||id!==pending)return false;pending=null;clearTimeout(timer);render();return true;},error(id:unknown,text:string){if(!this.receive(id))return false;options.notify(text);return true;},dispose(){clearTimeout(timer);dialog.remove();button.remove();}};
}
