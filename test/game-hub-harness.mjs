import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function createGameHubHarness(){
 const source=`import {DurableObject} from 'cloudflare:workers';import {GameHub} from './server/game-hub';import {defaultAvatarProfile} from './shared/avatar-catalog';
 export default {fetch(){return new Response('fixture');}};
 export class Fixture extends DurableObject {
  connected=[];packets=[];hub;towerFloors=new Map();towerBests=new Map();changes=0;
  constructor(ctx,env){super(ctx,env);this.resetHub();}
  resetHub(){this.hub=new GameHub(this.ctx.storage,{players:()=>this.connected,send:(id,packet)=>this.packets.push({id,packet}),changed:()=>{this.changes++;},towerFloor:id=>this.towerFloors.get(id)??null,towerBest:id=>this.towerBests.get(id)??0});}
  // Stand-ins for the jump authority: the hub only ever reads these two values.
  setTower(id,floor){if(floor===null)this.towerFloors.delete(id);else this.towerFloors.set(id,floor);}
  setTowerBest(id,best){this.towerBests.set(id,best);}
  towerRoom(id){return this.hub.towerRoom(id);}
  towerProgress(roomId,ranking,now){this.hub.towerProgress(roomId,ranking,now);}
  towerPresence(id,now){this.hub.towerPresence(id,now);}
  towerRanking(roomId,ranking){return this.hub.towerRanking(roomId,ranking);}
  towerRoomChanged(roomId,now){this.hub.towerRoomChanged(roomId,now);}
  location(id){return this.hub.location(id);}
  changeCount(){return this.changes;}
  testConnect(id,nickname,now){this.connected=this.connected.filter(p=>p.id!==id);this.connected.push({id,nickname});this.hub.joined(id,now);return this.hub.snapshot(id,now);}
  testDisconnect(id,now){this.connected=this.connected.filter(p=>p.id!==id);this.hub.left(id,now);}
  command(id,input,now){try{this.hub.handle(id,input,now);return {ok:true,state:this.hub.snapshot(id,now)};}catch(error){return {ok:false,code:error.code,message:error.message,retryAt:error.retryAt};}}
  state(id,now){return this.hub.snapshot(id,now);}
  advance(now){this.hub.advance(now);return this.hub.nextAlarmAt();}
  nextAlarm(){return this.hub.nextAlarmAt();}
  messages(id){return this.packets.filter(p=>p.id===id).map(p=>p.packet);}
  clearMessages(){this.packets=[];}
  internal(){const row=this.ctx.storage.sql.exec('SELECT state_json FROM game_hub_state WHERE id=1').toArray()[0];return row?JSON.parse(row.state_json):null;}
  seedPoints(id,points){const p={...defaultAvatarProfile(),points,wins:0,rewardDay:'',dailyEarned:0,receipts:[]};this.ctx.storage.sql.exec('INSERT INTO avatar_profiles(id,state_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json',id,JSON.stringify(p));this.resetHub();}
  seedProfile(id,profile){const p={...defaultAvatarProfile(),wins:0,rewardDay:'',dailyEarned:0,receipts:[],...profile};this.ctx.storage.sql.exec('INSERT INTO avatar_profiles(id,state_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json',id,JSON.stringify(p));this.resetHub();}
  seedDaily(id,amount,now){const p={...defaultAvatarProfile(),points:amount,earned:amount,wins:0,rewardDay:new Date(now+9*3600000).toISOString().slice(0,10),dailyEarned:amount,receipts:[]};this.ctx.storage.sql.exec('INSERT INTO avatar_profiles(id,state_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json',id,JSON.stringify(p));this.resetHub();}
  rewards(){return this.ctx.storage.sql.exec('SELECT * FROM game_rewards').toArray();}
  close(now){this.hub.close(now);}
  async request(url,id,method='GET',body){const response=await this.hub.route(new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})}),id);return {status:response.status,body:await response.json()};}
 }`;
 const result=await build({stdin:{contents:source,resolveDir:project,sourcefile:'game-fixture.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:*']});
 const mf=new Miniflare(convertV4MiniflareOptions({port:0,cf:false,unsafeInspectDurableObjects:true,workers:[{name:'game-fixture',modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-11-04',durableObjects:{GAMES:{className:'Fixture',useSQLite:true}}}]}));
 const ns=await mf.getDurableObjectNamespace('GAMES'),hub=ns.get(ns.idFromName('test'));
 return {mf,hub:new Proxy(hub,{get:(target,key)=>key==='connect'?target.testConnect.bind(target):key==='disconnect'?target.testDisconnect.bind(target):typeof target[key]==='function'?target[key].bind(target):target[key]})};
}
