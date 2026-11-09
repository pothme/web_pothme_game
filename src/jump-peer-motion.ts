export type JumpMotionSample = { x:number; y:number; z:number; vx:number; vy:number; vz:number; grounded:boolean; floor:number; updatedAt:number };
export type JumpMotionTrack = { previous:JumpMotionSample; current:JumpMotionSample };

/** Position packets are sparse; draw slightly behind authority rather than
 * repeatedly easing toward an already stale target. A bounded extrapolation
 * covers normal jitter without walking absent players through the course. */
export function updateJumpMotion(track:JumpMotionTrack|undefined,next:JumpMotionSample):JumpMotionTrack {
  if(!track)return {previous:{...next},current:{...next}};
  if(next.updatedAt<track.current.updatedAt)return track;
  const teleported=Math.hypot(next.x-track.current.x,next.y-track.current.y,next.z-track.current.z)>8||Math.abs(next.floor-track.current.floor)>=10;
  if(teleported)return {previous:{...next},current:{...next}};
  return {previous:next.updatedAt===track.current.updatedAt?track.previous:track.current,current:{...next}};
}
export function sampleJumpMotion(track:JumpMotionTrack,now:number):JumpMotionSample {
  const {previous:a,current:b}=track,renderAt=now-120,duration=b.updatedAt-a.updatedAt;
  if(duration>0&&renderAt<b.updatedAt){
    const fraction=Math.max(0,Math.min(1,(renderAt-a.updatedAt)/duration));
    return {...b,x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction,z:a.z+(b.z-a.z)*fraction};
  }
  const seconds=Math.max(0,Math.min(.1,(renderAt-b.updatedAt)/1000));
  return {...b,x:b.x+b.vx*seconds,y:b.y+(b.grounded?0:b.vy*seconds),z:b.z+b.vz*seconds};
}
export function isJumpPeerNearby(peer:Pick<JumpMotionSample,'floor'|'y'>,self:Pick<JumpMotionSample,'floor'|'y'>):boolean {
  return Math.abs(peer.floor-self.floor)<=6&&Math.abs(peer.y-self.y)<11;
}
