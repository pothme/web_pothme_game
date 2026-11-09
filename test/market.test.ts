import {DEFAULT_CHARTS,normalizeOfficeCharts,OFFICE_CHART_COUNT,OFFICE_CHART_LAYOUT_VERSION,chartSlotLabel} from '../shared/office-charts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialOffice,normalizeOfficeState,proposeChart,castChartVote,settleVote,finishVote,marketView} from '../server/market';
import {CURATED_MARKETS,DEFAULT_MARKET,searchMarkets,US_ETF_MARKETS,KR_MARKETS,getMarketRegion,getMarketAssetType,matchesMarketFilter} from '../shared/market-catalog';
import {parseBinanceMarkets,findMarket,findMarkets} from '../server/market-catalog';
const eth=CURATED_MARKETS.find(m=>m.symbol==='BINANCE:ETHUSDT')!,proposer={id:'a',nickname:'제안자'};
const start=(ids=['a','b','c'])=>proposeChart(initialOffice(),eth,proposer,ids,1000,'vote-one');
test('office starts with eight requested charts and a single-person legacy proposal passes immediately',()=>{assert.deepEqual(initialOffice().selected,DEFAULT_CHARTS[0]);const state=start(['a']);assert.equal(state.selected.symbol,eth.symbol);assert.equal(state.vote,null);assert.equal(state.lastResult!.outcome,'passed');});
test('strict majorities use fixed floor(n/2)+1 for every room size from 2 to 20',()=>{for(let n=2;n<=20;n++){const ids=['a',...Array.from({length:n-1},(_,i)=>`v${i}`)];let state=start(ids);assert.equal(state.vote!.requiredYes,Math.floor(n/2)+1);for(let i=0;i<Math.floor(n/2);i++)state=castChartVote(state,`v${i}`,'vote-one',true,2000);assert.equal(state.lastResult!.outcome,'passed');}});
test('a tie cannot pass and an impossible majority rejects before the deadline',()=>{let state=start(['a','b','c','d']);state=castChartVote(state,'b','vote-one',false,2000);assert.ok(state.vote);state=castChartVote(state,'c','vote-one',false,2000);assert.equal(state.lastResult!.outcome,'rejected');assert.deepEqual(state.selected,DEFAULT_CHARTS[0]);});
test('voters are snapshotted, proposer auto-yes is immutable and observers cannot vote',()=>{const state=start();assert.equal(state.vote!.ballots.a,true);assert.throws(()=>castChartVote(state,'a','vote-one',false,2000),{code:'ALREADY_VOTED'});assert.throws(()=>castChartVote(state,'late','vote-one',true,2000),{code:'VOTE_OBSERVER'});assert.throws(()=>castChartVote(state,'b','wrong-id',true,2000),{code:'VOTE_ENDED'});assert.throws(()=>castChartVote(state,'b','vote-one','yes',2000),{code:'VOTE_CHOICE'});});
test('deadline is exclusive and timeout/cancellation never changes the selected symbol',()=>{const state=start();assert.ok(settleVote(state,30999).vote);assert.throws(()=>castChartVote(state,'b','vote-one',true,31000),{code:'VOTE_ENDED'});assert.equal(settleVote(state,31000).lastResult!.outcome,'expired');assert.deepEqual(finishVote(state,'cancelled',2000).selected,DEFAULT_CHARTS[0]);});
test('personalized vote views reveal counts and own vote but not the voter identity list',()=>{const state=start(),own=marketView(state,'a',16000),observer=marketView(state,'late',0);assert.equal(own.vote!.voted,'yes');assert.equal(own.vote!.yesCount,1);assert.equal(own.vote!.eligibleCount,3);assert.equal(observer.vote!.eligible,false);assert.equal('ballots' in own.vote!,false);assert.equal('voters' in own.vote!,false);assert.throws(()=>proposeChart(state,eth,proposer,['a'],2000,'x'),{code:'VOTE_ACTIVE'});assert.throws(()=>proposeChart(initialOffice(),DEFAULT_CHARTS[0],proposer,['a'],2000,'x'),{code:'ALREADY_SELECTED'});});
test('catalog supports Korean US-stock aliases and filters kinds before applying the limit',async()=>{assert.equal(searchMarkets(CURATED_MARKETS,'엔비디아','stock')[0]!.symbol,'NASDAQ:NVDA');assert.ok(searchMarkets(CURATED_MARKETS,'','stock').length>20);assert.ok(searchMarkets(CURATED_MARKETS,'','crypto').every(m=>m.kind==='crypto'));assert.ok(searchMarkets(CURATED_MARKETS,'','all').some(m=>m.kind==='stock'));assert.equal((await findMarket('KRX:005930'))!.region,'KR');assert.equal(await findMarket('<script>'),null);});
test('official Binance catalog only admits trading spot USDT symbols with safe identifiers',()=>{const base={status:'TRADING',quoteAsset:'USDT',isSpotTradingAllowed:true,baseAsset:'ABC',symbol:'ABCUSDT'};const markets=parseBinanceMarkets({symbols:[base,{...base,status:'BREAK'},{...base,isSpotTradingAllowed:false},{...base,quoteAsset:'BTC'},{...base,symbol:'<IMG>USDT'}]});assert.equal(markets.length,1);assert.equal(markets[0]!.symbol,'BINANCE:ABCUSDT');assert.throws(()=>parseBinanceMarkets({}));});


test('US ETF tab includes major index, inverse, bond, income and crypto funds',async()=>{
 const funds=await findMarkets('', 'etf');
 assert.ok(funds.length>=30);
 for(const symbol of ['AMEX:SPY','NASDAQ:QQQ','NASDAQ:TQQQ','NASDAQ:SQQQ','AMEX:SOXL','NASDAQ:TLT','AMEX:SCHD','NASDAQ:JEPQ','CBOE:ARKK','NYSE:SGOV','NASDAQ:IBIT','CBOE:FBTC']) assert.ok(funds.some(m=>m.symbol===symbol),symbol);
 assert.ok(funds.every(m=>m.kind==='stock'&&getMarketRegion(m)==='US'&&getMarketAssetType(m)==='etf'));
 assert.ok((await findMarkets('', 'us')).every(m=>getMarketAssetType(m)==='stock'));
 assert.equal((await findMarkets('반도체', 'etf')).some(m=>m.symbol==='NASDAQ:SOXX'),true);
 assert.equal((await findMarkets('tqqq','etf'))[0]!.symbol,'NASDAQ:TQQQ');
 assert.equal((await findMarkets('나스닥 100','etf')).some(m=>m.symbol==='NASDAQ:QQQ'),true);
});

test('persisted ETF selections without new metadata retain their ETF classification',()=>{
 const legacy={symbol:'NASDAQ:QQQ',name:'나스닥 100 Invesco QQQ',kind:'stock' as const,exchange:'NASDAQ'};
 assert.equal(getMarketRegion(legacy),'US');assert.equal(getMarketAssetType(legacy),'etf');
 assert.equal(matchesMarketFilter(legacy,'etf'),true);assert.equal(matchesMarketFilter(legacy,'us'),false);assert.equal(matchesMarketFilter(legacy,'stock'),true);
 assert.equal(getMarketRegion(DEFAULT_MARKET),undefined);assert.equal(getMarketAssetType(DEFAULT_MARKET),undefined);
});

test('bounded initial results show coins, Korean stocks, US equities and ETFs instead of hiding a category',()=>{
 const results=searchMarkets(CURATED_MARKETS,'');assert.equal(results.length,40);
 assert.equal(new Set(results.map(m=>m.symbol)).size,results.length);
 for(const filter of ['crypto','kr','us','etf'])assert.ok(results.some(m=>matchesMarketFilter(m,filter)));
 assert.equal(searchMarkets(US_ETF_MARKETS,'QQQ','etf')[0]!.symbol,'NASDAQ:QQQ');
 assert.equal(searchMarkets(CURATED_MARKETS,'','unknown').length,0);
});

test('Korean catalog preserves six-digit codes and aliases and filters before the search limit',async()=>{
 assert.equal(searchMarkets(KR_MARKETS,'삼전','kr')[0]!.symbol,'KRX:005930');
 assert.equal(searchMarkets(KR_MARKETS,'000660','kr')[0]!.name.includes('하이닉스'),true);
 assert.equal(searchMarkets(KR_MARKETS,'알테오젠','kr')[0]!.symbol,'KRX:196170');
 assert.ok(KR_MARKETS.every(m=>/^KRX:[0-9]{6}$/.test(m.symbol)&&getMarketRegion(m)==='KR'));
 assert.equal((await findMarkets('삼성전자','kr'))[0]!.symbol,'KRX:005930');
 assert.equal((await findMarkets('','kr')).length,KR_MARKETS.length);
 assert.equal((await findMarkets('','us')).some(m=>m.exchange==='KRX'),false);
 assert.equal(await findMarket('KRX:999999'),null);assert.equal((await findMarket('KRX:005930'))!.region,'KR');
});

test('ETF selection remains server-authorized and carries metadata through a completed vote',async()=>{
 const qqq=await findMarket('NASDAQ:QQQ');assert.ok(qqq);assert.equal(qqq.assetType,'etf');
 const state=proposeChart(initialOffice(),qqq,proposer,['a'],1000,'etf-vote');
 assert.equal(state.selected.symbol,'NASDAQ:QQQ');assert.equal(marketView(state,'a',0).selected.assetType,'etf');
 assert.equal(await findMarket('NASDAQ:NOT_A_REAL_ETF'),null);
});

test('eight-chart migration replaces legacy defaults once and keeps subsequent front and rear selections',()=>{
 const symbols=['KRX:005930','KRX:000660','NASDAQ:TQQQ','AMEX:SOXL','BINANCE:BTCUSDT','BINANCE:ETHUSDT','BINANCE:XRPUSDT','COINBASE:USDTUSD'];
 assert.deepEqual(DEFAULT_CHARTS.map(m=>m.symbol),symbols);assert.deepEqual(initialOffice().charts.map(m=>m.symbol),symbols);
 const old={selected:DEFAULT_MARKET,vote:null,lastResult:null};const migrated=normalizeOfficeState(old);
 assert.deepEqual(migrated.charts.map(m=>m.symbol),symbols);assert.equal(migrated.selected,migrated.charts[0]);assert.equal(migrated.chartLayoutVersion,OFFICE_CHART_LAYOUT_VERSION);
 const changed=normalizeOfficeCharts([eth,DEFAULT_MARKET,DEFAULT_CHARTS[3],DEFAULT_CHARTS[2]],DEFAULT_CHARTS[0]);
 assert.deepEqual(normalizeOfficeState({...migrated,charts:changed}).charts,changed);
 const legacyVote={...start().vote!} as Partial<NonNullable<ReturnType<typeof start>['vote']>>;delete legacyVote.slot;
 const withVote=normalizeOfficeState({...old,vote:legacyVote,lastResult:{id:'old',outcome:'expired',symbol:eth.symbol,name:eth.name,finishedAt:900}});
 assert.equal(withVote.vote,null);assert.equal(withVote.lastResult,null);
 assert.deepEqual(normalizeOfficeState(JSON.parse(JSON.stringify(withVote))),withVote);
 const rearChanged=normalizeOfficeCharts(changed);rearChanged[7]=eth;
 assert.deepEqual(normalizeOfficeState({...migrated,charts:rearChanged}).charts,rearChanged);
 assert.deepEqual([0,3,4,7].map(chartSlotLabel),['앞벽 1번','앞벽 4번','뒷벽 1번','뒷벽 4번']);
});

test('a passed proposal changes only its target slot and results retain that slot through rejection and expiry',()=>{
 for(let slot=0;slot<OFFICE_CHART_COUNT;slot++){
  const before=initialOffice(),proposal=before.charts[slot]!.symbol===eth.symbol?DEFAULT_MARKET:eth,state=proposeChart(before,proposal,proposer,['a'],1000,`slot-${slot}`,slot);
  assert.equal(state.lastResult!.slot,slot);assert.equal(state.selected,state.charts[0]);
  for(let other=0;other<OFFICE_CHART_COUNT;other++)assert.deepEqual(state.charts[other],other===slot?proposal:before.charts[other]);
  const pending=proposeChart(before,proposal,proposer,['a','b'],1000,`slot-pending-${slot}`,slot);
  assert.equal(marketView(pending,'a',0).vote!.slot,slot);
  assert.deepEqual(castChartVote(pending,'b',pending.vote!.id,false,2000).charts,before.charts);
  assert.equal(settleVote(pending,31000).lastResult!.slot,slot);
 }
});

test('invalid target slots cannot change charts and duplicate symbols are checked against the target slot',()=>{
 for(const slot of [-1,8,0.5,'1',null,NaN,Infinity])assert.throws(()=>proposeChart(initialOffice(),eth,proposer,['a'],1000,'bad-slot',slot),{code:'SLOT_INVALID'});
 assert.throws(()=>proposeChart(initialOffice(),DEFAULT_CHARTS[2],proposer,['a'],1000,'same-slot',2),{code:'ALREADY_SELECTED'});
 const state=proposeChart(initialOffice(),DEFAULT_CHARTS[2],proposer,['a'],1000,'other-slot',0);assert.equal(state.charts[0].symbol,'NASDAQ:TQQQ');assert.equal(state.charts[2].symbol,'NASDAQ:TQQQ');
 const pending=proposeChart(initialOffice(),eth,proposer,['a','b'],1000,'pending-slot',3);
 assert.throws(()=>proposeChart(pending,DEFAULT_MARKET,proposer,['a','b'],2000,'cross-slot',1),{code:'VOTE_ACTIVE'});
});
