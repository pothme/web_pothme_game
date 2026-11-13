import type { WhisperMessage } from '../shared/whisper';
import { CHAT_HOLD_HINT, createChatOutbox } from './chat-outbox';
import './whisper-ui.css';
type Person={id:string;nickname:string;area?:string};
export function createWhisperUI(options:{send(to:string,text:string,requestId:string):boolean;notify(text:string):void;beforeOpen?():void;onUnread?(count:number):void;now?():number}){
  let me:string|null=null,connected=false,players:Person[]=[],messages:WhisperMessage[]=[],unread=0;
  const button=document.createElement('button');button.type='button';button.textContent='귓속말';button.className='tool-button view-preset podeum-extra-tool';button.setAttribute('aria-label','귓속말 열기');
  const dialog=document.createElement('dialog');dialog.className='whisper-dialog';dialog.setAttribute('aria-labelledby','whisper-title');
  dialog.innerHTML='<header><div><small>PRIVATE MESSAGE</small><h2 id="whisper-title">귓속말</h2></div><button type="button" class="whisper-close" aria-label="귓속말 닫기">닫기 ×</button></header><p class="whisper-note">선택한 상대와 나에게만 보여요. 전체 채팅이나 머리 위 말풍선에는 표시되지 않아요.</p><label for="whisper-recipient">받는 사람</label><select id="whisper-recipient"></select><div class="whisper-log" role="log" aria-label="선택한 상대와의 귓속말"></div><form><input aria-label="귓속말 내용" placeholder="비밀스러운 전략을 나눠보세요" maxlength="160" autocomplete="off"><button type="submit">보내기</button></form><p class="whisper-status" role="status"></p>';
  const select=dialog.querySelector('select')!,log=dialog.querySelector<HTMLDivElement>('.whisper-log')!,form=dialog.querySelector('form')!,input=dialog.querySelector('input')!,submit=form.querySelector('button')!,status=dialog.querySelector<HTMLElement>('.whisper-status')!;
  // Whispers go out back to back; one that does not arrive is handed back to the field.
  const outbox=createChatOutbox({now:options.now??Date.now,timeoutMs:7000,timeoutText:'응답이 늦어지고 있어요. 연결을 확인해 주세요.',read:()=>input.value,write:text=>{input.value=text;},status:text=>{status.textContent=text;},changed:()=>{}});
  function render(){
    const previous=select.value;select.replaceChildren();
    const list=players.filter(p=>p.id!==me);for(const person of list){const option=document.createElement('option');option.value=person.id;option.textContent=person.nickname+(person.area==='games'?' · 게임룸':'');select.append(option);}if(list.some(p=>p.id===previous))select.value=previous;
    if(!list.length){const option=document.createElement('option');option.textContent='접속 중인 다른 사람이 없어요';option.value='';select.append(option);}
    log.replaceChildren();const target=select.value;
    for(const message of messages.filter(m=>m.fromId===target||m.toId===target)){
      const row=document.createElement('div');row.className='whisper-message'+(message.fromId===me?' mine':'');const name=document.createElement('strong'),text=document.createElement('p');name.textContent=message.fromId===me?'나':message.fromNickname;text.textContent=message.text;row.append(name,text);log.append(row);
    }
    if(!log.children.length){const empty=document.createElement('p');empty.className='whisper-empty';empty.textContent='이 상대와 나눈 귓속말이 여기에 표시돼요.';log.append(empty);}
    log.scrollTop=log.scrollHeight;submit.disabled=!connected||!target;input.disabled=!connected||!target;
    button.textContent=unread?`귓속말 ${unread}`:'귓속말';button.setAttribute('aria-label',unread?`귓속말 열기 · 새 메시지 ${unread}개`:'귓속말 열기');
    options.onUnread?.(unread);
  }
  function open(target?:string){
    if(!connected||!me){options.notify('먼저 사무실에 입장해 주세요.');return;}
    options.beforeOpen?.();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other=>{if(other!==dialog)other.close();});render();if(target&&players.some(p=>p.id===target)){select.value=target;render();}unread=0;render();if(!dialog.open)dialog.showModal();input.focus({preventScroll:true});
  }
  button.onclick=()=>open();select.onchange=render;dialog.querySelector<HTMLButtonElement>('.whisper-close')!.onclick=()=>dialog.close();
  form.onsubmit=event=>{
    event.preventDefault();const text=input.value.trim();if(!select.value||!text)return;
    // An empty allowance keeps the text in the field and says so.
    if(!outbox.ready())return;
    const id=outbox.requestId(text,()=>crypto.randomUUID(),select.value);if(!options.send(select.value,text,id)){status.textContent='연결을 확인해 주세요.';return;}
    outbox.sent(id,text,select.value);input.value='';status.textContent='';input.focus({preventScroll:true});
  };
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.isComposing||event.keyCode===229))event.preventDefault();});
  input.addEventListener('input',()=>{outbox.edited();if(status.textContent!==CHAT_HOLD_HINT)status.textContent='';});
  document.body.append(dialog);
  return{button,open,setPlayers(value:Person[]){players=value;if(dialog.open)render();},setSession(id:string|null,online:boolean){if(me!==id){messages=[];unread=0;outbox.reset();}me=id;connected=online;if(!online){outbox.abandon('연결이 끊겨 보내지 못했어요.');if(dialog.open)dialog.close();}render();},receive(message:WhisperMessage,requestId?:unknown){if(!me||(message.fromId!==me&&message.toId!==me))return;outbox.ack(requestId,message.fromId===me?message.sentAt:undefined);if(messages.some(m=>m.id===message.id)){render();return;}messages.push(message);messages=messages.slice(-120);if(message.toId===me&&(!dialog.open||select.value!==message.fromId)){unread++;options.notify(`${message.fromNickname}님이 귓속말을 보냈어요.`);}render();},error(requestId:unknown,message:string,retryAt?:unknown){return outbox.fail(requestId,message,retryAt);},dispose(){outbox.reset();dialog.remove();button.remove();}};
}
