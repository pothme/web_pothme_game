import type { Miniflare } from 'miniflare';
import type { OfficeState } from '../server/market';
interface FixtureRuntime {roomOpen:boolean;concept:string;layoutVersion?:number;drops:unknown[];nextDropAt:null;managementVersion:number;donationSetupVersion?:number;settings:import('../shared/office-settings').OfficeSettings;blocks:Array<{id:string;nickname:string;until:number}>;audit:Array<{at:number;action:string;detail:string}>}
export interface FixtureSnapshot {
 office:OfficeState;
 runtime:FixtureRuntime;
 storedRuntime:FixtureRuntime;
 attachments:Array<{id:string;x:number;z:number;seat:number|null;layoutVersion?:number;normalMoveAt:number;normalMoveCredit:number;lastMoveAt:number;nextProposalAt:number;lastChat?:unknown;lastSeatAction?:unknown}>;
 players:Array<{id:string;nickname:string;area:'office'|'games'|'jump';x:number;z:number;seat:number|null;breadShuttle:boolean;chaseRole:null;chaseRoundId:null;disconnected:boolean}>;
 alarmAt:number|null;
 accounts:Array<{id:string;nickname:string;balance:number;next_play_at:number;receipts_json:string}>;
 board:Array<{id:string;text:string;author:string;color:string;created_at:number}>;
 legacy:{round:unknown;lastRound:unknown;nextRoundAt:number|null;roundNumber:number}|null;
}
export interface FixtureRoom {
 testFreezeClock(now?:number):Promise<number>;
 testClock(now:number,runAlarm?:boolean):Promise<FixtureSnapshot>;
 testFinishVote():Promise<FixtureSnapshot>;
 testPositions(points:Record<string,{x:number;z:number}>):Promise<FixtureSnapshot>;
 /** Puts players in a tower room (null removes them) as the game room lobby would. '*' is every player. */
 testTowerRoom(ids:string|string[],room?:string|null):Promise<void>;
 testPreviousLayout(points?:Record<string,{x:number;z:number;seat:number|null}>,version?:number|null):Promise<FixtureSnapshot>;
 testMigratePlayers():Promise<FixtureSnapshot>;
 testLegacy(open?:boolean):Promise<void>;
 testSnapshot():Promise<FixtureSnapshot>;
 testFailSave():Promise<void>;
 testAvatarPoints(id:string,points:number):Promise<void>;
 testGames(id:string):Promise<import('../shared/game-room').GameSnapshot>;
 testGames():Promise<Array<{id:string;nickname:string;state:import('../shared/game-room').GameSnapshot}>>;
 testNextGameAlarm():Promise<Array<{id:string;nickname:string;state:import('../shared/game-room').GameSnapshot}>>;
 testUsageSnapshot(snapshot:import('../shared/usage').UsageSnapshot|null):Promise<void>;
 testLegacyMovement(id:string):Promise<void>;
 testStoreOffice(state:unknown):Promise<void>;
 testPreviousManagement():Promise<void>;
 testPreviousSupport(settings?:Partial<import('../shared/office-settings').OfficeSettings>):Promise<void>;
 testLegacyReceipt(id:string,symbol:string,requestId:string):Promise<void>;
}
export function createHarness(options?:{port?:number;assets?:boolean;adminPassword?:string;koreanChartsEnabled?:boolean|null}):Promise<{mf:Miniflare;room:FixtureRoom;restart:(changes?:{koreanChartsEnabled?:boolean|null})=>Promise<void>}>;
