import type { JumpFeedbackEvent } from './jump-feedback';

export const JUMP_AUDIO_STORAGE_KEY='podeum-jump-audio-muted-v1';
export const JUMP_AUDIO_MAX_VOICES=8;
export type JumpAudioStatus=Readonly<{muted:boolean;active:boolean;ready:boolean;available:boolean;state:'unavailable'|'muted'|'inactive'|'locked'|'ready'}>;
type TrustedGesture=Pick<Event,'isTrusted'>;
type Options={
  onStatus?:(status:JumpAudioStatus)=>void;
  storage?:Pick<Storage,'getItem'|'setItem'>|null;
  createContext?:()=>AudioContext|null;
};
type Voice={oscillator:OscillatorNode;gain:GainNode;end:number};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:min));

/** Short synthesized cues. There is no network request, background loop or
 * automatic audio unlock: a native pointer/key event is required every resume. */
export function createJumpAudio(options:Options={}){
  let storage=options.storage;
  if(storage===undefined){try{storage=typeof localStorage==='undefined'?null:localStorage;}catch{storage=null;}}
  let muted=false;try{muted=storage?.getItem(JUMP_AUDIO_STORAGE_KEY)==='1';}catch{/* Private browsing may deny storage. */}
  const AudioCtor=typeof window==='undefined'?undefined:window.AudioContext??(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  const factory=options.createContext??(()=>AudioCtor?new AudioCtor():null);
  let available=Boolean(options.createContext||AudioCtor),active=false,disposed=false;
  let context:AudioContext|null=null,master:GainNode|null=null;
  const voices=new Set<Voice>(),played=new Set<string>();
  let lastStatus='';
  const status=():JumpAudioStatus=>{
    const ready=!disposed&&!muted&&active&&context?.state==='running';
    return Object.freeze({muted,active,ready,available,state:!available?'unavailable':muted?'muted':!active?'inactive':ready?'ready':'locked'});
  };
  function notify(){const next=status(),key=JSON.stringify(next);if(key!==lastStatus){lastStatus=key;options.onStatus?.(next);}}
  function retire(voice:Voice,stop=false){
    if(!voices.delete(voice))return;
    voice.oscillator.onended=null;
    if(stop)try{voice.oscillator.stop();}catch{/* Already ended. */}
    try{voice.oscillator.disconnect();voice.gain.disconnect();}catch{/* Context already closed. */}
  }
  function stopVoices(){for(const voice of [...voices])retire(voice,true);}
  function suspend(){
    stopVoices();
    if(context&&context.state!=='closed')try{void context.suspend().then(notify,notify);}catch{/* Unsupported state. */}
    notify();
  }
  function unlock(event:TrustedGesture){
    if(disposed||muted||!active||!available||!event.isTrusted)return;
    try{
      if(!context){
        context=factory();
        if(!context){available=false;notify();return;}
        master=context.createGain();master.gain.value=.18;master.connect(context.destination);
        context.onstatechange=()=>{
          // A resume promise can settle after the player has paused or exited.
          if((!active||muted||disposed)&&context?.state==='running')suspend();else notify();
        };
      }
      if(context.state!=='running')void context.resume().then(()=>{
        if(!active||muted||disposed)suspend();else notify();
      },notify);
      notify();
    }catch{available=false;stopVoices();notify();}
  }
  function tone(type:OscillatorType,from:number,to:number,duration:number,amplitude:number,delay=0){
    if(!context||!master||context.state!=='running')return;
    const now=context.currentTime;
    for(const voice of [...voices])if(voice.end<=now)retire(voice);
    while(voices.size>=JUMP_AUDIO_MAX_VOICES)retire(voices.values().next().value!,true);
    const oscillator=context.createOscillator(),gain=context.createGain(),start=now+delay,end=start+duration;
    oscillator.type=type;oscillator.frequency.setValueAtTime(clamp(from,55,1400),start);oscillator.frequency.exponentialRampToValueAtTime(clamp(to,55,1400),end);
    // Eight simultaneous layers at .25 each through a .18 master remain below
    // .36 peak. Sine/triangle waves and short attack/release avoid harsh clicks.
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(clamp(amplitude,0,.25),start+.008);gain.gain.exponentialRampToValueAtTime(.0001,end);
    oscillator.connect(gain);gain.connect(master);
    const voice={oscillator,gain,end:end+.012};voices.add(voice);oscillator.onended=()=>retire(voice);
    oscillator.start(start);oscillator.stop(voice.end);
  }
  function play(event:JumpFeedbackEvent){
    if(disposed||!active||muted||context?.state!=='running'||played.has(event.id))return;
    played.add(event.id);if(played.size>128)played.delete(played.values().next().value!);
    const intensity=clamp(event.intensity,0,1);
    try{
      if(event.kind==='jump'){
        if(event.spring){
          // A rising "boing": the launch is much taller than a jump.
          tone('sine',180,700,.22,.2);tone('triangle',360,1100,.18,.08,.03);
        }else{
          tone('triangle',event.doubleJump?520:300,event.doubleJump?850:540,.16,.18);
          if(event.doubleJump)tone('sine',920,650,.12,.075,.025);
        }
      }else if(event.kind==='land'){
        tone('sine',150,70,.12+intensity*.05,.07+intensity*.14);
        tone('triangle',240,110,.08,.025+intensity*.025);
        if(event.surface==='ice')tone('sine',1300,900,.06,.04);
        else if(event.surface==='conveyor')tone('square',95,70,.05,.03);
      }else if(event.kind==='hit'){
        // Every trap has its own voice over the same low thump.
        switch(event.hitKind){
          case 'pusher':tone('sine',150,58,.2,.25);tone('square',110,70,.12,.06,.01);break;
          case 'hammer':tone('sine',120,55,.26,.25);tone('triangle',300,90,.2,.12,.02);tone('sine',900,500,.08,.05,.05);break;
          case 'laser':tone('sine',190,64,.2,.18);tone('sawtooth',1200,300,.18,.07);tone('sine',700,1300,.12,.07,.03);break;
          case 'saw':tone('sine',170,64,.2,.2);tone('sawtooth',380,140,.22,.08);tone('square',760,420,.1,.04,.04);break;
          case 'cannon':tone('sine',110,55,.27,.25);tone('triangle',200,70,.2,.14,.01);break;
          case 'flame':tone('sine',190,64,.2,.18);tone('sawtooth',160,90,.26,.06);tone('sine',500,900,.2,.07,.03);break;
          default:tone('sine',190,64,.22,.24);tone('triangle',event.hitKind==='spikes'?540:420,170,.25,.11,.025);
        }
      }else if(event.phase==='warn'){
        // Two quick ticks: something on this pad or the next is about to change.
        tone('triangle',880,880,.05,.05*intensity);tone('triangle',1040,1040,.05,.05*intensity,.09);
      }else{
        const level=intensity;
        switch(event.trap){
          case 'spikes':tone('triangle',700,300,.07,.1*level);break;
          case 'pusher':tone('square',120,60,.12,.07*level);tone('sine',140,60,.14,.12*level);break;
          case 'wind':tone('sine',300,520,.28,.06*level);tone('triangle',420,640,.26,.03*level,.02);break;
          case 'cannon':tone('sine',130,55,.25,.18*level);tone('triangle',260,90,.12,.08*level);break;
          case 'flame':tone('sawtooth',120,200,.26,.05*level);tone('sine',400,700,.2,.04*level,.04);break;
          case 'blink':tone('sine',900,300,.14,.08*level);break;
          case 'crumble':tone('triangle',200,70,.25,.12*level);tone('square',90,60,.12,.04*level,.05);break;
          case 'shrink':tone('sine',600,380,.12,.07*level);break;
          // Back on the ground pad: a short falling sigh, then a friendly note upward.
          case 'fall':tone('sine',520,130,.2,.16);tone('triangle',330,660,.08,.1,.2);break;
        }
      }
    }catch{stopVoices();/* Audio failures must never interrupt the simulation. */}
  }
  notify();
  return{
    get status(){return status();},
    unlock,
    play,
    setMuted(value:boolean,event?:TrustedGesture){
      if(disposed)return;muted=Boolean(value);try{storage?.setItem(JUMP_AUDIO_STORAGE_KEY,muted?'1':'0');}catch{/* Optional preference. */}
      if(muted)suspend();else if(event)unlock(event);notify();
    },
    setActive(value:boolean){if(disposed||active===Boolean(value))return;active=Boolean(value);if(!active)suspend();else notify();},
    dispose(){
      if(disposed)return;disposed=true;active=false;stopVoices();played.clear();
      if(context){context.onstatechange=null;try{void context.close().catch(()=>{});}catch{/* Already closed. */}}
      try{master?.disconnect();}catch{/* Already closed. */}notify();
    },
  };
}
