import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, normalizeAvatarAppearance, type AppearanceKey, type AvatarAppearance } from '../shared/avatar-appearance';
import { appearanceUnlock, defaultAvatarProfile, type AvatarProfile } from '../shared/avatar-catalog';
import './avatar-customizer.css';

const STORAGE = 'podeumgo.appearance.v2';
const TITLES:Record<AppearanceKey,string>={species:'캐릭터',face:'얼굴형',hair:'헤어',skin:'피부 · 털색',hairColor:'헤어 색',top:'상의',bottom:'하의',shoes:'신발',headwear:'머리 장식',eyewear:'안경 · 고글',neckwear:'목 · 가슴 장식',backwear:'등 · 가방'};
const TABS = [
  {id:'face',label:'캐릭터',keys:['species','face','skin']},
  {id:'hair',label:'헤어',keys:['hair','hairColor']},
  {id:'outfit',label:'의상',keys:['top','bottom','shoes']},
  {id:'accessory',label:'액세서리',keys:['headwear','eyewear','neckwear','backwear']},
] as const;
export type AvatarTryOn = {key:AppearanceKey;value:string};
const THUMBNAIL_SLOTS:readonly AppearanceKey[]=['top','bottom','shoes','headwear','eyewear','neckwear','backwear'];
export function createAvatarCustomizer(options:{onSaved(profile:AvatarProfile):void;notify(text:string):void;onShop():void;beforeOpen?():void}) {
  let profile=defaultAvatarProfile(), draft:AvatarAppearance={...DEFAULT_APPEARANCE}, saving=false, loading=false, generation=0;
  let activeTab:typeof TABS[number]['id']='face';
  let preview: {update(value:AvatarAppearance):void;dispose():void}|undefined;
  let thumbnailCleanup:(()=>void)|undefined,thumbnailGeneration=0,thumbnailsPending=false,thumbnailsFailed=false;
  try { profile.appearance=normalizeAvatarAppearance(JSON.parse(localStorage.getItem(STORAGE)??'null')); } catch { /* Optional local preview. */ }
  const button=document.createElement('button');button.type='button';button.className='avatar-customize-entry';button.id='avatar-customize-entry';
  button.innerHTML='<span aria-hidden="true">✦</span><span><b>내 캐릭터 꾸미기</b><small>얼굴 · 헤어 · 옷 · 동물 친구들</small></span><span aria-hidden="true">↗</span>';
  const dialog=document.createElement('dialog');dialog.className='avatar-studio';dialog.setAttribute('aria-labelledby','avatar-studio-title');
  dialog.innerHTML=`<header><div><small>PODEUM CHARACTER STUDIO</small><h2 id="avatar-studio-title">나의 캐릭터</h2></div><button type="button" class="av-close" aria-label="캐릭터 꾸미기 닫기">닫기 ×</button></header><div class="av-layout"><section class="av-preview-column"><div class="av-preview" aria-label="선택한 캐릭터 3D 미리보기"></div><p class="av-preview-hint">사무실에서 함께할 나의 모습</p><div class="av-selection-name"></div><div class="av-preview-tools"><button type="button" class="av-random">↻ 새로운 조합</button><button type="button" class="av-default" title="상의·하의·신발을 흰 러닝셔츠·반바지·슬리퍼로 변경">기본 복장</button><button type="button" class="av-restore" title="저장된 캐릭터 모습으로 돌아가기">되돌리기</button></div></section><div class="av-options-pane"><nav class="av-tabs" aria-label="꾸미기 분류">${TABS.map(tab=>`<button type="button" data-avatar-tab="${tab.id}" aria-pressed="${activeTab===tab.id}">${tab.label}</button>`).join('')}</nav><p class="av-tryon-notice" role="status" hidden></p><section class="av-options" aria-label="캐릭터 꾸미기 옵션"></section></div></div><footer><p class="av-status" role="status">기본 꾸미기는 무료예요. 게임 포인트로 특별 의상을 만나보세요.</p><div><button type="button" class="av-shop">포인트 상점</button><button type="button" class="av-save">이 모습으로 선택</button></div></footer>`;
  const host=dialog.querySelector<HTMLElement>('.av-preview')!,choices=dialog.querySelector<HTMLElement>('.av-options')!,status=dialog.querySelector<HTMLElement>('.av-status')!,save=dialog.querySelector<HTMLButtonElement>('.av-save')!;
  const groups=new Map<AppearanceKey,HTMLDivElement>();
  function stopThumbnails(){++thumbnailGeneration;thumbnailCleanup?.();thumbnailCleanup=undefined;thumbnailsPending=false;thumbnailsFailed=false;}
  function startThumbnails(){
    if(!dialog.open||!['outfit','accessory'].includes(activeTab)||thumbnailCleanup||thumbnailsPending||thumbnailsFailed)return;
    const current=++thumbnailGeneration;thumbnailsPending=true;
    void import('./avatar-thumbnails').then(({mountAvatarThumbnails})=>{
      if(current!==thumbnailGeneration||!dialog.open)return;
      thumbnailCleanup=mountAvatarThumbnails(choices);
    }).catch(()=>{if(current===thumbnailGeneration){thumbnailsFailed=true;choices.querySelectorAll<HTMLImageElement>('img[data-avatar-slot]').forEach(image=>image.dataset.thumbnailState='error');}}).finally(()=>{if(current===thumbnailGeneration)thumbnailsPending=false;});
  }
  function unownedSelections(){return(Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]).flatMap(key=>{const item=appearanceUnlock(key,draft[key]);return item&&!profile.owned.includes(item.id)?[item]:[];});}
  function applyTryOn(selection?:AvatarTryOn){
    if(!selection||!APPEARANCE_OPTIONS[selection.key]?.some(option=>option.id===selection.value))return;
    (draft as Record<string,string>)[selection.key]=selection.value;
    activeTab=TABS.find(tab=>(tab.keys as readonly string[]).includes(selection.key))!.id;
  }
  for(const key of Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]) {
    const section=document.createElement('section'),label=document.createElement('h3'),group=document.createElement('div');
    const thumbnailSlot=THUMBNAIL_SLOTS.includes(key);
    label.textContent=TITLES[key];group.className=`av-choice-grid av-${key}${thumbnailSlot?' av-item-grid':''}`;group.setAttribute('role','group');group.setAttribute('aria-label',TITLES[key]);
    for(const option of APPEARANCE_OPTIONS[key]) {
      const item=document.createElement('button');item.type='button';item.dataset.value=option.id;item.setAttribute('aria-pressed','false');
      if(thumbnailSlot){
        item.classList.add('av-item-card');
        const frame=document.createElement('span');frame.className='av-item-thumb';frame.setAttribute('aria-hidden','true');
        if(option.id==='none'){frame.classList.add('av-item-remove');frame.textContent='⊘';}
        else{
          const image=document.createElement('img');image.dataset.avatarSlot=key;image.dataset.avatarValue=option.id;image.width=128;image.height=128;image.alt='';image.decoding='async';
          const placeholder=document.createElement('span');placeholder.className='av-thumb-placeholder';placeholder.textContent='3D';frame.append(image,placeholder);
        }
        item.append(frame);
      }else if('color'in option){const dot=document.createElement('i');dot.style.backgroundColor=option.color;dot.setAttribute('aria-hidden','true');item.append(dot);}
      const text=document.createElement('span');text.className='av-option-name';text.textContent=option.label;item.append(text);
      item.onclick=()=>{if(saving||loading)return;(draft as Record<string,string>)[key]=option.id;render();preview?.update(draft);};group.append(item);
    }
    section.append(label,group);choices.append(section);groups.set(key,group);
  }
  function render(){
    const tabKeys:readonly string[]=TABS.find(tab=>tab.id===activeTab)!.keys;
    dialog.querySelectorAll<HTMLButtonElement>('[data-avatar-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.avatarTab===activeTab)));
    for(const [key,group]of groups){
      group.parentElement!.hidden=!tabKeys.includes(key);
      for(const item of group.querySelectorAll<HTMLButtonElement>('button')){
        const locked=appearanceUnlock(key,item.dataset.value!);const isLocked=!!locked&&!profile.owned.includes(locked.id);
        item.disabled=saving||loading;item.setAttribute('aria-pressed',String(draft[key]===item.dataset.value));
        item.classList.toggle('av-locked',isLocked);item.title=isLocked?`${locked!.price} PT · 눌러서 입어보기 · 구매 후 저장할 수 있어요`:'';
        const card=item.classList.contains('av-item-card');
        let badge=item.querySelector('small');if((isLocked||card)&&!badge){badge=document.createElement('small');item.append(badge);}if(badge){if(isLocked)badge.textContent=`🔒 ${locked!.price} PT`;else if(card)badge.textContent=item.dataset.value==='none'?'장식 해제':locked?'보유':'무료';else badge.remove();}
      }
    }
    dialog.querySelector('.av-selection-name')!.textContent=APPEARANCE_OPTIONS.species.find(x=>x.id===draft.species)!.label+' · '+APPEARANCE_OPTIONS.top.find(x=>x.id===draft.top)!.label;
    const unowned=unownedSelections(),notice=dialog.querySelector<HTMLElement>('.av-tryon-notice')!;
    notice.hidden=!unowned.length;notice.textContent=unowned.length?`입어보기 중 · 미보유 ${unowned.length}개 (${unowned.reduce((sum,item)=>sum+item.price,0)} PT). 구매 후 저장하거나 되돌려 주세요.`:'';
    save.disabled=saving||loading||unowned.length>0;save.textContent=saving?'저장 중…':unowned.length?'구매 후 선택 가능':'이 모습으로 선택';
    dialog.querySelectorAll<HTMLButtonElement>('.av-preview-tools button').forEach(button=>button.disabled=saving||loading);
    startThumbnails();
  }
  function setProfile(value:AvatarProfile){profile={...value,appearance:normalizeAvatarAppearance(value.appearance),owned:[...value.owned]};try{localStorage.setItem(STORAGE,JSON.stringify(profile.appearance));}catch{} if(!dialog.open)draft={...profile.appearance};}
  async function loadProfile(current:number,selection?:AvatarTryOn){
    loading=true;render();status.textContent='저장된 캐릭터를 불러오고 있어요.';
    try {await fetch('/api/session',{credentials:'same-origin',signal:AbortSignal.timeout(10000)});if(current!==generation)return;const response=await fetch('/api/avatar/profile',{credentials:'same-origin',signal:AbortSignal.timeout(10000)});const result=await response.json();if(current!==generation)return;if(!response.ok||!result.profile)throw new Error(result.message||'캐릭터를 불러오지 못했어요.');setProfile(result.profile);draft={...profile.appearance};applyTryOn(selection);preview?.update(draft);status.textContent=`보유 ${profile.points} PT · 잠긴 아이템도 입어볼 수 있어요.`;}
    catch(error){if(current===generation)status.textContent=error instanceof Error?error.message:'연결을 확인해 주세요.';}
    finally{if(current===generation){loading=false;render();}}
  }
  async function open(selection?:AvatarTryOn){
    options.beforeOpen?.();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other=>other.close());draft={...profile.appearance};applyTryOn(selection);const current=++generation;dialog.showModal();render();
    host.textContent='캐릭터를 준비하고 있어요.';
    void loadProfile(current,selection);
    try {const {createAvatarPreview}=await import('./avatar-preview');if(current!==generation||!dialog.open)return;host.replaceChildren();preview=createAvatarPreview(host,draft);}
    catch{if(current===generation){host.textContent='3D 미리보기를 열지 못했어요. 옵션 선택과 저장은 계속 사용할 수 있어요.';}}
  }
  button.onclick=()=>void open();dialog.querySelector<HTMLButtonElement>('.av-close')!.onclick=()=>dialog.close();
  dialog.querySelectorAll<HTMLButtonElement>('[data-avatar-tab]').forEach(button=>button.onclick=()=>{activeTab=button.dataset.avatarTab as typeof activeTab;choices.scrollTop=0;render();});
  dialog.querySelector<HTMLButtonElement>('.av-default')!.onclick=()=>{if(saving||loading)return;draft={...draft,top:DEFAULT_APPEARANCE.top,bottom:DEFAULT_APPEARANCE.bottom,shoes:DEFAULT_APPEARANCE.shoes};render();preview?.update(draft);};
  dialog.querySelector<HTMLButtonElement>('.av-restore')!.onclick=()=>{if(saving||loading)return;draft={...profile.appearance};render();preview?.update(draft);};
  dialog.querySelector<HTMLButtonElement>('.av-random')!.onclick=()=>{
    if(saving||loading)return;
    for(const key of Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]){const available=APPEARANCE_OPTIONS[key].filter(item=>{const locked=appearanceUnlock(key,item.id);return!locked||profile.owned.includes(locked.id);});(draft as Record<string,string>)[key]=available[Math.floor(Math.random()*available.length)].id;}render();preview?.update(draft);
  };
  dialog.querySelector<HTMLButtonElement>('.av-shop')!.onclick=()=>{dialog.close();options.onShop();};
  save.onclick=async()=>{
    if(saving||loading||unownedSelections().length)return;const submittedGeneration=generation;saving=true;render();status.textContent='캐릭터를 저장하고 있어요.';
    try{const response=await fetch('/api/avatar/equip',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({appearance:draft,requestId:crypto.randomUUID()}),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok||!result.profile)throw new Error(result.message||'저장하지 못했어요. 다시 시도해 주세요.');setProfile(result.profile);options.onSaved(profile);if(submittedGeneration===generation){dialog.close();options.notify('내 캐릭터를 저장했어요.');}}
    catch(error){if(submittedGeneration===generation)status.textContent=error instanceof Error?error.message:'저장하지 못했어요.';}finally{saving=false;render();}
  };
  dialog.addEventListener('close',()=>{++generation;stopThumbnails();preview?.dispose();preview=undefined;host.replaceChildren();});document.body.append(dialog);
  return{button,open,read:()=>({...profile.appearance}),setProfile,dispose(){++generation;stopThumbnails();preview?.dispose();dialog.remove();button.remove();}};
}
