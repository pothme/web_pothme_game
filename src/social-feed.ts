interface FeedEvent {
  id: string;
  playerId: string;
  sentAt: number;
  expiresAt: number;
  channel?: 'action';
}

/** Actions share head bubbles with chat but never enter the conversation history. */
export function createSocialFeedGuard() {
  const seen = new Set<string>();
  const latestBubble = new Map<string, number>();
  return {
    accept(event: FeedEvent, now: number, history = false): { bubble: boolean; log: boolean } | null {
      if (!event.id || !event.playerId || !Number.isFinite(event.sentAt) || !Number.isFinite(event.expiresAt)) return null;
      const key = `${event.channel ?? 'chat'}:${event.id}`;
      if (seen.has(key)) return null;
      seen.add(key);
      while (seen.size > 128) seen.delete(seen.values().next().value!);
      const bubble = !history && event.expiresAt > now && event.sentAt <= now + 1000 && event.sentAt >= (latestBubble.get(event.playerId) ?? -Infinity);
      if (bubble) {
        latestBubble.delete(event.playerId); latestBubble.set(event.playerId, event.sentAt);
        while (latestBubble.size > 128) latestBubble.delete(latestBubble.keys().next().value!);
      }
      return { bubble, log: event.channel !== 'action' };
    },
    clear() { seen.clear(); latestBubble.clear(); },
  };
}
