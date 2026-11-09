import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeAvatarAppearance, type AvatarAppearance } from '../shared/avatar-appearance';
import { sculptForelock, sculptHairCap, sculptLoft, softenAvatarShoulder } from './avatar-sculpt';
import { AVATAR_BODY_SCALE_Y, AVATAR_HEAD_CENTER_Y, AVATAR_HEAD_SCALE, AVATAR_TORSO_Y } from '../shared/avatar-rig';
import { renderAvatarAccessories, renderWardrobeArms, renderWardrobeLegs, renderWardrobeShoes, renderWardrobeTop, type WardrobePainter } from './avatar-wardrobe';

type Finish = 'cloth' | 'polished';
type Point = [number, number, number];
export const AVATAR_LABEL_Y = 2.22;

/** Every species uses the same joint positions. Detail is merged by joint and
 * finish, keeping hair locks, paws and wing patterns out of the draw-call count. */
export function createOfficeAvatar(color: number, requested?: AvatarAppearance) {
  const appearance=normalizeAvatarAppearance(requested,color);
  const group = new THREE.Group(); group.name = 'podeum-collectible-avatar';
  const upperBody = new THREE.Group(); upperBody.position.y = .64; group.add(upperBody);
  const head = new THREE.Group(); head.position.y = .76; upperBody.add(head);
  const arms: THREE.Group[] = [], forearms: THREE.Group[] = [], legs: THREE.Group[] = [], lowerLegs: THREE.Group[] = [];
  const {species,face,hair:hairStyle,top,bottom,shoes}=appearance;
  const skinColors: Record<string, number> = { porcelain:0xf6d9c3, peach:0xefc6a8, rose:0xecc2b9, tan:0xd2a079, brown:0xa47254, deep:0x714834 };
  const hairColors: Record<string, number> = { espresso:0x44302c, chestnut:0x735044, black:0x292b35, ash:0x89776b, silver:0xa2a5ae, rose:0xb16c87 };
  const topColors: Record<string, number> = { 'blazer-blue':0x91aac6, 'blazer-lilac':0xb29bc1, 'cardigan-mint':0x9ac2ad, 'knit-cream':0xe8decb, 'blazer-night':0x39485f, 'cardigan-coral':0xdba58e, 'blazer-gold':0xc7a563 };
  const bottomColors: Record<string, number> = { 'trousers-slate':0x565c70, 'trousers-plum':0x786077, 'trousers-cream':0xcabda8, 'skirt-navy':0x414f67, 'trousers-ivory':0xe5ded1 };
  const shoeColors: Record<string, number> = { 'loafers-cream':0xe8dcc7, 'loafers-navy':0x39475c, 'sneakers-white':0xeeeae0, 'sneakers-rose':0xd9a5b3 };
  const humanSkin=skinColors[appearance.skin], hair=hairColors[appearance.hairColor];
  const suit=topColors[top] ?? 0xf7f4eb, trousers=bottomColors[bottom] ?? 0x61758a, shoe=shoeColors[shoes] ?? 0xe9dfcb;
  const lapel=new THREE.Color(suit).multiplyScalar(.86).getHex();
  const hairLight=new THREE.Color(hair).lerp(new THREE.Color(0xd4b6a0),.12).getHex();
  const animal=species!=='human', insect=species==='bee'||species==='butterfly';
  const animalColors:Record<string,number>={cat:0xd8b48f,rabbit:0xe7ded7,fox:0xcd8651,bear:0x997657,bee:0xf0c459,butterfly:0xb2a0ce};
  const skin=animal?new THREE.Color(animalColors[species]).lerp(new THREE.Color(humanSkin),.22).getHex():humanSkin;
  const blush=new THREE.Color(skin).lerp(new THREE.Color(0xe78f98),.42).getHex();
  const tie=new THREE.Color(color).lerp(new THREE.Color(0x659487),.72).getHex();
  const finishes={cloth:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82}),polished:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.52,metalness:0})};
  const pieces=new Map<THREE.Group,Map<Finish,THREE.BufferGeometry[]>>(),features:string[]=[];
  const transform=new THREE.Object3D();
  function add(owner:THREE.Group,source:THREE.BufferGeometry,tint:number,position:Point,scale:Point=[1,1,1],rotation:Point=[0,0,0],finish:Finish='cloth'){
    const geometry=source.index?source.toNonIndexed():source;if(geometry!==source)source.dispose();
    transform.position.set(...position);transform.scale.set(...scale);transform.rotation.set(...rotation);transform.updateMatrix();
    geometry.applyMatrix4(transform.matrix);geometry.deleteAttribute('uv');
    // Mirrored ears are baked into a shared draw, so their triangle winding
    // must be reversed as well as their normals to remain visible from outside.
    if(transform.matrix.determinant()<0)for(const attribute of Object.values(geometry.attributes)){
      const values=attribute.array,itemSize=attribute.itemSize;
      for(let vertex=0;vertex<attribute.count;vertex+=3)for(let component=0;component<itemSize;component++){
        const a=(vertex+1)*itemSize+component,b=(vertex+2)*itemSize+component;
        [values[a],values[b]]=[values[b],values[a]];
      }
    }
    const rgb=new THREE.Color(tint),colors=new Float32Array(geometry.getAttribute('position').count*3);
    for(let i=0;i<colors.length;i+=3){colors[i]=rgb.r;colors[i+1]=rgb.g;colors[i+2]=rgb.b;}
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const batches=pieces.get(owner)??new Map<Finish,THREE.BufferGeometry[]>(),batch=batches.get(finish)??[];
    batch.push(geometry);batches.set(finish,batch);pieces.set(owner,batches);
  }
  function oval(owner:THREE.Group,tint:number,p:Point,size:Point,rotation:Point=[0,0,0],finish:Finish='cloth',detail=12){add(owner,new THREE.SphereGeometry(1,detail,detail>=16?10:7),tint,p,size,rotation,finish);}
  function rounded(owner:THREE.Group,tint:number,p:Point,size:Point,radius=.025,rotation:Point=[0,0,0],finish:Finish='cloth'){add(owner,new RoundedBoxGeometry(...size,1,radius),tint,p,[1,1,1],rotation,finish);}
  function panel(owner:THREE.Group,tint:number,points:number[][],z:number,finish:Finish='cloth'){
    const shape=new THREE.Shape();shape.moveTo(points[0][0],points[0][1]);points.slice(1).forEach(p=>shape.lineTo(p[0],p[1]));shape.closePath();
    add(owner,new THREE.ExtrudeGeometry(shape,{depth:.008,bevelEnabled:false,steps:1}),tint,[0,0,z],[1,1,1],[0,0,0],finish);
  }
  function stroke(owner:THREE.Group,tint:number,points:Point[],radius=.004,finish:Finish='cloth'){add(owner,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(4,points.length*2),radius,5,false),tint,[0,0,0],[1,1,1],[0,0,0],finish);}
  const painter:WardrobePainter={add,oval,rounded,panel,stroke,features};
  /** Broad clay-like forelocks share a cap instead of forming separate spikes. */
  function lock(points:Point[],width:number,tint=hair){
    add(head,sculptForelock(points,width,Math.min(.044,width*.32)),tint,[0,0,0]);
  }
  function softEar(side:number,kind:'point'|'round'|'long'){
    features.push(`${kind}-ear`);
    if(kind==='point'){
      const shape=new THREE.Shape();shape.moveTo(-.09,0);shape.quadraticCurveTo(-.08,.12,0,.19);shape.quadraticCurveTo(.025,.205,.055,.025);shape.quadraticCurveTo(0,-.035,-.09,0);
      add(head,new THREE.ExtrudeGeometry(shape,{depth:.065,steps:1,bevelEnabled:true,bevelSegments:1,bevelSize:.012,bevelThickness:.012,curveSegments:5}),skin,[side*.27,.25,-.07],[side*1.12,1.12,1],[0,0,-side*.12]);
      oval(head,blush,[side*.29,.343,.004],[.039,.08,.013],[0,0,-side*.17]);
    }else if(kind==='long'){
      oval(head,skin,[side*.225,.375,-.01],[.085,.20,.068],[0,0,-side*.2]);oval(head,blush,[side*.232,.395,.048],[.042,.135,.016],[0,0,-side*.2]);
    }else{oval(head,skin,[side*.315,.285,-.025],[.113,.11,.065]);oval(head,blush,[side*.319,.289,.032],[.064,.066,.018]);}
  }
  // Tailored clothes: broad readable lapels and soft knitted layers.
  const knit=top.includes('knit'),cardigan=top.includes('cardigan');
  if(!renderWardrobeTop(painter,top,upperBody,skin)){
  add(upperBody,sculptLoft([[-.055,0,0],[-.049,.22,.15],[-.015,.27,.185],[.08,.282,.199],[.22,.27,.19],[.34,.27,.177],[.41,.254,.16],[.465,.184,.119],[.485,.106,.083],[.487,0,0]]),suit,[0,0,0]);
  if(knit){
    oval(upperBody,0xf6efe0,[0,.455,.017],[.143,.052,.116]);rounded(upperBody,lapel,[0,-.01,.015],[.51,.043,.35],.018);
    for(const x of [-.08,0,.08])stroke(upperBody,lapel,[[x,.12,.199],[x,.3,.183]],.0028);features.push('knit-top');
  }else{
    panel(upperBody,0xf7efdf,[[-.103,.462],[.103,.462],[.083,.33],[0,.226],[-.083,.33]],.202);
    panel(upperBody,0xfffaf0,[[-.077,.478],[0,.442],[-.047,.389],[-.105,.438]],.216);panel(upperBody,0xf0f0e9,[[.077,.478],[0,.442],[.047,.389],[.105,.438]],.216);
    if(cardigan){
      for(const side of [-1,1])stroke(upperBody,lapel,[[side*.122,.46,.208],[side*.084,.33,.214],[0,.205,.211]],.014);
      stroke(upperBody,lapel,[[0,.205,.211],[0,.025,.208]],.012);
      for(const y of [.08,.19,.30])oval(upperBody,0xd1b684,[.079,y,.219],[.019,.019,.008]);features.push('cardigan-top');
    }else{
      const collarColor=new THREE.Color(suit).lerp(new THREE.Color(0xffffff),.09).getHex();
      panel(upperBody,collarColor,[[-.108,.466],[-.205,.395],[-.155,.325],[-.045,.177],[-.076,.358]],.222);panel(upperBody,collarColor,[[.108,.466],[.205,.395],[.155,.325],[.045,.177],[.076,.358]],.222);
      panel(upperBody,tie,[[-.026,.424],[.026,.424],[.016,.38],[.031,.309],[0,.282],[-.031,.309],[-.016,.38]],.218);
      for(const side of [-1,1])rounded(upperBody,lapel,[side*.174,.08,.164],[.112,.043,.035],.017,[0,0,side*.04]);
      oval(upperBody,0xe6c58a,[-.175,.365,.208],[.018,.018,.008]);oval(upperBody,0xe9dac5,[0,.082,.181],[.014,.014,.007]);features.push('tailored-top');
    }
  }
  }
  add(upperBody,new THREE.CylinderGeometry(.085,.096,.11,16),skin,[0,.51,0]);
  // A softly shaped face with flattened eyes, large irises and sculpted brows.
  const faceWidth=face==='oval'?.95:face==='soft'?1.045:1,faceHeight=face==='oval'?1.04:face==='soft'?.96:1;
  add(head,sculptLoft([[-.329,0,0],[-.317,.105,.09],[-.28,.223,.183],[-.215,.316,.248],[-.13,.375,.284],[-.035,.392,.302],[.065,.385,.299],[.16,.351,.274],[.245,.285,.23],[.305,.19,.16],[.337,.08,.07],[.344,0,0]],32),skin,[0,0,0],[faceWidth,faceHeight,1]);
  for(const side of [-1,1]){
    if(!animal){oval(head,skin,[side*.385,-.04,-.015],[.046,.065,.042]);oval(head,blush,[side*.407,-.04,.012],[.016,.031,.011]);}
    const eyeX=side*.137,eyeY=.025;
    // Nearly flush graphic eyes: broad warm pupil, white corners, one highlight.
    // No concentric reflective spheres that read as glass doll eyes.
    oval(head,0xfffbf0,[eyeX,eyeY,.283],[.071,.083,.013],[0,side*.13,-side*.025],'cloth',16);
    oval(head,insect?0x493d4b:0x40322c,[eyeX-side*.007,eyeY+.002,.296],[.049,.073,.009],[0,side*.12,0],'cloth',16);
    oval(head,0xfffbec,[eyeX-side*.007-.014,eyeY+.031,.305],[.011,.014,.003],[0,0,0],'cloth');
    stroke(head,hair,[[side*.093,.132,.282],[side*.137,.143,.272],[side*.177,.133,.256]],.0065);
    oval(head,blush,[side*.247,-.093,.235],[.054,.023,.008],[0,side*.48,0],'cloth',16);
  }
  if(!animal){oval(head,new THREE.Color(skin).lerp(new THREE.Color(0xdf9b84),.18).getHex(),[0,-.073,.302],[.027,.023,.025]);stroke(head,0xa5665f,[[-.043,-.151,.272],[0,-.167,.278],[.043,-.151,.272]],.006);}
  else if(insect){
    stroke(head,0x7b5662,[[-.04,-.145,.281],[0,-.163,.286],[.04,-.145,.281]],.006);
    for(const side of [-1,1]){stroke(head,0x55434c,[[side*.15,.28,.015],[side*.19,.405,.013],[side*.24,.45,.035]],.012);oval(head,species==='bee'?0x71504a:0x9279b5,[side*.24,.45,.035],[.032,.035,.031]);}features.push('antennae','compound-eye-face');
  }else{
    for(const side of [-1,1])oval(head,0xf3e6d1,[side*.068,-.135,.282],[.105,.072,.055]);oval(head,species==='rabbit'?0xa66e7d:0x59433e,[0,-.09,.338],[.03,.023,.017],[0,0,0],'cloth');
    stroke(head,0x7b5954,[[0,-.108,.342],[0,-.157,.333],[-.031,-.171,.319]],.005);stroke(head,0x7b5954,[[0,-.157,.333],[.031,-.171,.319]],.005);
    if(species==='cat'||species==='fox')for(const side of [-1,1])for(const dy of [-.025,.01])stroke(head,0x94725c,[[side*.14,-.12+dy,.294],[side*.277,-.10+dy,.225]],.003);
    for(const side of [-1,1])softEar(side,species==='rabbit'?'long':species==='bear'?'round':'point');features.push('animal-muzzle');
  }
  // Six independent hair silhouettes; animals receive styled tufts so their
  // species-defining ears and antennae remain visible.
  if(!animal){
    add(head,sculptHairCap(hairStyle==='bob'),hair,[0,0,0]);
    if(hairStyle==='bob'){
      for(const side of [-1,1]){oval(head,hair,[side*.325,-.04,-.046],[.105,.25,.23],[0,0,side*.065],'cloth',16);lock([[side*.16,.30,.17],[side*.29,.17,.239],[side*.365,-.035,.163],[side*.32,-.26,.088]],.095);}
      lock([[.07,.356,.107],[-.035,.292,.259],[-.19,.164,.281],[-.295,.112,.195]],.135);
      lock([[.09,.355,.106],[.17,.27,.259],[.27,.14,.24],[.329,.085,.169]],.115,hairLight);
      rounded(head,0xe8c584,[.32,.13,.23],[.023,.11,.024],.01,[0,0,-.6]);
    }else if(hairStyle==='curtain'){
      for(const side of [-1,1]){lock([[side*.036,.372,.06],[side*.14,.306,.23],[side*.257,.185,.278],[side*.332,.035,.15]],.13);lock([[side*.12,.337,-.058],[side*.27,.253,.077],[side*.379,.105,.015]],.105,side===-1?hairLight:hair);}
    }else if(hairStyle==='pony'||hairStyle==='bun'){
      lock([[.075,.355,.12],[-.09,.267,.277],[-.265,.11,.248]],.135);
      lock([[.09,.35,.11],[.235,.245,.261],[.35,-.015,.155]],.12);
      if(hairStyle==='pony'){oval(head,hair,[0,.105,-.348],[.133,.13,.1]);oval(head,hair,[.03,-.11,-.373],[.13,.25,.105],[.1,0,-.12],'cloth',16);oval(head,0xd8bea0,[0,.106,-.353],[.138,.026,.086]);}
      else{oval(head,hair,[0,.397,-.15],[.15,.116,.13],[0,0,0],'cloth',16);stroke(head,hairLight,[[-.12,.406,-.11],[0,.484,-.09],[.12,.41,-.1]],.006);}
    }else if(hairStyle==='crop'){
      for(let i=0;i<3;i++){const x=-.23+i*.20;lock([[x+.055,.318,.123],[x+.02,.25,.265],[x-.035,.158,.278-Math.abs(x)*.2]],.113,i===1?hairLight:hair);}
    }else{
      lock([[.15,.385,.06],[.07,.35,.20],[-.085,.282,.306],[-.19,.157,.273]],.15,hairLight);
      lock([[-.035,.35,.04],[-.18,.302,.217],[-.306,.172,.242],[-.346,.075,.137]],.125);
      lock([[.207,.317,.032],[.294,.245,.185],[.325,.112,.217],[.278,.074,.223]],.116);
    }features.push(`hair-${hairStyle}`);
  }else{
    // Compact tufts keep animal muzzles and insect antennae exposed while every
    // hair choice still changes the silhouette on every species.
    const tuftWidth=insect?.062:.078;
    oval(head,hair,[0,.303,.096],[insect?.13:.17,.06,.13],[0,0,0],'cloth',16);
    if(hairStyle==='curtain'){
      for(const side of [-1,1])lock([[side*.025,.337,.077],[side*.1,.299,.208],[side*.195,.19,.242]],tuftWidth*1.25);
    }else{
      lock([[.085,.354,.085],[.015,hairStyle==='crop'?.305:.32,.192],[-.105,hairStyle==='crop'?.23:.179,.269]],tuftWidth*1.55);
      lock([[.11,.316,.075],[.165,.274,.181],[.18,.19,.245]],tuftWidth);
      if(hairStyle==='bob')for(const side of [-1,1])lock([[side*.26,.22,.09],[side*.37,.065,.12],[side*.33,-.2,.04]],tuftWidth*1.4);
      else if(hairStyle==='pony'){oval(head,hair,[.03,-.03,-.32],[.1,.22,.085],[0,0,-.12]);oval(head,0xddbc9b,[0,.16,-.314],[.086,.02,.05]);}
      else if(hairStyle==='bun')oval(head,hair,[0,.356,-.10],[.095,.079,.084]);
    }
    features.push(`tuft-${hairStyle}`);
  }
  if(species==='cat'){stroke(upperBody,skin,[[.1,.06,-.14],[.34,.01,-.31],[.46,.16,-.4],[.39,.3,-.37]],.045);features.push('cat-tail');}
  else if(species==='fox'){oval(upperBody,skin,[.22,.12,-.245],[.15,.29,.115],[.18,0,-.5]);oval(upperBody,0xf1e3d1,[.323,.33,-.27],[.11,.13,.091],[.18,0,-.5]);features.push('fox-tail');}
  else if(species==='rabbit'||species==='bear'){oval(upperBody,skin,[0,.075,-.197],species==='rabbit'?[.085,.079,.075]:[.053,.052,.05]);features.push('round-tail');}
  else if(insect){
    oval(upperBody,species==='bee'?0xe4b346:0x8872a4,[0,.12,-.215],[.205,.245,.155]);
    if(species==='bee'){
      for(const y of [.015,.12,.22])oval(upperBody,0x695044,[0,y,-.291],[.178,.033,.075]);for(const side of [-1,1])oval(upperBody,0xd8e8ed,[side*.27,.37,-.22],[.16,.27,.023],[.08,0,-side*.58],'polished');features.push('striped-abdomen','bee-wings');
    }else{
      for(const side of [-1,1]){
        oval(upperBody,0x7f669a,[side*.29,.345,-.205],[.235,.27,.036],[0,0,-side*.42]);oval(upperBody,0xc9abdd,[side*.306,.363,-.244],[.177,.206,.012],[0,0,-side*.42]);
        oval(upperBody,0x7f669a,[side*.223,.059,-.211],[.177,.18,.029],[0,0,side*.34]);oval(upperBody,0xe0bad6,[side*.236,.048,-.244],[.129,.129,.012],[0,0,side*.34]);
        for(const y of [.19,.38,.48])oval(upperBody,0xf2e5cd,[side*(y===.19?.32:.42),y,-.251],[.019,.027,.008]);
      }features.push('patterned-butterfly-wings');
    }
  }
  const skirt=bottom==='skirt-navy',wide=bottom==='trousers-plum'||bottom==='trousers-ivory',sneakers=shoes.includes('sneaker');
  // The skirt is split per thigh so sitting and walking retain the shared rig.
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.285,.35,0);upperBody.add(arm);arm.rotation.z=side*.12;arms.push(arm);
    const forearm=new THREE.Group();forearm.position.y=-.19;arm.add(forearm);forearms.push(forearm);
    // Sleeves share the same elbow profile. After batching, the shoulder rolls
    // gently inward/down while the wave/carry/seat pivots remain unchanged.
    if(!renderWardrobeArms(painter,top,arm,forearm,side,skin)){
    add(arm,sculptLoft([[-.231,0,0],[-.23,.098,.103],[-.17,.101,.109],[-.08,.111,.119],[.015,.114,.111],[.071,.077,.076],[.09,0,0]],16),suit,[0,0,0]);
    add(forearm,sculptLoft([[-.146,0,0],[-.145,.082,.087],[-.115,.09,.094],[-.04,.097,.102],[.008,.097,.103],[.043,.094,.101],[.044,0,0]],16),suit,[0,0,0]);
    add(forearm,new THREE.CylinderGeometry(.084,.08,.03,16),knit||cardigan?lapel:0xf4eee3,[0,-.141,0]);
    }
    oval(forearm,skin,[0,-.198,.005],[.077,.077,.059]);oval(forearm,skin,[side*-.056,-.177,.029],[.025,.04,.029],[0,0,side*-.25]);
    const leg=new THREE.Group();leg.position.set(side*.12,.62,0);group.add(leg);legs.push(leg);
    const lowerLeg=new THREE.Group();lowerLeg.position.y=-.25;leg.add(lowerLeg);lowerLegs.push(lowerLeg);
    const legWidth=wide?1.12:1;
    if(!renderWardrobeLegs(painter,bottom,leg,lowerLeg,skin,side)){
    add(leg,sculptLoft([[-.287,0,0],[-.286,skirt?.16:.116,skirt?.161:.12],[-.19,skirt?.15:.123,skirt?.15:.127],[-.08,skirt?.135:.126,.132],[.011,.107,.115],[.024,0,0]],16),trousers,[0,0,0],[legWidth,1,1]);
    add(lowerLeg,sculptLoft([[-.258,0,0],[-.253,skirt?.077:.102,skirt?.077:.1],[-.224,skirt?.08:.109,skirt?.083:.108],[-.11,skirt?.087:.114,skirt?.09:.117],[-.016,skirt?.088:.115,skirt?.092:.119],[.033,skirt?.08:.114,skirt?.084:.117],[.034,0,0]],16),skirt?skin:trousers,[0,0,0],[legWidth,1,1]);
    if(!skirt){
      stroke(lowerLeg,new THREE.Color(trousers).multiplyScalar(.92).getHex(),[[0,-.036,.122],[0,-.222,.11]],.0026);
      add(lowerLeg,sculptLoft([[-.247,.102,.102],[-.228,.112,.111],[-.215,.109,.109]],16),new THREE.Color(trousers).multiplyScalar(.91).getHex(),[0,0,0],[legWidth,1,1]);
    }
    }
    if(!renderWardrobeShoes(painter,shoes,lowerLeg,skin)){
    add(lowerLeg,new THREE.CylinderGeometry(.084,.083,.031,16),0xf1e5d3,[0,-.251,0]);
    // Soft broad loafers have an actual toe box, inset welt and a curved sole.
    add(lowerLeg,sculptLoft([[-.344,0,0],[-.341,.091,.129,.043],[-.332,.113,.161,.055],[-.308,.115,.162,.055],[-.302,.098,.14,.051],[-.30,0,0]],20),sneakers?0xf8f3e8:0xbca98e,[0,0,0]);
    add(lowerLeg,sculptLoft([[-.315,0,0],[-.31,.109,.155,.055],[-.29,.114,.156,.052],[-.265,.109,.14,.041],[-.242,.091,.11,.019],[-.232,.071,.082,.002],[-.23,0,0]],20),shoe,[0,0,0]);
    if(sneakers){rounded(lowerLeg,0xf4efe3,[0,-.242,.046],[.122,.022,.097],.01);for(const z of [.016,.05,.084])stroke(lowerLeg,0xffffff,[[-.039,-.229,z],[.039,-.229,z]],.0045);}
    else{rounded(lowerLeg,new THREE.Color(shoe).multiplyScalar(.88).getHex(),[0,-.243,.051],[.16,.022,.048],.011);stroke(lowerLeg,new THREE.Color(shoe).multiplyScalar(.9).getHex(),[[-.079,-.269,.087],[-.06,-.272,.155],[0,-.274,.185],[.06,-.272,.155],[.079,-.269,.087]],.003);}
    }
  }
  renderAvatarAccessories(painter,appearance,head,upperBody);
  const heartEffect=new THREE.Group();heartEffect.position.set(0,.44,.34);heartEffect.visible=false;upperBody.add(heartEffect);
  const heartShape=new THREE.Shape();heartShape.moveTo(0,-.09);
  heartShape.bezierCurveTo(-.02,-.06,-.112,-.015,-.112,.047);
  heartShape.bezierCurveTo(-.112,.115,-.035,.138,0,.079);
  heartShape.bezierCurveTo(.035,.138,.112,.115,.112,.047);
  heartShape.bezierCurveTo(.112,-.015,.02,-.06,0,-.09);
  add(heartEffect,new THREE.ExtrudeGeometry(heartShape,{depth:.022,bevelEnabled:true,bevelSegments:1,bevelSize:.008,bevelThickness:.008,curveSegments:5}),0xe8a0b1,[0,0,0],[1,1,1],[0,0,0],'polished');
  // Compress the actual joint lengths as well as the skin; a short body must
  // not retain long invisible elbows/knees when walking or carrying a cup.
  // Bake proportions into geometry because the gesture layer animates scales.
  upperBody.position.y *= AVATAR_BODY_SCALE_Y;
  for (const joint of [...arms,...forearms,...legs,...lowerLegs]) joint.position.y *= AVATAR_BODY_SCALE_Y;
  head.position.y = AVATAR_HEAD_CENTER_Y - AVATAR_TORSO_Y;
  heartEffect.position.y *= AVATAR_BODY_SCALE_Y;
  const geometries:THREE.BufferGeometry[]=[];
  for(const [owner,batches]of pieces)for(const [finish,parts]of batches){const geometry=mergeGeometries(parts,false)!;parts.forEach(part=>part.dispose());geometry.computeBoundingSphere();geometries.push(geometry);const mesh=new THREE.Mesh(geometry,finishes[finish]);mesh.castShadow=true;mesh.receiveShadow=false;owner.add(mesh);}
  for(const [owner] of pieces) owner.children.forEach(child=>{
    if(!(child instanceof THREE.Mesh))return;
    const shoulderIndex=arms.indexOf(owner);
    if(shoulderIndex!==-1)softenAvatarShoulder(child.geometry,shoulderIndex===0?-1:1);
    else if(forearms.includes(owner))child.geometry.scale(.86,1,.90);
    child.geometry.scale(owner===head?AVATAR_HEAD_SCALE:1,owner===head?AVATAR_HEAD_SCALE:AVATAR_BODY_SCALE_Y,owner===head?AVATAR_HEAD_SCALE:1);
    child.geometry.computeBoundingSphere();
  });
  group.userData.species=species;group.userData.features=features;
  let disposed=false;
  return {group,upperBody,head,arms,forearms,legs,lowerLegs,heartEffect,labelY:AVATAR_LABEL_Y,dispose(){if(disposed)return;disposed=true;geometries.forEach(geometry=>geometry.dispose());Object.values(finishes).forEach(material=>material.dispose());}};
}

export type OfficeAvatar = ReturnType<typeof createOfficeAvatar>;

/** Replace only the rendered body. The scene root and its external attachments
 * (nameplate, held tray, selection ring) keep their identity and world position. */
export function replaceOfficeAvatarAppearance(current: OfficeAvatar, color: number, appearance: AvatarAppearance): OfficeAvatar {
  const next=createOfficeAvatar(color,appearance);
  const oldJoints=[current.upperBody,current.head,...current.arms,...current.forearms,...current.legs,...current.lowerLegs];
  const newJoints=[next.upperBody,next.head,...next.arms,...next.forearms,...next.legs,...next.lowerLegs];
  for(let index=0;index<oldJoints.length;index++){
    newJoints[index].position.copy(oldJoints[index].position);
    newJoints[index].quaternion.copy(oldJoints[index].quaternion);
    newJoints[index].scale.copy(oldJoints[index].scale);
  }
  next.heartEffect.visible=current.heartEffect.visible;
  next.heartEffect.position.copy(current.heartEffect.position);
  next.heartEffect.scale.copy(current.heartEffect.scale);
  const root=current.group;
  root.remove(current.upperBody,...current.legs);
  root.add(next.upperBody,...next.legs);
  root.userData.species=next.group.userData.species;
  root.userData.features=next.group.userData.features;
  next.group=root;
  current.dispose();
  return next;
}
