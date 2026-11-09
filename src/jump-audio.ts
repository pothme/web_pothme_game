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
        tone('triangle',event.doubleJump?520:300,event.doubleJump?850:540,.16,.18);
        if(event.doubleJump)tone('sine',920,650,.12,.075,.025);
      }else if(event.kind==='land'){
        tone('sine',150,70,.12+intensity*.05,.07+intensity*.14);
        tone('triangle',240,110,.08,.025+intensity*.025);
      }else{
        tone('sine',190,64,.22,.24);
        tone('triangle',event.hitKind==='spikes'?540:420,170,.25,.11,.025);
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
