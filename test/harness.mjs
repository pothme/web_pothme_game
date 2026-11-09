import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureSource = `
 import worker, { Classroom } from './server/index.ts';
 import {JUMP_COURSE,JUMP_RULES,createJumpState,getJumpPlatformView} from './shared/jump-game.ts';
 export default worker;
 const realNow = Date.now.bind(Date); let offset = 0, frozenNow = null; Date.now = () => frozenNow ?? realNow() + offset;
 export class FixtureClassroom extends Classroom {
   failNextSave = false;
   saveOffice(state) { if (this.failNextSave) { this.failNextSave = false; throw new Error('Injected office save failure'); } return super.saveOffice(state); }
   async testFailSave() { this.failNextSave = true; }
   async testAvatarPoints(id,points) { const previous=this.games.profile(id),profile={...previous,points,wins:previous.wins,rewardDay:'',dailyEarned:0,receipts:[]};this.ctx.storage.sql.exec('INSERT INTO avatar_profiles(id,state_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json',id,JSON.stringify(profile));this.games.profiles.delete(id); }
   async testGames(id) { return id ? this.games.snapshot(id) : this.players().map(player=>({id:player.id,nickname:player.nickname,state:this.games.snapshot(player.id)})); }
   async testNextGameAlarm() { const next=this.games.nextAlarmAt();if(next!==null){offset=next+1-realNow();await this.alarm();}return this.testGames(); }
   async testUsageSnapshot(snapshot) { if (snapshot === null) this.usage.get = Object.getPrototypeOf(this.usage).get.bind(this.usage); else this.usage.get = async () => snapshot; }
   async testLegacyMovement(id) { for (const socket of this.sockets()) { const player = this.attachment(socket); if (player.id === id) { delete player.movementDelta; socket.serializeAttachment(player); } } }
   async testStoreOffice(state) { this.ctx.storage.sql.exec('INSERT INTO office_state (id,state_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json',JSON.stringify(state)); }
   async testPreviousManagement() { const runtime={...this.runtime}; delete runtime.managementVersion; this.ctx.storage.sql.exec('UPDATE room_runtime SET state_json=? WHERE id=1',JSON.stringify(runtime)); await this.ctx.storage.setAlarm(Date.now()+30000); }
   async testPreviousSupport(settings = {}) { const runtime={...this.runtime,settings:{...this.runtime.settings,...settings}}; delete runtime.donationSetupVersion; this.ctx.storage.sql.exec('UPDATE room_runtime SET state_json=? WHERE id=1',JSON.stringify(runtime)); }
   async testLegacyReceipt(id,symbol,requestId) {
     const command={type:'chart-propose',symbol,requestId};
     const receipt={requestId,signature:JSON.stringify(command),response:{type:'chart-ack',action:'propose',requestId,voteId:'legacy-receipt-vote'}};
     this.ctx.storage.sql.exec('INSERT INTO office_users (id,next_proposal_at,receipts_json) VALUES (?,0,?) ON CONFLICT(id) DO UPDATE SET receipts_json=excluded.receipts_json',id,JSON.stringify([receipt]));
   }
   async testTowerStates() { return this.sockets().map(socket=>this.attachment(socket)).filter(player=>this.jump.isActive(player.id)).map(player=>({nickname:player.nickname,state:this.jump.snapshot(player.id)})); }
   async testTowerPreview(floor = 0, mode = 'standing') {
     const platform=JUMP_COURSE[Math.max(0,Math.min(59,Math.floor(floor)))],now=Date.now();
     for(const socket of this.sockets()) {
       const player=this.attachment(socket);if(!this.jump.isActive(player.id))continue;
       const run=this.jump.read(player.id,now),tick=Math.floor(now/JUMP_RULES.stepMs),state=createJumpState(Math.floor(platform.floor/10)*10,tick);
       const view=getJumpPlatformView(platform,tick,state);Object.assign(state,{x:view.x,y:view.y,z:view.z,floor:platform.floor,standingFloor:platform.floor,invulnerableUntil:mode==='safe'?tick+100000:0});
       if(mode==='jump'){state.y+=1.6;state.vy=2;state.grounded=false;state.standingFloor=null;state.jumps=1;state.lastJumpTick=tick-18;}
       this.jump.save(player.id,{...run,state,runId:crypto.randomUUID(),ackSeq:0,budgetMs:JUMP_RULES.networkCreditMs,budgetAt:now});this.jump.emit(player.id,now);
     }
     this.publishJumpPresence(true);return {floor:platform.floor,kind:platform.kind,mode};
   }
   async testFreezeClock(now = Date.now()) { frozenNow = now; return now; }
   async testClock(now, runAlarm = true) { if (frozenNow !== null) frozenNow = now; else offset = now - realNow(); if (runAlarm) await this.alarm(); return this.testSnapshot(); }
   async testFinishVote() { if (this.office.vote) offset = this.office.vote.deadline + 1 - realNow(); await this.alarm(); return this.testSnapshot(); }
   async testPositions(points) { const now = Date.now(); for (const socket of this.sockets()) { const player = this.attachment(socket), point = points[player.id]; if (point) socket.serializeAttachment({ ...player, ...point, seat: null, normalMoveAt: now, normalMoveCredit: 0, lastMoveAt: now }); } this.broadcast({ type:'players',players:this.players() }); return this.testSnapshot(); }
   async testViewSpot(point) { const state = await this.testPositions(Object.fromEntries(this.players().map(player => [player.id, point]))); for (const socket of this.sockets()) this.send(socket, {type:'position-correction', ...point, roundId:null, serverTime:Date.now()}); return {players:state.players}; }
   async testPreviousLayout(points = {}, version = 2) {
     const runtime = { ...this.runtime }; if (version === null) delete runtime.layoutVersion; else runtime.layoutVersion = version;
     this.ctx.storage.sql.exec('UPDATE room_runtime SET state_json = ? WHERE id = 1', JSON.stringify(runtime));
     for (const socket of this.sockets()) { const player = this.attachment(socket); const attachment = { ...player, ...points[player.id], normalMoveCredit: 999 }; if (version === null) delete attachment.layoutVersion; else attachment.layoutVersion = version; socket.serializeAttachment(attachment); }
     return this.testSnapshot();
   }
   async testMigratePlayers() { this.migratePlayerLayouts(); return this.testSnapshot(); }
   async testLegacy(open = false) {
     this.ctx.storage.sql.exec('INSERT OR REPLACE INTO accounts (id,nickname,balance,next_play_at,color,receipts_json) VALUES (?, ?, ?, ?, ?, ?)', 'a'.repeat(64), '보존계정', 12345, 987654321, 123456, '[{"legacy":true}]');
     this.ctx.storage.sql.exec('INSERT OR REPLACE INTO board (id,text,author,color,created_at) VALUES (?, ?, ?, ?, ?)', 'legacy-board', '보존할 글', '보존계정', '#fff', 1);
     this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room_runtime (id,state_json) VALUES (1,?)', JSON.stringify({roomOpen:open,drops:[{id:'old-drop'}],nextDropAt:Date.now()+1000}));
     this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room_state (id,state_json) VALUES (1,?)', JSON.stringify({round:{id:'old-round',deadline:Date.now()+1000,participants:{bad:{}}},nextRoundAt:Date.now()+1000,roundNumber:7,lastRound:{id:'old-last'}}));
     await this.ctx.storage.setAlarm(Date.now()+1000);
   }
   async testSnapshot() { const legacy=this.ctx.storage.sql.exec('SELECT state_json FROM room_state WHERE id=1').toArray()[0]; return { office:this.office,runtime:this.runtime,storedRuntime:JSON.parse(this.ctx.storage.sql.exec('SELECT state_json FROM room_runtime WHERE id=1').toArray()[0].state_json),players:this.players(),attachments:this.sockets().map(socket=>this.attachment(socket)),alarmAt:await this.ctx.storage.getAlarm(),accounts:this.ctx.storage.sql.exec('SELECT id,nickname,balance,next_play_at,receipts_json FROM accounts').toArray(),board:this.ctx.storage.sql.exec('SELECT * FROM board').toArray(),legacy:legacy?JSON.parse(legacy.state_json):null }; }
 }
`;
export async function createHarness({ port = 0, assets = false, adminPassword = 'podeumgo-local-fixture-admin-2026-only', koreanChartsEnabled = true } = {}) {
 const bundled = await build({stdin:{contents:fixtureSource,resolveDir:project,sourcefile:'test-fixture.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:*']});
 const serve = async request => {
   if (!assets) return new Response('test static asset');
   const mobileUrl = new URL(request.url);
   if (mobileUrl.pathname === '/__mobile-preview') {
     const width = [320,390,844].includes(Number(mobileUrl.searchParams.get('width'))) ? Number(mobileUrl.searchParams.get('width')) : 390;
     const height = width === 844 ? 390 : 844;
     const route = mobileUrl.searchParams.get('view') === 'markets' ? '/markets' : mobileUrl.searchParams.get('view') === 'admin' ? '/admin' : '/';
     return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Local responsive fixture</title><style>html,body{margin:0;background:#172536}iframe{display:block;border:0;width:${width}px;height:${height}px}</style></head><body><iframe title="Mobile preview" src="${route}"></iframe></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
   }
   // Local-only density fixture: exercise the real app's drawing buffer at a
   // phone pixel ratio even when the desktop browser reports DPR 1. No public hook.
   if (mobileUrl.pathname === '/' && [1,1.5,1.7,2,3].includes(Number(mobileUrl.searchParams.get('__testDpr')))) {
     const dpr = Number(mobileUrl.searchParams.get('__testDpr'));
     const html = await readFile(path.join(project,'dist/index.html'),'utf8');
     const compositorProbe = mobileUrl.searchParams.has('__chartCompositing') ? `<script>addEventListener('DOMContentLoaded',()=>{
       const style=document.createElement('style');document.head.append(style);
       const css=document.createElement('textarea');css.setAttribute('aria-label','Local chart CSS test');
       Object.assign(css.style,{position:'fixed',left:'4px',top:'50px',zIndex:'100000',width:'185px',height:'30px'});
       css.addEventListener('input',()=>style.textContent=css.value);document.body.append(css);
     });</script>` : '';
     return new Response(html.replace('<head>',`<head><script>Object.defineProperty(window,'devicePixelRatio',{value:${dpr},configurable:true});</script>${compositorProbe}`),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
   }
   const dist=path.join(project,'dist'),pathname=decodeURIComponent(new URL(request.url).pathname),filename=path.resolve(dist, "." + (['/','/admin','/admin/','/markets','/markets/','/support','/support/'].includes(pathname)?'/index.html':pathname));
   if (!filename.startsWith(dist+path.sep)) return new Response('Forbidden',{status:403});
   try { return new Response(await readFile(filename),{headers:{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}}); } catch { return new Response('Not found',{status:404}); }
 };
 const options={port,host:'127.0.0.1',cf:false,unsafeInspectDurableObjects:true,workers:[{name:'podeumgo-fixture',modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-11-04',bindings:{ADMIN_PASSWORD:adminPassword,...(koreanChartsEnabled===null?{}:{KOREAN_CHARTS_ENABLED:String(koreanChartsEnabled)})},durableObjects:{CLASSROOM:{className:'FixtureClassroom',useSQLite:true}},serviceBindings:{ASSETS:serve}}]};
 const mf=new Miniflare(convertV4MiniflareOptions(options));
 const room=new Proxy({}, {get:(_,method)=>async(...args)=>{const ns=await mf.getDurableObjectNamespace('CLASSROOM');return ns.get(ns.idFromName('podeumgo-one-classroom'))[method](...args);}});
 let revision=0;
 const restart=async(changes={})=>{if(Object.hasOwn(changes,'koreanChartsEnabled')){if(changes.koreanChartsEnabled===null)delete options.workers[0].bindings.KOREAN_CHARTS_ENABLED;else options.workers[0].bindings.KOREAN_CHARTS_ENABLED=String(changes.koreanChartsEnabled);}options.workers[0].script=bundled.outputFiles[0].text+'\n//reload '+(++revision);await mf.setOptions(convertV4MiniflareOptions(options));};
 return {mf,room,restart};
}
