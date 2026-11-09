import { isWalkable, isWalkableSegment } from '../shared/classroom-layout';
import { SHOULDER_LINK_RULES, type ShoulderLinkView, type ShoulderCheerView } from '../shared/shoulder-links';

export interface ShoulderPlayer { id: string; x: number; z: number; seat: number | null; shoulder?: ShoulderLinkView | null; nextShoulderCheerAt?: number }
export interface ShoulderChange { id: string; shoulder: ShoulderLinkView; x?: number; z?: number }

function groupCheerState(members: readonly ShoulderPlayer[], now: number): Pick<ShoulderLinkView, 'cheer' | 'cheerNextAt'> {
  const cheerNextAt = Math.max(0, ...members.map(member => Math.max(member.nextShoulderCheerAt ?? 0, member.shoulder?.cheerNextAt ?? 0)));
  const cheer = members.length < 2 ? undefined : members.map(member => member.shoulder?.cheer)
    .filter((value): value is ShoulderCheerView => !!value && value.startedAt <= now && value.expiresAt > now)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  return { ...(cheer ? { cheer } : {}), ...(cheerNextAt > 0 ? { cheerNextAt } : {}) };
}

/** Re-index live contiguous chains. A departing middle member splits the chain;
 * nobody is teleported across their empty spot. Socket attachments persist it. */
export function repairShoulderLinks(players: readonly ShoulderPlayer[], now = Date.now()): ShoulderChange[] {
  const groups = new Map<string, ShoulderPlayer[]>(), changes: ShoulderChange[] = [];
  for (const player of players) if (player.shoulder) {
    const members = groups.get(player.shoulder.groupId) ?? [];
    members.push(player); groups.set(player.shoulder.groupId, members);
  }
  for (const members of groups.values()) {
    members.sort((a, b) => a.shoulder!.index - b.shoulder!.index);
    const chains: ShoulderPlayer[][] = [];
    for (const member of members) {
      const chain = chains.at(-1), previous = chain?.at(-1);
      if (previous && member.shoulder!.index === previous.shoulder!.index + 1
        && Math.abs(member.x - previous.x - SHOULDER_LINK_RULES.spacing) < 0.02 && Math.abs(member.z - previous.z) < 0.02) chain!.push(member);
      else chains.push([member]);
    }
    chains.forEach((chain, part) => {
      const groupId = part === 0 ? chain[0]!.shoulder!.groupId : crypto.randomUUID();
      const cheerState = groupCheerState(chain, now);
      chain.forEach((member, index) => {
        const { cheer: _cheer, cheerNextAt: _cheerNextAt, ...previous } = member.shoulder!;
        const shoulder = { ...previous, groupId, index, count: chain.length, ...cheerState };
        if (JSON.stringify(shoulder) !== JSON.stringify(member.shoulder)) changes.push({ id: member.id, shoulder });
      });
    });
  }
  return changes;
}

/** Only the consenting newcomer moves, by at most joinRadius, onto a clear
 * endpoint. Unselected bystanders never get pulled into a pose or moved. */
export function joinShoulderLinks(players: readonly ShoulderPlayer[], actor: ShoulderPlayer, now: number): ShoulderChange[] {
  const groups = new Map<string, ShoulderPlayer[]>();
  for (const player of players) if (player.id !== actor.id && player.shoulder && player.seat === null) {
    const members = groups.get(player.shoulder.groupId) ?? [];
    members.push(player); groups.set(player.shoulder.groupId, members);
  }
  const candidates: { members: ShoulderPlayer[]; x: number; z: number; left: boolean; distance: number }[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.shoulder!.index - b.shoulder!.index);
    for (const left of [true, false]) {
      const end = left ? members[0]! : members.at(-1)!;
      const x = end.x + (left ? -1 : 1) * SHOULDER_LINK_RULES.spacing, z = end.z;
      const distance = Math.hypot(actor.x - x, actor.z - z);
      if (distance > SHOULDER_LINK_RULES.joinRadius || !isWalkable(x, z) || !isWalkableSegment(actor.x, actor.z, x, z) || !isWalkableSegment(end.x, end.z, x, z)) continue;
      if (players.some(other => other.id !== actor.id && Math.hypot(other.x - x, other.z - z) < 0.62)) continue;
      candidates.push({ members, x, z, left, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.members[0]!.id.localeCompare(b.members[0]!.id));
  const best = candidates[0];
  if (!best) return [{ id: actor.id, shoulder: { groupId: crypto.randomUUID(), index: 0, count: 1, facing: 0, since: now } }];
  const group = best.members[0]!.shoulder!, ordered = best.left ? [actor, ...best.members] : [...best.members, actor];
  const cheerState = groupCheerState(best.members, now), cheerNextAt = Math.max(cheerState.cheerNextAt ?? 0, actor.nextShoulderCheerAt ?? 0);
  return ordered.map((member, index) => ({ id: member.id, shoulder: { groupId: group.groupId, index, count: ordered.length, facing: 0, since: group.since, ...cheerState, ...(cheerNextAt > 0 ? { cheerNextAt } : {}) }, ...(member.id === actor.id ? { x: best.x, z: best.z } : {}) }));
}
