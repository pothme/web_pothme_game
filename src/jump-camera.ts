import type { JumpPlatformView, JumpState } from '../shared/jump-game';

export interface JumpCameraPoint {x:number;y:number;z:number}
type CameraState=Pick<JumpState,'x'|'y'|'z'|'grounded'|'standingFloor'|'floor'>;
type CameraPlatform=Pick<JumpPlatformView,'x'|'y'|'z'|'width'|'depth'>&{cameraHeight?:number};
export const JUMP_CAMERA_PITCH=.8;

/** A fall onto a lower step changes the route, not the saved best score. Keep
 * the chosen landing steady while airborne instead of chasing an overhead step. */
export function nextJumpCameraFloor(state:CameraState,previousTarget?:number){
  return Math.max(1,Math.min(60,state.grounded&&state.standingFloor!==null?state.standingFloor+1:previousTarget??state.floor+1));
}
export function jumpCameraFocus(state:CameraState,next:JumpCameraPoint):JumpCameraPoint {
  return{x:state.x*.58+next.x*.42,y:(state.y+1.25)*.58+(next.y+.12)*.42,z:state.z*.58+next.z*.42};
}
export function jumpCameraAnchors(state:CameraState,next:CameraPlatform){
  const avatar:JumpCameraPoint[]=[{x:state.x,y:state.y+.1,z:state.z},{x:state.x,y:state.y+1.15,z:state.z},{x:state.x,y:state.y+2.65,z:state.z}];
  for(const x of [-.48,.48])for(const z of [-.48,.48])avatar.push({x:state.x+x,y:state.y+1.5,z:state.z+z});
  const landing:JumpCameraPoint[]=[{x:next.x,y:next.y+.1,z:next.z}];
  for(const x of [-1,1])for(const z of [-1,1])landing.push({x:next.x+x*next.width*.5,y:next.y+.1,z:next.z+z*next.depth*.5});
  // The sign and raised machinery are part of the destination too. Surface
  // corners alone let a pusher's red wall disappear behind the mobile HUD.
  landing.push({x:next.x,y:next.y+.7,z:next.z-next.depth*.3});
  if(next.cameraHeight)for(const x of [-1,1])for(const z of [-1,1])landing.push({x:next.x+x*next.width*.5,y:next.y+next.cameraHeight,z:next.z+z*next.depth*.5});
  return{avatar,landing};
}
/** Fit both bodies into the usable viewport. Portrait phones need a wider
 * camera distance when looking sideways, rather than clipping the next step. */
export function fitJumpCamera(state:CameraState,next:CameraPlatform,yaw:number,pitch:number,aspect:number,minimumDistance=8.5,height=844,focus=jumpCameraFocus(state,next)){
  const sin=Math.sin(yaw),cos=Math.cos(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const direction={x:sin*cp,y:sp,z:cos*cp},right={x:cos,y:0,z:-sin},up={x:-sin*sp,y:cp,z:-cos*sp};
  const tanVertical=Math.tan(51*Math.PI/360),tanHorizontal=tanVertical*Math.max(.25,aspect);
  const top=Math.max(.22,Math.min(.72,1-2*(height<540?128:aspect<.8?(next.cameraHeight?240:220):178)/height)),bottom=Math.max(.22,Math.min(.72,1-2*(height<540?120:aspect<.8?190:160)/height));
  const anchors=jumpCameraAnchors(state,next);let distance=minimumDistance;
  for(const point of [...anchors.avatar,...anchors.landing]){
    const x=point.x-focus.x,y=point.y-focus.y,z=point.z-focus.z;
    const along=x*direction.x+y*direction.y+z*direction.z,horizontal=x*right.x+z*right.z,vertical=x*up.x+y*up.y+z*up.z;
    distance=Math.max(distance,along+Math.abs(horizontal)/(tanHorizontal*.82),along+Math.abs(vertical)/(tanVertical*(vertical>=0?top:bottom)));
  }
  distance+=.25;
  return{focus,distance,position:{x:focus.x+direction.x*distance,y:focus.y+direction.y*distance,z:focus.z+direction.z*distance},limits:{horizontal:.82,top,bottom}};
}

/** Several body / landing samples replace a single ray to the feet. The
 * bounds include raised trap parts, so their decorations fade with the slab. */
export function jumpPlatformOccludes(platform:Pick<JumpPlatformView,'x'|'y'|'z'|'width'|'depth'>,camera:JumpCameraPoint,samples:readonly JumpCameraPoint[]){
  const minimum=[platform.x-platform.width*.5-.12,platform.y-.45,platform.z-platform.depth*.5-.12],maximum=[platform.x+platform.width*.5+.12,platform.y+.72,platform.z+platform.depth*.5+.12],origin=[camera.x,camera.y,camera.z];
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
