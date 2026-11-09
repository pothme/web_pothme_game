import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';
import {identity,join,admin,login,manage,setCharts,origin,type Message} from './office-helpers';
import { DEFAULT_CHARTS } from '../shared/office-charts';
const rearChartSymbols = DEFAULT_CHARTS.slice(4).map(market => market.symbol);
import {MAP_LAYOUT_VERSION,SEATS,SOFAS,REFRESHMENT_STATION,isWalkable,nearestWalkable} from '../shared/classroom-layout';
const plain=(value:unknown):Message=>JSON.parse(JSON.stringify(value));

test('older v7 layout preserves occupied lounge seats and a standing visitor with their tray', {timeout:30000},async()=>{
 const {mf,room}=await createHarness();
 try {
  const a=await join(mf,await identity(mf),'소파유지동료'),b=await join(mf,await identity(mf),'창가이동동료');
  a.send({type:'sit',seat:15,requestId:'v7-kept-seat'});await a.wait(m=>m.requestId==='v7-kept-seat');
  await room.testPositions({[b.welcome.me.id]:{x:REFRESHMENT_STATION.standX,z:REFRESHMENT_STATION.standZ}});
  b.send({type:'refreshments',refreshments:{drink:'coffee',snack:'cookie'},requestId:'v7-kept-tray'});await b.wait(m=>m.requestId==='v7-kept-tray');
  const oldStanding={x:-37.9,z:-10,seat:null};
  const before=plain(await room.testPreviousLayout({[a.welcome.me.id]:{x:15.1,z:-6.9,seat:15},[b.welcome.me.id]:oldStanding},7));
  const after=plain(await room.testMigratePlayers());
  const seated=after.players.find((p:Message)=>p.id===a.welcome.me.id),standing=after.players.find((p:Message)=>p.id===b.welcome.me.id);
  assert.deepEqual({x:seated.x,z:seated.z,seat:seated.seat},{x:15.1,z:-6.9,seat:15});
  assert.deepEqual({x:standing.x,z:standing.z,seat:standing.seat},oldStanding);
  assert.deepEqual(standing.refreshments,{drink:'coffee',snack:'cookie'});
  assert.ok(isWalkable(standing.x,standing.z));
  assert.ok(after.attachments.every((p:Message)=>p.layoutVersion===MAP_LAYOUT_VERSION));
  assert.deepEqual(after.accounts,before.accounts);assert.deepEqual(after.office,before.office);assert.deepEqual(after.runtime.settings,before.runtime.settings);
 }finally{await mf.dispose();}
});

test('v8 to v9 preserves original sofa and table seat ids while moving a newly obstructed visitor only to the nearest aisle', {timeout:30000},async()=>{
 const {mf,room}=await createHarness();
 try {
  const auth=await login(mf);
  const settings={action:'settings',notice:'가구 추가 후에도 유지할 안내',donationUrl:'https://qr.kakaopay.com/local-layout-test',chatEnabled:false};
  assert.equal((await manage(mf,auth,settings)).status,200);
  await setCharts(mf,auth,['NASDAQ:TQQQ','KRX:005930','BINANCE:ETHUSDT','AMEX:SOXL',...rearChartSymbols],'5');
  const originals=[{seat:15,x:15.1,z:-6.9},{seat:24,x:-34,z:-19.9},{seat:31,x:31.6,z:-17.5}];
  const occupants=[];
  for(const original of originals){
   const client=await join(mf,await identity(mf),`기존자리${original.seat}`);
   const requestId=`v8-seat-${original.seat}`;client.send({type:'sit',seat:original.seat,requestId});
   assert.equal((await client.wait(m=>m.requestId===requestId)).seat,original.seat);
   occupants.push({client,original});
  }
  const visitor=await join(mf,await identity(mf),'새소파앞동료');
  const oldStanding={x:-34,z:6,seat:null};
  assert.equal(isWalkable(oldStanding.x,oldStanding.z),false,'new sofa occupies previously clear floor');
  const points:Record<string,{x:number;z:number;seat:number|null}>=Object.fromEntries(occupants.map(({client,original})=>[client.welcome.me.id,original]));
  points[visitor.welcome.me.id]=oldStanding;
  const before=plain(await room.testPreviousLayout(points,8));
  const after=plain(await room.testMigratePlayers());
  for(const {client,original} of occupants){
   const seated=after.players.find((p:Message)=>p.id===client.welcome.me.id);
   assert.deepEqual({x:seated.x,z:seated.z,seat:seated.seat},original,'old table ids must not become new sofa ids');
   const correction=await client.wait(m=>m.type==='position-correction');
   assert.deepEqual({x:correction.x,z:correction.z},{x:original.x,z:original.z});
  }
  const standing=after.players.find((p:Message)=>p.id===visitor.welcome.me.id);
  const nearest=nearestWalkable(oldStanding.x,oldStanding.z);
  assert.deepEqual({x:standing.x,z:standing.z,seat:standing.seat},{...nearest,seat:null});
  assert.ok(isWalkable(standing.x,standing.z));
  assert.ok(Math.hypot(standing.x-oldStanding.x,standing.z-oldStanding.z)<1.5,'furniture migration must not reset a visitor to the room entrance');
  const correction=await visitor.wait(m=>m.type==='position-correction');
  assert.deepEqual({x:correction.x,z:correction.z},nearest);
  assert.ok(after.attachments.every((p:Message)=>p.layoutVersion===MAP_LAYOUT_VERSION && p.normalMoveCredit===0));
  assert.deepEqual(after.accounts,before.accounts);assert.deepEqual(after.office,before.office);assert.deepEqual(after.runtime.settings,before.runtime.settings);
  assert.deepEqual(after.runtime.audit,before.runtime.audit);assert.deepEqual(after.board,before.board);assert.equal(after.alarmAt,before.alarmAt);assert.equal(after.runtime.roomOpen,before.runtime.roomOpen);
  assert.equal((await admin(mf,'state',undefined,auth.cookie)).status,200);
  const again=plain(await room.testMigratePlayers());assert.deepEqual(again.attachments,after.attachments,'v9 migration is idempotent');
 }finally{await mf.dispose();}
});

test('office layout upgrades remap occupied seats and obstructed standing positions without resetting social, chart or admin state', {timeout:30000},async()=>{
 const {mf,room}=await createHarness();
 try {
  const auth=await login(mf),cookie=await identity(mf);let a=await join(mf,cookie,'자리유지동료');
  await setCharts(mf,auth,['KRX:000660','KRX:005930','BINANCE:BTCUSDT','AMEX:SOXL',...rearChartSymbols]);
  const b=await join(mf,await identity(mf),'걷는동료');
  a.send({type:'sit',seat:3,requestId:'layout-seat-claim'});await a.wait(m=>m.requestId==='layout-seat-claim');
  b.send({type:'chat',text:'확장 전 대화',requestId:'layout-chat-note'});await b.wait(m=>m.requestId==='layout-chat-note');
  await setCharts(mf,auth,['KRX:000660','NASDAQ:QQQ','BINANCE:BTCUSDT','AMEX:SOXL',...rearChartSymbols]);
  // Seat3's old coordinates, and a formerly clear point now occupied by a sofa.
  const before=plain(await room.testPreviousLayout({[a.welcome.me.id]:{seat:3,x:3.45,z:-0.48},[b.welcome.me.id]:{seat:null,x:SOFAS[0].x,z:SOFAS[0].z}},null));
  const oldById=new Map(before.attachments.map((p:Message)=>[p.id,p]));
  const after=plain(await room.testMigratePlayers());
  assert.equal(after.runtime.layoutVersion,MAP_LAYOUT_VERSION);assert.equal(after.runtime.roomOpen,true);
  assert.deepEqual(after.office,before.office);assert.deepEqual(after.accounts,before.accounts);assert.deepEqual(after.board,before.board);assert.equal(after.alarmAt,before.alarmAt);
  const seated=after.attachments.find((p:Message)=>p.id===a.welcome.me.id)!;
  assert.equal(seated.seat,3);assert.equal(seated.x,SEATS[3]!.x);assert.equal(seated.z,SEATS[3]!.z);
  const standing=after.attachments.find((p:Message)=>p.id===b.welcome.me.id)!;
  assert.equal(standing.seat,null);assert.ok(isWalkable(standing.x,standing.z));assert.notDeepEqual({x:standing.x,z:standing.z},{x:SOFAS[0].x,z:SOFAS[0].z});
  for(const player of after.attachments){const old=oldById.get(player.id)as Message;assert.equal(player.layoutVersion,MAP_LAYOUT_VERSION);assert.equal(player.normalMoveCredit,0);assert.equal(player.nextProposalAt,old.nextProposalAt);assert.deepEqual(player.lastChat,old.lastChat);assert.deepEqual(player.lastSeatAction,old.lastSeatAction);}
  assert.equal((await admin(mf,'state',undefined,auth.cookie)).status,200);
  a=await join(mf,cookie,'자리유지동료');const own=a.welcome.players.find((p:Message)=>p.id===a.welcome.me.id)!;
  assert.equal(own.seat,3);assert.equal(own.x,SEATS[3]!.x);assert.equal(a.welcome.rules.layoutVersion,MAP_LAYOUT_VERSION);assert.equal(a.welcome.market.selected.symbol,'KRX:000660');assert.equal(a.welcome.market.vote,null);
  const once=plain(await room.testSnapshot());const twice=plain(await room.testMigratePlayers());
  assert.deepEqual(twice.attachments,once.attachments,'a second wake does not rerun migration or reset movement credit/timestamps');assert.deepEqual(twice.office,once.office);
 }finally{await mf.dispose();}
});

test('a closed office remains closed with its selected chart and admin session after a geometry upgrade', {timeout:30000},async()=>{
 const {mf,room,restart}=await createHarness();
 try {
  const auth=await login(mf),a=await join(mf,await identity(mf),'폐쇄전동료');
  await setCharts(mf,auth,['NASDAQ:SOXX','KRX:000660','BINANCE:BTCUSDT','AMEX:SOXL',...rearChartSymbols]);
  await admin(mf,'control',{action:'close'},auth.cookie,auth.csrf);await room.testPreviousLayout({},MAP_LAYOUT_VERSION-1);
  const before=plain(await room.testSnapshot());await restart();const after=plain(await room.testSnapshot());
  assert.equal(after.runtime.layoutVersion,MAP_LAYOUT_VERSION);assert.equal(after.storedRuntime.layoutVersion,MAP_LAYOUT_VERSION);assert.equal(after.runtime.roomOpen,false);assert.equal(after.players.length,0);assert.equal(after.alarmAt,null);assert.deepEqual(after.office,before.office);assert.deepEqual(after.accounts,before.accounts);
  const status=await mf.dispatchFetch(`${origin}/api/status`).then(r=>r.json())as Message;assert.equal(status.roomOpen,false);assert.equal(status.market.selected.symbol,'NASDAQ:SOXX');assert.equal((await admin(mf,'state',undefined,auth.cookie)).status,200);
 }finally{await mf.dispose();}
});
