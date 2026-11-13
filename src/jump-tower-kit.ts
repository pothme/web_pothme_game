import * as THREE from 'three';

/** Rotations are applied roll (z), then tilt (x), then yaw (y).
 * Merges many coloured primitives into one indexed geometry (position, normal,
 * colour), so a whole pad, trap part or backdrop costs a single draw call with
 * one shared vertex-colour material. Templates are created once per page. */
const templates=new Map<string,THREE.BufferGeometry>();
function template(key:string,make:()=>THREE.BufferGeometry){let value=templates.get(key);if(!value){value=make();templates.set(key,value);}return value;}
const matrix=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),euler=new THREE.Euler(0,0,0,'YXZ'),point=new THREE.Vector3(),tint=new THREE.Color(),low=new THREE.Color();

export class Kit {
  private positions:number[]=[];private normals:number[]=[];private colors:number[]=[];private indices:number[]=[];private count=0;
  /** Each primitive darkens toward its own underside: a cheap, baked contact shade. */
  shade=.2;
  get empty(){return this.count===0;}
  add(geometry:THREE.BufferGeometry,color:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,rx=0,ry=0,rz=0){
    matrix.compose(position.set(x,y,z),quaternion.setFromEuler(euler.set(rx,ry,rz)),scale.set(sx,sy,sz));normalMatrix.getNormalMatrix(matrix);
    tint.setHex(color);low.copy(tint).multiplyScalar(1-this.shade);
    geometry.boundingBox??geometry.computeBoundingBox();
    const box=geometry.boundingBox!,bottom=box.min.y,span=Math.max(1e-6,box.max.y-box.min.y);
    const source=geometry.getAttribute('position'),sourceNormal=geometry.getAttribute('normal'),index=geometry.getIndex(),base=this.count;
    for(let i=0;i<source.count;i++){
      point.fromBufferAttribute(source,i);const t=(point.y-bottom)/span;
      point.applyMatrix4(matrix);this.positions.push(point.x,point.y,point.z);
      point.fromBufferAttribute(sourceNormal,i).applyMatrix3(normalMatrix).normalize();this.normals.push(point.x,point.y,point.z);
      this.colors.push(low.r+(tint.r-low.r)*t,low.g+(tint.g-low.g)*t,low.b+(tint.b-low.b)*t);
    }
    if(index)for(let i=0;i<index.count;i++)this.indices.push(base+index.getX(i));else for(let i=0;i<source.count;i++)this.indices.push(base+i);
    this.count+=source.count;return this;
  }
  box(color:number,x:number,y:number,z:number,w:number,h:number,d:number,ry=0,rx=0,rz=0){return this.add(template('box',()=>new THREE.BoxGeometry(1,1,1)),color,x,y,z,w,h,d,rx,ry,rz);}
  /** Upright cylinder or cone frustum centred on (x,y,z). */
  cyl(color:number,x:number,y:number,z:number,top:number,bottom:number,height:number,segments=10,rx=0,ry=0,rz=0){
    const radius=Math.max(top,bottom,1e-4),ratio=Math.round(top/radius*20)/20,other=Math.round(bottom/radius*20)/20;
    return this.add(template(`cyl:${ratio}:${other}:${segments}`,()=>new THREE.CylinderGeometry(ratio,other,1,segments)),color,x,y,z,radius,height,radius,rx,ry,rz);
  }
  /** Open-ended cylinder wall: a pipe, a crater rim, the inside of a shaft. */
  tube(color:number,x:number,y:number,z:number,top:number,bottom:number,height:number,segments=24,ry=0){
    const radius=Math.max(top,bottom,1e-4),ratio=Math.round(top/radius*40)/40,other=Math.round(bottom/radius*40)/40;
    return this.add(template(`tube:${ratio}:${other}:${segments}`,()=>new THREE.CylinderGeometry(ratio,other,1,segments,1,true)),color,x,y,z,radius,height,radius,0,ry,0);
  }
  ball(color:number,x:number,y:number,z:number,sx:number,sy=sx,sz=sx,detail=8){return this.add(template(`ball:${detail}`,()=>new THREE.SphereGeometry(1,detail,Math.max(4,detail-2))),color,x,y,z,sx,sy,sz);}
  /** Flat ring lying in the xz plane. */
  ring(color:number,x:number,y:number,z:number,inner:number,outer:number,segments=24){
    const ratio=Math.round(inner/outer*40)/40;
    return this.add(template(`ring:${ratio}:${segments}`,()=>new THREE.RingGeometry(ratio,1,segments).rotateX(-Math.PI/2)),color,x,y,z,outer,1,outer);
  }
  torus(color:number,x:number,y:number,z:number,radius:number,tube:number,rx=0,ry=0,rz=0,segments=20){
    const ratio=Math.max(.002,Math.round(tube/radius*500)/500);
    return this.add(template(`torus:${ratio}:${segments}`,()=>new THREE.TorusGeometry(1,ratio,6,segments).rotateX(-Math.PI/2)),color,x,y,z,radius,radius,radius,rx,ry,rz);
  }
  /** Flat arrow head lying on the surface, pointing along +x before `ry`. */
  chevron(color:number,x:number,y:number,z:number,size:number,ry=0,thickness=.02){
    return this.add(template('chevron',()=>{
      const shape=new THREE.Shape();shape.moveTo(.5,0);shape.lineTo(-.1,.5);shape.lineTo(-.5,.5);shape.lineTo(.1,0);shape.lineTo(-.5,-.5);shape.lineTo(-.1,-.5);shape.closePath();
      return new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,-.5,0);
    }),color,x,y,z,size,thickness,size,0,ry,0);
  }
  build(){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(this.positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(this.normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(this.colors,3));
    geometry.setIndex(this.indices);geometry.computeBoundingSphere();
    this.positions=[];this.normals=[];this.colors=[];this.indices=[];this.count=0;return geometry;
  }
}
/** Shared primitive templates stay alive for the page: later scenes reuse them. */
export function disposeKitTemplates(){templates.forEach(value=>value.dispose());templates.clear();}
