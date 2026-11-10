import { JUMP_RULES, type JumpPlatformView, type JumpState } from '../shared/jump-game';

export interface JumpCameraPoint {x:number;y:number;z:number}
type CameraState=Pick<JumpState,'x'|'y'|'z'|'grounded'|'standingFloor'|'floor'>;
type CameraPlatform=Pick<JumpPlatformView,'x'|'y'|'z'|'width'|'depth'>&{cameraHeight?:number};
export const JUMP_CAMERA_PITCH=.8;

/** A fall onto a lower step changes the route, not the saved best score. Keep
 * the chosen landing steady while airborne instead of chasing an overhead step. */
export function nextJumpCameraFloor(state:CameraState,previousTarget?:number){
  return Math.max(1,Math.min(JUMP_RULES.floors,state.grounded&&state.standingFloor!==null?state.standingFloor+1:previousTarget??state.floor+1));
}
export function jumpCameraFocus(state:CameraState,next:JumpCameraPoint):JumpCameraPoint {
  return{x:state.x*.58+next.x*.42,y:(state.y+1.25)*.58+(next.y+.12)*.42,z:state.z*.58+next.z*.42};
}
/** Looking direction for the next stretch of the route. The path turns,
 * crosses the centre and doubles back, so the view blends the leap to the next
 * pad with the one after it. Where the route reverses (the shaft's zigzag) the
 * camera looks across it from the side it is already on: that view stays valid
 * pad after pad instead of flipping half a turn on every landing. A portrait
 * screen is narrow, so there the view stays straight behind the leap: looking
 * ahead at an angle would cost far more distance than it gains. */
export function jumpCameraHeading(state:Pick<CameraState,'x'|'z'>,next:JumpCameraPoint,after:JumpCameraPoint|null,currentYaw:number,aspect=1.6):number {
  let ax=next.x-state.x,az=next.z-state.z;const first=Math.hypot(ax,az);
  // Straight up or down (a lift, a spring): no horizontal direction to prefer.
  if(first<.6)return currentYaw;
  ax/=first;az/=first;let hx=ax,hz=az;
  if(after){
    let bx=after.x-next.x,bz=after.z-next.z;const second=Math.hypot(bx,bz);
    if(second>.6){
      bx/=second;bz/=second;
      // A side view of a long leap does not fit a portrait screen; the short zigzag hops do.
      if(ax*bx+az*bz<-.8&&(aspect>=.8||first<3.3)){
        const left=Math.atan2(az,-ax),right=Math.atan2(-az,ax),turn=(yaw:number)=>Math.abs(Math.atan2(Math.sin(yaw-currentYaw),Math.cos(yaw-currentYaw)));
        return turn(left)<=turn(right)?left:right;
      }
      const ahead=aspect<.8?0:aspect<1.2?.25:.5;hx+=bx*ahead;hz+=bz*ahead;
    }
  }
  return Math.atan2(-hx,-hz);
}
/** Eases the view toward a heading. Small differences are ignored, so the
 * camera does not fidget, and the turn rate is capped, so it never whips round. */
export function turnJumpCamera(yaw:number,desired:number,dt:number,turning:boolean):{yaw:number;turning:boolean} {
  const delta=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw)),size=Math.abs(delta);
  if(!turning&&size<.4)return{yaw,turning:false};
  if(size<.02)return{yaw:desired,turning:false};
  const step=Math.min(size,Math.min(2.1,.35+size*2.4)*Math.max(0,dt));
  return{yaw:yaw+Math.sign(delta)*step,turning:true};
}
export function jumpCameraAnchors(state:CameraState,next:CameraPlatform,after?:CameraPlatform|null){
  const avatar:JumpCameraPoint[]=[{x:state.x,y:state.y+.1,z:state.z},{x:state.x,y:state.y+1.15,z:state.z},{x:state.x,y:state.y+2.65,z:state.z}];
  for(const x of [-.48,.48])for(const z of [-.48,.48])avatar.push({x:state.x+x,y:state.y+1.5,z:state.z+z});
  const landing:JumpCameraPoint[]=[{x:next.x,y:next.y+.1,z:next.z}];
  // A landing a long leap away is framed by its middle: fitting every far
  // corner would pull the camera so far back that the climber becomes a dot.
  const reach=Math.hypot(next.x-state.x,next.z-state.z),part=Math.max(.45,Math.min(1,5.5/Math.max(.1,reach)));
  for(const x of [-1,1])for(const z of [-1,1])landing.push({x:next.x+x*next.width*.5*part,y:next.y+.1,z:next.z+z*next.depth*.5*part});
  // The sign and raised machinery are part of the destination too. Surface
  // corners alone let a pusher's red wall disappear behind the mobile HUD.
  landing.push({x:next.x,y:next.y+.7,z:next.z-next.depth*.3});
  if(next.cameraHeight)for(const x of [-1,1])for(const z of [-1,1])landing.push({x:next.x+x*next.width*.5*part,y:next.y+next.cameraHeight,z:next.z+z*next.depth*.5*part});
  // The pad after the next one: its middle and a cross half-way to its edges.
  const beyond:JumpCameraPoint[]=[];
  if(after){beyond.push({x:after.x,y:after.y+.1,z:after.z});for(const [x,z] of [[-1,0],[1,0],[0,-1],[0,1]] as const)beyond.push({x:after.x+x*after.width*.3,y:after.y+.1,z:after.z+z*after.depth*.3});}
  return{avatar,landing,beyond};
}
/** Fit both bodies into the usable viewport. Portrait phones need a wider
 * camera distance when looking sideways, rather than clipping the next step. */
export function fitJumpCamera(state:CameraState,next:CameraPlatform,yaw:number,pitch:number,aspect:number,minimumDistance=8.5,height=844,focus=jumpCameraFocus(state,next),after?:CameraPlatform|null){
  const sin=Math.sin(yaw),cos=Math.cos(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const direction={x:sin*cp,y:sp,z:cos*cp},right={x:cos,y:0,z:-sin},up={x:-sin*sp,y:cp,z:-cos*sp};
  const tanVertical=Math.tan(51*Math.PI/360),tanHorizontal=tanVertical*Math.max(.25,aspect);
  const top=Math.max(.22,Math.min(.72,1-2*(height<540?128:aspect<.8?(next.cameraHeight?240:220):178)/height)),bottom=Math.max(.22,Math.min(.72,1-2*(height<540?120:aspect<.8?190:160)/height));
  const anchors=jumpCameraAnchors(state,next,after);
  const needed=(points:readonly JumpCameraPoint[],from:number)=>{
    let distance=from;
    for(const point of points){
      const x=point.x-focus.x,y=point.y-focus.y,z=point.z-focus.z;
      const along=x*direction.x+y*direction.y+z*direction.z,horizontal=x*right.x+z*right.z,vertical=x*up.x+y*up.y+z*up.z;
      distance=Math.max(distance,along+Math.abs(horizontal)/(tanHorizontal*.82),along+Math.abs(vertical)/(tanVertical*(vertical>=0?top:bottom)));
    }
    return distance;
  };
  let distance=needed(anchors.landing,needed(anchors.avatar,minimumDistance));
  // The pad after the next is worth a modest step back, never a long one.
  if(anchors.beyond.length)distance=Math.min(needed(anchors.beyond,distance),Math.max(distance,Math.min(distance*1.3+1,15)));
  distance+=.25;
  return{focus,distance,position:{x:focus.x+direction.x*distance,y:focus.y+direction.y*distance,z:focus.z+direction.z*distance},limits:{horizontal:.82,top,bottom}};
}

/** Several body / landing samples replace a single ray to the feet. The
 * bounds include raised trap parts, so their decorations fade with the slab. */
export function jumpPlatformOccludes(platform:Pick<JumpPlatformView,'x'|'y'|'z'|'width'|'depth'>,camera:JumpCameraPoint,samples:readonly JumpCameraPoint[],height=.72){
  const minimum=[platform.x-platform.width*.5-.12,platform.y-.45,platform.z-platform.depth*.5-.12],maximum=[platform.x+platform.width*.5+.12,platform.y+height,platform.z+platform.depth*.5+.12],origin=[camera.x,camera.y,camera.z];
  return samples.some(point=>{
    const end=[point.x,point.y,point.z];let near=0,far=.985;
    for(let axis=0;axis<3;axis++){
      const direction=end[axis]-origin[axis];
      if(Math.abs(direction)<1e-8){if(origin[axis]<minimum[axis]||origin[axis]>maximum[axis])return false;continue;}
      const a=(minimum[axis]-origin[axis])/direction,b=(maximum[axis]-origin[axis])/direction;
      near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far)return false;
    }
    return near<=far;
  });
}
