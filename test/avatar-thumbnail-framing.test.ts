import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, OrthographicCamera, Vector3 } from 'three';
import { createOfficeAvatar } from '../src/office-avatar';
import { DEFAULT_APPEARANCE, type AvatarAppearance } from '../shared/avatar-appearance';
import { CLOTHING_ADDITIONS, ACCESSORY_ADDITIONS } from '../shared/avatar-wardrobe';
import { avatarThumbnailFrame } from '../shared/avatar-thumbnail-framing';

test('slot views show the actual sixty items without clipping their clothing or accessory region',()=>{
  const point=new Vector3();
  for(const item of [...CLOTHING_ADDITIONS,...ACCESSORY_ADDITIONS]){
    const slot=item.slot,view=avatarThumbnailFrame(slot),model=createOfficeAvatar(0x7a9bb4,{...DEFAULT_APPEARANCE,[slot]:item.id} as AvatarAppearance);
    try{
      model.group.rotation.y=view.yaw;model.group.updateMatrixWorld(true);
      const camera=new OrthographicCamera(-view.halfSize,view.halfSize,view.halfSize,-view.halfSize,.05,20);
      camera.position.set(...view.camera);camera.lookAt(...view.target);camera.updateMatrixWorld(true);
      const roots=slot==='headwear'||slot==='eyewear'?[model.head]:slot==='bottom'||slot==='shoes'?model.legs:[model.upperBody];
      let selected=0,largest=0;
      for(const root of roots)root.traverse(object=>{
        if(!(object instanceof Mesh))return;
        // The item's region intentionally excludes the head in garment cards.
        let parent=object.parent;
        while(parent&&parent!==root){if(parent===model.head||parent===model.heartEffect||slot==='neckwear'&&model.arms.some(arm=>arm===parent))return;parent=parent.parent;}
        if(object.parent===model.heartEffect)return;
        const vertices=object.geometry.getAttribute('position');
        for(let index=0;index<vertices.count;index++){
          point.fromBufferAttribute(vertices,index).applyMatrix4(object.matrixWorld);
          // Footwear and neckwear are close crops rather than whole-body images.
          if(slot==='shoes'&&point.y>.24||slot==='neckwear'&&point.y<.61)continue;
          point.project(camera);selected++;largest=Math.max(largest,Math.abs(point.x),Math.abs(point.y));
        }
      });
      assert.ok(selected>0,`${item.id}: the target region contains real geometry`);
      assert.ok(largest<=1.025,`${item.id}: region projects outside the image (${largest.toFixed(3)})`);
      if(slot==='backwear')assert.ok(view.camera[2]<view.target[2],'back accessories use the rear face of the avatar');
      else assert.ok(view.camera[2]>view.target[2],'front garments use the front face of the avatar');
    }finally{model.dispose();}
  }
});
