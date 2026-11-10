import { ACESFilmicToneMapping, DirectionalLight, HemisphereLight, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { createOfficeAvatar, type OfficeAvatar } from './office-avatar';
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, type AppearanceKey, type AvatarAppearance } from '../shared/avatar-appearance';
import { avatarThumbnailFrame } from '../shared/avatar-thumbnail-framing';

/** Loaded only after a visible item requests an uncached image. All named
 * imports are statically analysable, retaining Three's normal tree shaking. */
export function createAvatarThumbnailRenderer(size=160){
  const canvas=document.createElement('canvas');
  const renderer=new WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
  renderer.setPixelRatio(1);renderer.setSize(size,size,false);
  renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  renderer.setClearColor(0xf7f5ed,1);
  const scene=new Scene();
  scene.add(new HemisphereLight(0xfffaf1,0x929b8b,1.3));
  const key=new DirectionalLight(0xfff4e4,2.3);key.position.set(-3,5,5);scene.add(key);
  const fill=new DirectionalLight(0xc8def4,1);fill.position.set(3,3,-4);scene.add(fill);
  const camera=new OrthographicCamera(-1,1,1,-1,.05,20);
  // The figure of the previous card stays alive (off the scene) until the next
  // one has been drawn. All figures share one shader program, and disposing the
  // only material that uses it would make every card compile it again.
  let disposed=false,kept:OfficeAvatar|undefined;
  return{
    render(slot:string,value:string){
      if(disposed||renderer.getContext().isContextLost())throw new Error('Thumbnail renderer unavailable');
      const options=APPEARANCE_OPTIONS[slot as AppearanceKey];
      if(!options||!options.some(option=>option.id===value)){
        const error=new Error('Unknown appearance choice');error.name='UnknownAppearanceChoice';throw error;
      }
      const appearance={...DEFAULT_APPEARANCE,[slot]:value} as AvatarAppearance;
      const model=createOfficeAvatar(0x7a9bb4,appearance),view=avatarThumbnailFrame(slot,value);
      // Only this disposable model is cropped. Office/large previews have
      // independent joints and resources, so their visibility is unaffected.
      // Garment, neck and back cards are a bust without the head: a frame that
      // cuts through the big head leaves a chin and half a smile above the item.
      if(['top','bottom','shoes','neckwear','backwear'].includes(slot))model.head.visible=false;
      if(['top','neckwear','backwear'].includes(slot))model.legs.forEach(leg=>leg.visible=false);
      // Trousers and skirts keep the waist they hang from (the pelvis is part
      // of the torso); only the arms that would hang into the frame are hidden.
      if(slot==='bottom')model.arms.forEach(arm=>arm.visible=false);
      // A shoe card shows shins and shoes; the thigh would bring the hem of the shorts into the top edge.
      if(slot==='shoes'){model.upperBody.visible=false;model.legs.forEach(leg=>leg.children.forEach(part=>{if((part as {isMesh?:boolean}).isMesh)part.visible=false;}));}
      model.group.rotation.y=view.yaw;scene.add(model.group);
      camera.left=camera.bottom=-view.halfSize;camera.right=camera.top=view.halfSize;
      camera.position.set(...view.camera);camera.lookAt(...view.target);camera.updateProjectionMatrix();
      try{renderer.render(scene,camera);return canvas.toDataURL('image/png');}
      finally{scene.remove(model.group);kept?.dispose();kept=model;}
    },
    dispose(){if(disposed)return;disposed=true;kept?.dispose();kept=undefined;renderer.dispose();renderer.forceContextLoss();canvas.width=canvas.height=1;},
  };
}
