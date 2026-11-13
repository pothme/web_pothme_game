import type { JumpPeerView, JumpChatMessage, JumpRoomRank } from '../shared/jump-social';
import { createJumpChatUI } from './jump-chat-ui';
import { JUMP_COURSE, JUMP_HIT_KINDS, JUMP_RULES, JUMP_SHORTCUTS, JUMP_ZONES, jumpZoneOf, type JumpSnapshot, type JumpPlatformKind, type JumpZone } from '../shared/jump-game';
import { defaultAvatarProfile, type AvatarProfile } from '../shared/avatar-catalog';
import { JumpPrediction } from './jump-client';
import { nextJumpCameraFloor } from './jump-camera';
import { createJumpAudio } from './jump-audio';
import { JumpFeedbackTracker, jumpFallCue } from './jump-feedback';
import { createJumpJoystick } from './jump-joystick';
import type { createJumpGameScene } from './jump-game-scene';
import './jump-game-ui.css';
import './jump-joystick.css';

type Session={id:string;nickname:string};
export type JumpLeader={nickname:string;bestFloor:number;reachedAt:number};
type Options={send:(packet:Record<string,unknown>)=>boolean;now:()=>number;onOpen?:()=>void;onExit:()=>void;onProfile?:(profile:AvatarProfile)=>void;onNotify:(message:string)=>void};
type Scene=ReturnType<typeof createJumpGameScene>;
const TRAPS:Record<JumpPlatformKind,{name:string;tip:string;icon:string}>={
  safe:{name:'안전 발판',tip:'다음 번호의 발판을 향해 점프해요.',icon:'◇'},
  moving:{name:'움직이는 발판',tip:'발판의 이동 방향을 보고 착지해요.',icon:'↔'},
  blink:{name:'점멸 발판',tip:'노란 예고 뒤 잠깐 사라져요. 다시 나타날 때 건너요.',icon:'◌'},
  crumble:{name:'무너지는 발판',tip:'밟은 뒤 0.9초 안에 다음 발판으로!',icon:'▱'},
  sweep:{name:'회전 막대',tip:'닿으면 옆으로 튕겨요. 다가오는 막대를 점프로 넘어요.',icon:'⟳'},
  spikes:{name:'가시 발판',tip:'솟는 가시에 닿으면 튕겨요. 노란 예고를 보고 가장자리로!',icon:'△'},
  wind:{name:'바람 발판',tip:'화살표 방향으로 바람이 불어요. 이동으로 버텨요.',icon:'≈'},
  pusher:{name:'밀대 함정',tip:'예고등 뒤 밀대가 나와요. 옆으로 피하거나 점프로 넘어요.',icon:'⇥'},
  conveyor:{name:'컨베이어 발판',tip:'화살표 방향으로 밀려요. 반대로 걷거나 빨리 건너요.',icon:'»'},
  ice:{name:'얼음 발판',tip:'멈춰도 미끄러져요. 짧게 움직이며 반대 방향으로 제동해요.',icon:'❄'},
  lift:{name:'승강 발판',tip:'위아래로 오르내려요. 꼭대기에서 다음 발판으로 건너요.',icon:'⇅'},
  orbit:{name:'회전 발판',tip:'원을 그리며 돌아요. 가까워질 때 올라타고 내려요.',icon:'◴'},
  shrink:{name:'수축 발판',tip:'노란 예고 뒤 작아졌다가 다시 커져요. 가운데에 서요.',icon:'▣'},
  spring:{name:'스프링 발판',tip:'밟으면 높이 튀어 올라요. 공중에서 한 번 더 점프할 수 있어요.',icon:'⤒'},
  hammer:{name:'진자 망치',tip:'좌우로 흔들려요. 지나간 직후에 건너요.',icon:'⚒'},
  laser:{name:'레이저',tip:'바닥을 훑는 빛줄기를 점프로 넘어요.',icon:'⌇'},
  saw:{name:'톱날 레일',tip:'레일을 따라 톱날이 오가요. 레일 밖에서 기다려요.',icon:'✺'},
  cannon:{name:'대포',tip:'예고등 뒤 느린 포탄이 날아와요. 옆으로 피하거나 뛰어넘어요.',icon:'●'},
  flame:{name:'화염 분사',tip:'발판 절반씩 번갈아 불이 나와요. 예고를 보고 반대쪽으로!',icon:'♨'},
};

/** Same colour code as the scene: red strikes, amber is a pad that gives way, the rest only carries you. */
const HIT_KINDS:readonly string[]=JUMP_HIT_KINDS;
const trapTone=(kind:string)=>HIT_KINDS.includes(kind)||kind==='wind'?'danger':kind==='blink'||kind==='crumble'||kind==='shrink'?'warn':'move';
/** The ground pad is the start, not a floor: the first pad above it is floor 1. */
const floorLabel=(floor:number)=>floor>0?`${floor}F`:'출발';

/** The socket remains owned by main; only authoritative snapshots award points. */
export function createJumpGameUI(options:Options){
  const root=document.createElement('section');root.id='jump-game';root.className='jg';root.hidden=true;root.tabIndex=-1;root.setAttribute('aria-label','포듬 점프 타워');
  root.innerHTML=`<div class="jg-world"></div>
    <header class="jg-header"><div class="jg-brand"><span aria-hidden="true">↟</span><div><small>PODEUM SKY CLUB</small><strong>점프 타워 <i>${JUMP_RULES.floors}F</i></strong></div></div><div class="jg-header-actions"><span class="jg-wallet"><b data-wallet>0</b> PT</span><button type="button" class="jg-sound" data-command="sound" aria-label="효과음 끄기" aria-pressed="false" title="효과음 끄기">♪</button><button type="button" data-command="help" aria-label="일시 정지 및 게임 안내">Ⅱ <span>도움말</span></button><button type="button" data-command="exit" aria-label="타워에서 나가 방으로 돌아가기">나가기 ↩</button></div></header>
    <div class="jg-hud"><div class="jg-floor"><small>현재 층</small><strong><b data-floor>출발</b><i> / ${JUMP_RULES.floors}</i></strong></div><div class="jg-stat jg-best"><small>최고 기록</small><b data-best>출발</b></div><div class="jg-stat jg-zone"><small>구역 <span data-zone-index>1</span> / ${JUMP_ZONES.length}</small><b data-zone>-</b></div><div class="jg-stat jg-earned"><small>획득 포인트</small><b><span data-earned>0</span><i> / <span data-earned-max>${JUMP_RULES.maxRewardPoints}</span> PT</i></b></div><div class="jg-progress" role="progressbar" aria-label="타워 진행도" aria-valuemin="0" aria-valuemax="${JUMP_RULES.floors}" aria-valuenow="0"><i></i></div></div>
    <div class="jg-zone-banner" role="status" aria-live="polite" hidden><small data-banner-range></small><strong data-banner-name></strong><span data-banner-pattern></span></div>
    <div class="jg-connection" role="status" hidden></div><div class="jg-toast" role="status" aria-live="polite" hidden></div>
    <aside class="jg-leaders" aria-label="점프 타워 순위"><button type="button" data-command="leaders" aria-expanded="true"><span>순위 <b data-room-count></b></span><i>−</i></button><div class="jg-leaders-body"><h3>우리 방 <small>지금 · 최고</small></h3><ol data-room-rank><li class="jg-leader-empty">같은 방 사람들의 순위가 여기에 보여요.</li></ol><h3>전체 TOP 3</h3><ol data-top><li>첫 등반 기록을 기다리고 있어요.</li></ol></div></aside>
    <div class="jg-next"><span data-trap-icon aria-hidden="true">◇</span><div><small data-next-floor>다음 1F</small><strong data-trap-name>안전 발판</strong><p data-trap-tip>다음 번호의 발판을 향해 점프해요.</p></div></div>
    <button type="button" class="jg-camera" data-command="camera" aria-label="다음 발판 방향으로 시점 맞추기">◎ <span>다음 발판 보기</span></button>
    <div class="jg-desktop-help"><kbd>W A S D</kbd> 이동 <span>·</span> <kbd>Space</kbd> 2단 점프 <span>·</span> 드래그로 시점 회전</div>
    <div class="jg-touch-controls" aria-label="모바일 게임 조작"><div data-joystick></div><button type="button" class="jg-jump" data-jump><span>↑</span><strong>점프</strong><small data-jump-count>한 번 더 · 2단 점프</small></button></div>
    <div class="jg-shade" data-loading><div class="jg-loading"><span class="jg-loading-icon">↟</span><h2 data-loading-title>하늘 위로 올라가는 중</h2><p data-loading-message>점프 타워를 준비하고 있어요.</p><button type="button" data-command="reload" hidden>다시 연결</button></div></div>
    <div class="jg-shade" data-pause hidden><section class="jg-dialog" role="dialog" aria-modal="true" aria-labelledby="jg-help-title" tabindex="-1"><small>타워는 멈추지 않아요</small><h2 id="jg-help-title">한 층씩, 하늘 가까이</h2><p>발판을 밟아 친구들과 ${JUMP_RULES.floors}층에 도전해요.<br>함정에 닿으면 튕겨요. 공중에서 한 번 더 점프해 버텨보세요.<br>아래 발판에 내려앉으면 거기서 이어 가고, 허공으로 떨어지면 출발 발판으로 돌아가 1층부터 다시 올라요.<br>이 창을 열어도 타워는 계속 움직여요. 쉬어 갈 때는 10층마다 있는 쉼터 발판에 서 주세요.</p><p class="jg-my-record">내 최고 기록 <b data-best-help>출발</b> · 획득 <b data-earned-help>0</b> PT</p><div class="jg-how"><span><kbd>W A S D / 원형 조이스틱</kbd> 이동</span><span><kbd>Space / 점프 버튼</kbd> 공중에서 한 번 더</span><span><kbd>조이스틱 기울이기</kbd> 살짝 밀면 천천히 이동</span><span><kbd>화면 드래그</kbd> 자유 시점</span><span><kbd>◎ 다음 발판 보기</kbd> 자동 시점으로 복귀</span></div><ol class="jg-zones" aria-label="열 개의 구역">${JUMP_ZONES.map(zone=>`<li><b>${zone.from}–${zone.to}F</b>${zone.name}</li>`).join('')}</ol><p class="jg-shortcut">지름길 · ${JUMP_SHORTCUTS.map(route=>`${route.from}F → ${route.to}F`).join(', ')}은 높은 2단 점프로 두 칸을 건너뛸 수 있어요. 건너뛴 층의 포인트도 함께 받아요.</p><p class="jg-legend-key"><span class="is-danger">빨강 · 닿으면 튕겨요</span><span class="is-warn">노랑 · 사라지거나 줄어들어요</span><span class="is-move">초록 · 움직이거나 미끄러워요</span></p><div class="jg-trap-legend">${Object.entries(TRAPS).filter(([kind])=>kind!=='safe').sort(([a],[b])=>['move','warn','danger'].indexOf(trapTone(a))-['move','warn','danger'].indexOf(trapTone(b))).map(([kind,trap])=>`<span class="is-${trapTone(kind)}"><i>${trap.icon}</i>${trap.name}</span>`).join('')}</div><p class="jg-reward-rule">캐릭터당 각 층 첫 도달 +${JUMP_RULES.floorReward}PT · ${JUMP_RULES.floors}층 첫 도달 보너스 +${JUMP_RULES.summitReward}PT<br>최대 ${JUMP_RULES.maxRewardPoints}PT. 떨어져도 받은 보상과 최고 기록은 유지돼요.</p><div class="jg-dialog-actions"><button type="button" data-command="retry">1층부터 다시</button><button type="button" class="jg-primary" data-command="resume">계속 올라가기</button></div></section></div>
    <div class="jg-shade" data-complete hidden><section class="jg-dialog jg-finish" role="dialog" aria-modal="true" aria-labelledby="jg-finish-title" tabindex="-1"><span class="jg-crown" aria-hidden="true">♛</span><small>YOU MADE IT</small><h2 id="jg-finish-title">${JUMP_RULES.floors}층, 정상에 도착!</h2><p data-finish-message>도달 기록과 보상을 확인하고 있어요.</p><div class="jg-finish-reward"><strong data-finish-total>0</strong><span>누적 획득 PT</span></div><p class="jg-reward-rule">층마다 +${JUMP_RULES.floorReward}PT · 정상 보너스 +${JUMP_RULES.summitReward}PT · 캐릭터당 최초 1회</p><div class="jg-dialog-actions"><button type="button" data-command="retry">다시 도전</button><button type="button" class="jg-primary" data-command="exit">방으로 돌아가기</button></div></section></div>`;
  document.body.append(root);
  const $=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
  const world=$('.jg-world'),connection=$('.jg-connection'),toast=$('.jg-toast'),loading=$('[data-loading]'),pause=$('[data-pause]'),complete=$('[data-complete]');
  const refs={floor:$('[data-floor]'),best:$('[data-best]'),bestHelp:$('[data-best-help]'),earnedHelp:$('[data-earned-help]'),zone:$('[data-zone]'),zoneIndex:$('[data-zone-index]'),earned:$('[data-earned]'),earnedMax:$('[data-earned-max]'),zoneBanner:$('.jg-zone-banner'),wallet:$('[data-wallet]'),progress:$('.jg-progress'),progressBar:$('.jg-progress i'),next:$('[data-next-floor]'),trapIcon:$('[data-trap-icon]'),trapName:$('[data-trap-name]'),trapTip:$('[data-trap-tip]'),jumpCount:$('[data-jump-count]')};
  let session:Session|null=null,connected=false,opened=false,disposed=false,paused=false,contextLost=false,sceneFailed=false;
  let profile:AvatarProfile=defaultAvatarProfile(),snapshot:JumpSnapshot|null=null,prediction:JumpPrediction|null=null,scene:Scene|null=null,profileKey=JSON.stringify(profile);
  let sceneGeneration=0,frameId=0,lastFrame=0,accumulator=0,lastFlush=0,lastHud=0,awaitingSync='',exitRun='',retrying=false;
  let bestFloor=0,shownDeaths=0,nextTargetFloor=1,queuedJump=false,previousJump=false,previousFocus:HTMLElement|null=null,resetOnSync=false;
  let peers:JumpPeerView[]=[];
  // -1 until the first zone of this visit has been announced.
  let shownZone=-1,zoneTimer:ReturnType<typeof setTimeout>|undefined,roomRanking:JumpRoomRank[]=[],roomRankKey='';
  const retiredInputs=new Set<string>();
  let toastTimer:ReturnType<typeof setTimeout>|undefined,healthTimer:ReturnType<typeof setInterval>|undefined;
  let leaders:JumpLeader[]=[],leaderKey='',collapsedLeaders=matchMedia('(max-width:700px)').matches;
  const keys=new Set<string>(),pending=new Map<string,{type:string;at:number}>();
  const feedback=new JumpFeedbackTracker();
  const audio=createJumpAudio({onStatus:status=>{root.dataset.sound=status.muted?'muted':status.state;}});
  const joystick=createJumpJoystick($('[data-joystick]'),{canUse:()=>canRun()&&!chat.isComposing(),onGesture:unlockAudio});
  const setText=(element:HTMLElement,text:string)=>{if(element.textContent!==text)element.textContent=text;};
  const chat=createJumpChatUI({host:root,now:options.now,
    send:(text,requestId)=>options.send({type:'jump-chat',text,requestId}),
    beforeCompose:clearControls,onComposing:value=>{root.classList.toggle('is-chatting',value);if(value)clearControls();},
    blocked:()=>paused||!loading.hidden||!complete.hidden||!!exitRun,
    onMessage:message=>scene?.showChat(message),
  });chat.setVisible(false);
  function announceZone(zone:JumpZone){
    setText($('[data-banner-range]'),`ZONE ${zone.index+1} / ${JUMP_ZONES.length} · ${zone.from}–${zone.to}F`);setText($('[data-banner-name]'),zone.name);setText($('[data-banner-pattern]'),zone.pattern);
    clearTimeout(zoneTimer);refs.zoneBanner.hidden=true;void refs.zoneBanner.offsetWidth;refs.zoneBanner.hidden=false;zoneTimer=setTimeout(()=>{refs.zoneBanner.hidden=true;},3200);
  }
  /** Live ranking of this room only: where each member stands now and their best floor of this visit. */
  function setRoomRanking(value:JumpRoomRank[]){
    roomRanking=value.slice(0,50);const own=roomRanking.findIndex(row=>row.id===session?.id),rows=roomRanking.slice(0,5).map((row,index)=>({row,rank:index+1}));
    if(own>=5)rows.push({row:roomRanking[own]!,rank:own+1});
    const key=JSON.stringify(rows)+session?.id;if(key===roomRankKey)return;roomRankKey=key;
    setText($('[data-room-count]'),roomRanking.length?`${roomRanking.length}명`:'');
    const list=$<HTMLOListElement>('[data-room-rank]');list.replaceChildren();
    if(!rows.length){const item=document.createElement('li');item.className='jg-leader-empty';item.textContent='같은 방 사람들의 순위가 여기에 보여요.';list.append(item);}
    for(const {row,rank} of rows){const item=document.createElement('li'),place=document.createElement('i'),name=document.createElement('span'),now=document.createElement('em'),best=document.createElement('strong');item.classList.toggle('is-me',row.id===session?.id);place.textContent=String(rank).padStart(2,'0');name.textContent=row.nickname;now.textContent=floorLabel(row.floor);best.textContent=floorLabel(row.bestFloor);item.append(place,name,now,best);list.append(item);}
  }
  function setPeers(value:JumpPeerView[]){peers=value.slice(0,50);chat.setOnline(peers.length);if(scene&&session)scene.setPeers(session.id,peers);}
  function retireInputs(){for(const [id,request]of pending)if(request.type==='jump-input'){pending.delete(id);retiredInputs.add(id);}while(retiredInputs.size>64)retiredInputs.delete(retiredInputs.values().next().value!);}
  function notify(message:string){if(!opened){options.onNotify(message);return;}clearTimeout(toastTimer);toast.textContent=message;toast.hidden=false;toastTimer=setTimeout(()=>{toast.hidden=true;},3400);}
  function hideToast(){clearTimeout(toastTimer);toast.hidden=true;}
  function command(type:string,extra:Record<string,unknown>={}){
    if(!connected)return '';
    const requestId=crypto.randomUUID();if(!options.send({type,...extra,requestId}))return '';
    pending.set(requestId,{type,at:options.now()});return requestId;
  }
  function clearControls(){keys.clear();joystick.reset();queuedJump=false;previousJump=false;}
  function canPlayAudio(){return opened&&connected&&!paused&&!contextLost&&!sceneFailed&&!retrying&&!exitRun&&!document.hidden&&!!scene&&!!snapshot?.active&&prediction?.state.status==='playing';}
  function unlockAudio(event:Event){audio.setActive(canPlayAudio());audio.unlock(event);}
  function queueJump(){if(canRun()&&!chat.isComposing()&&prediction!.state.jumps<2)queuedJump=true;}
  function flush(){
    if(!prediction||!connected||!snapshot?.active||awaitingSync)return;
    const frames=prediction.outgoing(JUMP_RULES.maxBatchFrames);if(!frames.length)return;
    const id=command('jump-input',{runId:prediction.runId,frames});if(id)prediction.markSent(frames);
    lastFlush=performance.now();
  }
  function canRun(){return opened&&connected&&!paused&&!contextLost&&!sceneFailed&&!awaitingSync&&!retrying&&!exitRun&&!document.hidden&&!!scene&&!!prediction&&!!snapshot?.active;}
  function canRender(){return opened&&!contextLost&&!sceneFailed&&!document.hidden&&!!scene&&!!prediction;}
  function stopAnimation(){cancelAnimationFrame(frameId);frameId=0;lastFrame=0;accumulator=0;audio.setActive(false);}
  function startAnimation(){if(canRender()&&!frameId)frameId=requestAnimationFrame(animate);}
  function sync(resetPrediction=false){
    if(!opened||!connected)return;
    resetOnSync ||= resetPrediction;if(resetOnSync)retireInputs();
    clearControls();accumulator=0;
    if(!awaitingSync)awaitingSync=command('jump-sync');
    updateHud();startAnimation();
  }
  function updateHud(){
    const state=prediction?.state??snapshot?.state;
    bestFloor=Math.max(bestFloor,snapshot?.state.floor??0,...(snapshot?.rewards.earnedFloors??[]));
    const standing=state?.lastFloor??0;setText(refs.floor,standing>0?String(standing):'출발');refs.floor.classList.toggle('is-start',standing<=0);setText(refs.best,floorLabel(bestFloor));setText(refs.bestHelp,floorLabel(bestFloor));const zone=state?jumpZoneOf(Math.max(1,state.lastFloor)):null;setText(refs.zone,zone?.name??'-');setText(refs.zoneIndex,String((zone?.index??0)+1));
    // Announce a zone when the climber first stands in it. A fall back to the first zone is told by the fall notice instead.
    if(zone&&opened&&snapshot?.active&&state?.status==='playing'&&zone.index!==shownZone){if(zone.index>shownZone)announceZone(zone);shownZone=zone.index;}
    setText(refs.earned,String(snapshot?.rewards.totalPoints??0));setText(refs.earnedHelp,`${snapshot?.rewards.totalPoints??0} / ${snapshot?.rewards.maxPoints??JUMP_RULES.maxRewardPoints}`);setText(refs.earnedMax,String(snapshot?.rewards.maxPoints??JUMP_RULES.maxRewardPoints));setText(refs.wallet,Math.max(0,profile.points).toLocaleString('ko-KR'));
    const floor=state?.lastFloor??0;refs.progress.setAttribute('aria-valuenow',String(floor));refs.progressBar.style.width=`${floor/JUMP_RULES.floors*100}%`;
    if(state)nextTargetFloor=nextJumpCameraFloor(state,nextTargetFloor);
    const next=nextTargetFloor,trap=TRAPS[JUMP_COURSE[next].kind];setText(refs.next,state?.status==='complete'?'정상 도착':`다음 ${next}F`);setText(refs.trapIcon,trap.icon);setText(refs.trapName,trap.name);setText(refs.trapTip,trap.tip);
    setText(refs.jumpCount,state?.jumps===1?'지금 한 번 더!':state?.jumps===2?'착지 후 다시 점프':'한 번 더 · 2단 점프');
    root.dataset.jumps=String(state?.jumps??0);root.dataset.paused=String(paused||!connected||!!awaitingSync||retrying||contextLost);
    const message=!connected?'연결이 끊겼어요. 재연결되면 이어서 올라가요.':contextLost?'그래픽 화면을 복구하고 있어요.':awaitingSync?'서버 기록을 확인하고 있어요.':retrying?'출발 발판으로 돌아가는 중…':'';
    connection.hidden=!message;setText(connection,message);
    loading.hidden=!!scene&&!!snapshot?.active&&!sceneFailed;
    setText($('[data-loading-title]'),sceneFailed?'화면을 준비하지 못했어요':'하늘 위로 올라가는 중');
    setText($('[data-loading-message]'),sceneFailed?'다시 연결을 누르면 화면을 새로 준비해요.':!connected?'서버 연결을 기다리고 있어요.':'점프 타워를 준비하고 있어요.');
    $<HTMLButtonElement>('[data-command="reload"]').hidden=!sceneFailed;
    pause.hidden=!paused||!loading.hidden;
    const finished=state?.status==='complete'&&!paused&&loading.hidden;const wasComplete=!complete.hidden;complete.hidden=!finished;
    if(finished){const confirmed=snapshot?.state.status==='complete';setText($('[data-finish-message]'),confirmed?'정상 도달 기록이 저장됐어요. 멋진 등반이었어요!':'도달 기록과 보상을 확인하고 있어요.');setText($('[data-finish-total]'),String(snapshot?.rewards.totalPoints??0));if(!wasComplete)$<HTMLElement>('.jg-finish').focus({preventScroll:true});}
    root.querySelectorAll<HTMLButtonElement>('[data-command="retry"]').forEach(button=>button.disabled=!connected||retrying||!!awaitingSync||!snapshot?.active);
    root.querySelectorAll<HTMLButtonElement>('[data-command="exit"]').forEach(button=>button.disabled=!!exitRun&&connected);
    const controlsEnabled=canRun()&&!finished&&!chat.isComposing();
    $<HTMLButtonElement>('[data-jump]').disabled=!controlsEnabled;joystick.setEnabled(controlsEnabled);
    audio.setActive(canPlayAudio());
    const sound=$<HTMLButtonElement>('[data-command="sound"]'),muted=audio.status.muted;
    sound.setAttribute('aria-pressed',String(muted));sound.setAttribute('aria-label',muted?'효과음 켜기':'효과음 끄기');sound.title=muted?'효과음 켜기':'효과음 끄기';
    setText(sound,muted?'♪̸':'♪');
  }
  function animate(time:number){
    frameId=0;if(!canRender())return;
    const dt=lastFrame?Math.min(80,time-lastFrame):0;lastFrame=time;if(canRun())accumulator+=dt;else accumulator=0;
    while(canRun()&&accumulator>=JUMP_RULES.stepMs){
      accumulator-=JUMP_RULES.stepMs;
      const stick=joystick.value();
      const x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+stick.x;
      const z=Number(keys.has('KeyS')||keys.has('ArrowDown'))-Number(keys.has('KeyW')||keys.has('ArrowUp'))+stick.z;
      const strength=Math.max(1,Math.hypot(x,z));
      const movement=scene!.movement(x/strength,z/strength),jump=queuedJump&&!previousJump&&prediction!.state.tick+1-prediction!.state.lastJumpTick>=JUMP_RULES.minJumpTicks;
      if(jump)queuedJump=false;previousJump=jump;
      const before=prediction!.state,advanced=prediction!.advance({...movement,jump});
      if(!advanced&&prediction!.state.status!=='complete'){sync(true);notify('연결을 확인한 뒤 같은 위치에서 이어갈게요.');break;}
      if(advanced)for(const event of feedback.step(prediction!.runId,prediction!.sequence,before,prediction!.state)){audio.play(event);scene!.playEffect(event);}
      const deaths=prediction!.state.deaths;
      // The scene shows the restart card with the height lost; the HUD only adds the sound.
      if(deaths>shownDeaths){shownDeaths=deaths;scene!.resetCamera(prediction!.state);hideToast();const cue=jumpFallCue(prediction!.runId,prediction!.sequence,before,prediction!.state);if(cue)audio.play(cue);clearControls();}
    }
    if(canRun()&&(time-lastFlush>=200||prediction!.state.status==='complete'))flush();
    scene!.render(prediction!.state,dt/1000,time,options.now());
    if(time-lastHud>100){updateHud();lastHud=time;}
    if(canRender())frameId=requestAnimationFrame(animate);
  }
  function detachScene(){++sceneGeneration;scene?.canvas.removeEventListener('webglcontextlost',onContextLost);scene?.canvas.removeEventListener('webglcontextrestored',onContextRestored);scene?.dispose();scene=null;}
  async function ensureScene(){
    if(scene||!opened||disposed)return;const generation=++sceneGeneration;sceneFailed=false;
    try{const {createJumpGameScene:make}=await import('./jump-game-scene');if(disposed||!opened||generation!==sceneGeneration)return;
      scene=make(world,profile.appearance);if(session)scene.setPeers(session.id,peers);for(const message of chat.messages())if(message.expiresAt>options.now())scene.showChat(message);scene.canvas.addEventListener('webglcontextlost',onContextLost);scene.canvas.addEventListener('webglcontextrestored',onContextRestored);
      if(prediction){scene.resetCamera(prediction.state);scene.render(prediction.state,0,performance.now(),options.now());}updateHud();startAnimation();
    }catch{if(generation!==sceneGeneration)return;sceneFailed=true;updateHud();}
  }
  function onContextLost(event:Event){event.preventDefault();contextLost=true;flush();clearControls();stopAnimation();updateHud();}
  function onContextRestored(){contextLost=false;sync();}
  function setOpen(value:boolean){
    if(opened===value)return;opened=value;root.hidden=!value;
    document.body.classList.toggle('jump-game-open',value);chat.setVisible(value);
    if(value){previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;paused=false;contextLost=false;sceneFailed=false;options.onOpen?.();void ensureScene();root.focus({preventScroll:true});healthTimer=setInterval(checkConnection,1000);}
    else{clearInterval(healthTimer);healthTimer=undefined;stopAnimation();clearControls();clearTimeout(toastTimer);toast.hidden=true;clearTimeout(zoneTimer);refs.zoneBanner.hidden=true;shownZone=-1;setRoomRanking([]);detachScene();awaitingSync='';paused=false;retrying=false;resetOnSync=false;options.onExit();previousFocus?.focus({preventScroll:true});previousFocus=null;}
    updateHud();
  }
  function setPaused(value:boolean){
    if(!opened)return;paused=value;chat.close();clearControls();accumulator=0;
    if(value){flush();updateHud();$<HTMLElement>('.jg-dialog').focus({preventScroll:true});startAnimation();}
    else{updateHud();sync();scene?.canvas.focus({preventScroll:true});}
  }
  function exit(){
    if(!opened||exitRun)return;flush();clearControls();stopAnimation();
    if(snapshot?.active){exitRun=snapshot.runId;if(connected){command('jump-exit',{runId:exitRun});updateHud();}else setOpen(false);}
    else setOpen(false);
  }
  function retry(){if(!snapshot?.active||!connected||retrying||awaitingSync)return;flush();clearControls();stopAnimation();retrying=true;paused=false;command('jump-retry',{runId:snapshot.runId});updateHud();}
  function checkConnection(){
    const now=options.now();
    for(const [id,request]of pending){if(now-request.at<6000)continue;pending.delete(id);if(request.type==='jump-input')continue;
      if(request.type==='jump-enter'||request.type==='jump-sync'||request.type==='jump-retry'||request.type==='jump-exit'){
        retrying=false;if(connected&&opened){if(exitRun)command('jump-exit',{runId:exitRun});else if(!snapshot?.active)awaitingSync=command('jump-enter');else sync();}break;
      }
    }
  }
  function setLeaderboard(value:JumpLeader[]){
    leaders=value.slice(0,3);const key=JSON.stringify(leaders);if(key!==leaderKey){leaderKey=key;const list=$<HTMLOListElement>('[data-top]');list.replaceChildren();
      if(!leaders.length){const item=document.createElement('li');item.className='jg-leader-empty';item.textContent='첫 등반 기록을 기다리고 있어요.';list.append(item);}
      leaders.forEach((leader,index)=>{const item=document.createElement('li'),rank=document.createElement('i'),name=document.createElement('span'),floor=document.createElement('strong');rank.textContent=String(index+1).padStart(2,'0');name.textContent=leader.nickname;floor.textContent=`${leader.bestFloor}F`;item.append(rank,name,floor);list.append(item);});
    }
    const panel=$('.jg-leaders');panel.classList.toggle('is-collapsed',collapsedLeaders);$('[data-command="leaders"]').setAttribute('aria-expanded',String(!collapsedLeaders));setText($('.jg-leaders>button>i'),collapsedLeaders?'+':'−');
  }
  function keydown(event:KeyboardEvent){
    if(!opened)return;
    unlockAudio(event);
    if(event.isComposing||event.keyCode===229)return;
    if(event.code==='Escape'){event.preventDefault();if(!event.repeat)setPaused(!paused);return;}
    if(event.code==='Tab'&&(paused||!complete.hidden)){
      const dialog=paused?pause:complete,buttons=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const first=buttons[0],last=buttons.at(-1);if(!first||!last)return;
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.firstElementChild)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}return;
    }
    if(!['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))return;
    if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement)return;
    if(!canRun()||chat.isComposing())return;event.preventDefault();keys.add(event.code);if(event.code==='Space'&&!event.repeat)queueJump();
  }
  function keyup(event:KeyboardEvent){keys.delete(event.code);}
  function visibility(){if(!opened)return;if(document.hidden){flush();clearControls();stopAnimation();}else if(connected)sync();}
  // The authority plays every missing tick with no input, so losing focus only lets go of the controls: freezing the picture would hide a fall.
  function blur(){if(opened)clearControls();}
  function pointerDown(event:PointerEvent){
    unlockAudio(event);
    const target=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[data-jump]'):null;
    if(!target||target.disabled||!canRun()||chat.isComposing())return;event.preventDefault();target.setPointerCapture(event.pointerId);
    queueJump();
  }
  function click(event:MouseEvent){
    if(event.detail===0&&event.target instanceof Element&&event.target.closest('[data-jump]')){queueJump();return;}
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[data-command]'):null;if(!button||button.disabled)return;
    switch(button.dataset.command){case'sound':audio.setMuted(!audio.status.muted,event);updateHud();break;case'exit':exit();break;case'help':setPaused(true);break;case'resume':setPaused(false);unlockAudio(event);break;case'retry':retry();break;case'camera':if(prediction){scene?.resetCamera(prediction.state);scene?.render(prediction.state,0,performance.now(),options.now());}break;case'leaders':collapsedLeaders=!collapsedLeaders;setLeaderboard(leaders);break;case'reload':detachScene();sceneFailed=false;contextLost=false;void ensureScene();sync();break;}
  }
  root.addEventListener('click',click);root.addEventListener('pointerdown',pointerDown);
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
  setLeaderboard([]);
  return{
    setSession(value:Session|null){if(session?.id!==value?.id){snapshot=null;prediction=null;bestFloor=0;shownDeaths=0;exitRun='';pending.clear();roomRankKey='';}session=value;chat.setSession(value?.id??null);if(!value){setPeers([]);setOpen(false);}else scene?.setPeers(value.id,peers);},
    setConnected(value:boolean){const changed=value!==connected;connected=value;chat.setConnected(value);if(!value){pending.clear();awaitingSync='';clearControls();stopAnimation();}else if(changed){if(exitRun)command('jump-exit',{runId:exitRun});else if(opened){if(snapshot?.active)sync();else awaitingSync=command('jump-enter');}}updateHud();startAnimation();},
    setChatEnabled(value:boolean){chat.setEnabled(value);},
    setPeers,
    setProfile(value:AvatarProfile){const key=JSON.stringify(value);if(key===profileKey)return;profile=value;profileKey=key;scene?.setAppearance(value.appearance);updateHud();},
    setLeaderboard,
    receive(packet:Record<string,unknown>){
      if(packet.type==='jump-presence'&&Array.isArray(packet.peers)){setPeers(packet.peers as JumpPeerView[]);if(Number.isFinite(packet.serverTime))scene?.setServerTime(Number(packet.serverTime));return true;}
      if(packet.type==='jump-positions'&&Array.isArray(packet.players)){
        const byId=new Map(peers.map(peer=>[peer.id,peer]));
        for(const row of packet.players){if(!Array.isArray(row)||row.length!==10)continue;const previous=byId.get(row[0]);if(!previous)continue;byId.set(previous.id,{...previous,x:row[1],y:row[2],z:row[3],vx:row[4],vy:row[5],vz:row[6],grounded:row[7]===1,floor:row[8],jumps:row[9],updatedAt:Number(packet.serverTime)});}
        setPeers([...byId.values()]);if(Number.isFinite(packet.serverTime))scene?.setServerTime(Number(packet.serverTime));return true;
      }
      if(packet.type==='jump-room'&&Array.isArray(packet.ranking)){setRoomRanking((packet.ranking as JumpRoomRank[]).filter(row=>row&&typeof row.id==='string'&&typeof row.nickname==='string'&&Number.isFinite(row.floor)&&Number.isFinite(row.bestFloor)));return true;}
      if(packet.type==='jump-chat'&&packet.message){chat.receive(packet.message as JumpChatMessage,typeof packet.requestId==='string'?packet.requestId:undefined);return true;}
      if(packet.type==='jump-chat-history'&&Array.isArray(packet.messages)){chat.history(packet.messages as JumpChatMessage[]);return true;}
      if(packet.type==='jump-chat-clear'){chat.clear();scene?.clearChats();return true;}
      if(packet.type==='jump-leaderboard'&&Array.isArray(packet.leaders)){setLeaderboard(packet.leaders as JumpLeader[]);return true;}
      const requestId=typeof packet.requestId==='string'?packet.requestId:'',request=pending.get(requestId);
      if(packet.type==='error'&&chat.error(requestId,String(packet.message??'메시지를 보내지 못했어요.'),packet.retryAt))return true;
      if(packet.type==='error'&&retiredInputs.has(requestId)){retiredInputs.delete(requestId);return true;}
      if(packet.type==='error'&&request){pending.delete(requestId);if(requestId===awaitingSync)awaitingSync='';retrying=false;
        if(request.type==='jump-exit'&&packet.code==='JUMP_RUN'){awaitingSync=command('jump-sync');updateHud();return true;}
        if(request.type==='jump-exit'){exitRun='';if(snapshot?.active)setOpen(true);}notify(String(packet.message??'점프 타워 연결을 확인해 주세요.'));
        if(request.type==='jump-enter')setOpen(false);else if(request.type==='jump-input'&&opened)sync(true);else if(request.type==='jump-sync'&&opened)setPaused(true);updateHud();return true;
      }
      if(packet.type!=='jump-state')return false;
      const next=packet.state as JumpSnapshot|undefined;if(!next?.state||typeof next.runId!=='string')return true;
      pending.delete(requestId);if(Number.isFinite(next.serverTime))scene?.setServerTime(next.serverTime);
      if(next.active&&snapshot?.runId===next.runId&&next.ackSeq<snapshot.ackSeq)return true;
      const previous=snapshot,newRun=!prediction||prediction.runId!==next.runId;
      const wasSync=!!request&&(request.type==='jump-sync'||request.type==='jump-enter');
      if(requestId===awaitingSync||!requestId&&awaitingSync)awaitingSync='';
      if(request?.type==='jump-retry')retrying=false;
      snapshot=next;const nextProfileKey=JSON.stringify(next.profile);profile=next.profile;
      if(nextProfileKey!==profileKey){profileKey=nextProfileKey;scene?.setAppearance(profile.appearance);options.onProfile?.(profile);}setLeaderboard(next.leaderboard??leaders);
      if(!next.active){exitRun='';prediction=null;setOpen(false);return true;}
      if(exitRun&&(next.runId!==exitRun||request?.type==='jump-sync')){exitRun=next.runId;command('jump-exit',{runId:exitRun});updateHud();return true;}
      if(!prediction)prediction=new JumpPrediction(next);else if(wasSync&&resetOnSync)prediction.reset(next);else prediction.reconcile(next,wasSync);
      if(newRun||wasSync||request?.type==='jump-retry')feedback.reset(prediction.runId,prediction.state,prediction.sequence);
      if(wasSync)resetOnSync=false;
      // Server welcome can resume an active run after a browser reload.
      // Do not reopen in response to an in-flight batch after an offline exit.
      if(!opened&&!exitRun)setOpen(true);
      if(newRun||request?.type==='jump-retry'){nextTargetFloor=Math.min(JUMP_RULES.floors,(next.state.standingFloor??next.state.lastFloor)+1);shownDeaths=next.state.deaths;scene?.resetCamera(prediction.state,request?.type==="jump-retry"?"retry":undefined);}
      if(previous&&opened){const reward=next.rewards.totalPoints-previous.rewards.totalPoints;if(reward>0)notify(`+${reward} PT · ${next.state.status==='complete'?'정상 보상까지 받았어요!':`${next.state.floor}F 첫 도달!`}`);
      }
      if(opened&&next.state.deaths>shownDeaths){shownDeaths=next.state.deaths;scene?.resetCamera(prediction.state);hideToast();const cue=previous?jumpFallCue(next.runId,next.ackSeq,previous.state,next.state):null;if(cue)audio.play(cue);clearControls();}
      if(wasSync||newRun||request?.type==='jump-retry')lastFlush=performance.now()+100;
      updateHud();if(opened&&prediction&&!canRender())scene?.render(prediction.state,0,performance.now(),options.now());startAnimation();return true;
    },
    open(){if(disposed||opened)return;if(!session){options.onNotify('사무실에 입장한 뒤 게임룸에서 점프 타워 방에 참가해 주세요.');return;}setOpen(true);if(connected)awaitingSync=command('jump-enter');updateHud();},
    isOpen(){return opened;},
    dispose(){if(disposed)return;disposed=true;if(opened)setOpen(false);chat.dispose();joystick.dispose();audio.dispose();clearInterval(healthTimer);clearTimeout(toastTimer);clearTimeout(zoneTimer);stopAnimation();detachScene();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);root.remove();},
  };
}
