import * as THREE from 'three';
import type { JumpHitKind } from '../shared/jump-game';
import type { JumpFeedbackEvent } from './jump-feedback';

const POOL_SIZE=4,SPARK_COUNT=8,DUST_COUNT=4;
const DURATION={hit:660,land:340,jump:300,trap:420} as const;
type Options={now?:()=>number;reducedMotion?:()=>boolean};
/** One burst shape per trap, so a hit reads by its motion as well as its colour:
 * `aim` throws the sparks along the knock-back, `rise` lifts them, `spin` whirls
 * them round the climber, `smoke` turns the dust into a dark rising puff. */
type HitStyle={color:number;dust:number;ring:number;spread:number;rise:number;aim:number;spin:number;smoke:number;size:number};
const HIT_STYLE:Record<JumpHitKind,HitStyle>={
  spikes:{color:0xff8fa3,dust:0xfff4da,ring:1.45,spread:.75,rise:.75,aim:0,spin:0,smoke:0,size:1},
  sweep:{color:0xffd572,dust:0xfff4da,ring:1.45,spread:.95,rise:.4,aim:.35,spin:2.6,smoke:0,size:1},
  pusher:{color:0xffb06a,dust:0xfff4da,ring:1.3,spread:.7,rise:.3,aim:1,spin:0,smoke:0,size:1.05},
  hammer:{color:0xfff0a0,dust:0xfff4da,ring:2.2,spread:.6,rise:1.05,aim:0,spin:5,smoke:0,size:1.35},
  laser:{color:0xff6f9c,dust:0xffd0dc,ring:1.1,spread:.55,rise:.55,aim:.2,spin:-7,smoke:0,size:.75},
  saw:{color:0xfff3b0,dust:0xfff4da,ring:1.2,spread:1.25,rise:.3,aim:.9,spin:0,smoke:0,size:.8},
  cannon:{color:0xffa24c,dust:0x59616b,ring:2,spread:.9,rise:.6,aim:.5,spin:0,smoke:1,size:1.15},
  flame:{color:0xff9a3c,dust:0x6b5a50,ring:1.25,spread:.45,rise:1.35,aim:0,spin:1.2,smoke:1,size:.9},
};

/** A fixed pool: a hit never allocates meshes or textures in the movement loop. */
export function createJumpEffects(parent:THREE.Object3D,options:Options={}){
  const clock=options.now??(()=>performance.now());
  const media=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
  const reducedMotion=options.reducedMotion??(()=>media?.matches??false);
  const root=new THREE.Group();root.name='jump-feedback-effects';parent.add(root);
  const ringGeometry=new THREE.RingGeometry(.65,.75,28);
  const starShape=new THREE.Shape();
  for(let i=0;i<10;i++){
    const angle=i*Math.PI/5+Math.PI/2,radius=i%2?.43:1,x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
    if(i===0)starShape.moveTo(x,y);else starShape.lineTo(x,y);
  }
  starShape.closePath();
  const starGeometry=new THREE.ShapeGeometry(starShape),dustGeometry=new THREE.SphereGeometry(1,6,4);
  const material=(color:number)=>new THREE.MeshBasicMaterial({color,transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
  const slots=Array.from({length:POOL_SIZE},()=>{
    const group=new THREE.Group();group.visible=false;root.add(group);
    const ringMat=material(0xffe7a9),sparkMat=material(0xffd572),dustMat=material(0xfff4da);
    const ring=new THREE.Mesh(ringGeometry,ringMat);ring.rotation.x=-Math.PI/2;group.add(ring);
    const sparks=Array.from({length:SPARK_COUNT},()=>{const mesh=new THREE.Mesh(starGeometry,sparkMat);group.add(mesh);return mesh;});
    const dust=Array.from({length:DUST_COUNT},()=>{const mesh=new THREE.Mesh(dustGeometry,dustMat);group.add(mesh);return mesh;});
    return{group,ring,ringMat,sparkMat,dustMat,sparks,dust,start:0,event:null as JumpFeedbackEvent|null,reduced:false,aimX:0,aimZ:0};
  });
  const seen=new Set<string>();let disposed=false;
  function clear(){for(const slot of slots){slot.event=null;slot.group.visible=false;}}
  function play(event:JumpFeedbackEvent){
    if(disposed||seen.has(event.id)||![event.x,event.y,event.z,event.intensity].every(Number.isFinite))return;
    // Traps animate on their own pads; only the restart on the ground pad gets a ring here.
    if(event.kind==='trap'&&event.trap!=='fall')return;
    seen.add(event.id);if(seen.size>64)seen.delete(seen.values().next().value!);
    const slot=slots.find(entry=>!entry.event)??slots.reduce((oldest,entry)=>entry.start<oldest.start?entry:oldest);
    slot.event={...event,intensity:THREE.MathUtils.clamp(event.intensity,0,1)};slot.start=clock();slot.reduced=reducedMotion();
    slot.group.position.set(event.x,event.y+.07,event.z);slot.group.visible=true;
    const style=event.kind==='hit'?HIT_STYLE[event.hitKind]:null;
    const color=style?style.color:event.kind==='jump'?(event.spring?0xffe27a:event.doubleJump?0xa1f1eb:0xfff4da):event.kind==='trap'?0xbfe9ff:0xfff4da;
    slot.ringMat.color.setHex(color);slot.sparkMat.color.setHex(color);slot.dustMat.color.setHex(style?style.dust:0xfff4da);
    slot.aimX=0;slot.aimZ=0;
    if(event.kind==='hit'){const speed=Math.hypot(event.vx,event.vz);if(Number.isFinite(speed)&&speed>.01){slot.aimX=event.vx/speed;slot.aimZ=event.vz/speed;}}
    // Initialize immediately, including when the first render follows a long pause.
    update(slot.start);
  }
  function update(time=clock(),camera?:THREE.Camera){
    if(disposed)return;
    const reduced=reducedMotion();
    for(const slot of slots){
      const event=slot.event;if(!event)continue;
      slot.reduced ||= reduced;
      const age=Math.max(0,time-slot.start),duration=slot.reduced?180:DURATION[event.kind];
      if(age>=duration){slot.event=null;slot.group.visible=false;continue;}
      const progress=age/duration,eased=1-Math.pow(1-progress,2),strength=event.intensity;
      const style=event.kind==='hit'?HIT_STYLE[event.hitKind]:null,spring=event.kind==='jump'&&event.spring===true;
      slot.ring.scale.setScalar(slot.reduced?.65:style?.38+eased*style.ring:event.kind==='land'?.35+eased*(.45+strength*.4):event.kind==='trap'?.5+eased*1.6:spring?.3+eased*1.1:.24+eased*.4);
      slot.ringMat.opacity=(slot.reduced?.45:style||spring||event.kind==='trap'?.85:.4)*(1-progress);
      slot.sparkMat.opacity=.95*(1-progress*progress);
      slot.dustMat.opacity=(style?(style.smoke?.5:.35):.28)*(1-progress);
      for(let i=0;i<slot.sparks.length;i++){
        const spark=slot.sparks[i];spark.visible=!!style&&!slot.reduced;if(!spark.visible||!style)continue;
        const angle=i*Math.PI*2/SPARK_COUNT+.23+progress*style.spin,radius=(.3+eased*(.75+(i%3)*.2))*style.spread;
        // Aimed bursts fold the ring of sparks forward into a fan along the knock-back.
        const aim=style.aim*eased*(1.1+(i%4)*.25);
        spark.position.set(Math.cos(angle)*radius*(1-style.aim*.45)+slot.aimX*aim,.48+Math.sin(progress*Math.PI)*(.4+(i%2)*.25)*style.rise+(style.smoke?progress*.5:0),Math.sin(angle)*radius*(1-style.aim*.45)+slot.aimZ*aim);
        spark.scale.setScalar((.17+(i%3)*.035)*(1-progress*.55)*style.size);
        if(camera)spark.quaternion.copy(camera.quaternion);else spark.quaternion.identity();
        spark.rotateZ(angle+progress*(i%2?3:-3));
      }
      for(let i=0;i<slot.dust.length;i++){
        const dust=slot.dust[i];dust.visible=!slot.reduced;if(!dust.visible)continue;
        const angle=i*Math.PI*2/DUST_COUNT+.6,radius=.2+eased*(style?.65:spring?.7:.4);
        dust.position.set(Math.cos(angle)*radius,.03+Math.sin(progress*Math.PI)*.12+(style?.smoke?eased*1.1:0),Math.sin(angle)*radius);
        dust.scale.setScalar((.07+eased*.1)*(event.kind==='land'?.65+strength:style?.smoke?2.2:1));
      }
    }
  }
  return{play,update,clear,get activeCount(){return slots.filter(slot=>slot.event).length;},
    dispose(){if(disposed)return;clear();disposed=true;seen.clear();root.removeFromParent();ringGeometry.dispose();starGeometry.dispose();dustGeometry.dispose();for(const slot of slots){slot.ringMat.dispose();slot.sparkMat.dispose();slot.dustMat.dispose();}}
  };
}
