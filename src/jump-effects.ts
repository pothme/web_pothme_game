import * as THREE from 'three';
import type { JumpFeedbackEvent } from './jump-feedback';

const POOL_SIZE=4,SPARK_COUNT=8,DUST_COUNT=4;
const DURATION={hit:660,land:340,jump:300} as const;
type Options={now?:()=>number;reducedMotion?:()=>boolean};

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
    return{group,ring,ringMat,sparkMat,dustMat,sparks,dust,start:0,event:null as JumpFeedbackEvent|null,reduced:false};
  });
  const seen=new Set<string>();let disposed=false;
  function clear(){for(const slot of slots){slot.event=null;slot.group.visible=false;}}
  function play(event:JumpFeedbackEvent){
    if(disposed||seen.has(event.id)||![event.x,event.y,event.z,event.intensity].every(Number.isFinite))return;
    seen.add(event.id);if(seen.size>64)seen.delete(seen.values().next().value!);
    const slot=slots.find(entry=>!entry.event)??slots.reduce((oldest,entry)=>entry.start<oldest.start?entry:oldest);
    slot.event={...event,intensity:THREE.MathUtils.clamp(event.intensity,0,1)};slot.start=clock();slot.reduced=reducedMotion();
    slot.group.position.set(event.x,event.y+.07,event.z);slot.group.visible=true;
    const color=event.kind==='hit'?0xffd572:event.kind==='jump'&&event.doubleJump?0xa1f1eb:0xfff4da;
    slot.ringMat.color.setHex(color);slot.sparkMat.color.setHex(color);
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
      slot.ring.scale.setScalar(slot.reduced?.65:event.kind==='hit'?.38+eased*1.45:event.kind==='land'?.35+eased*(.45+strength*.4):.24+eased*.4);
      slot.ringMat.opacity=(slot.reduced?.45:event.kind==='hit'?.85:.4)*(1-progress);
      slot.sparkMat.opacity=.95*(1-progress*progress);
      slot.dustMat.opacity=(event.kind==='hit'?.35:.28)*(1-progress);
      for(let i=0;i<slot.sparks.length;i++){
        const spark=slot.sparks[i];spark.visible=event.kind==='hit'&&!slot.reduced;if(!spark.visible)continue;
        const angle=i*Math.PI*2/SPARK_COUNT+.23,radius=.3+eased*(.75+(i%3)*.2);
        spark.position.set(Math.cos(angle)*radius,.48+Math.sin(progress*Math.PI)*(.4+(i%2)*.25),Math.sin(angle)*radius);
        spark.scale.setScalar((.12+(i%3)*.025)*(1-progress*.55));
        if(camera)spark.quaternion.copy(camera.quaternion);else spark.quaternion.identity();
        spark.rotateZ(angle+progress*(i%2?3:-3));
      }
      for(let i=0;i<slot.dust.length;i++){
        const dust=slot.dust[i];dust.visible=!slot.reduced;if(!dust.visible)continue;
        const angle=i*Math.PI*2/DUST_COUNT+.6,radius=.2+eased*(event.kind==='hit'?.65:.4);
        dust.position.set(Math.cos(angle)*radius,.03+Math.sin(progress*Math.PI)*.12,Math.sin(angle)*radius);
        dust.scale.setScalar((.07+eased*.1)*(event.kind==='land'?.65+strength:1));
      }
    }
  }
  return{play,update,clear,get activeCount(){return slots.filter(slot=>slot.event).length;},
    dispose(){if(disposed)return;clear();disposed=true;seen.clear();root.removeFromParent();ringGeometry.dispose();starGeometry.dispose();dustGeometry.dispose();for(const slot of slots){slot.ringMat.dispose();slot.sparkMat.dispose();slot.dustMat.dispose();}}
  };
}
