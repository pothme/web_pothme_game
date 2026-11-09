import * as THREE from 'three';
import { sculptLoft } from './avatar-sculpt';

type Point = [number, number, number];
type Finish = 'cloth' | 'polished';
/** Geometry is written into the avatar's existing joint/material batches. */
export interface WardrobePainter {
  add(owner: THREE.Group, geometry: THREE.BufferGeometry, color: number, position: Point, scale?: Point, rotation?: Point, finish?: Finish): void;
  oval(owner: THREE.Group, color: number, position: Point, size: Point, rotation?: Point, finish?: Finish, detail?: number): void;
  rounded(owner: THREE.Group, color: number, position: Point, size: Point, radius?: number, rotation?: Point, finish?: Finish): void;
  panel(owner: THREE.Group, color: number, points: number[][], z: number, finish?: Finish): void;
  stroke(owner: THREE.Group, color: number, points: Point[], radius?: number, finish?: Finish): void;
  features: string[];
}

export const WARDROBE_COLORS: Record<string, number> = {
  'tank-white':0xfffcf0,'hoodie-peach':0xe7aa96,'varsity-mint':0x83b7a3,'sailor-navy':0x405b7e,'raincoat-yellow':0xeec760,'hanbok-sky':0xa6cbd9,'overalls-denim':0x6b94b3,'explorer-khaki':0x9caa79,'chef-white':0xf3ead8,'space-silver':0xb9c8d6,'pajama-lavender':0xc1afd7,
  'shorts-navy':0x64718b,'denim-shorts':0x718fae,'cargo-shorts':0x9ca77d,'pleated-skirt':0xc294b1,'sailor-shorts':0x405b7e,'hanbok-pants':0xd9d2bc,'joggers-mint':0x9fc6b2,'adventure-pants':0x9a8873,'chef-check':0xe6dfd0,'space-pants':0xb5c4d0,'pajama-shorts':0xc4b1d4,
  'slippers-ivory':0xece2cb,'canvas-red':0xd88d85,'high-top-purple':0xa692c6,'rainboots-yellow':0xeac264,'maryjane-black':0x434554,'hiking-tan':0xab8a68,'clogs-mint':0x99bba8,'spaceboots-silver':0xb9c9d1,'bunny-slippers':0xeccbd2,'skate-blue':0x819fbc,'sandals-sand':0xc6aa80,
};
const tops = new Set(['tank-white','hoodie-peach','varsity-mint','sailor-navy','raincoat-yellow','hanbok-sky','overalls-denim','explorer-khaki','chef-white','space-silver','pajama-lavender']);
const bottoms = new Set(['shorts-navy','denim-shorts','cargo-shorts','pleated-skirt','sailor-shorts','hanbok-pants','joggers-mint','adventure-pants','chef-check','space-pants','pajama-shorts']);
const footwear = new Set(['slippers-ivory','canvas-red','high-top-purple','rainboots-yellow','maryjane-black','hiking-tan','clogs-mint','spaceboots-silver','bunny-slippers','skate-blue','sandals-sand']);
const cream=0xfff6e7, ink=0x465364, gold=0xdcc179;
const dark=(color:number, amount=.84)=>new THREE.Color(color).multiplyScalar(amount).getHex();
const light=(color:number, amount=.2)=>new THREE.Color(color).lerp(new THREE.Color(cream),amount).getHex();
function disk(p:WardrobePainter,owner:THREE.Group,color:number,position:Point,radius:number,depth=.012,rotation:Point=[Math.PI/2,0,0],segments=16){p.add(owner,new THREE.CylinderGeometry(radius,radius,depth,segments),color,position,[1,1,1],rotation);}
function ring(p:WardrobePainter,owner:THREE.Group,color:number,position:Point,radius:number,tube=.009,scale:Point=[1,1,1],rotation:Point=[0,0,0]){p.add(owner,new THREE.TorusGeometry(radius,tube,5,20),color,position,scale,rotation);}
function polygon(p:WardrobePainter,owner:THREE.Group,color:number,points:Point[],depth=.01){const shape=new THREE.Shape();shape.moveTo(points[0][0],points[0][1]);points.slice(1).forEach(v=>shape.lineTo(v[0],v[1]));shape.closePath();p.add(owner,new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,steps:1}),color,[0,0,points[0][2]]);}
function star(p:WardrobePainter,owner:THREE.Group,color:number,position:Point,size:number,points=5){const shape=new THREE.Shape();for(let i=0;i<points*2;i++){const a=Math.PI/2+i*Math.PI/points,r=i%2?size*.44:size;const x=Math.cos(a)*r,y=Math.sin(a)*r;if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);}shape.closePath();p.add(owner,new THREE.ExtrudeGeometry(shape,{depth:.009,bevelEnabled:false,steps:1}),color,position);}
function button(p:WardrobePainter,owner:THREE.Group,x:number,y:number,z:number,color=gold){disk(p,owner,color,[x,y,z],.013,.009);}

/** A visibly different silhouette, neckline or tailoring for every new top. */
export function renderWardrobeTop(p:WardrobePainter,id:string,body:THREE.Group,skin:number):boolean {
  if(!tops.has(id))return false;
  const color=WARDROBE_COLORS[id], tank=id==='tank-white', coat=id==='raincoat-yellow', collar=id==='sailor-navy';
  const base=id==='overalls-denim'?cream:color;
  p.add(body,sculptLoft([[coat?-.11:-.055,0,0],[coat?-.105:-.05,.235,.165],[.02,.277,.188],[.18,.277,.192],[.32,.263,.178],[.42,tank?.208:.25,.15],[.478,tank?.158:.17,.108],[.481,0,0]],20),base,[0,0,0]);
  if(tank){
    // Exposed round neckline and bare shoulders make this an undershirt, not a white tee.
    p.oval(body,skin,[0,.452,.108],[.111,.085,.044]);
    p.stroke(body,0xe2ded1,[[-.119,.478,.125],[-.106,.414,.158],[0,.379,.178],[.106,.414,.158],[.119,.478,.125]],.012);
    for(const side of [-1,1])p.stroke(body,0xe2ded1,[[side*.202,.428,.13],[side*.204,.318,.178],[side*.259,.283,.12]],.011);
  }else if(id==='hoodie-peach'){
    p.oval(body,dark(color),[0,.445,-.105],[.2,.135,.12]);
    ring(p,body,light(color),[0,.447,.024],.135,.025,[1,.78,1],[Math.PI/2,0,0]);
    p.rounded(body,light(color,.13),[0,.11,.196],[.285,.13,.025],.03);
    for(const side of [-1,1])p.stroke(body,cream,[[side*.053,.416,.169],[side*.066,.30,.205]],.008);
  }else if(id==='varsity-mint'){
    p.stroke(body,cream,[[0,.45,.17],[0,.025,.205]],.013);
    for(const y of [.1,.22,.34])button(p,body,.035,y,.215);
    p.rounded(body,cream,[-.135,.32,.2],[.09,.11,.018],.017);
    p.stroke(body,color,[[-.155,.275,.216],[-.155,.355,.216],[-.109,.351,.216],[-.109,.318,.216],[-.15,.318,.216]],.009);
    for(const y of [-.015,.005])p.stroke(body,dark(color),[[-.22,y,.168],[0,y,.2],[.22,y,.168]],.008);
  }else if(collar){
    p.panel(body,cream,[[-.2,.437],[-.095,.238],[0,.3],[.095,.238],[.2,.437]],.195);
    for(const side of [-1,1])p.stroke(body,color,[[side*.165,.419,.214],[side*.089,.283,.214],[0,.327,.214]],.008);
    p.panel(body,0xd88d85,[[-.035,.326],[.035,.326],[.027,.2],[0,.17],[-.027,.2]],.219);
    for(const y of [.02,.06])p.stroke(body,cream,[[-.23,y,.16],[0,y,.207],[.23,y,.16]],.012);
  }else if(coat){
    p.oval(body,dark(color),[0,.441,-.11],[.211,.15,.13]);
    p.stroke(body,cream,[[0,.44,.17],[0,-.08,.209]],.011);
    for(const side of [-1,1])p.rounded(body,dark(color),[side*.159,.1,.182],[.13,.105,.03],.02,[0,0,-side*.08]);
    for(const y of [.32,.19,.04])button(p,body,.035,y,.216,0x9f8548);
  }else if(id==='hanbok-sky'){
    p.panel(body,cream,[[-.15,.46],[-.085,.47],[.1,.255],[.06,.211]],.209);
    p.panel(body,light(color),[[.16,.46],[.10,.47],[-.083,.26],[-.045,.207]],.214);
    p.stroke(body,0xdcaab8,[[-.23,.08,.16],[0,.08,.213],[.23,.08,.16]],.024);
    for(const side of [-1,1])p.oval(body,0xdcaab8,[.105+side*.045,.225,.225],[.054,.022,.018],[0,0,side*.4]);
    p.panel(body,0xdcaab8,[[.095,.23],[.12,.225],[.145,.086],[.103,.092]],.221);
  }else if(id==='overalls-denim'){
    p.rounded(body,color,[0,.16,.195],[.4,.30,.038],.035);
    for(const side of [-1,1]){p.stroke(body,color,[[side*.15,.46,.15],[side*.14,.24,.217]],.026);button(p,body,side*.14,.258,.248);}
    p.rounded(body,dark(color),[0,.17,.222],[.17,.1,.022],.015);
    p.stroke(body,0xd6c298,[[-.075,.194,.237],[-.075,.13,.237],[.075,.13,.237],[.075,.194,.237]],.0035);
  }else if(id==='explorer-khaki'){
    p.panel(body,cream,[[-.1,.47],[.1,.47],[.07,.34],[0,.3],[-.07,.34]],.204);
    for(const side of [-1,1]){
      p.rounded(body,dark(color),[side*.148,.27,.184],[.13,.13,.04],.015);
      p.rounded(body,light(color),[side*.148,.32,.21],[.14,.04,.017],.01);button(p,body,side*.148,.306,.224);
    }
    p.stroke(body,0x7f6a52,[[0,.45,.21],[0,.02,.21]],.011);
    p.stroke(body,0x7f6a52,[[-.235,.045,.16],[0,.045,.213],[.235,.045,.16]],.017);
  }else if(id==='chef-white'){
    p.panel(body,0xe4dccb,[[-.09,.45],[.11,.43],[.12,.025],[-.11,.025]],.203);
    for(const side of [-1,1])for(const y of [.11,.22,.33])button(p,body,side*.075,y,.222,ink);
    p.panel(body,0xc78c85,[[-.075,.45],[0,.392],[.075,.45],[.025,.335],[-.024,.335]],.217);
  }else if(id==='space-silver'){
    p.rounded(body,ink,[0,.265,.195],[.26,.18,.045],.026);
    p.rounded(body,0x88bbb7,[-.035,.29,.222],[.105,.059,.014],.009);
    for(const side of [-1,1])disk(p,body,side<0?0xe5af7f:0x9bc5ad,[side*.08,.219,.224],.018);
    p.stroke(body,cream,[[-.24,.06,.16],[0,.06,.219],[.24,.06,.16]],.021);
    star(p,body,0xdabb7a,[.155,.374,.187],.038);
  }else{
    p.panel(body,cream,[[-.102,.46],[0,.32],[-.043,.21],[-.17,.4]],.205);
    p.panel(body,cream,[[.102,.46],[0,.32],[.043,.21],[.17,.4]],.205);
    p.stroke(body,cream,[[0,.31,.213],[0,.015,.21]],.008);
    for(const y of [.08,.18,.28])button(p,body,.025,y,.222,0x8c7aa3);
    for(const x of [-.2,-.14,.14,.2])p.stroke(body,light(color),[[x,.11,.196],[x,.31,.176]],.007);
    p.rounded(body,light(color),[-.16,.24,.191],[.09,.095,.018],.012);
  }
  p.features.push(`wardrobe-top:${id}`);return true;
}

export function renderWardrobeArms(p:WardrobePainter,id:string,arm:THREE.Group,forearm:THREE.Group,side:number,skin:number):boolean {
  if(!tops.has(id))return false;
  const color=WARDROBE_COLORS[id],bare=id==='tank-white',short=['sailor-navy','overalls-denim','explorer-khaki'].includes(id);
  const sleeve=id==='varsity-mint'||id==='overalls-denim'?cream:color;
  p.add(arm,sculptLoft([[-.231,0,0],[-.23,.098,.103],[-.17,.101,.109],[-.08,.111,.119],[.015,.114,.111],[.071,.077,.076],[.09,0,0]],16),bare?skin:sleeve,[0,0,0]);
  p.add(forearm,sculptLoft([[-.146,0,0],[-.145,.082,.087],[-.115,.09,.094],[-.04,.097,.102],[.008,.097,.103],[.043,.094,.101],[.044,0,0]],16),bare||short?skin:sleeve,[0,0,0]);
  if(short){
    // The lower part of the upper arm is exposed below a visibly short sleeve.
    p.add(arm,sculptLoft([[-.23,0,0],[-.229,.099,.104],[-.17,.101,.109],[-.135,.105,.114],[-.134,0,0]],16),skin,[0,0,0]);
    p.add(arm,new THREE.CylinderGeometry(.114,.11,.035,16),id==='sailor-navy'?cream:dark(sleeve),[0,-.131,0],[1,1,1.06]);
  }else if(!bare){
    p.add(forearm,new THREE.CylinderGeometry(.089,.083,.042,16),id==='varsity-mint'?color:light(color),[0,-.13,0],[1,1,1.04]);
    if(id==='space-silver'){p.rounded(arm,cream,[side*.082,-.05,.075],[.055,.12,.08],.015);p.rounded(forearm,ink,[0,-.07,.105],[.115,.05,.018],.012);}
    if(id==='pajama-lavender')for(const x of [-.04,.04])p.stroke(forearm,cream,[[x,.015,.098],[x,-.105,.093]],.005);
  }
  return true;
}

export function renderWardrobeLegs(p:WardrobePainter,id:string,leg:THREE.Group,lowerLeg:THREE.Group,skin:number,side=1):boolean {
  if(!bottoms.has(id))return false;
  const color=WARDROBE_COLORS[id],short=id.includes('shorts'),skirt=id==='pleated-skirt',baggy=['hanbok-pants','joggers-mint'].includes(id);
  const bare=short||skirt,width=baggy?1.12:1;
  p.add(leg,sculptLoft([[-.287,0,0],[-.286,.116,.12],[-.19,.123,.127],[-.08,.126,.132],[.011,.107,.115],[.024,0,0]],16),bare?skin:color,[0,0,0],[width,1,1]);
  p.add(lowerLeg,sculptLoft([[-.258,0,0],[-.253,bare?.082:.102,bare?.083:.1],[-.224,bare?.086:.109,bare?.09:.108],[-.11,bare?.093:.114,bare?.096:.117],[-.016,bare?.095:.115,bare?.1:.119],[.033,bare?.095:.114,bare?.1:.117],[.034,0,0]],16),bare?skin:color,[0,0,0],[width,1,1]);
  if(short){
    const hem=id==='cargo-shorts'?-.22:id==='pajama-shorts'?-.155:-.19;
    p.add(leg,sculptLoft([[hem-.002,0,0],[hem,.132,.139],[-.07,.14,.143],[.026,.112,.12],[.029,0,0]],16),color,[0,0,0]);
    p.add(leg,new THREE.CylinderGeometry(.134,.134,.025,16),dark(color),[0,hem+.014,0],[1,1,1.06]);
    if(id==='cargo-shorts')p.rounded(leg,dark(color),[side*.107,-.115,.065],[.073,.102,.105],.015);
    if(id==='denim-shorts'){p.stroke(leg,0xd9c29a,[[side*.105,-.02,.079],[side*.087,-.077,.118],[side*.04,-.086,.137]],.004);p.rounded(leg,light(color),[0,-.12,.143],[.08,.04,.006],.008);}
    if(id==='sailor-shorts')for(const y of [-.155,-.13])p.stroke(leg,cream,[[-.105,y,.09],[0,y,.143],[.105,y,.09]],.009);
    if(id==='pajama-shorts')for(const x of [-.08,0,.08])p.stroke(leg,light(color),[[x,.01,.12],[x,-.13,.139]],.007);
  }else if(skirt){
    p.add(leg,sculptLoft([[-.302,0,0],[-.3,.171,.169],[-.16,.149,.155],[.025,.111,.13],[.027,0,0]],20),color,[0,0,0]);
    for(const x of [-.115,-.055,.005,.065,.12])p.stroke(leg,dark(color),[[x*.72,.005,.12],[x,-.276,.156]],.005);
    p.stroke(leg,cream,[[-.13,-.27,.1],[0,-.27,.174],[.13,-.27,.1]],.008);
  }else if(id==='hanbok-pants'||id==='joggers-mint'){
    p.add(lowerLeg,new THREE.CylinderGeometry(.097,.09,.065,16),dark(color),[0,-.22,0],[1.1,1,1.1]);
    if(id==='joggers-mint')p.stroke(leg,cream,[[side*.12,.005,.045],[side*.13,-.24,.05]],.009);
  }else if(id==='adventure-pants'){
    p.rounded(leg,dark(color),[side*.108,-.1,.06],[.065,.13,.106],.015);
    p.rounded(lowerLeg,0xb8aa8d,[0,-.04,.115],[.16,.12,.026],.025);
  }else if(id==='chef-check'){
    // Printed checks are flat cloth detail, not dozens of rounded solid boxes.
    for(let row=0;row<4;row++)for(let col=0;col<3;col++)if((row+col)%2===0)p.add(leg,new THREE.PlaneGeometry(.06,.06),0x65747c,[(col-1)*.062,-.025-row*.062,.143]);
    for(let row=0;row<4;row++)for(let col=0;col<3;col++)if((row+col)%2===0)p.add(lowerLeg,new THREE.PlaneGeometry(.054,.052),0x65747c,[(col-1)*.056,-.02-row*.054,.128]);
  }else if(id==='space-pants'){
    p.rounded(lowerLeg,cream,[0,-.022,.117],[.17,.11,.033],.03);
    p.stroke(leg,0x648a9b,[[side*.116,0,.05],[side*.124,-.24,.05]],.013);
    p.stroke(lowerLeg,0x648a9b,[[side*.11,-.02,.045],[side*.101,-.21,.04]],.013);
  }
  p.features.push(`wardrobe-bottom:${id}`);return true;
}

export function renderWardrobeShoes(p:WardrobePainter,id:string,shin:THREE.Group,skin:number):boolean {
  if(!footwear.has(id))return false;
  const color=WARDROBE_COLORS[id],open=['slippers-ivory','sandals-sand','maryjane-black','clogs-mint'].includes(id),boot=['rainboots-yellow','spaceboots-silver','hiking-tan','high-top-purple'].includes(id);
  p.add(shin,sculptLoft([[-.344,0,0],[-.342,.099,.139,.046],[-.33,.119,.166,.053],[-.311,.117,.162,.052],[-.308,0,0]],16),id==='hiking-tan'?0x655c50:cream,[0,0,0]);
  if(open){
    p.oval(shin,skin,[0,-.282,.045],[.097,.044,.143]);
    if(id==='slippers-ivory'){
      p.add(shin,new THREE.CylinderGeometry(.109,.112,.085,16,1,true,0,Math.PI),color,[0,-.269,.069],[1,.38,1],[Math.PI/2,0,Math.PI/2]);
      p.rounded(shin,color,[0,-.249,.059],[.205,.045,.095],.018);
    }else if(id==='sandals-sand'){
      for(const z of [.105,.02])p.rounded(shin,color,[0,-.246,z],[.199,.033,.04],.012);
      p.stroke(shin,dark(color),[[-.082,-.26,-.028],[0,-.237,-.051],[.082,-.26,-.028]],.013);
      button(p,shin,.09,-.244,.03);
    }else if(id==='maryjane-black'){
      p.oval(shin,color,[0,-.278,.108],[.108,.041,.091]);
      p.stroke(shin,color,[[-.086,-.27,-.024],[0,-.269,-.068],[.086,-.27,-.024]],.021);
      p.rounded(shin,color,[0,-.239,.035],[.19,.026,.037],.01);button(p,shin,.081,-.238,.043);
    }else{
      p.oval(shin,color,[0,-.277,.089],[.112,.061,.128]);
      for(const x of [-.054,0,.054])disk(p,shin,dark(color),[x,-.222,.105],.01,.006,[0,0,0],8);
      p.stroke(shin,dark(color),[[-.10,-.266,.02],[-.095,-.248,-.052],[.095,-.248,-.052],[.10,-.266,.02]],.012);
    }
  }else{
    p.add(shin,sculptLoft([[-.315,0,0],[-.313,.108,.151,.053],[-.29,.113,.157,.052],[-.258,.101,.13,.03],[-.232,.078,.09,0],[-.23,0,0]],16),color,[0,0,0]);
    if(boot)p.add(shin,sculptLoft([[-.28,.089,.092],[-.24,.099,.1],[-.13,id==='rainboots-yellow'?.104:.09,.091],[-.118,0,0]],16),color,[0,0,-.005]);
    if(id==='rainboots-yellow')ring(p,shin,dark(color),[0,-.137,-.005],.099,.009,[1,.92,1],[Math.PI/2,0,0]);
    else if(id==='spaceboots-silver'){
      for(const y of [-.18,-.24])p.rounded(shin,cream,[0,y,.096],[.18,.035,.026],.008);
      p.rounded(shin,0x6f9d9c,[0,-.197,.115],[.058,.04,.015],.008);
    }else if(id==='bunny-slippers'){
      p.oval(shin,light(color),[0,-.254,.129],[.085,.044,.072]);
      for(const side of [-1,1]){p.oval(shin,color,[side*.04,-.183,.111],[.025,.066,.023],[0,0,-side*.14]);disk(p,shin,ink,[side*.03,-.247,.194],.008,.004,[Math.PI/2,0,0],8);}
      p.oval(shin,0xc98d9e,[0,-.262,.201],[.009,.007,.005]);
    }else{
      for(const z of [.026,.063,.1])p.stroke(shin,cream,[[-.04,-.232,z],[.04,-.232,z]],.005);
      if(id==='canvas-red')p.oval(shin,cream,[0,-.278,.163],[.108,.034,.042]);
      if(id==='high-top-purple')star(p,shin,cream,[0,-.17,.105],.035);
      if(id==='hiking-tan'){for(const side of [-1,1])for(const y of [-.18,-.22])button(p,shin,side*.06,y,.103,0x72634f);}
      if(id==='skate-blue')for(const x of [-.053,.053])p.stroke(shin,cream,[[x,-.239,.015],[x,-.244,.114]],.01);
    }
  }
  p.features.push(`wardrobe-shoes:${id}`);return true;
}

type Accessories = {species:string;headwear?:string;eyewear?:string;neckwear?:string;backwear?:string};
/** Four simultaneous slots. Existing geometry batches keep the cost per joint fixed. */
export function renderAvatarAccessories(p:WardrobePainter,a:Accessories,head:THREE.Group,body:THREE.Group):void {
  const hat=a.headwear??'none',eyes=a.eyewear??'none',neck=a.neckwear??'none',back=a.backwear??'none';
  if(hat!=='none'){
    if(hat==='cap-mint'){
      p.add(head,new THREE.SphereGeometry(1,20,9,0,Math.PI*2,0,Math.PI*.46),0x8eb7a2,[0,.25,-.03],[.414,.24,.335]);
      p.oval(head,0x739b88,[0,.30,.27],[.26,.032,.18]);p.rounded(head,cream,[0,.402,.282],[.09,.073,.015],.02);
    }else if(hat==='beret-cream'){
      p.oval(head,0xe6d9bb,[.043,.361,-.037],[.42,.128,.32],[0,0,-.08]);p.oval(head,0xc7b995,[.065,.49,-.035],[.018,.033,.021]);
      ring(p,head,0xcabd9d,[0,.30,-.031],.31,.019,[1.22,1,1],[Math.PI/2,0,0]);
    }else if(hat==='bucket-yellow'||hat==='straw-ribbon'){
      const straw=hat==='straw-ribbon',color=straw?0xd7c097:0xe6c569;
      p.add(head,new THREE.CylinderGeometry(.265,.343,.18,20),color,[0,.35,-.035],[1,1,.89]);
      p.add(head,new THREE.CylinderGeometry(.44,.43,.028,24),color,[0,.266,-.035],[1,1,.85]);
      p.add(head,new THREE.CylinderGeometry(.344,.351,.043,20),straw?0xc48d9e:light(color),[0,.292,-.035],[1,1,.89]);
      if(straw){p.oval(head,0xc48d9e,[.32,.298,.065],[.035,.055,.06],[0,0,-.4]);p.oval(head,0xc48d9e,[.377,.281,.062],[.035,.055,.06],[0,0,.4]);}
    }else if(hat==='beanie-rose'){
      p.add(head,new THREE.SphereGeometry(1,20,10,0,Math.PI*2,0,Math.PI*.46),0xc699b1,[0,.265,-.04],[.408,.265,.335]);
      ring(p,head,0xae829b,[0,.286,-.04],.327,.033,[1.21,1,.94],[Math.PI/2,0,0]);
      p.oval(head,0xe3bbce,[0,.534,-.04],[.055,.058,.05]);
    }else if(hat==='chef-hat'){
      p.add(head,new THREE.CylinderGeometry(.23,.255,.14,20),cream,[0,.365,-.025],[1,1,.9]);
      for(const [x,y,z]of [[-.17,.47,-.025],[0,.51,.03],[.17,.47,-.025],[0,.46,-.14]])p.oval(head,cream,[x,y,z],[.17,.12,.14]);
      p.stroke(head,0xe2d7c4,[[-.21,.345,.16],[0,.345,.206],[.21,.345,.16]],.014);
    }else if(hat==='space-helmet'){
      // Open face frame: no opaque visor hides the face or downloaded textures.
      ring(p,head,cream,[0,.025,.095],.382,.035,[1.12,1.1,1]);
      for(const side of [-1,1])p.oval(head,0x9eb8c7,[side*.428,.02,.025],[.061,.105,.105]);
      p.stroke(head,0x829dac,[[-.3,.29,-.12],[0,.44,-.16],[.3,.29,-.12]],.045);
    }else if(hat==='flower-crown'){
      ring(p,head,0x8aa578,[0,.29,-.02],.35,.012,[1.1,1,.89],[Math.PI/2,0,0]);
      for(let i=0;i<7;i++){const t=i*Math.PI*2/7,x=Math.sin(t)*.37,z=Math.cos(t)*.30-.02;flower(p,head,[x,.32,z],i%2?0xe6b1b8:cream,.036);}
    }
    p.features.push(`accessory-headwear:${hat}`);
  }
  if(eyes!=='none'){
    const color=eyes==='heart-glasses'?0xc78b9b:eyes==='star-glasses'?gold:eyes==='sport-glasses'?0x72969c:eyes==='pixel-glasses'?0x444454:0x777b78;
    const z=.326;
    for(const side of [-1,1]){
      const x=side*.137;
      if(eyes==='monocle'){if(side>0)continue;ring(p,head,gold,[x,.025,z],.084,.009);p.stroke(head,gold,[[x-.07,-.02,z],[x-.11,-.17,.29],[x-.18,-.23,.15]],.004);}
      else if(eyes==='round-glasses')ring(p,head,color,[x,.025,z],.089,.009,[1,.95,1]);
      else if(eyes==='square-glasses'||eyes==='pixel-glasses'){
        const r=eyes==='pixel-glasses'?.015:.01;
        p.stroke(head,color,[[x-.089,.095,z],[x+.084,.095,z],[x+.084,-.045,z],[x-.089,-.045,z],[x-.089,.095,z]],r);
        if(eyes==='pixel-glasses')p.stroke(head,0x9e9cb9,[[x-.05,.067,z+.01],[x-.015,.026,z+.01]],.009);
      }else if(eyes==='heart-glasses'){
        p.stroke(head,color,[[x,.083,z],[x-.055,.106,z],[x-.092,.055,z],[x-.071,.005,z],[x,-.057,z],[x+.071,.005,z],[x+.092,.055,z],[x+.055,.106,z],[x,.083,z]],.009);
      }else if(eyes==='star-glasses'){
        const path:Point[]=[];for(let i=0;i<=10;i++){const t=Math.PI/2+i*Math.PI/5,r=i%2?.055:.10;path.push([x+Math.cos(t)*r,.025+Math.sin(t)*r,z]);}p.stroke(head,color,path,.009);
      }else if(eyes==='sport-glasses'){
        p.stroke(head,color,[[x-.088,.065,z],[x+.09,.065,z],[x+.075,-.025,z],[x-.074,-.025,z],[x-.088,.065,z]],.015);
        p.oval(head,0x85a7ac,[x,.022,z-.004],[.076,.043,.006],[0,0,0],'polished');
      }else if(eyes==='goggles'){
        ring(p,head,0xb3956e,[x,.025,z],.096,.019);ring(p,head,0x94b9bb,[x,.025,z+.009],.073,.006);
      }
    }
    if(eyes!=='monocle'){
      p.stroke(head,color,[[-.048,.042,z],[0,.056,z+.004],[.048,.042,z]],.008);
      for(const side of [-1,1])p.stroke(head,color,[[side*.222,.047,z-.01],[side*.327,.058,.22],[side*.38,.03,.035]],.008);
    }
    p.features.push(`accessory-eyewear:${eyes}`);
  }
  if(neck!=='none'){
    if(neck==='scarf-red'){
      ring(p,body,0xcf9290,[0,.47,.012],.129,.036,[1,.84,1],[Math.PI/2,0,0]);
      p.rounded(body,0xcf9290,[.08,.31,.227],[.085,.24,.036],.018,[0,0,-.13]);
      for(const x of [.049,.077,.103])p.stroke(body,0xe7b9a8,[[x,.212,.25],[x,.181,.25]],.004);
    }else if(neck==='bowtie-mint'){
      for(const side of [-1,1])p.oval(body,0x87b3a1,[side*.057,.423,.194],[.069,.042,.022],[0,0,-side*.3]);p.oval(body,0x6c9483,[0,.423,.213],[.022,.027,.016]);
    }else if(neck==='headphones'){
      p.stroke(body,ink,[[-.2,.45,.02],[-.23,.3,.1],[0,.235,.227],[.23,.3,.1],[.2,.45,.02]],.027);
      for(const side of [-1,1])p.rounded(body,0xa38ac4,[side*.19,.352,.12],[.09,.13,.09],.028,[0,0,side*.25]);
    }else if(neck==='pearl-necklace'){
      for(let i=0;i<11;i++){const t=Math.PI*.12+i*Math.PI*.76/10;p.oval(body,cream,[Math.cos(t)*.163,.43-Math.sin(t)*.16,.17+Math.sin(t)*.035],[.019,.02,.013],[0,0,0],'polished',8);}
    }else if(neck==='camera'){
      for(const side of [-1,1])p.stroke(body,0x8d795f,[[side*.08,.47,.07],[side*.123,.26,.224]],.01);
      p.rounded(body,ink,[0,.205,.242],[.23,.16,.09],.027);disk(p,body,0x93a9aa,[0,.205,.301],.061,.027);disk(p,body,0x4c6478,[0,.205,.321],.04,.01);
      p.rounded(body,cream,[-.075,.249,.294],[.046,.03,.01],.006);
    }else if(neck==='flower-lei'){
      for(let i=0;i<7;i++){const t=Math.PI*.12+i*Math.PI*.76/6;flower(p,body,[Math.cos(t)*.18,.43-Math.sin(t)*.18,.18+Math.sin(t)*.045],i%2?0xe9c582:0xc997ad,.027);}
    }else if(neck==='medal-star'){
      for(const side of [-1,1])p.stroke(body,0x879bb9,[[side*.09,.46,.15],[0,.25,.221]],.016);
      disk(p,body,gold,[0,.208,.235],.07,.017);star(p,body,cream,[0,.208,.251],.041);
    }
    p.features.push(`accessory-neckwear:${neck}`);
  }
  if(back!=='none'){
    const wingSpecies=a.species==='bee'||a.species==='butterfly',z=wingSpecies?-.40:-.27;
    if(back==='backpack-mint'||back==='satchel-brown'){
      const satchel=back==='satchel-brown',color=satchel?0xac8b6b:0x8eb6a3;
      p.rounded(body,color,[satchel?.13:0,.22,z],[satchel?.32:.39,.38,.16],.06,[0,0,satchel?-.1:0]);
      p.rounded(body,dark(color),[satchel?.13:0,.12,z-.091],[.27,.13,.04],.022);
      p.rounded(body,light(color),[satchel?.13:0,.31,z-.088],[.30,.10,.035],.02);
      if(satchel)p.stroke(body,color,[[-.16,.46,.08],[.16,.13,.21]],.018);
      else for(const side of [-1,1])p.stroke(body,dark(color),[[side*.16,.43,z],[side*.21,.43,.04],[side*.20,.17,.17]],.019);
    }else if(back==='angel-wings'||back==='bat-wings'){
      const angel=back==='angel-wings',color=angel?cream:0x8c799f;
      for(const side of [-1,1]){
        if(angel){for(let i=0;i<4;i++)p.oval(body,i%2?0xe7dfda:cream,[side*(.18+i*.065),.29+i*.044,z],[.09,.22-i*.018,.035],[0,0,-side*(.32+i*.18)],'cloth',10);}
        else{
          polygon(p,body,color,[[side*.12,.09,z],[side*.20,.42,z],[side*.53,.49,z],[side*.44,.24,z],[side*.36,.29,z],[side*.27,.15,z],[side*.21,.21,z]],.015);
          for(const end of [[side*.53,.49,z-.01],[side*.44,.24,z-.01],[side*.27,.15,z-.01]] as Point[])p.stroke(body,0x66566e,[[side*.15,.30,z-.01],end],.008);
        }
      }
    }else if(back==='turtle-shell'){
      p.oval(body,0x91a77d,[0,.22,z],[.27,.31,.16]);
      ring(p,body,0xd1bf8e,[0,.22,z-.024],.277,.019,[.95,1.1,1]);
      for(const side of [-1,1])p.stroke(body,0x6f845d,[[side*.08,.45,z-.10],[side*.11,.24,z-.166],[side*.07,-.02,z-.09]],.008);
      p.stroke(body,0x6f845d,[[-.24,.22,z-.08],[0,.22,z-.17],[.24,.22,z-.08]],.008);
    }else if(back==='rocket-pack'){
      for(const side of [-1,1]){
        p.add(body,new THREE.CylinderGeometry(.075,.075,.34,12),0xb7c5cc,[side*.105,.23,z]);
        p.add(body,new THREE.ConeGeometry(.075,.12,12),0xc6a58f,[side*.105,.46,z]);
        p.add(body,new THREE.CylinderGeometry(.088,.067,.07,12),ink,[side*.105,.035,z]);
      }
      p.rounded(body,0x86a8a8,[0,.23,z-.083],[.12,.14,.05],.018);
    }else if(back==='guitar'){
      p.oval(body,0xbb956f,[-.035,.14,z],[.17,.18,.06],[0,0,-.25]);p.oval(body,0xbb956f,[.01,.30,z],[.13,.12,.06]);
      p.rounded(body,0x806c58,[.08,.47,z],[.065,.36,.043],.015,[0,0,-.28]);
      disk(p,body,0x685344,[-.006,.24,z-.063],.053,.009);
      for(const x of [-.014,0,.014])p.stroke(body,cream,[[x-.034,.08,z-.065],[x+.115,.61,z-.03]],.002);
    }
    p.features.push(`accessory-backwear:${back}`);
  }
}

function flower(p:WardrobePainter,owner:THREE.Group,position:Point,color:number,radius:number){
  // Small petals need only four latitude rows, even in a seven-flower garland.
  for(let i=0;i<5;i++){const t=i*Math.PI*2/5;p.add(owner,new THREE.SphereGeometry(1,5,4),color,[position[0]+Math.cos(t)*radius*.74,position[1]+Math.sin(t)*radius*.74,position[2]],[radius*.62,radius*.52,.011],[0,0,t]);}
  p.add(owner,new THREE.SphereGeometry(1,6,4),gold,[position[0],position[1],position[2]+.012],[radius*.37,radius*.37,.008]);
}
