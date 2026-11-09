import { gameDefinition, GAME_RULES, type GameChoice, type GameKind, type GameRoundResult, type GameFinalRow, type GameChat } from '../shared/game-room';
import { GameError } from './domain';

export interface GameMember {
  id: string; nickname: string; bot: boolean; ready: boolean; team: 'A' | 'B' | null;
  score: number; chips: number; solved: boolean; forfeited: boolean; turns: number;
  choice: GameChoice | null; hints: { round: number; guess: number[]; exact: number; misplaced: number }[];
  disconnectedAt?: number;
}
export interface InternalRoom {
  id: string; kind: GameKind; hostId: string; practice: boolean; phase: 'waiting' | 'playing' | 'reveal' | 'finished';
  members: GameMember[]; round: number; deadline: number | null; updatedAt: number;
  secret: number[]; vaults: { A: number; B: number }; history: GameRoundResult[];
  results: GameFinalRow[]; finishReason: string | null; matchId: string; awarded: boolean; chats: GameChat[];
}
export const AUCTION_PRIZES = [3, 5, 4, 7, 9] as const;
export function newMember(id: string, nickname: string, bot = false): GameMember {
  return { id, nickname, bot, ready: bot, team: null, score: 0, chips: 18, solved: false, forfeited: false, turns: 0, choice: null, hints: [] };
}
export function randomCode(): number[] {
  const digits = [1,2,3,4,5,6];
  for (let index = digits.length - 1; index > 0; index--) {
    const selected = crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
    [digits[index], digits[selected]] = [digits[selected]!, digits[index]!];
  }
  return digits.slice(0,3);
}
export function hintFor(secret: readonly number[], guess: readonly number[]) {
  const exact = guess.filter((digit,index) => secret[index] === digit).length;
  return { exact, misplaced: guess.filter(digit => secret.includes(digit)).length - exact };
}
export function validateChoice(room: InternalRoom, member: GameMember, input: unknown): GameChoice {
  if (member.solved || member.forfeited) throw new GameError('GAME_SPECTATING', '이미 관전 중인 참가자예요.');
  if (room.kind === 'blind-auction') {
    if (!Number.isInteger(input) || (input as number) < 0 || (input as number) > Math.min(6, member.chips)) throw new GameError('GAME_CHOICE', '남은 칩 안에서 0~6칩을 선택해 주세요.');
    return input as number;
  }
  if (room.kind === 'vault-dilemma') {
    if (!['invest','guard','steal'].includes(input as string)) throw new GameError('GAME_CHOICE', '투자·감시·빼돌리기 중 하나를 선택해 주세요.');
    return input as 'invest' | 'guard' | 'steal';
  }
  if (!Array.isArray(input) || input.length !== 3 || new Set(input).size !== 3 || !input.every(digit => Number.isInteger(digit) && digit >= 1 && digit <= 6)) throw new GameError('GAME_CHOICE', '1~6 중 서로 다른 숫자 3개를 선택해 주세요.');
  return [...input];
}
export function seedBotChoices(room: InternalRoom) {
  for (const member of room.members) {
    if (!member.bot || member.forfeited || member.solved) continue;
    const random = crypto.getRandomValues(new Uint32Array(1))[0]!;
    if (room.kind === 'blind-auction') member.choice = random % (Math.min(6, member.chips) + 1);
    else if (room.kind === 'vault-dilemma') member.choice = ['invest','guard','steal'][random % 3] as GameChoice;
    else {
      const candidates: number[][] = [];
      for (let a=1;a<=6;a++) for (let b=1;b<=6;b++) for (let c=1;c<=6;c++) {
        if (a === b || b === c || a === c) continue;
        const guess = [a,b,c];
        if (member.hints.every(hint => { const result=hintFor(guess,hint.guess); return result.exact === hint.exact && result.misplaced === hint.misplaced; })) candidates.push(guess);
      }
      member.choice = candidates[random % candidates.length] ?? [1,2,3];
    }
  }
}
export function startRoom(room: InternalRoom, now: number) {
  room.phase = 'playing'; room.round = 1; room.deadline = now + GAME_RULES.roundMs; room.updatedAt = now;
  room.matchId = crypto.randomUUID(); room.awarded = false; room.secret = room.kind === 'cipher-race' ? randomCode() : [];
  room.vaults = { A:0, B:0 }; room.history = []; room.results = []; room.finishReason = null;
  room.members = room.members.map((member,index) => ({ ...newMember(member.id, member.nickname, member.bot), ready: true, team: room.kind === 'vault-dilemma' ? index % 2 ? 'B' : 'A' : null, ...(member.disconnectedAt ? { disconnectedAt: member.disconnectedAt } : {}) }));
  seedBotChoices(room);
}
export function roundComplete(room: InternalRoom) { return room.members.every(member => member.forfeited || member.solved || member.choice !== null); }
export function resolveRound(room: InternalRoom, now: number) {
  if (room.phase !== 'playing') return;
  const active = room.members.filter(member => !member.forfeited), before = new Map(active.map(member => [member.id,member.score]));
  const lines: string[] = [], choices: GameRoundResult['choices'] = [];
  if (room.kind === 'blind-auction') {
    for (const member of active) { const bid = typeof member.choice === 'number' ? member.choice : 0; member.chips -= bid; }
    const highest = Math.max(0,...active.map(member => typeof member.choice === 'number' ? member.choice : 0));
    const winners = active.filter(member => member.choice === highest && highest > 0);
    if (winners.length === 1) { winners[0]!.score += AUCTION_PRIZES[room.round-1]!; lines.push(`${winners[0]!.nickname}님이 ${highest}칩으로 ${AUCTION_PRIZES[room.round-1]}점을 얻었어요.`); }
    else lines.push(highest ? '최고 입찰이 겹쳤어요. 이번 보석은 아무도 얻지 못해요.' : '모두 패스했어요. 이번 보석은 남겨 두었어요.');
  } else if (room.kind === 'vault-dilemma') {
    for (const team of ['A','B'] as const) {
      const teamMembers = active.filter(member => member.team === team);
      let guards = teamMembers.filter(member => (member.choice ?? 'guard') === 'guard').length;
      room.vaults[team] += teamMembers.reduce((sum,member) => sum + (member.choice === 'invest' ? 3 : (member.choice ?? 'guard') === 'guard' ? 1 : 0),0);
      const ordered = [...teamMembers.slice((room.round-1)%teamMembers.length),...teamMembers.slice(0,(room.round-1)%teamMembers.length)];
      for (const member of ordered.filter(member => member.choice === 'steal')) {
        if (guards > 0) { guards--; member.score--; lines.push(`${member.nickname}님의 빼돌리기가 감시에 걸렸어요. 개인 몫 −1.`); }
        else if (room.vaults[team] >= 2) { room.vaults[team] -= 2; member.score += 4; lines.push(`${member.nickname}님이 금고 2를 빼돌려 개인 몫 4를 얻었어요.`); }
        else lines.push(`${member.nickname}님은 금고가 부족해 빼돌리지 못했어요.`);
      }
      lines.push(`${team}팀 금고 ${room.vaults[team]}`);
    }
  } else {
    for (const member of active) {
      if (member.solved || !Array.isArray(member.choice)) continue;
      const hint = hintFor(room.secret,member.choice);
      member.hints.push({ round: room.round, guess: [...member.choice], ...hint });
      if (hint.exact === 3) { member.solved = true; member.score = 20 - room.round*2; }
    }
    const solved = active.filter(member => member.solved).length;
    lines.push(`${solved}명이 암호를 풀었어요. 각자의 단서는 본인에게만 표시돼요.`);
  }
  if (room.kind !== 'cipher-race') for (const member of active) choices.push({ playerId:member.id,choice:member.choice ?? (room.kind==='vault-dilemma'?'guard':0),points:member.score-(before.get(member.id)??0) });
  room.history.push({ round:room.round,title:`${room.round}라운드 결과`,lines,choices });
  room.phase = 'reveal'; room.deadline = now + GAME_RULES.revealMs; room.updatedAt = now;
}
export function finishRoom(room: InternalRoom, now: number, reason: string | null = null) {
  if (room.phase === 'finished') return;
  if (!reason && room.kind === 'vault-dilemma') {
    const winner = room.vaults.A === room.vaults.B ? null : room.vaults.A > room.vaults.B ? 'A' : 'B';
    for (const member of room.members) if (!member.forfeited) member.score += winner === null ? 6 : member.team === winner ? 12 : 0;
  }
  room.phase='finished'; room.deadline=null; room.updatedAt=now; room.finishReason=reason;
  const sorted=[...room.members].sort((a,b)=>Number(a.forfeited)-Number(b.forfeited)||b.score-a.score||a.id.localeCompare(b.id));
  room.results=sorted.map((member,index)=>({playerId:member.id,nickname:member.nickname,score:member.score,rank:member.forfeited?sorted.length:1+sorted.filter(other=>!other.forfeited&&other.score>member.score).length,reward:0,forfeited:member.forfeited}));
}
export function advanceRoom(room: InternalRoom, now: number) {
  if (room.deadline === null || room.deadline > now) return;
  if (room.phase === 'playing') { resolveRound(room,now); return; }
  if (room.phase !== 'reveal') return;
  const definition=gameDefinition(room.kind);
  if (room.round >= definition.rounds || room.kind==='cipher-race' && room.members.every(member=>member.forfeited||member.solved)) { finishRoom(room,now); return; }
  room.round++; room.phase='playing'; room.deadline=now+GAME_RULES.roundMs; room.updatedAt=now;
  for(const member of room.members) member.choice=null;
  seedBotChoices(room);
}
