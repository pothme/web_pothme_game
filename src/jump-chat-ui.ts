import type { JumpChatMessage } from '../shared/jump-social';
import { JUMP_CHAT_LIMIT, jumpChatDraft, mergeJumpChats } from './jump-chat-state';

type Options={host:HTMLElement;now:()=>number;send:(text:string,requestId:string)=>boolean;beforeCompose:()=>void;onComposing:(value:boolean)=>void;blocked:()=>boolean;onMessage:(message:JumpChatMessage)=>void};

export function createJumpChatUI(options:Options){
  const panel=document.createElement('section');panel.className='jg-chat is-empty';panel.setAttribute('aria-label','점프 타워 채팅');
  panel.innerHTML='<div class="jg-chat-heading"><strong>함께 올라가기 <span data-chat-online>1명</span></strong><button type="button" data-chat-fold aria-label="최근 대화 4줄로 축소" aria-expanded="true">축소 −</button></div><ol class="jg-chat-log" role="log" aria-label="점프 타워 대화" aria-live="polite" aria-relevant="additions"></ol><button type="button" class="jg-chat-launch" aria-label="점프 타워 채팅 입력 열기">대화하기 · Enter</button><form class="jg-chat-form" hidden><label class="jg-chat-label" for="jump-chat-input">점프 타워 채팅</label><div><input id="jump-chat-input" aria-label="점프 타워 채팅 내용" autocomplete="off" enterkeyhint="send" placeholder="함께 올라가는 사람들과 대화해요" maxlength="160"><button type="submit">보내기</button><button type="button" data-chat-close aria-label="점프 타워 채팅 입력 닫기">×</button></div><small data-chat-hint>80자 · Enter로 보내기</small></form><p class="jg-chat-error" role="status" hidden></p>';
  options.host.append(panel);
  const log=panel.querySelector<HTMLOListElement>('.jg-chat-log')!,form=panel.querySelector<HTMLFormElement>('form')!,input=panel.querySelector<HTMLInputElement>('input')!,sendButton=panel.querySelector<HTMLButtonElement>('button[type="submit"]')!,launch=panel.querySelector<HTMLButtonElement>('.jg-chat-launch')!,fold=panel.querySelector<HTMLButtonElement>('[data-chat-fold]')!,hint=panel.querySelector<HTMLElement>('[data-chat-hint]')!,error=panel.querySelector<HTMLElement>('.jg-chat-error')!;
  const mobile=matchMedia('(max-width:850px), (pointer:coarse)');
  let sessionId:string|null=null,connected=false,enabled=true,visible=false,composing=false,expanded=!mobile.matches,disposed=false,nextSendAt=0;
  let messages:JumpChatMessage[]=[],lastRender='',timer:ReturnType<typeof setInterval>|undefined;
  const pending=new Map<string,{text:string;at:number}>();
  function status(message=''){error.textContent=message;error.hidden=!message;}
  function syncInput(){
    const value=jumpChatDraft(input.value),length=[...value].length;
    const waiting=options.now()<nextSendAt||pending.size>0;
    input.disabled=!connected||!enabled;sendButton.disabled=!connected||!enabled||waiting||!length||length>JUMP_CHAT_LIMIT;
    launch.disabled=!connected||!enabled;
    launch.textContent=!enabled?'관리자가 채팅을 잠시 중지했어요':!connected?'다시 연결되면 대화할 수 있어요':'대화하기 · Enter';
    hint.textContent=length>JUMP_CHAT_LIMIT?`${length} / 80자 · 조금 줄여 주세요`:waiting?'잠시 후 다음 메시지를 보낼 수 있어요':`${length} / 80자 · Enter로 보내기`;
  }
  function render(){
    panel.classList.toggle('is-empty',messages.length===0);panel.classList.toggle('is-collapsed',!expanded);
    fold.setAttribute('aria-expanded',String(expanded));fold.setAttribute('aria-label',expanded?'최근 대화 4줄로 축소':'최근 대화 10줄로 펼치기');fold.textContent=expanded?'축소 −':'펼치기 +';
    const shown=messages.slice(-(expanded?10:4)),key=shown.map(message=>message.id).join('|')+'|'+sessionId;
    if(key!==lastRender){lastRender=key;log.replaceChildren();for(const message of shown){
      const row=document.createElement('li'),name=document.createElement('b'),text=document.createElement('span');
      row.classList.toggle('is-mine',message.playerId===sessionId);name.textContent=message.nickname;text.textContent=message.text;
      row.append(name,text);log.append(row);
    }log.scrollTop=log.scrollHeight;}
    syncInput();
  }
  function close(){if(!composing)return;composing=false;panel.classList.remove('is-composing');form.hidden=true;launch.hidden=false;options.onComposing(false);input.blur();}
  function open(){
    if(!visible||!connected||!enabled||options.blocked())return;
    options.beforeCompose();composing=true;panel.classList.add('is-composing');form.hidden=false;launch.hidden=true;options.onComposing(true);syncInput();input.focus({preventScroll:true});
  }
  function submit(event:SubmitEvent){
    event.preventDefault();if(!connected||!enabled||options.blocked()||pending.size||options.now()<nextSendAt)return;
    const text=jumpChatDraft(input.value);if(!text||[...text].length>JUMP_CHAT_LIMIT){syncInput();return;}
    const requestId=crypto.randomUUID();if(!options.send(text,requestId)){status('연결을 확인한 뒤 다시 보내 주세요.');return;}
    pending.set(requestId,{text,at:options.now()});nextSendAt=options.now()+1200;status();syncInput();
  }
  function receive(message:JumpChatMessage,requestId?:string,history=false){
    const known=messages.some(item=>item.id===message?.id);messages=mergeJumpChats(messages,[message]);
    if(requestId&&pending.has(requestId)){const sent=pending.get(requestId)!;pending.delete(requestId);if(jumpChatDraft(input.value)===sent.text)input.value='';status();if(mobile.matches)close();}
    if(!known&&messages.some(item=>item.id===message?.id)&&!history&&message.expiresAt>options.now())options.onMessage(message);
    render();
  }
  function keydown(event:KeyboardEvent){
    if(!visible||options.blocked()||event.isComposing||event.keyCode===229)return;
    if(composing&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
    if(event.key!=='Enter'||event.repeat)return;
    if(event.target===input){event.preventDefault();event.stopImmediatePropagation();form.requestSubmit();return;}
    if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,button,select,[contenteditable="true"],dialog,[role="dialog"]'))return;
    event.preventDefault();event.stopImmediatePropagation();open();
  }
  function inputKeydown(event:KeyboardEvent){if(event.key==='Enter'&&(event.isComposing||event.keyCode===229))event.preventDefault();}
  function interval(){
    for(const [id,item]of pending)if(options.now()-item.at>8000){pending.delete(id);status('전송 확인이 늦어지고 있어요. 대화 기록을 확인한 뒤 다시 보내 주세요.');}
    syncInput();
  }
  function mobileChanged(){expanded=!mobile.matches;render();}
  launch.onclick=open;fold.onclick=()=>{expanded=!expanded;render();};panel.querySelector<HTMLButtonElement>('[data-chat-close]')!.onclick=close;
  input.addEventListener('input',syncInput);input.addEventListener('keydown',inputKeydown);input.addEventListener('focus',options.beforeCompose);form.addEventListener('submit',submit);window.addEventListener('keydown',keydown,true);mobile.addEventListener('change',mobileChanged);
  render();
  return{
    setSession(id:string|null){if(id!==sessionId){messages=[];pending.clear();input.value='';lastRender='';nextSendAt=0;}sessionId=id;if(!id)close();render();},
    setConnected(value:boolean){connected=value;if(!value){pending.clear();close();}syncInput();},
    setEnabled(value:boolean){enabled=value;if(!value)close();syncInput();},
    setVisible(value:boolean){visible=value;panel.hidden=!value;clearInterval(timer);timer=value?setInterval(interval,500):undefined;if(!value)close();},
    setOnline(count:number){panel.querySelector<HTMLElement>('[data-chat-online]')!.textContent=`${Math.max(0,count)}명`;},
    receive,
    history(value:JumpChatMessage[]){messages=mergeJumpChats(messages,value);render();},
    clear(){messages=[];lastRender='';render();},
    error(requestId:string,message:string){if(!pending.has(requestId))return false;pending.delete(requestId);status(message);syncInput();return true;},
    messages:()=>messages,
    isComposing:()=>composing,
    open,close,
    dispose(){if(disposed)return;disposed=true;close();clearInterval(timer);window.removeEventListener('keydown',keydown,true);mobile.removeEventListener('change',mobileChanged);input.removeEventListener('input',syncInput);input.removeEventListener('keydown',inputKeydown);input.removeEventListener('focus',options.beforeCompose);form.removeEventListener('submit',submit);panel.remove();},
  };
}
