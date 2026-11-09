import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJumpAudio, JUMP_AUDIO_MAX_VOICES, JUMP_AUDIO_STORAGE_KEY } from '../src/jump-audio';
import type { JumpFeedbackEvent } from '../src/jump-feedback';

class FakeParam {
  value=1;values:number[]=[];
  setValueAtTime(value:number,_at:number){this.values.push(value);return this;}
  linearRampToValueAtTime(value:number,_at:number){this.values.push(value);return this;}
  exponentialRampToValueAtTime(value:number,_at:number){this.values.push(value);return this;}
}
class FakeGain {
  gain=new FakeParam();connected=false;
  connect(_target:unknown){this.connected=true;}
  disconnect(){this.connected=false;}
}
class FakeOscillator {
  frequency=new FakeParam();type='sine';onended:(()=>void)|null=null;connected=false;stops:number[]=[];starts:number[]=[];
  connect(_target:unknown){this.connected=true;}
  disconnect(){this.connected=false;}
  start(time=0){this.starts.push(time);}
  stop(time=0){this.stops.push(time);}
}
class FakeContext {
  state:AudioContextState='suspended';currentTime=0;destination={};onstatechange:(()=>void)|null=null;
  resumeCalls=0;suspendCalls=0;closeCalls=0;oscillators:FakeOscillator[]=[];gains:FakeGain[]=[];
  createGain(){const gain=new FakeGain();this.gains.push(gain);return gain;}
  createOscillator(){const oscillator=new FakeOscillator();this.oscillators.push(oscillator);return oscillator;}
  async resume(){this.resumeCalls++;this.state='running';this.onstatechange?.();}
  async suspend(){this.suspendCalls++;this.state='suspended';this.onstatechange?.();}
  async close(){this.closeCalls++;this.state='closed';}
}
const trusted={isTrusted:true},synthetic={isTrusted:false};
const event=(id:string,kind:JumpFeedbackEvent['kind']='jump'):JumpFeedbackEvent=>{
  const base={id,kind,x:0,y:0,z:0,tick:0,intensity:1};
  if(kind==='hit')return{...base,kind,hitKind:'spikes',vx:5,vz:0};
  if(kind==='land')return{...base,kind,impactSpeed:10};
  return{...base,kind,doubleJump:false};
};
function fixture(saved?:string){
  const context=new FakeContext(),values=new Map<string,string>();if(saved)values.set(JUMP_AUDIO_STORAGE_KEY,saved);
  let created=0;
  const audio=createJumpAudio({storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}},createContext:()=>{created++;return context as unknown as AudioContext;}});
  return{audio,context,values,get created(){return created;}};
}

test('context is created and resumed only by a trusted active interaction',async()=>{
  const f=fixture();assert.equal(f.audio.status.muted,false);assert.equal(f.created,0);
  f.audio.unlock(trusted);assert.equal(f.created,0,'inactive game does not start audio');
  f.audio.setActive(true);f.audio.play(event('before-gesture'));f.audio.unlock(synthetic);
  assert.equal(f.created,0);assert.equal(f.audio.status.state,'locked');
  f.audio.unlock(trusted);await Promise.resolve();
  assert.equal(f.created,1);assert.equal(f.context.resumeCalls,1);assert.equal(f.audio.status.ready,true);
  f.audio.play(event('jump'));assert.equal(f.context.oscillators.length,1);
  f.audio.play(event('jump'));assert.equal(f.context.oscillators.length,1,'duplicate event id is silent');
  assert.ok(Object.isFrozen(f.audio.status));f.audio.dispose();
});

test('mute persists, unmute resumes from its gesture, and pause stops all voices',async()=>{
  const f=fixture('1');f.audio.setActive(true);f.audio.unlock(trusted);assert.equal(f.created,0);
  f.audio.setMuted(false,trusted);await Promise.resolve();assert.equal(f.context.resumeCalls,1);assert.equal(f.values.get(JUMP_AUDIO_STORAGE_KEY),'0');
  f.audio.play(event('hit','hit'));assert.equal(f.context.oscillators.filter(osc=>osc.connected).length,2);
  f.audio.setMuted(true);await Promise.resolve();assert.equal(f.context.state,'suspended');assert.equal(f.values.get(JUMP_AUDIO_STORAGE_KEY),'1');
  assert.ok(f.context.oscillators.every(osc=>!osc.connected&&osc.stops.includes(0)));
  f.audio.setMuted(false);assert.equal(f.context.resumeCalls,1,'preference alone cannot resume');
  f.audio.unlock(trusted);await Promise.resolve();f.audio.play(event('land','land'));
  f.audio.setActive(false);await Promise.resolve();assert.equal(f.context.state,'suspended');assert.equal(f.audio.status.state,'inactive');
  const resumes=f.context.resumeCalls;f.audio.setActive(true);assert.equal(f.context.resumeCalls,resumes,'showing the game cannot auto-resume');
  f.audio.dispose();await Promise.resolve();assert.equal(f.context.closeCalls,1);
  f.audio.unlock(trusted);f.audio.play(event('disposed'));assert.equal(f.context.resumeCalls,resumes);
});

test('cue layers, loudness and oscillator count remain bounded during a burst',async()=>{
  const f=fixture();f.audio.setActive(true);f.audio.unlock(trusted);await Promise.resolve();
  for(let i=0;i<40;i++)f.audio.play(event(`hit-${i}`,'hit'));
  assert.equal(f.context.oscillators.filter(osc=>osc.connected).length,JUMP_AUDIO_MAX_VOICES);
  assert.equal(f.context.gains[0].gain.value,.18);
  assert.ok(f.context.gains.slice(1).every(gain=>gain.gain.values.every(value=>value>=0&&value<=.25)));
  assert.ok(f.context.oscillators.every(osc=>osc.frequency.values.every(value=>value>=55&&value<=1400)));
  assert.ok(f.context.oscillators.every(osc=>osc.stops.some(time=>time>0&&time<.3)));
  f.context.currentTime=1;f.audio.play(event('fresh'));
  assert.equal(f.context.oscillators.filter(osc=>osc.connected).length,1,'expired voices are retired even if end callback is delayed');
  f.audio.dispose();
});

test('missing audio and inaccessible preferences fail quietly',()=>{
  const audio=createJumpAudio({storage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}},createContext:()=>null});
  audio.setActive(true);assert.doesNotThrow(()=>audio.unlock(trusted));assert.equal(audio.status.state,'unavailable');
  assert.doesNotThrow(()=>{audio.play(event('silent'));audio.setMuted(true);audio.dispose();});
});

test('pause wins a delayed resume, so audio cannot restart after leaving the game',async()=>{
  const context=new FakeContext();let resolveResume:(()=>void)|undefined;
  context.resume=()=>{context.resumeCalls++;return new Promise<void>(resolve=>{resolveResume=()=>{context.state='running';resolve();};});};
  const audio=createJumpAudio({storage:null,createContext:()=>context as unknown as AudioContext});
  audio.setActive(true);audio.unlock(trusted);audio.setActive(false);resolveResume?.();await Promise.resolve();await Promise.resolve();
  assert.equal(context.state,'suspended');assert.equal(audio.status.ready,false);audio.dispose();
});
