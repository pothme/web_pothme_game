import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function createJumpHarness(){
 const source=`import {DurableObject} from 'cloudflare:workers';import {GameHub} from './server/game-hub';import {JumpGame} from './server/jump-game';import {JUMP_COURSE,createJumpState,getJumpPlatformView} from './shared/jump-game';import {defaultAvatarProfile} from './shared/avatar-catalog';
 export default {fetch(){return new Response('fixture');}};
 export class Fixture extends DurableObject {
  connected=[];packets=[];allowed=true;fault=false;hub;jump;events=[];
  constructor(ctx,env){super(ctx,env);this.reset();}
  reset(){this.hub=new GameHub(this.ctx.storage,{players:()=>this.connected,send:(id,packet)=>this.packets.push({id,packet})});this.jump=new JumpGame(this.ctx.storage,{isConnected:id=>this.connected.some(p=>p.id===id),canEnter:()=>this.allowed,nickname:id=>this.connected.find(p=>p.id===id)?.nickname??'visitor',send:(id,packet)=>this.packets.push({id,packet}),profile:(id,now)=>this.hub.profile(id,now),awardFloors:(id,floors,now,commit)=>this.hub.awardExternalBatch(id,floors.map(floor=>({token:'jump-v1:floor:'+floor,amount:floor===60?301:1})),now,()=>{commit?.();if(this.fault){this.fault=false;throw new Error('injected progress persistence failure');}}),onEnter:id=>this.events.push(['enter',id]),onExit:id=>this.events.push(['exit',id]),changed:id=>this.events.push(['changed',id])});}
  testConnect(id,nickname,now){this.connected=this.connected.filter(p=>p.id!==id);this.connected.push({id,nickname});this.jump.joined(id,now);return this.jump.snapshot(id,now);}
  testDisconnect(id,now){this.connected=this.connected.filter(p=>p.id!==id);this.jump.left(id,now);}
  command(id,input,now){try{return {ok:true,handled:this.jump.handle(id,input,now),state:this.jump.snapshot(id,now)};}catch(error){return {ok:false,code:error.code,message:error.message,state:this.jump.snapshot(id,now)};}}
  state(id,now){return this.jump.snapshot(id,now);}
  restart(){this.reset();}
  permit(value){this.allowed=value;}
  failNext(){this.fault=true;}
  prepareState(id,state,now){this.jump.snapshot(id,now);const run=this.jump.runs.get(id);run.state=state;run.budgetMs=300;run.budgetAt=now;return this.jump.snapshot(id,now);}
  prepareLanding(id,floor,now){const snapshot=this.jump.snapshot(id,now),run=this.jump.runs.get(id);const state={...createJumpState(Math.floor((floor-1)/10)*10,Math.floor(now/20)),floor:floor-1,grounded:false,standingFloor:null,jumps:1,vy:-1};while(!getJumpPlatformView(JUMP_COURSE[floor],state.tick+1,state).active)state.tick++;state.invulnerableUntil=state.tick+9999;const view=getJumpPlatformView(JUMP_COURSE[floor],state.tick+1,state);state.x=view.x;state.z=view.z;state.y=view.y+.01;run.state=state;run.budgetMs=300;run.budgetAt=now;return this.jump.snapshot(id,now);}
  seedDaily(id,amount,now){const p={...defaultAvatarProfile(),points:amount,earned:amount,wins:0,rewardDay:new Date(now+9*3600000).toISOString().slice(0,10),dailyEarned:amount,receipts:[]};this.ctx.storage.sql.exec('INSERT INTO avatar_profiles(id,state_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json',id,JSON.stringify(p));this.reset();}
  rewards(){return this.ctx.storage.sql.exec('SELECT * FROM game_rewards ORDER BY created_at').toArray();}
  records(){return this.ctx.storage.sql.exec('SELECT * FROM jump_runs').toArray();}
  leaders(){return this.jump.leaderboard();}
  messages(){return this.packets;}
  clearMessages(){this.packets=[];}
  close(now){this.jump.close(now);}
 }`;
 const result=await build({stdin:{contents:source,resolveDir:project,sourcefile:'jump-fixture.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:*']});
 const mf=new Miniflare(convertV4MiniflareOptions({port:0,cf:false,unsafeInspectDurableObjects:true,workers:[{name:'jump-fixture',modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-11-04',durableObjects:{JUMP:{className:'Fixture',useSQLite:true}}}]}));
 const ns=await mf.getDurableObjectNamespace('JUMP'),jump=ns.get(ns.idFromName('test'));
 return{mf,jump:new Proxy(jump,{get:(target,key)=>key==='connect'?target.testConnect.bind(target):key==='disconnect'?target.testDisconnect.bind(target):typeof target[key]==='function'?target[key].bind(target):target[key]})};
}
