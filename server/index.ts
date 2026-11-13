import { JumpSocial } from './jump-social';
import { JUMP_SOCIAL_RULES, type JumpPeerView, type JumpPeerMotion } from '../shared/jump-social';
import { JumpGame } from './jump-game';
import { jumpFloorReward, jumpRewardToken } from '../shared/jump-game';
import { DurableObject } from 'cloudflare:workers';
import { COLORS, GameError, canJoin, validateNickname } from './domain';
import { AdminAuth, initialAdmin, adminError, type AdminSecurity } from './admin';
import { GoogleOAuth, type GoogleAuthEnv } from './google-auth';
import { CHAT_RULES, classroomSeat, normalizeChat, socialRequestId, type ChatMessage } from './social';
import { initialOffice, normalizeOfficeState, marketView, type OfficeState } from './market';
import { findMarket, findMarkets } from './market-catalog';
import { CURATED_MARKETS, getMarketRegion, searchMarkets } from '../shared/market-catalog';
import { MAP_LAYOUT_VERSION, SEATS, ROOM_SPAWN, nearestWalkable, isWalkable, NORMAL_MOVE_SPEED } from '../shared/classroom-layout';
import { OFFICE_CHART_COUNT, OFFICE_CHART_LAYOUT_VERSION, type OfficeCharts } from '../shared/office-charts';
import { CHART_INTERVALS, normalizeOfficeSettings, type ChartInterval, type OfficeSettings } from '../shared/office-settings';
import { initializeSupportDonation } from '../shared/support-link';
import { handleQuotes } from './quotes';
import { Community } from './community';
import { UsageMonitor, type UsageEnv } from './usage';
import { Refreshments } from './refreshments';
import { type RefreshmentSelection } from '../shared/refreshments';
import { getAvatarActionDuration, getAvatarActionCooldown, isAvatarActionKind, isMarketReaction, type AvatarActionView } from '../shared/avatar-actions';
import { createJumpAction, jumpStep, JUMP_RULES } from '../shared/avatar-jump';
import { ROOM_CAPACITY } from '../shared/room-rules';
import { validateStockProfile, type StockProfile } from '../shared/stock-profile';
import { SHOULDER_LINK_RULES, type ShoulderLinkView, type ShoulderCheerView } from '../shared/shoulder-links';
import { joinShoulderLinks, repairShoulderLinks, type ShoulderChange } from './shoulder-links';
import { ACTION_NOTICE_RULES, actionNoticeText, type ActionNotice, type ActionNoticeKind } from '../shared/action-notices';
import { GameHub } from './game-hub';
import { shopItem, validateOwnedAppearance } from '../shared/avatar-catalog';
import { normalizeWhisper, WHISPER_RULES, type WhisperMessage } from '../shared/whisper';
import { CHAT_BURST, chatBurstReplay, chatBurstTake } from '../shared/chat-burst';
export interface Env extends UsageEnv, GoogleAuthEnv { CLASSROOM: DurableObjectNamespace<Classroom>; ASSETS: Fetcher; ADMIN_PASSWORD?: string; KOREAN_CHARTS_ENABLED?: string }
interface Attachment {
  id: string; nickname: string; color: number; x: number; z: number; seat: number | null; layoutVersion: number;
  stockProfile?: StockProfile | null;
  lastChat?: { requestId: string; message: ChatMessage };
  /** Burst allowances (shared/chat-burst): one number each, the time the bucket is full again. */
  chatBurst?: number;
  whisperBurst?: number;
  lastAvatarAction?: { requestId: string; action: AvatarActionView };
  avatarActionReceipts?: { requestId: string; kind: AvatarActionView['kind']; actionId: string }[];
  avatarActionCancelled?: boolean;
  /** Landing debt survives cosmetic cancellation, preventing a reset of the two-jump chain. */
  nextJumpAt?: number;
  shoulder?: ShoulderLinkView | null;
  shoulderReceipts?: { requestId: string; enabled: boolean }[];
  nextShoulderAt?: number;
  nextShoulderCheerAt?: number;
  shoulderCheerReceipts?: string[];
  lastSeatAction?: { requestId: string; type: 'sit' | 'stand'; seat: number | null };
  seatActionReceipts?: { requestId: string; type: 'sit' | 'stand'; seat: number | null }[];
  normalMoveAt: number; normalMoveCredit: number; lastMoveAt: number; nextProposalAt: number;
  movementDelta?: boolean;
  refreshments?: RefreshmentSelection | null;
  inboundTokens?: number; inboundUpdatedAt?: number; inboundViolations?: number; inboundViolationAt?: number; revoked?: boolean;
}
interface RoomBlock { id: string; nickname: string; until: number }
interface AuditEntry { at: number; action: string; detail: string }
interface WhisperReceipt { requestId: string; message: WhisperMessage }
interface Runtime { roomOpen: boolean; concept: 'securities-office'; layoutVersion: number; drops: never[]; nextDropAt: null; managementVersion: number; donationSetupVersion: number; settings: OfficeSettings; blocks: RoomBlock[]; audit: AuditEntry[] }
const CAPACITY = ROOM_CAPACITY, COOKIE = 'podeumgo_session', NORMAL_SPEED = NORMAL_MOVE_SPEED;
const WHISPER_RECEIPT_TTL_MS = 10 * 60_000;
const PUBLIC_MARKETS = CURATED_MARKETS.filter((market) => getMarketRegion(market) !== 'KR');
function koreanChartsEnabled(env: Env): boolean { return env.KOREAN_CHARTS_ENABLED === 'true'; }
function json(value: unknown, status = 200, headers: HeadersInit = {}) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } }); }
function tokenFrom(request: Request): string | null {
  const token = (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function hex(bytes: ArrayBuffer | Uint8Array): string { return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join(''); }
function sameOrigin(request: Request, required = false): boolean { const origin = request.headers.get('Origin'); return origin ? origin === new URL(request.url).origin : !required && request.headers.get('Sec-Fetch-Site') !== 'cross-site'; }
function requestedStockProfile(params: URLSearchParams): StockProfile | null | undefined {
  const raw = params.get('profile');
  if (raw === null) return undefined;
  if (raw.length > 400) throw new GameError('STOCK_PROFILE', '종목과 평단 표시가 너무 길어요.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new GameError('STOCK_PROFILE', '종목과 평단을 확인해 주세요.'); }
  try { return validateStockProfile(value); } catch (error) { throw new GameError('STOCK_PROFILE', error instanceof Error ? error.message : '종목과 평단을 확인해 주세요.'); }
}
function errorBody(error: unknown, requestId?: unknown) {
  const known = error instanceof GameError;
  return { type: 'error', ...(typeof requestId === 'string' && requestId.length <= 100 ? { requestId } : {}), code: known ? error.code : 'SERVER_ERROR', message: known ? error.message : '잠시 연결이 불안정해요. 다시 시도해 주세요.', ...(known && error.retryAt ? { retryAt: error.retryAt } : {}) };
}
export class Classroom extends DurableObject<Env> {
  private office: OfficeState;
  private runtime: Runtime;
  private security: AdminSecurity;
  private admin: AdminAuth;
  private community: Community;
  private usage: UsageMonitor;
  private refreshments: Refreshments;
  private games: GameHub;
  private jump: JumpGame;
  private jumpSocial: JumpSocial;
  private jumpPresenceTimer: ReturnType<typeof setTimeout> | undefined;
  private jumpFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private jumpPresenceAt=0;
  private jumpRosterKeys=new Map<string,string>();
  private jumpRoomKeys=new Map<string,string>();
  private jumpRoomSentAt=0;
  private jumpRoomTimer: ReturnType<typeof setTimeout> | undefined;
  private jumpMotions=new Map<string,string>();
  private jumpRankingSentAt = 0;
  private jumpRankingTimer: ReturnType<typeof setTimeout> | undefined;
  private jumpRankingKey = '';
  /** Office chat allowance and the requests of the running burst, by player: a socket attachment ends with its socket, and closing a tab must not buy a new burst. */
  private chatBursts = new Map<string, number>(); private chatReceipts = new Map<string, { requestId: string; message: ChatMessage }[]>();
  private alarmUpdates: Promise<void> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS usage_cache (id INTEGER PRIMARY KEY CHECK(id=1), account_id TEXT NOT NULL, snapshot_json TEXT NOT NULL)');
    this.usage = new UsageMonitor(env, fetch, () => Date.now(), {
      read: (accountId) => {
        const row = this.ctx.storage.sql.exec<{ snapshot_json: string }>('SELECT snapshot_json FROM usage_cache WHERE id=1 AND account_id=?', accountId).toArray()[0];
        if (!row) return null;
        const cached = JSON.parse(row.snapshot_json); return cached.version === 3 ? cached.snapshot : null;
      },
      write: (accountId, snapshot) => { this.ctx.storage.sql.exec('INSERT INTO usage_cache(id,account_id,snapshot_json) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,snapshot_json=excluded.snapshot_json', accountId, JSON.stringify({ version: 3, snapshot })); },
    });
    // Financial and board records remain untouched. Office commands never use balances.
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, balance INTEGER NOT NULL CHECK(balance >= 0), next_play_at INTEGER NOT NULL DEFAULT 0, color INTEGER NOT NULL, receipts_json TEXT NOT NULL DEFAULT '[]')`);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS office_stock_profiles (id TEXT PRIMARY KEY, profile_json TEXT NOT NULL)');
    // Private, short-lived delivery receipts. Never exposed by history or admin APIs.
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS office_whisper_receipts (id TEXT PRIMARY KEY, receipts_json TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS office_whisper_expiry ON office_whisper_receipts(expires_at)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS board (id TEXT PRIMARY KEY, text TEXT NOT NULL, author TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_runtime (id INTEGER PRIMARY KEY CHECK(id = 1), state_json TEXT NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK(id = 1), state_json TEXT NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS admin_security (id INTEGER PRIMARY KEY CHECK(id = 1), state_json TEXT NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS office_state (id INTEGER PRIMARY KEY CHECK(id = 1), state_json TEXT NOT NULL)');
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS office_users (id TEXT PRIMARY KEY, next_proposal_at INTEGER NOT NULL DEFAULT 0, receipts_json TEXT NOT NULL DEFAULT '[]')");
    // One short-lived checkpoint per interrupted connection, never per movement.
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS office_resume_positions (id TEXT PRIMARY KEY, x REAL NOT NULL, z REAL NOT NULL, seat INTEGER, expires_at INTEGER NOT NULL)');
    const runtime = this.ctx.storage.sql.exec<{ state_json: string }>('SELECT state_json FROM room_runtime WHERE id = 1').toArray()[0];
    const previous = runtime ? JSON.parse(runtime.state_json) as Partial<Runtime> : null;
    const managementChanged = previous?.managementVersion !== 1;
    const donationSetup = initializeSupportDonation(normalizeOfficeSettings(managementChanged ? undefined : previous?.settings), previous?.donationSetupVersion);
    this.runtime = { roomOpen: previous?.roomOpen !== false, concept: 'securities-office', layoutVersion: MAP_LAYOUT_VERSION, drops: [], nextDropAt: null, managementVersion: 1, donationSetupVersion: donationSetup.version, settings: donationSetup.settings, blocks: previous?.blocks ?? [], audit: (previous?.audit ?? []).slice(-80) };
    const office = this.ctx.storage.sql.exec<{ state_json: string }>('SELECT state_json FROM office_state WHERE id = 1').toArray()[0];
    this.office = managementChanged || !office ? initialOffice() : normalizeOfficeState(JSON.parse(office.state_json));
    // Public votes are retired. Never resume a persisted vote or its alarm.
    this.office = { ...this.office, vote: null, lastResult: null };
    const security = this.ctx.storage.sql.exec<{ state_json: string }>('SELECT state_json FROM admin_security WHERE id = 1').toArray()[0];
    this.security = security ? JSON.parse(security.state_json) as AdminSecurity : initialAdmin();
    const conceptChanged = previous?.concept !== 'securities-office';
    if (conceptChanged || managementChanged) {
      this.ctx.storage.transactionSync(() => {
        this.saveRuntime(this.runtime);
        const old = this.ctx.storage.sql.exec<{ state_json: string }>('SELECT state_json FROM room_state WHERE id = 1').toArray()[0];
        if (old) { const state = JSON.parse(old.state_json); this.ctx.storage.sql.exec('UPDATE room_state SET state_json = ? WHERE id = 1', JSON.stringify({ ...state, round: null, lastRound: null, nextRoundAt: null })); }
        this.saveOffice(this.office);
      });
      this.ctx.waitUntil(this.syncAlarm());
    } else if (previous?.layoutVersion !== MAP_LAYOUT_VERSION || donationSetup.changed) {
      // Geometry upgrades must not reset selected markets, votes, admin sessions,
      // account records, or the operator's open/closed setting.
      this.saveRuntime(this.runtime);
    }
    if (!conceptChanged && !managementChanged && (!office || JSON.stringify(this.office) !== office.state_json)) { this.saveOffice(this.office); this.ctx.waitUntil(this.syncAlarm()); }
    this.migratePlayerLayouts(conceptChanged);
    this.admin = new AdminAuth(() => this.security, (state) => { this.ctx.storage.sql.exec('INSERT INTO admin_security (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json', JSON.stringify(state)); this.security = state; }, () => this.env.ADMIN_PASSWORD, new GoogleOAuth(() => this.env));
    this.community = new Community(this.ctx.storage, () => this.broadcast({ type: 'community-changed' }));
    this.refreshments = new Refreshments(this.ctx.storage);
    this.games = new GameHub(this.ctx.storage, {
      players: () => this.sockets().flatMap(socket => { const p = this.attachment(socket); return p ? [{ id: p.id, nickname: p.nickname }] : []; }),
      send: (id, packet) => { for (const socket of this.sockets()) if (this.attachment(socket)?.id === id) this.send(socket, packet); },
      // The lobby shows tower progress but never decides it: both values come from the jump authority.
      towerFloor: id => this.jump?.roomOf(id) == null ? null : this.jump.peerState(id)?.floor ?? null,
      towerBest: id => this.towerBestOf(id),
      changed: (id) => {
        for (const socket of this.sockets()) {
          const p = this.attachment(socket)!;
          if (this.games.location(p.id) === 'games' && (p.seat !== null || p.shoulder)) {
            const seat = p.seat === null ? null : SEATS[p.seat];
            socket.serializeAttachment({ ...p, seat: null, shoulder: null, avatarActionCancelled: true, ...(seat ? { x: seat.standX, z: seat.standZ } : {}) });
          }
          if (p.id === id) this.send(socket, { type: 'avatar-profile', profile: this.games.profile(p.id) });
        }
        this.broadcast({ type: 'players', players: this.players() });
        // Lobby membership is the source of truth for tower rooms.
        if(this.jump){this.jump.syncRooms();this.scheduleJumpPresence();}
      },
    });
    this.jump = new JumpGame(this.ctx.storage, {
      isConnected: id => this.sockets().some(socket=>this.attachment(socket)?.id===id),
      nickname: id => this.sockets().map(socket=>this.attachment(socket)).find(p=>p?.id===id)?.nickname ?? this.ctx.storage.sql.exec<{nickname:string}>('SELECT nickname FROM accounts WHERE id=?',id).toArray()[0]?.nickname ?? '도전자',
      room: id => this.towerRoomOf(id),
      send: (id,packet) => {for(const socket of this.sockets())if(this.attachment(socket)?.id===id)this.send(socket,packet);},
      awardFloors: (id,floors,now,commit) => this.games.awardExternalBatch(id,floors.map(floor=>({token:jumpRewardToken(floor),amount:jumpFloorReward(floor)})),now,commit),
      profile: (id,now) => this.games.profile(id,now),
      onEnter: id => {
        for(const socket of this.sockets()){const p=this.attachment(socket)!;if(p.id===id)socket.serializeAttachment({...p,seat:null,shoulder:null,avatarActionCancelled:true});}
        this.broadcast({type:'players',players:this.players()});this.publishJumpPresence(true);this.jumpSocial.joined(id);
        // Publishing the room ranking also refreshes the room view of the members who are not climbing.
        const roomId=this.jump.roomOf(id);if(roomId!==null)this.jumpRoomKeys.delete(roomId);this.publishJumpRooms();
      },
      // The climber is back in the room view; the lobby still lists them as a member.
      onExit: id => {this.broadcast({type:'players',players:this.players()});this.publishJumpPresence(true);this.scheduleJumpRooms();this.games.towerPresence(id);},
      motion: () => {this.scheduleJumpPresence();this.scheduleJumpFlush();},
      changed: id => {this.towerBests.delete(id);this.scheduleJumpRanking();this.scheduleJumpRooms();},
    });
    this.jumpSocial=new JumpSocial(this.ctx.storage,{
      room:id=>this.runtime.roomOpen&&this.sockets().some(socket=>this.attachment(socket)?.id===id)?this.jump.roomOf(id):null,
      enabled:()=>this.runtime.settings.chatEnabled,
      nickname:id=>this.sockets().map(socket=>this.attachment(socket)).find(p=>p?.id===id)?.nickname??'도전자',
      send:(id,packet)=>{for(const socket of this.sockets())if(this.attachment(socket)?.id===id)this.send(socket,packet);},
      broadcast:(packet,roomId)=>this.broadcastJump(packet,roomId),
    });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.ctx.waitUntil(this.syncAlarm());
  }
  /** Best floor a player ever reached, for the lobby card. One indexed column, remembered until the
   * jump authority reports a change for that player; it never builds a jump snapshot or caches a run. */
  private towerBests=new Map<string,number>();
  private towerBestOf(id:string):number {
    let best=this.towerBests.get(id);
    if(best===undefined){
      best=Number(this.ctx.storage.sql.exec<{best_floor:number}>('SELECT best_floor FROM jump_runs WHERE id=?',id).toArray()[0]?.best_floor)||0;
      if(this.towerBests.size>=512)this.towerBests.clear();
      this.towerBests.set(id,best);
    }
    return best;
  }
  /** Tower room of a player, as decided by the game room lobby. Null means "not in a tower room". */
  protected towerRoomOf(id:string):string|null {return this.games.towerRoom(id);}
  /** Tower packets reach the members of one tower room, or everyone inside the tower when no room is given. */
  private broadcastJump(packet:unknown,roomId?:string):void {
    const message=JSON.stringify(packet);
    for(const socket of this.sockets()){const room=this.jump.roomOf(this.attachment(socket)!.id);if(room!==null&&(roomId===undefined||room===roomId))this.sendRaw(socket,message);}
  }
  /** One serialised packet for many recipients. */
  private sendRaw(socket:WebSocket,message:string):void {try{socket.send(message);}catch{/* Close frees the socket. */}}
  /** While any climber has movement that is not on disk yet, check once a second for those who went quiet.
   * A pending timer also keeps this object awake, so a paused climber's exact position (a fall
   * included) is stored before hibernation can happen. */
  private scheduleJumpFlush():void {
    if(this.jumpFlushTimer!==undefined)return;
    this.jumpFlushTimer=setTimeout(()=>{this.jumpFlushTimer=undefined;if(this.jump.flushIdle())this.scheduleJumpFlush();},1000);
  }
  private scheduleJumpPresence():void {
    if(this.jumpPresenceTimer!==undefined)return;
    const wait=Math.max(0,JUMP_SOCIAL_RULES.presenceMs-(Date.now()-this.jumpPresenceAt));
    if(wait===0)this.publishJumpPresence();else this.jumpPresenceTimer=setTimeout(()=>this.publishJumpPresence(),wait);
  }
  private publishJumpPresence(force=false):void {
    if(this.jumpPresenceTimer!==undefined){clearTimeout(this.jumpPresenceTimer);this.jumpPresenceTimer=undefined;}
    const now=Date.now(),round=(value:number)=>Math.round(value*1000)/1000;
    // One pass over the sockets collects each room's peers and its recipients; every packet is serialised once.
    const rooms=new Map<string,JumpPeerView[]>(),recipients=new Map<string,WebSocket[]>();
    for(const socket of this.sockets()){
      const p=this.attachment(socket)!,roomId=this.jump.roomOf(p.id),state=roomId===null?null:this.jump.peerState(p.id,now);if(roomId===null||!state)continue;
      let peers=rooms.get(roomId);if(!peers){rooms.set(roomId,peers=[]);recipients.set(roomId,[]);}
      recipients.get(roomId)!.push(socket);
      if(!peers.some(peer=>peer.id===p.id))peers.push({id:p.id,nickname:p.nickname,color:p.color,appearance:this.games.appearance(p.id),...state,x:round(state.x),y:round(state.y),z:round(state.z),vx:round(state.vx),vy:round(state.vy),vz:round(state.vz)});
    }
    const rosterKeys=new Map<string,string>(),motions=new Map<string,string>();
    for(const [roomId,peers] of rooms){
      const rosterKey=JSON.stringify(peers.map(({id,nickname,color,appearance})=>({id,nickname,color,appearance})));rosterKeys.set(roomId,rosterKey);
      const changed:JumpPeerMotion[]=[];
      for(const p of peers){const motion:JumpPeerMotion=[p.id,p.x,p.y,p.z,p.vx,p.vy,p.vz,p.grounded?1:0,p.floor,p.jumps],key=JSON.stringify(motion);motions.set(p.id,key);if(key!==this.jumpMotions.get(p.id))changed.push(motion);}
      const packet=force||rosterKey!==this.jumpRosterKeys.get(roomId)?{type:'jump-presence',roomId,peers,serverTime:now}:changed.length?{type:'jump-positions',roomId,players:changed,serverTime:now}:null;
      if(packet){const message=JSON.stringify(packet);for(const socket of recipients.get(roomId)!)this.sendRaw(socket,message);}
    }
    this.jumpRosterKeys=rosterKeys;this.jumpMotions=motions;this.jumpPresenceAt=now;
  }
  private scheduleJumpRooms():void {
    if(this.jumpRoomTimer!==undefined)return;
    const wait=Math.max(0,JUMP_SOCIAL_RULES.rankingMs-(Date.now()-this.jumpRoomSentAt));
    if(wait===0)this.publishJumpRooms();else this.jumpRoomTimer=setTimeout(()=>this.publishJumpRooms(),wait);
  }
  /** Live ranking of each tower room, sent to its own members when it changes. */
  private publishJumpRooms():void {
    if(this.jumpRoomTimer!==undefined){clearTimeout(this.jumpRoomTimer);this.jumpRoomTimer=undefined;}
    const now=Date.now(),keys=new Map<string,string>();
    for(const roomId of this.jump.rooms()){
      // The lobby room keeps each member's best floor for the whole stay, so the panel inside the tower
      // and the room view show the same number even after someone steps out and climbs again.
      const ranking=this.games.towerRanking(roomId,this.jump.roomRanking(roomId)),key=JSON.stringify(ranking);keys.set(roomId,key);
      if(key!==this.jumpRoomKeys.get(roomId)){this.broadcastJump({type:'jump-room',roomId,ranking,serverTime:now},roomId);this.games.towerRoomChanged(roomId,now);}
    }
    this.jumpRoomKeys=keys;this.jumpRoomSentAt=now;
  }
  private scheduleJumpRanking(): void {
    if(this.jumpRankingTimer!==undefined)return;
    const publish=()=>{
      this.jumpRankingTimer=undefined;const leaders=this.jump.leaderboard(),key=JSON.stringify(leaders);
      if(key===this.jumpRankingKey)return;this.jumpRankingKey=key;this.jumpRankingSentAt=Date.now();
      this.broadcast({type:'jump-leaderboard',leaders});
    };
    const wait=Math.max(0,5000-(Date.now()-this.jumpRankingSentAt));
    if(!wait)publish();else this.jumpRankingTimer=setTimeout(publish,wait);
  }
  private migratePlayerLayouts(conceptChanged = false): void {
    let positionsChanged = false;
    for (const socket of this.ctx.getWebSockets()) {
      const old = this.attachment(socket);
      if (!old || old.revoked || (!conceptChanged && old.layoutVersion === MAP_LAYOUT_VERSION)) continue;
      const seat = old.seat == null ? null : SEATS[old.seat];
      const point = seat ? { x: seat.x, z: seat.z } : nearestWalkable(old.x, old.z);
      const base = conceptChanged ? { id: old.id, nickname: old.nickname, stockProfile: old.stockProfile ?? null, color: old.color, lastChat: old.lastChat, chatBurst: old.chatBurst, whisperBurst: old.whisperBurst, lastSeatAction: old.lastSeatAction, movementDelta: old.movementDelta, nextProposalAt: 0 } : old;
      socket.serializeAttachment({ ...base, ...point, shoulder: null, seat: seat?.id ?? null, layoutVersion: MAP_LAYOUT_VERSION, normalMoveAt: Date.now(), normalMoveCredit: 0, lastMoveAt: 0 } satisfies Attachment);
      this.send(socket, { type: 'position-correction', ...point, roundId: null, serverTime: Date.now() });
      this.send(socket, { type: 'error', code: 'LAYOUT_UPDATED', message: '사무실 배치가 바뀌었어요. 새로고침하면 넓어진 공간을 볼 수 있어요.' });
      positionsChanged = true;
    }
    if (positionsChanged) this.broadcast({ type: 'players', players: this.players() });
  }
  private attachment(socket: WebSocket): Attachment | null { try { return socket.deserializeAttachment() as Attachment | null; } catch { return null; } }
  private stockProfile(id: string, requested: StockProfile | null | undefined): StockProfile | null {
    const saved = this.ctx.storage.sql.exec<{ profile_json: string }>('SELECT profile_json FROM office_stock_profiles WHERE id=?', id).toArray()[0];
    let previous: StockProfile | null = null;
    if (saved) { try { previous = validateStockProfile(JSON.parse(saved.profile_json)); } catch { /* A bad old label must not prevent admission. */ } }
    if (requested === undefined) return previous;
    if (JSON.stringify(previous) === JSON.stringify(requested)) return previous;
    if (requested) this.ctx.storage.sql.exec('INSERT INTO office_stock_profiles(id,profile_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json', id, JSON.stringify(requested));
    else this.ctx.storage.sql.exec('DELETE FROM office_stock_profiles WHERE id=?', id);
    return requested;
  }
  private resumePosition(id: string, now: number): { x: number; z: number; seat: number | null } | null {
    this.ctx.storage.sql.exec('DELETE FROM office_resume_positions WHERE expires_at <= ?', now);
    const saved = this.ctx.storage.sql.exec<{ x: number; z: number; seat: number | null }>('SELECT x,z,seat FROM office_resume_positions WHERE id=?', id).toArray()[0];
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.z)) return null;
    const seat = saved.seat === null ? undefined : SEATS.find(candidate => candidate.id === saved.seat);
    if (seat && !this.players().some(player => player.seat === seat.id)) return { x: seat.x, z: seat.z, seat: seat.id };
    const point = seat ? nearestWalkable(seat.standX, seat.standZ) : nearestWalkable(saved.x, saved.z);
    return { ...point, seat: null };
  }
  private sockets(): WebSocket[] { return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN && !this.attachment(socket)?.revoked); }
  private players() { this.repairShoulders(); const now = Date.now(); return this.sockets().flatMap((socket) => { const p = this.attachment(socket); return p ? [{ id: p.id, nickname: p.nickname, appearance: this.games?.appearance(p.id), area: this.jump?.isActive(p.id) ? 'jump' : this.games?.location(p.id) ?? 'office', stockProfile: p.stockProfile ?? null, color: p.color, x: p.x, z: p.z, seat: p.seat ?? null, refreshments: p.refreshments ?? null, shoulder: p.shoulder ?? null, action: !p.avatarActionCancelled && p.lastAvatarAction && p.lastAvatarAction.action.expiresAt > now ? p.lastAvatarAction.action : null, breadShuttle: false, chaseRole: null, chaseRoundId: null, disconnected: false }] : []; }); }
  private applyShoulderChanges(changes: ShoulderChange[], now = Date.now()): void {
    if (!changes.length) return;
    for (const socket of this.sockets()) {
      const player = this.attachment(socket); if (!player) continue;
      const change = changes.find(candidate => candidate.id === player.id);
      if (!change) continue;
      const moved = change.x !== undefined && change.z !== undefined && (change.x !== player.x || change.z !== player.z);
      socket.serializeAttachment({ ...player, shoulder: change.shoulder, ...(change.shoulder.cheerNextAt !== undefined ? { nextShoulderCheerAt: Math.max(player.nextShoulderCheerAt ?? 0, change.shoulder.cheerNextAt) } : {}), ...(moved ? { x: change.x!, z: change.z!, normalMoveAt: now, normalMoveCredit: NORMAL_SPEED * 0.3, lastMoveAt: now } : {}) });
      if (moved) this.send(socket, { type: 'position-correction', x: change.x, z: change.z, reason: 'shoulder-link', roundId: null, serverTime: now });
    }
  }
  private repairShoulders(): void { this.applyShoulderChanges(repairShoulderLinks(this.sockets().flatMap(socket => { const player = this.attachment(socket); return player ? [player] : []; }))); }
  private leaveShoulder(socket: WebSocket, player: Attachment): Attachment {
    if (!player.shoulder) return player;
    const next = { ...player, shoulder: null }; socket.serializeAttachment(next);
    this.broadcast({ type: 'players', players: this.players() });
    return next;
  }
  private chats(now: number): ChatMessage[] { return this.sockets().flatMap((socket) => { const message = this.attachment(socket)?.lastChat?.message; return message && message.expiresAt > now ? [message] : []; }).sort((a, b) => a.sentAt - b.sentAt); }
  private send(socket: WebSocket, value: unknown): void { try { socket.send(JSON.stringify(value)); } catch { /* Close frees the socket. */ } }
  private broadcast(value: unknown): void {
    const message = JSON.stringify(value);
    for (const socket of this.sockets()) { try { socket.send(message); } catch { /* A closed peer must not prevent delivery to the remaining room. */ } }
  }
  private broadcastActionNotice(player: Pick<Attachment, 'id' | 'nickname'>, kind: ActionNoticeKind, now: number, refreshments?: RefreshmentSelection | null, shoulderCount = 1): void {
    const notice: ActionNotice = { id: crypto.randomUUID(), playerId: player.id, nickname: player.nickname, kind, text: actionNoticeText(kind, refreshments, shoulderCount), at: now, expiresAt: now + (kind === 'shoulder-cheer' ? SHOULDER_LINK_RULES.cheerDurationMs : ACTION_NOTICE_RULES.ttlMs) };
    this.broadcast({ type: 'action-notice', notice });
  }
  private broadcastMovement(id: string, x: number, z: number, actionCancelled = false): void {
    const delta = JSON.stringify({ type: 'player-moved', player: { id, x, z, ...(actionCancelled ? { action: null } : {}) } });
    let fullRoster: string | undefined;
    for (const socket of this.sockets()) {
      // Older open tabs and hibernated attachments have not opted into deltas.
      // Serialize their fallback only if needed, and at most once per movement.
      const message = this.attachment(socket)?.movementDelta === true ? delta : (fullRoster ??= JSON.stringify({ type: 'players', players: this.players() }));
      try { socket.send(message); } catch { /* Keep delivering to the other peers. */ }
    }
  }
  private saveRuntime(state: Runtime): void { this.ctx.storage.sql.exec('INSERT INTO room_runtime (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json', JSON.stringify(state)); }
  private saveOffice(state: OfficeState): void { this.ctx.storage.sql.exec('INSERT INTO office_state (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json', JSON.stringify(state)); }
  private whisperReceipts(id: string, now: number): WhisperReceipt[] {
    const row = this.ctx.storage.sql.exec<{ receipts_json: string }>('SELECT receipts_json FROM office_whisper_receipts WHERE id=? AND expires_at>?', id, now).toArray()[0];
    return row ? JSON.parse(row.receipts_json) as WhisperReceipt[] : [];
  }
  private syncAlarm(): Promise<void> {
    this.alarmUpdates = this.alarmUpdates.catch(() => {}).then(() => {
      const whispers = this.ctx.storage.sql.exec<{ next: number | null }>('SELECT MIN(expires_at) AS next FROM office_whisper_receipts').toArray()[0]?.next;
      const times = [this.games?.nextAlarmAt(), whispers].filter((value): value is number => value != null), next = this.runtime.roomOpen && times.length ? Math.min(...times) : null;
      return next == null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
    }); return this.alarmUpdates;
  }
  private broadcastMarket(now = Date.now()): void { this.broadcast({ type: 'market', state: { ...marketView(this.office, '', 0), settings: this.runtime.settings }, serverTime: now }); }
  private activeBlock(id: string | null): RoomBlock | undefined { return id ? this.runtime.blocks.find((entry) => entry.id === id && entry.until > Date.now()) : undefined; }
  private publicState() { return { roomOpen: this.runtime.roomOpen, koreanChartsEnabled: koreanChartsEnabled(this.env), market: { selected: this.office.selected, charts: this.office.charts }, charts: this.office.charts, settings: this.runtime.settings, onlineCount: this.sockets().length, capacity: CAPACITY, overflowUrl: '/markets', serverTime: Date.now() }; }
  private admission(id: string | null) {
    const state = this.publicState(), reconnecting = Boolean(id && this.players().some((player) => player.id === id)), block = this.activeBlock(id);
    const error = block ? { code: 'BLOCKED', message: '관리자가 입장을 잠시 제한했어요.', retryAt: block.until } : !state.roomOpen ? { code: 'ROOM_CLOSED', message: '지금은 사무실이 닫혀 있어요. 잠시 후 다시 입장해 주세요.' } : !reconnecting && state.onlineCount >= CAPACITY ? { code: 'ROOM_FULL', message: '사무실이 가득 찼어요. 차트 화면을 이용해 주세요.' } : null;
    return { ...state, allowed: !error, reconnecting, ...(error ?? {}) };
  }
  private withAudit(runtime: Runtime, action: string, detail: string): Runtime { return { ...runtime, blocks: runtime.blocks.filter((entry) => entry.until > Date.now()), audit: [...runtime.audit, { at: Date.now(), action, detail }].slice(-80) }; }
  private adminState(): Response { return json({ ok: true, ...this.publicState(), boardCount: this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM board').toArray()[0]!.count, selectedSymbol: this.office.selected.symbol, selectedName: this.office.selected.name, voteActive: false, players: this.players().map(({ id, nickname, seat }) => ({ id, nickname, seat })), blocks: this.runtime.blocks.filter((entry) => entry.until > Date.now()), audit: this.runtime.audit }); }
  private async controlRoom(action: 'open' | 'close'): Promise<Response> {
    const roomOpen = action === 'open';
    if (roomOpen !== this.runtime.roomOpen) {
      const runtime = this.withAudit({ ...this.runtime, roomOpen }, action, roomOpen ? '사무실 입장 허용' : '사무실 닫기 · 접속자 퇴장');
      this.saveRuntime(runtime); this.runtime = runtime;
      if (!roomOpen) { this.games.close(); this.jump.close(); this.jumpSocial.clear(); this.ctx.storage.sql.exec('DELETE FROM office_whisper_receipts'); }
      if (!roomOpen) for (const socket of this.sockets()) { const p = this.attachment(socket)!; socket.serializeAttachment({ ...p, revoked: true }); this.send(socket, { type: 'room-closed', message: '개발자가 사무실을 닫았어요. 잠시 후 다시 입장해 주세요.' }); socket.close(4003, 'Office closed'); }
    }
    await this.syncAlarm(); return this.adminState();
  }
  private async manageRoom(input: Record<string, unknown>, reauthorize: () => Promise<boolean>): Promise<Response> {
    try {
      const action = input.action;
      if (['community-hide', 'community-restore', 'community-report-dismiss'].includes(String(action))) {
        if (!await reauthorize()) return adminError('ADMIN_AUTH', '관리자 로그인이 필요해요.', 401);
        const runtime = this.ctx.storage.transactionSync(() => {
          const detail = this.community.moderate(input), next = this.withAudit(this.runtime, String(action), detail);
          this.saveRuntime(next); return next;
        });
        this.runtime = runtime;
        if (action !== 'community-report-dismiss') this.broadcast({ type: 'community-changed' });
        return this.adminState();
      }
      if (!['charts', 'settings', 'kick', 'block', 'unblock', 'clear-chat'].includes(String(action))) throw new GameError('INVALID', '관리 작업을 다시 선택해 주세요.');
      let charts: OfficeCharts | undefined, interval: ChartInterval | undefined, settingsPatch: Omit<OfficeSettings, 'interval'> | undefined;
      if (action === 'charts') {
        if (!Array.isArray(input.symbols) || input.symbols.length !== OFFICE_CHART_COUNT || !input.symbols.every((symbol) => typeof symbol === 'string' && symbol.length <= 60)) throw new GameError('MARKET_INVALID', '앞벽·뒷벽 차트 8개의 종목을 선택해 주세요. 이전 운영실 화면이라면 새로고침해 주세요.');
        if (!CHART_INTERVALS.includes(input.interval as ChartInterval)) throw new GameError('INTERVAL_INVALID', '지원하는 차트 간격을 선택해 주세요.');
        if (!koreanChartsEnabled(this.env) && input.symbols.some((symbol) => symbol.startsWith('KRX:'))) throw new GameError('KOREAN_CHARTS_DISABLED', '국내 차트 연결을 준비 중이에요.');
        const markets = await Promise.all(input.symbols.map((symbol) => findMarket(symbol)));
        if (markets.some((market) => !market)) throw new GameError('MARKET_INVALID', '검색 결과에서 지원하는 종목을 선택해 주세요.');
        charts = markets as OfficeCharts; interval = input.interval as ChartInterval;
      }
      if (action === 'settings') {
        if (typeof input.notice !== 'string' || typeof input.donationUrl !== 'string' || typeof input.chatEnabled !== 'boolean') throw new GameError('SETTINGS_INVALID', '공지·후원 링크·채팅 설정을 확인해 주세요.');
        const notice = input.notice.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
        if ([...notice].length > 200) throw new GameError('NOTICE_LENGTH', '공지는 200자까지 입력할 수 있어요.');
        let donationUrl = input.donationUrl.trim();
        if (donationUrl) {
          let url: URL; try { url = new URL(donationUrl); } catch { throw new GameError('DONATION_URL', '카카오페이 후원 링크를 확인해 주세요.'); }
          if (donationUrl.length > 1000 || url.protocol !== 'https:' || !['qr.kakaopay.com', 'link.kakaopay.com'].includes(url.hostname) || url.username || url.password || url.port) throw new GameError('DONATION_URL', 'https 카카오페이 공식 후원 링크만 사용할 수 있어요.');
          donationUrl = url.href;
        }
        settingsPatch = { notice, donationUrl, chatEnabled: input.chatEnabled };
      }
      if (action === 'kick' || action === 'block' || action === 'unblock') {
        if (typeof input.id !== 'string' || !/^[a-f0-9]{64}$/.test(input.id)) throw new GameError('PLAYER_INVALID', '대상 접속자를 다시 선택해 주세요.');
        if (action === 'block' && input.minutes !== 60) throw new GameError('BLOCK_DURATION', '입장 제한 시간은 60분이에요.');
      }
      // Catalog I/O and body reads can overlap logout, secret rotation or other admin actions.
      if (!await reauthorize()) return adminError('ADMIN_AUTH', '관리자 로그인이 필요해요.', 401);
      let runtime = this.runtime, office = this.office, detail = '';
      if (charts && interval) { office = { chartLayoutVersion: OFFICE_CHART_LAYOUT_VERSION, selected: charts[0], charts, vote: null, lastResult: null }; runtime = { ...runtime, settings: { ...runtime.settings, interval } }; detail = `${charts.map((market) => market.symbol).join(', ')} · ${interval}`; }
      if (settingsPatch) { runtime = { ...runtime, settings: { ...runtime.settings, ...settingsPatch } }; detail = `공지 ${settingsPatch.notice ? '설정' : '없음'} · 후원 ${settingsPatch.donationUrl ? '설정' : '없음'} · 채팅 ${settingsPatch.chatEnabled ? '허용' : '중지'}`; }
      if (action === 'kick' || action === 'block' || action === 'unblock') {
        const id = input.id as string, live = this.players().find((player) => player.id === id), existing = runtime.blocks.find((entry) => entry.id === id);
        const profile = live ?? existing ?? this.ctx.storage.sql.exec<{ nickname: string }>('SELECT nickname FROM accounts WHERE id = ?', id).toArray()[0];
        if (!profile || action === 'kick' && !live) throw new GameError('PLAYER_MISSING', '대상 접속자를 찾을 수 없어요.');
        detail = `${profile.nickname} (${id.slice(0, 8)})`;
        const blocks = runtime.blocks.filter((entry) => entry.until > Date.now() && entry.id !== id);
        if (action === 'block') { if (blocks.length >= 200) throw new GameError('BLOCK_LIMIT', '기존 입장 제한을 해제한 뒤 다시 시도해 주세요.'); blocks.push({ id, nickname: profile.nickname, until: Date.now() + 60 * 60_000 }); }
        if (action !== 'kick') runtime = { ...runtime, blocks };
      }
      if (action === 'clear-chat') detail = '현재 말풍선과 대화 표시 지우기';
      runtime = this.withAudit(runtime, action as string, detail);
      this.ctx.storage.transactionSync(() => { if (charts) this.saveOffice(office); this.saveRuntime(runtime); });
      this.office = office; this.runtime = runtime;
      if (charts) this.broadcastMarket();
      if (charts || settingsPatch) this.broadcast({ type: 'settings', settings: runtime.settings, serverTime: Date.now() });
      if (action === 'clear-chat') {
        for (const socket of this.sockets()) { const attachment = this.attachment(socket)!; const { lastChat: _lastChat, ...rest } = attachment; socket.serializeAttachment(rest); }
        this.chatReceipts.clear(); this.broadcast({ type: 'chat-clear', serverTime: Date.now() });this.jumpSocial.clear();
      }
      if (action === 'kick' || action === 'block') {
        for (const socket of this.sockets()) {
          const player = this.attachment(socket)!; if (player.id !== input.id) continue;
          socket.serializeAttachment({ ...player, revoked: true });
          this.send(socket, { type: 'kicked', reason: action === 'block' ? 'admin-block' : 'admin-kick', message: action === 'block' ? '관리자가 60분 동안 입장을 제한했어요.' : '관리자가 사무실에서 내보냈어요.', ...(action === 'block' ? { retryAt: this.activeBlock(player.id)!.until } : {}) });
          socket.close(action === 'block' ? 4005 : 4004, action === 'block' ? 'Admission blocked' : 'Removed by administrator');
          this.games.left(player.id); this.jump.left(player.id); this.publishJumpPresence(true);
        }
        this.broadcast({ type: 'players', players: this.players(), onlineCount: this.sockets().length, capacity: CAPACITY });
        this.ctx.waitUntil(this.syncAlarm());
      }
      return this.adminState();
    } catch (error) { return json({ ok: false, ...errorBody(error) }, error instanceof GameError ? 400 : 500); }
  }
  async alarm(): Promise<void> { const now = Date.now(); this.ctx.storage.sql.exec('DELETE FROM office_whisper_receipts WHERE expires_at<=?', now); if (this.runtime.roomOpen) this.games.advance(now); await this.syncAlarm(); }
  private consumeInbound(socket: WebSocket, player: Attachment, now: number): Attachment | null {
    const available = Math.min(12, (player.inboundTokens ?? 12) + Math.max(0, now - (player.inboundUpdatedAt ?? now)) * (this.jump.isActive(player.id) ? 8 : 2) / 1000), next = { ...player, inboundTokens: Math.max(0, available - 1), inboundUpdatedAt: now };
    if (available < 1) {
      next.inboundViolations = now - (player.inboundViolationAt ?? 0) < 10000 ? (player.inboundViolations ?? 0) + 1 : 1; next.inboundViolationAt = now; if (next.inboundViolations >= 3) next.revoked = true;
      socket.serializeAttachment(next); this.send(socket, errorBody(new GameError('RATE_LIMIT', '요청이 너무 많아요. 잠시 후 다시 입장해 주세요.')));
      if (next.revoked) { socket.close(1008, 'Too many messages'); this.games.left(player.id, now); this.jump.left(player.id, now); this.publishJumpPresence(true); this.ctx.waitUntil(this.syncAlarm()); this.broadcast({ type: 'players', players: this.players() }); } return null;
    }
    socket.serializeAttachment(next); return next;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/status') return json(this.publicState());
    if (url.pathname === '/api/jump/leaderboard') return json({ok:true,leaders:this.jump.leaderboard()});
    if (url.pathname === '/api/admission') return json(this.admission(request.headers.get('X-Podeumgo-Player')));
    if (url.pathname.startsWith('/api/admin/')) return this.admin.route(request, (action) => this.controlRoom(action), () => this.adminState(), (input, reauthorize) => this.manageRoom(input, reauthorize), (query) => this.community.adminState(query), () => this.usage.get());
    if (url.pathname.startsWith('/api/avatar/')) {
      const actor = request.headers.get('X-Podeumgo-Player');
      if (request.method === 'POST' && (!this.runtime.roomOpen || this.activeBlock(actor))) return json({ ok: false, code: 'ROOM_CLOSED', message: '입장이 가능한 상태에서 다시 시도해 주세요.' }, 403);
      return this.games.route(request, actor, () => this.runtime.roomOpen && !this.activeBlock(actor));
    }
    if (url.pathname === '/api/community' || url.pathname.startsWith('/api/community/')) {
      const actor = request.headers.get('X-Podeumgo-Player');
      return this.community.route(request, actor, request.headers.get('X-Podeumgo-Address') ?? 'local', () => Boolean(this.activeBlock(actor)));
    }
    const preflight = url.pathname === '/api/join-check';
    if (!preflight && (url.pathname !== '/api/room' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')) return json({ error: 'WebSocket connection required' }, 426);
    const id = request.headers.get('X-Podeumgo-Player'); if (!id || !/^[a-f0-9]{64}$/.test(id)) return json(errorBody(new GameError('SESSION', '입장 화면에서 다시 접속해 주세요.')), 401);
    try {
      const admission = this.admission(id);
      if (!admission.allowed) return json({ ok: false, ...admission }, 'code' in admission && admission.code === 'BLOCKED' ? 403 : 503);
      const nickname = validateNickname(url.searchParams.get('nickname')), requestedProfile = requestedStockProfile(url.searchParams), now = Date.now();
      let appearance = this.games.appearance(id);
      if (url.searchParams.has('appearance')) {
        const rawAppearance = url.searchParams.get('appearance')!;
        if (rawAppearance.length > 1200) throw new GameError('AVATAR_INVALID', '캐릭터 설정이 너무 길어요.');
        try { appearance = validateOwnedAppearance(JSON.parse(rawAppearance), this.games.profile(id).owned); }
        catch (error) { throw new GameError('AVATAR_INVALID', error instanceof Error ? error.message : '캐릭터 설정을 확인해 주세요.'); }
      }
      canJoin(id, nickname, this.players()); if (preflight) return json({ ok: true, ...admission });
      // No await between capacity validation, identity replacement and acceptance.
      let profile = this.ctx.storage.sql.exec<{ id: string; nickname: string; color: number }>('SELECT id, nickname, color FROM accounts WHERE id = ?', id).toArray()[0];
      if (!profile) { const color = COLORS[parseInt(id.slice(0, 8), 16) % COLORS.length]!; this.ctx.storage.sql.exec('INSERT INTO accounts (id, nickname, balance, next_play_at, color) VALUES (?, ?, 0, 0, ?)', id, nickname, color); profile = { id, nickname, color }; }
      else if (profile.nickname !== nickname) { this.ctx.storage.sql.exec('UPDATE accounts SET nickname = ? WHERE id = ?', nickname, id); profile = { ...profile, nickname }; }
      const stockProfile = this.stockProfile(id, requestedProfile);
      this.games.updateAppearance(id, appearance);
      let previous: Attachment | null = null;
      for (const socket of this.sockets()) { const p = this.attachment(socket)!; if (p.id !== id) continue; previous = p; socket.serializeAttachment({ ...p, revoked: true }); this.send(socket, { type: 'error', code: 'SESSION_REPLACED', message: '다른 창에서 사무실에 입장했어요.' }); socket.close(4001, 'Session replaced'); }
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]; this.ctx.acceptWebSocket(server);
      const resumed = !previous && url.searchParams.get('resume') === '1' ? this.resumePosition(id, now) : null;
      const point = previous ? { x: previous.x, z: previous.z } : resumed ?? ROOM_SPAWN, nextProposalAt = 0;
      this.ctx.storage.sql.exec('DELETE FROM office_resume_positions WHERE id=?', id);
      server.serializeAttachment({ ...previous, ...profile, stockProfile, ...point, seat: previous?.seat ?? resumed?.seat ?? null, refreshments: this.refreshments.current(id), layoutVersion: MAP_LAYOUT_VERSION, normalMoveAt: previous?.normalMoveAt ?? now, normalMoveCredit: previous?.normalMoveCredit ?? NORMAL_SPEED * 0.3, lastMoveAt: previous?.lastMoveAt ?? 0, nextProposalAt, movementDelta: url.searchParams.get('positions') === 'delta', revoked: false } satisfies Attachment);
      this.send(server, { type: 'welcome', ...this.publicState(), avatarProfile: this.games.profile(id), me: { ...profile, stockProfile, appearance, area: this.jump.isActive(id) ? 'jump' : this.games.location(id) }, players: this.players(), chats: this.chats(now), market: { ...marketView(this.office, id, nextProposalAt), settings: this.runtime.settings }, serverTime: now, rules: { capacity: CAPACITY, layoutVersion: MAP_LAYOUT_VERSION, ...CHAT_RULES, seatCount: SEATS.length } });
      this.games.joined(id, now); this.jump.joined(id, now);
      this.broadcast({ type: 'players', players: this.players() }); this.broadcastMarket(now); this.ctx.waitUntil(this.syncAlarm()); return new Response(null, { status: 101, webSocket: client });
    } catch (error) { return json({ ok: false, ...errorBody(error) }, error instanceof GameError ? error.code === 'ROOM_FULL' ? 503 : 400 : 500); }
  }
  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.runtime.roomOpen) { socket.close(4003, 'Office closed'); return; }
    const original = this.attachment(socket); if (!original || original.revoked) { socket.close(4001, 'Session expired'); return; }
    const now = Date.now(); let player = this.consumeInbound(socket, original, now); if (!player) return; let input: Record<string, unknown> | undefined;
    try {
      if (typeof raw !== 'string' || raw.length > 2048) throw new GameError('INVALID', '요청 내용이 너무 길어요.');
      const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new GameError('INVALID', '올바르지 않은 요청이에요.'); input = parsed as Record<string, unknown>;
      if (input.type === 'whisper') {
        if (!this.runtime.settings.chatEnabled) throw new GameError('CHAT_DISABLED', '관리자가 채팅을 잠시 중지했어요.');
        const requestId = socialRequestId(input.requestId);
        let text: string;
        try { text = normalizeWhisper(input.text); } catch (error) { throw new GameError('WHISPER_TEXT', error instanceof Error ? error.message : '귓속말을 확인해 주세요.'); }
        if (typeof input.to !== 'string' || !/^[a-f0-9]{64}$/.test(input.to) || input.to === player.id) throw new GameError('WHISPER_RECIPIENT', '귓속말을 받을 다른 접속자를 선택해 주세요.');
        const receipts = this.whisperReceipts(player.id, now), receipt = receipts.find(item => item.requestId === requestId);
        if (receipt) {
          if (receipt.message.toId !== input.to || receipt.message.text !== text) throw new GameError('REQUEST_REUSED', '이미 보낸 요청의 내용을 바꿀 수 없어요.');
          this.send(socket, { type: 'whisper', message: receipt.message, requestId }); return;
        }
        const recipientSocket = this.sockets().find(peer => this.attachment(peer)?.id === input!.to), recipient = recipientSocket ? this.attachment(recipientSocket) : null;
        if (!recipientSocket || !recipient) throw new GameError('WHISPER_OFFLINE', '상대방이 접속을 종료했어요.');
        // The stored receipts keep the allowance from being reset by a reconnect.
        const burst = chatBurstTake(Math.max(player.whisperBurst ?? 0, chatBurstReplay(receipts.map(item => item.message.sentAt))), now);
        if (!burst.ok) throw new GameError('WHISPER_COOLDOWN', '귓속말을 조금만 천천히 보내 주세요.', burst.retryAt);
        const message: WhisperMessage = { id: crypto.randomUUID(), fromId: player.id, fromNickname: player.nickname, toId: recipient.id, toNickname: recipient.nickname, text, sentAt: now };
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec('DELETE FROM office_whisper_receipts WHERE expires_at<=?', now);
          this.ctx.storage.sql.exec('INSERT INTO office_whisper_receipts(id,receipts_json,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET receipts_json=excluded.receipts_json,expires_at=excluded.expires_at', message.fromId, JSON.stringify([...receipts, { requestId, message }].slice(-WHISPER_RULES.receiptLimit)), now + WHISPER_RECEIPT_TTL_MS);
        });
        socket.serializeAttachment({ ...player, whisperBurst: burst.fullAt });
        this.ctx.waitUntil(this.syncAlarm());
        this.send(socket, { type: 'whisper', message, requestId }); this.send(recipientSocket, { type: 'whisper', message }); return;
      }
      if (this.jumpSocial.handle(player.id,input,now)) return;
      if (this.jump.handle(player.id,input,now)) return;
      if (this.jump.isActive(player.id)) {if(input.type==='move')return;throw new GameError('JUMP_AREA','점프 타워에서 나간 뒤 사용할 수 있어요.');}
      if (input.type === 'game-chat' && !this.runtime.settings.chatEnabled) throw new GameError('CHAT_DISABLED', '관리자가 채팅을 잠시 중지했어요.');
      if (this.games.handle(player.id, input, now)) { this.ctx.waitUntil(this.syncAlarm()); return; }
      if (this.games.location(player.id) === 'games') {
        if (input.type === 'move') return;
        throw new GameError('GAME_AREA', '사무실로 돌아간 뒤 사용할 수 있어요. 게임 중 대화는 게임방 채팅을 이용해 주세요.');
      }
      if (input.type === 'move') {
        // Network jitter can put two one-second updates less than 950 ms apart.
        // Dropping one made the next update exceed the travel budget and snap
        // the player back. The distance credit and inbound bucket enforce rate.
        if (player.seat !== null) return;
        const { x, z } = input, credit = Math.min(NORMAL_SPEED * 1.5, Math.max(0, player.normalMoveCredit ?? 0) + Math.max(0, now - (player.normalMoveAt ?? now)) * NORMAL_SPEED / 1000), distance = typeof x === 'number' && typeof z === 'number' ? Math.hypot(x - player.x, z - player.z) : Infinity;
        if (typeof x !== 'number' || typeof z !== 'number' || !isWalkable(x, z) || distance > credit + 1e-8) { this.send(socket, { type: 'position-correction', x: player.x, z: player.z, roundId: null, serverTime: now }); return; }
        if (distance > 0.001) player = this.leaveShoulder(socket, player);
        const preserveJump = player.lastAvatarAction?.action.kind === 'jump';
        const actionCancelled = !preserveJump && !player.avatarActionCancelled && !!player.lastAvatarAction && player.lastAvatarAction.action.expiresAt > now;
        socket.serializeAttachment({ ...player, x, z, normalMoveAt: now, normalMoveCredit: Math.max(0, credit - distance), lastMoveAt: now, avatarActionCancelled: preserveJump ? player.avatarActionCancelled : true }); this.broadcastMovement(player.id, x, z, actionCancelled); return;
      }
      if (input.type === 'shoulder-link') {
        const requestId = socialRequestId(input.requestId);
        if (typeof input.enabled !== 'boolean') throw new GameError('SHOULDER_INVALID', '어깨동무 동작을 다시 선택해 주세요.');
        const receipt = player.shoulderReceipts?.find(item => item.requestId === requestId);
        if (receipt) {
          if (receipt.enabled !== input.enabled) throw new GameError('REQUEST_REUSED', '이미 사용한 요청 번호예요.');
          this.send(socket, { type: 'shoulder-state', requestId, shoulder: player.shoulder ?? null, serverTime: now }); return;
        }
        if (input.enabled) {
          if (player.seat !== null) throw new GameError('SHOULDER_SEATED', '자리에서 일어난 뒤 어깨동무해 주세요.');
          if (player.refreshments) throw new GameError('SHOULDER_HANDS_BUSY', '음료·간식을 내려놓은 뒤 어깨동무해 주세요.');
          if (now < (player.nextShoulderAt ?? 0)) throw new GameError('SHOULDER_COOLDOWN', '잠시 후 다시 어깨동무해 주세요.', player.nextShoulderAt);
        }
        const receipts = [...(player.shoulderReceipts ?? []), { requestId, enabled: input.enabled }].slice(-SHOULDER_LINK_RULES.receiptLimit);
        socket.serializeAttachment({ ...player, shoulderReceipts: receipts, nextShoulderAt: now + SHOULDER_LINK_RULES.cooldownMs, avatarActionCancelled: input.enabled ? true : player.avatarActionCancelled, ...(input.enabled ? {} : { shoulder: null }) });
        if (input.enabled && !player.shoulder) {
          this.repairShoulders();
          this.applyShoulderChanges(joinShoulderLinks(this.sockets().map(peer => this.attachment(peer)!), player, now), now);
        }
        this.repairShoulders();
        const shoulder = this.attachment(socket)!.shoulder ?? null;
        this.send(socket, { type: 'shoulder-state', requestId, shoulder, serverTime: now });
        this.broadcast({ type: 'players', players: this.players() });
        if (!player.shoulder && shoulder) this.broadcastActionNotice(player, 'shoulder-start', now, null, shoulder.count);
        else if (player.shoulder && !shoulder) this.broadcastActionNotice(player, 'shoulder-end', now);
        return;
      }
      if (input.type === 'shoulder-cheer') {
        const requestId = socialRequestId(input.requestId);
        this.repairShoulders();
        player = this.attachment(socket)!;
        if (player.shoulderCheerReceipts?.includes(requestId)) {
          this.send(socket, { type: 'shoulder-cheer-state', requestId, shoulder: player.shoulder ?? null, serverTime: now }); return;
        }
        const groupId = player.shoulder?.groupId;
        const members = groupId ? this.sockets().flatMap(peer => { const member = this.attachment(peer); return member?.shoulder?.groupId === groupId ? [member] : []; }) : [];
        if (members.length < 2 || !player.shoulder || player.seat !== null || player.refreshments) throw new GameError('SHOULDER_CHEER_GROUP', '두 명 이상 어깨동무한 뒤 으쌰! 으쌰!를 할 수 있어요.');
        const retryAt = Math.max(...members.map(member => Math.max(member.nextShoulderCheerAt ?? 0, member.shoulder?.cheerNextAt ?? 0)));
        if (now < retryAt) throw new GameError('SHOULDER_CHEER_COOLDOWN', '잠깐 쉬었다가 다시 으쌰! 해 주세요.', retryAt);
        const cheer: ShoulderCheerView = { id: crypto.randomUUID(), startedAt: now, expiresAt: now + SHOULDER_LINK_RULES.cheerDurationMs };
        const receipts = [...(player.shoulderCheerReceipts ?? []), requestId].slice(-SHOULDER_LINK_RULES.cheerReceiptLimit);
        socket.serializeAttachment({ ...player, shoulderCheerReceipts: receipts });
        this.applyShoulderChanges(members.map(member => ({ id: member.id, shoulder: { ...member.shoulder!, cheer, cheerNextAt: now + SHOULDER_LINK_RULES.cheerCooldownMs } })), now);
        this.send(socket, { type: 'shoulder-cheer-state', requestId, shoulder: this.attachment(socket)!.shoulder, serverTime: now });
        this.broadcast({ type: 'players', players: this.players() });
        for (const member of members) this.broadcastActionNotice(member, 'shoulder-cheer', now);
        return;
      }
      if (input.type === 'avatar-action') {
        const requestId = socialRequestId(input.requestId);
        if (!isAvatarActionKind(input.kind)) throw new GameError('ACTION_INVALID', '캐릭터 동작을 다시 선택해 주세요.');
        if ((input.kind === 'dance' || input.kind === 'heart') && !this.games.owns(player.id, `action-${input.kind}`)) throw new GameError('ITEM_LOCKED', '상점에서 이 액션을 구매한 뒤 사용할 수 있어요.');
        const receipt = player.avatarActionReceipts?.find(item => item.requestId === requestId);
        if (receipt) {
          if (receipt.kind !== input.kind) throw new GameError('REQUEST_REUSED', '이미 사용한 요청 번호예요.');
          const action = !player.avatarActionCancelled && player.lastAvatarAction?.action.id === receipt.actionId && player.lastAvatarAction.action.expiresAt > now ? player.lastAvatarAction.action : null;
          this.send(socket, { type: 'avatar-action', playerId: player.id, action, requestId, serverTime: now }); return;
        }
        if (player.lastAvatarAction?.requestId === requestId) {
          if (player.lastAvatarAction.action.kind !== input.kind) throw new GameError('REQUEST_REUSED', '이미 사용한 요청 번호예요.');
          this.send(socket, { type: 'avatar-action', playerId: player.id, action: player.avatarActionCancelled || player.lastAvatarAction.action.expiresAt <= now ? null : player.lastAvatarAction.action, requestId, serverTime: now }); return;
        }
        const kind = input.kind;
        if (kind === 'jump' && player.seat !== null) throw new GameError('ACTION_SEATED', '자리에서 일어난 뒤 점프해 주세요.');
        const previous = player.lastAvatarAction?.action;
        const activeJump = !player.avatarActionCancelled && previous?.kind === 'jump' && previous.expiresAt > now ? previous : null;
        const nextJumpAt = Math.max(player.nextJumpAt ?? 0, previous?.kind === 'jump' ? previous.expiresAt + JUMP_RULES.landingCooldownMs : 0);
        if (kind === 'jump') {
          // The server owns the stage, launch height and time. Only a new request
          // during the first flight can boost; receipts above never spend a boost.
          const retryAt = activeJump && jumpStep(activeJump) === 1 ? activeJump.startedAt + JUMP_RULES.minBoostDelayMs : nextJumpAt;
          if (now < retryAt) throw new GameError('ACTION_COOLDOWN', activeJump && jumpStep(activeJump) === 1 ? '한 번 더 눌러 2단 점프해 주세요.' : '착지한 뒤 다시 점프해 주세요.', retryAt);
        } else {
          const retryAt = activeJump?.expiresAt ?? (previous ? previous.kind === 'jump' ? previous.expiresAt : previous.startedAt + getAvatarActionCooldown(previous.kind) : 0);
          if (now < retryAt) throw new GameError('ACTION_COOLDOWN', '동작이 끝나면 다시 할 수 있어요.', retryAt);
        }
        if (kind === 'drink' && !player.refreshments?.drink) throw new GameError('ACTION_NO_DRINK', '먼저 간식 코너에서 음료를 가져와 주세요.');
        if (kind === 'eat' && !player.refreshments?.snack) throw new GameError('ACTION_NO_SNACK', '먼저 간식 코너에서 간식을 가져와 주세요.');
        if (!['jump', 'drink', 'eat'].includes(kind) && !isMarketReaction(kind) && player.refreshments) throw new GameError('ACTION_HANDS_BUSY', '쟁반을 카운터에 반납한 뒤 액션을 해 주세요.');
        player = this.leaveShoulder(socket, player);
        const action: AvatarActionView = kind === 'jump' ? createJumpAction(crypto.randomUUID(), now, activeJump) : { id: crypto.randomUUID(), kind, startedAt: now, expiresAt: now + getAvatarActionDuration(kind) };
        const receipts = [...(player.avatarActionReceipts ?? []), { requestId, kind, actionId: action.id }].slice(-ACTION_NOTICE_RULES.receiptLimit);
        socket.serializeAttachment({ ...player, lastAvatarAction: { requestId, action }, avatarActionReceipts: receipts, avatarActionCancelled: false, ...(kind === 'jump' ? { nextJumpAt: action.expiresAt + JUMP_RULES.landingCooldownMs } : {}) });
        this.broadcast({ type: 'avatar-action', playerId: player.id, action, requestId, serverTime: now });
        this.broadcastActionNotice(player, kind, now, player.refreshments); return;
      }
      if (input.type === 'chat' || input.type === 'chat-sticker') {
        if (!this.runtime.settings.chatEnabled) throw new GameError('CHAT_DISABLED', '관리자가 채팅을 잠시 중지했어요.');
        const item = input.type === 'chat-sticker' ? shopItem(input.itemId) : undefined;
        if (input.type === 'chat-sticker' && (!item || item.category !== 'emoji' || !item.emoji || !this.games.owns(player.id, item.id))) throw new GameError('ITEM_LOCKED', '구매한 채팅 이모티콘을 선택해 주세요.');
        const requestId = socialRequestId(input.requestId), text = normalizeChat(item?.emoji ?? input.text);
        const recent = this.chatReceipts.get(player.id) ?? [], sent = player.lastChat?.requestId === requestId ? player.lastChat : recent.find(item => item.requestId === requestId);
        if (sent) { if (sent.message.text !== text) throw new GameError('REQUEST_REUSED', '이미 보낸 요청의 내용을 바꿀 수 없어요.'); this.send(socket, { type: 'chat', message: sent.message, requestId }); return; }
        const burst = chatBurstTake(Math.max(player.chatBurst ?? 0, this.chatBursts.get(player.id) ?? 0), now); if (!burst.ok) throw new GameError('CHAT_COOLDOWN', '조금만 천천히 말해 주세요.', burst.retryAt);
        const message: ChatMessage = { id: crypto.randomUUID(), playerId: player.id, nickname: player.nickname, text, sentAt: now, expiresAt: now + CHAT_RULES.chatTtlMs }; socket.serializeAttachment({ ...player, lastChat: { requestId, message }, chatBurst: burst.fullAt });
        // A full bucket and an expired bubble need no memory, so both maps stay as small as the room is busy.
        if (this.chatBursts.size >= 256) for (const [id, fullAt] of this.chatBursts) if (fullAt <= now) { this.chatBursts.delete(id); this.chatReceipts.delete(id); }
        this.chatBursts.set(player.id, burst.fullAt); this.chatReceipts.set(player.id, [...recent, { requestId, message }].slice(-CHAT_BURST.capacity));
        for(const peer of this.sockets())if(!this.jump.isActive(this.attachment(peer)!.id))this.send(peer,{type:'chat',message,requestId});return;
      }
      if (input.type === 'refreshments') {
        const result = this.refreshments.change(player, input, now);
        if (result.changed) player = this.leaveShoulder(socket, player);
        socket.serializeAttachment({ ...player, refreshments: result.refreshments, avatarActionCancelled: result.changed ? true : player.avatarActionCancelled });
        this.send(socket, { type: 'refreshments-state', requestId: result.requestId, refreshments: result.refreshments });
        if (result.changed) {
          this.broadcast({ type: 'players', players: this.players() });
          this.broadcastActionNotice(player, result.refreshments ? 'refreshments-take' : 'refreshments-clear', now, result.refreshments ?? player.refreshments);
        }
        return;
      }
      if (input.type === 'sit' || input.type === 'stand') {
        const requestId = socialRequestId(input.requestId), seat = input.type === 'sit' ? classroomSeat(input.seat) : null;
        const receipt = player.seatActionReceipts?.find(item => item.requestId === requestId);
        if (receipt) {
          if (receipt.type !== input.type || receipt.seat !== (seat?.id ?? null)) throw new GameError('REQUEST_REUSED', '이미 사용한 요청 번호예요.');
          this.send(socket, { type: 'seat-state', requestId, seat: player.seat }); return;
        }
        if (player.lastSeatAction?.requestId === requestId) { if (player.lastSeatAction.type !== input.type || player.lastSeatAction.seat !== (seat?.id ?? null)) throw new GameError('REQUEST_REUSED', '이미 사용한 요청 번호예요.'); this.send(socket, { type: 'seat-state', requestId, seat: player.seat }); return; }
        if (seat && this.players().some((p) => p.id !== player!.id && p.seat === seat.id)) throw new GameError('SEAT_OCCUPIED', '다른 사람이 앉아 있는 의자예요.');
        player = this.leaveShoulder(socket, player);
        const previous = player.seat === null ? null : SEATS[player.seat], point = seat ? { x: seat.x, z: seat.z } : previous ? { x: previous.standX, z: previous.standZ } : { x: player.x, z: player.z };
        const nextSeat = seat?.id ?? null, seatAction = { requestId, type: input.type, seat: nextSeat } as const;
        const receipts = [...(player.seatActionReceipts ?? []), seatAction].slice(-ACTION_NOTICE_RULES.receiptLimit);
        socket.serializeAttachment({ ...player, ...point, seat: nextSeat, normalMoveAt: now, normalMoveCredit: seat ? 0 : NORMAL_SPEED * 0.3, avatarActionCancelled: true, lastSeatAction: seatAction, seatActionReceipts: receipts });
        this.send(socket, { type: 'seat-state', requestId, seat: nextSeat }); this.broadcast({ type: 'players', players: this.players() });
        if (player.seat !== nextSeat) this.broadcastActionNotice(player, input.type, now);
        return;
      }
      if (input.type === 'chart-propose' || input.type === 'chart-vote') throw new GameError('FEATURE_DISABLED', '차트는 관리자가 변경할 수 있어요.');
      throw new GameError('INVALID', '지원하지 않는 요청이에요.');
    } catch (error) { this.send(socket, errorBody(error, input?.requestId)); }
  }
  webSocketClose(socket: WebSocket, code: number, reason = ''): void {
    try {
      const p = this.attachment(socket);
      // A replaced/admin-revoked socket must never overwrite its successor.
      if (p && !p.revoked && !this.sockets().some(peer => peer !== socket && this.attachment(peer)?.id === p.id)) {
        const now = Date.now();
        this.ctx.storage.sql.exec('DELETE FROM office_resume_positions WHERE expires_at <= ?', now);
        if (code < 4000 && code !== 1008 && !(code === 1000 && reason === 'leave')) {
          this.ctx.storage.sql.exec('INSERT INTO office_resume_positions(id,x,z,seat,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET x=excluded.x,z=excluded.z,seat=excluded.seat,expires_at=excluded.expires_at', p.id, p.x, p.z, p.seat ?? null, now + 5 * 60_000);
        } else this.ctx.storage.sql.exec('DELETE FROM office_resume_positions WHERE id=?', p.id);
      }
      if (p) {
        socket.serializeAttachment({ ...p, revoked: true });
        if (!p.revoked && !this.sockets().some(peer => peer !== socket && this.attachment(peer)?.id === p.id)) {this.games.left(p.id);this.jump.left(p.id);this.publishJumpPresence(true);}
      }
      socket.close(code === 1005 || code === 1006 ? 1000 : code, 'Closed');
    } catch { /* Already closed. */ }
    this.broadcast({ type: 'players', players: this.players() }); this.ctx.waitUntil(this.syncAlarm());
  }
  webSocketError(socket: WebSocket): void { this.webSocketClose(socket, 1011); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), room = () => env.CLASSROOM.get(env.CLASSROOM.idFromName('podeumgo-one-classroom'));
    if (url.pathname === '/api/health') return json({ ok: true, room: 'podeum-office', capacity: CAPACITY });
    if (url.pathname === '/api/quotes') { if (!sameOrigin(request)) return json({ error: 'Origin not allowed' }, 403); return handleQuotes(request); }
    if (url.pathname === '/api/markets/search') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405); if (!sameOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
      const q = url.searchParams.get('q') ?? ''; if (q.length > 60) return json({ ok: false, code: 'QUERY', message: '검색어는 60자까지 입력해 주세요.' }, 400);
      const enabled = koreanChartsEnabled(env), kind = url.searchParams.get('kind') ?? 'all';
      // Remove unavailable exchanges before limiting the curated results. Dynamic
      // Binance results still use the existing server cache and validation.
      let markets = enabled ? await findMarkets(q, kind) : searchMarkets(PUBLIC_MARKETS, q, kind);
      if (!enabled && !markets.length && (kind === 'all' || kind === 'crypto')) markets = (await findMarkets(q, kind)).filter((market) => getMarketRegion(market) !== 'KR');
      return json({ ok: true, koreanChartsEnabled: enabled, markets });
    }
    if (url.pathname === '/api/admin/oauth/callback' && request.method === 'GET' && env.ADMIN_AUTH_MODE === 'google') return room().fetch(request);
    if(url.pathname==='/api/jump/leaderboard'){if(request.method!=='GET')return json({error:'Method not allowed'},405);if(!sameOrigin(request))return json({error:'Origin not allowed'},403);return room().fetch(request);}
    if (url.pathname === '/api/status' || url.pathname.startsWith('/api/admin/')) { if (!sameOrigin(request, request.method === 'POST')) return json({ ok: false, code: 'ORIGIN', message: '같은 사이트에서 요청해 주세요.' }, 403); return room().fetch(request); }
    if (url.pathname.startsWith('/api/avatar/')) {
      const expectedMethod = url.pathname === '/api/avatar/profile' ? ['GET', 'POST'] : ['/api/avatar/purchase', '/api/avatar/equip'].includes(url.pathname) ? ['POST'] : [];
      if (!expectedMethod.length) return json({ ok: false, code: 'NOT_FOUND', message: '페이지를 찾을 수 없어요.' }, 404);
      if (!expectedMethod.includes(request.method)) return json({ ok: false, code: 'METHOD', message: '요청 방식을 확인해 주세요.' }, 405);
      if (!sameOrigin(request, request.method === 'POST') || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ ok: false, code: 'ORIGIN', message: '같은 사이트에서 요청해 주세요.' }, 403);
      const token = tokenFrom(request); if (!token) return json({ ok: false, code: 'SESSION', message: '입장 화면에서 다시 접속해 주세요.' }, 401);
      const headers = new Headers(request.headers); headers.delete('X-Podeumgo-Player');
      headers.set('X-Podeumgo-Player', hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
      return room().fetch(new Request(request, { headers }));
    }
    if (url.pathname === '/api/community' || url.pathname.startsWith('/api/community/')) {
      if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, code: 'METHOD', message: '요청 방식을 확인해 주세요.' }, 405);
      if (!sameOrigin(request, request.method === 'POST') || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ ok: false, code: 'ORIGIN', message: '같은 사이트에서 요청해 주세요.' }, 403);
      const token = tokenFrom(request);
      if (request.method === 'POST' && !token) return json({ ok: false, code: 'SESSION', message: '브라우저 연결을 확인한 뒤 다시 시도해 주세요.' }, 401);
      const headers = new Headers(request.headers); headers.delete('X-Podeumgo-Player'); headers.delete('X-Podeumgo-Address');
      if (token) headers.set('X-Podeumgo-Player', hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
      if (request.method === 'POST') headers.set('X-Podeumgo-Address', hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`community:${Math.floor(Date.now() / 86_400_000)}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`))));
      return room().fetch(new Request(request, { headers }));
    }
    if (url.pathname === '/api/session') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405); if (!sameOrigin(request)) return json({ error: 'Origin not allowed' }, 403);
      const status = await room().fetch(new Request(new URL('/api/status', request.url))).then((response) => response.json()) as Record<string, unknown>;
      if (tokenFrom(request)) return json({ ok: true, ...status });
      const token = hex(crypto.getRandomValues(new Uint8Array(32))), secure = url.protocol === 'https:' ? '; Secure' : ''; return json({ ok: true, ...status }, 200, { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}` });
    }
    if (url.pathname === '/api/room' || url.pathname === '/api/join-check' || url.pathname === '/api/admission') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (!sameOrigin(request, url.pathname === '/api/room')) return json({ error: 'Origin not allowed' }, 403);
      const token = tokenFrom(request); if (!token && url.pathname !== '/api/admission') return json(errorBody(new GameError('SESSION', '입장 화면에서 다시 접속해 주세요.')), 401);
      const headers = new Headers(request.headers); headers.delete('X-Podeumgo-Player');
      if (token) headers.set('X-Podeumgo-Player', hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))); return room().fetch(new Request(request, { headers }));
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404); return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
