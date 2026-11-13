import type { JumpChatMessage } from '../shared/jump-social';
import { createChatOutbox } from './chat-outbox';
import { JUMP_CHAT_LIMIT, jumpChatDraft, mergeJumpChats } from './jump-chat-state';

type Options={host:HTMLElement;now:()=>number;send:(text:string,requestId:string)=>boolean;beforeCompose:()=>void;onComposing:(value:boolean)=>void;blocked:()=>boolean;onMessage:(message:JumpChatMessage)=>void};

export function createJumpChatUI(options:Options){
  const panel=document.createElement('section');panel.className='jg-chat is-empty';panel.setAttribute('aria-label','점프 타워 채팅');
  panel.innerHTML='<div class="jg-chat-heading"><strong>함께 올라가기 <span data-chat-online>1명</span></strong><button type="button" data-chat-fold aria-label="최근 대화 4줄로 축소" aria-expanded="true">축소 −</button></div><ol class="jg-chat-log" role="log" aria-label="점프 타워 대화" aria-live="polite" aria-relevant="additions"></ol><button type="button" class="jg-chat-launch" aria-label="점프 타워 채팅 입력 열기"><i aria-hidden="true">💬</i><span data-chat-launch>대화하기</span><b data-chat-unread hidden></b></button><form class="jg-chat-form" hidden><label class="jg-chat-label" for="jump-chat-input">점프 타워 채팅</label><div><input id="jump-chat-input" aria-label="점프 타워 채팅 내용" autocomplete="off" enterkeyhint="send" placeholder="함께 올라가는 사람들과 대화해요" maxlength="160"><button type="submit">보내기</button><button type="button" data-chat-close aria-label="점프 타워 채팅 입력 닫기">×</button></div><small data-chat-hint></small></form><p class="jg-chat-error" role="status" hidden></p>';
  options.host.append(panel);
  const log=panel.querySelector<HTMLOListElement>('.jg-chat-log')!,form=panel.querySelector<HTMLFormElement>('form')!,input=panel.querySelector<HTMLInputElement>('input')!,sendButton=panel.querySelector<HTMLButtonElement>('button[type="submit"]')!,launch=panel.querySelector<HTMLButtonElement>('.jg-chat-launch')!,launchText=panel.querySelector<HTMLElement>('[data-chat-launch]')!,unreadBadge=panel.querySelector<HTMLElement>('[data-chat-unread]')!,fold=panel.querySelector<HTMLButtonElement>('[data-chat-fold]')!,hint=panel.querySelector<HTMLElement>('[data-chat-hint]')!,error=panel.querySelector<HTMLElement>('.jg-chat-error')!;
  const mobile=matchMedia('(max-width:850px), (pointer:coarse)');
  // A phone has no Enter key to point at, and its chat is one round button until it is tapped.
  const touch=matchMedia('(pointer:coarse)'),compact=matchMedia('(max-width:700px)');
  // A message that came back while the composer was closed: on a phone the field is hidden then, so the round button says so.
  let unread=0,returnedUnseen=false;
  const setUnread=(value:number)=>{unread=value;unreadBadge.hidden=!value&&!returnedUnseen;unreadBadge.textContent=returnedUnseen?'!':value>9?'9+':String(value);panel.classList.toggle('has-returned',returnedUnseen);launch.setAttribute('aria-label',returnedUnseen?'점프 타워 채팅 입력 열기 · 보내지 못한 메시지가 있어요':value?`점프 타워 채팅 입력 열기 · 새 메시지 ${value}개`:'점프 타워 채팅 입력 열기');};
  const setReturned=(value:boolean)=>{if(returnedUnseen!==value){returnedUnseen=value;setUnread(unread);}};
  let sessionId:string|null=null,connected=false,enabled=true,visible=false,composing=false,expanded=!mobile.matches,disposed=false;
  let messages:JumpChatMessage[]=[],lastRender='',timer:ReturnType<typeof setInterval>|undefined;
  function status(message=''){error.textContent=message;error.hidden=!message;if(!message)setReturned(false);}
  // Any number of messages may be on the wire; one that does not arrive is handed back to the field.
  const outbox=createChatOutbox({now:options.now,timeoutMs:8000,timeoutText:'전송 확인이 늦어지고 있어요. 대화 기록을 확인한 뒤 다시 보내 주세요.',read:()=>input.value,write:text=>{input.value=text;},status,changed:()=>syncInput(),returned:()=>{if(!composing)setReturned(true);}});
  function syncInput(){
    const value=jumpChatDraft(input.value),length=[...value].length;
    const waiting=outbox.waiting();
    input.disabled=!connected||!enabled;sendButton.disabled=!connected||!enabled||waiting||!length||length>JUMP_CHAT_LIMIT;
    launch.disabled=!connected||!enabled;
    launchText.textContent=!enabled?'관리자가 채팅을 잠시 중지했어요':!connected?'다시 연결되면 대화할 수 있어요':touch.matches?'대화하기':'대화하기 · Enter';
    hint.textContent=length>JUMP_CHAT_LIMIT?`${length} / 80자 · 조금 줄여 주세요`:touch.matches?`${length} / 80자`:`${length} / 80자 · Enter로 보내기`;
  }
  function render(){
    panel.classList.toggle('is-empty',messages.length===0);panel.classList.toggle('is-collapsed',!expanded);
    fold.setAttribute('aria-expanded',String(expanded));fold.setAttribute('aria-label',expanded?'최근 대화 4줄로 축소':'최근 대화 10줄로 펼치기');fold.textContent=expanded?'축소 −':'펼치기 +';
    const shown=messages.slice(-(expanded||composing&&compact.matches?10:4)),key=shown.map(message=>message.id).join('|')+'|'+sessionId;
    if(key!==lastRender){lastRender=key;log.replaceChildren();for(const message of shown){
      const row=document.createElement('li'),name=document.createElement('b'),text=document.createElement('span');
      row.classList.toggle('is-mine',message.playerId===sessionId);name.textContent=message.nickname;text.textContent=message.text;
      row.append(name,text);log.append(row);
    }log.scrollTop=log.scrollHeight;}
    syncInput();
  }
  function close(){if(!composing)return;composing=false;panel.classList.remove('is-composing');form.hidden=true;launch.hidden=false;options.onComposing(false);input.blur();render();}
  function open(){
    if(!visible||!connected||!enabled||options.blocked())return;
    options.beforeCompose();composing=true;returnedUnseen=false;setUnread(0);panel.classList.add('is-composing');form.hidden=false;launch.hidden=true;options.onComposing(true);render();input.focus({preventScroll:true});
  }
  function sendDraft(){
    if(!connected||!enabled||options.blocked())return;
    const text=jumpChatDraft(input.value);if(!text||[...text].length>JUMP_CHAT_LIMIT){syncInput();return;}
    // An empty allowance keeps the text in the field and says so.
    if(!outbox.ready())return;
    const requestId=outbox.requestId(text,()=>crypto.randomUUID());if(!options.send(text,requestId)){status('연결을 확인한 뒤 다시 보내 주세요.');return;}
    // The field is free at once; the composer stays open for the next line, on a phone too.
    status();outbox.sent(requestId,text);input.value='';syncInput();
  }
  function submit(event:SubmitEvent){event.preventDefault();sendDraft();if(document.activeElement===sendButton)input.focus({preventScroll:true});}
  function receive(message:JumpChatMessage,requestId?:string,history=false){
    const known=messages.some(item=>item.id===message?.id);messages=mergeJumpChats(messages,[message]);
    outbox.ack(requestId,message?.sentAt);
    if(!known&&messages.some(item=>item.id===message?.id)&&!history&&message.expiresAt>options.now()){options.onMessage(message);if(!composing&&message.playerId!==sessionId)setUnread(unread+1);}
    render();
  }
  function keydown(event:KeyboardEvent){
    if(!visible||options.blocked()||event.isComposing||event.keyCode===229)return;
    if(composing&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
    if(event.key!=='Enter'||event.repeat)return;
    if(event.target===input){event.preventDefault();event.stopImmediatePropagation();sendDraft();return;}
    if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,button,select,[contenteditable="true"],dialog,[role="dialog"]'))return;
    event.preventDefault();event.stopImmediatePropagation();open();
  }
  function inputKeydown(event:KeyboardEvent){if(event.key==='Enter'&&(event.isComposing||event.keyCode===229))event.preventDefault();}
  function interval(){syncInput();}
  function edited(){outbox.edited();syncInput();}
  function mobileChanged(){expanded=!mobile.matches;render();}
  launch.onclick=open;fold.onclick=()=>{expanded=!expanded;render();};panel.querySelector<HTMLButtonElement>('[data-chat-close]')!.onclick=close;
  input.addEventListener('input',edited);input.addEventListener('keydown',inputKeydown);input.addEventListener('focus',options.beforeCompose);form.addEventListener('submit',submit);window.addEventListener('keydown',keydown,true);mobile.addEventListener('change',mobileChanged);
  render();
  return{
    setSession(id:string|null){if(id!==sessionId){messages=[];outbox.reset();input.value='';status();lastRender='';returnedUnseen=false;setUnread(0);}sessionId=id;if(!id)close();render();},
    setConnected(value:boolean){connected=value;if(!value){close();outbox.abandon('연결이 끊겨 보내지 못했어요.');}syncInput();},
    setEnabled(value:boolean){enabled=value;if(!value)close();syncInput();},
    setVisible(value:boolean){visible=value;panel.hidden=!value;clearInterval(timer);timer=value?setInterval(interval,500):undefined;if(!value){close();setUnread(0);}},
    setOnline(count:number){panel.querySelector<HTMLElement>('[data-chat-online]')!.textContent=`${Math.max(0,count)}명`;},
    receive,
    history(value:JumpChatMessage[]){messages=mergeJumpChats(messages,value);render();},
    clear(){messages=[];lastRender='';setUnread(0);render();},
    error(requestId:string,message:string,retryAt?:unknown){return outbox.fail(requestId,message,retryAt);},
    messages:()=>messages,
    isComposing:()=>composing,
    open,close,
    dispose(){if(disposed)return;disposed=true;close();clearInterval(timer);outbox.reset();window.removeEventListener('keydown',keydown,true);mobile.removeEventListener('change',mobileChanged);input.removeEventListener('input',edited);input.removeEventListener('keydown',inputKeydown);input.removeEventListener('focus',options.beforeCompose);form.removeEventListener('submit',submit);panel.remove();},
  };
}
