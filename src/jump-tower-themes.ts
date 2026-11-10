import * as THREE from 'three';
import { JUMP_COURSE, JUMP_RULES, JUMP_ZONES } from '../shared/jump-game';
import { Kit } from './jump-tower-kit';

/** Ten zone looks. Trap colours never change with the zone, so a red part
 * always means the same thing; only the ground, the air and the scenery do. */
export interface JumpTheme {
  id:string;
  /** Pad top, pad side, edge trim, small accent and dark detail. */
  top:number;side:number;rim:number;accent:number;dark:number;
  skyTop:number;skyBottom:number;fog:number;cloud:number;
  hemiSky:number;hemiGround:number;sun:number;light:number;
  /** Drifting specks around the climber: colour, velocity (units/s), sway and size. */
  mote:{color:number;vx:number;vy:number;vz:number;sway:number;size:number};
}
export const JUMP_THEMES:readonly JumpTheme[]=[
  {id:'garden',top:0xa5d68c,side:0xbb9468,rim:0xe4f5c6,accent:0xf7a8b8,dark:0x6f8f5a,skyTop:0x8fd0f0,skyBottom:0xeaf7e6,fog:0xe0f2e6,cloud:0xffffff,hemiSky:0xfffbe8,hemiGround:0x7fa58a,sun:0xfff0d0,light:1,mote:{color:0xffc6d8,vx:.35,vy:-.25,vz:.15,sway:.5,size:.16}},
  {id:'cliff',top:0xe0bd92,side:0xa67e5a,rim:0xf6e3c2,accent:0x7fb37a,dark:0x7c5c43,skyTop:0x86c5ea,skyBottom:0xf7e9d2,fog:0xf2e4d0,cloud:0xfff7ea,hemiSky:0xfff4dc,hemiGround:0x9c8468,sun:0xffe2b8,light:1.05,mote:{color:0xe8d2ac,vx:.6,vy:.05,vz:.1,sway:.25,size:.1}},
  {id:'bridge',top:0xd2a878,side:0x91694a,rim:0xf7f0df,accent:0xe86f5c,dark:0x6c4f3a,skyTop:0x6fb4ea,skyBottom:0xcfe6f7,fog:0xc6e0f4,cloud:0xffffff,hemiSky:0xffffff,hemiGround:0x8fa9b8,sun:0xfff1dc,light:1.05,mote:{color:0xffffff,vx:.8,vy:0,vz:.2,sway:.2,size:.22}},
  {id:'factory',top:0xa7b3bf,side:0x6c7885,rim:0xf2c552,accent:0xe9795a,dark:0x47525e,skyTop:0x7f9db5,skyBottom:0xecd6ba,fog:0xdccfc0,cloud:0xe9dfd2,hemiSky:0xfff0d8,hemiGround:0x6f7a86,sun:0xffd9a8,light:.98,mote:{color:0xffb45c,vx:.1,vy:.9,vz:.05,sway:.35,size:.09}},
  {id:'sky',top:0xf6f9fd,side:0xbcd8f2,rim:0x8fc7f2,accent:0xffd76a,dark:0x7da7cf,skyTop:0x4a9be8,skyBottom:0xc6e9ff,fog:0xc2e4fb,cloud:0xffffff,hemiSky:0xffffff,hemiGround:0x8fbbe0,sun:0xffffff,light:1.1,mote:{color:0xffffff,vx:.5,vy:.1,vz:.3,sway:.3,size:.12}},
  {id:'shaft',top:0xc0b0de,side:0x7f72aa,rim:0xece3ff,accent:0xffc978,dark:0x55497f,skyTop:0x5a5d9e,skyBottom:0xcbbae8,fog:0xb9addc,cloud:0xd9cdf0,hemiSky:0xf0e8ff,hemiGround:0x6b6196,sun:0xffe6c8,light:.95,mote:{color:0xf2e8ff,vx:.05,vy:.3,vz:.05,sway:.3,size:.08}},
  {id:'ridge',top:0xf1f6f9,side:0x91a5b8,rim:0xffffff,accent:0xf2946c,dark:0x62748a,skyTop:0x6f8fd6,skyBottom:0xffdcb6,fog:0xf4dcc6,cloud:0xffeede,hemiSky:0xfff1e2,hemiGround:0x8c93ad,sun:0xffcf9e,light:1.05,mote:{color:0xffffff,vx:.5,vy:-.7,vz:.25,sway:.6,size:.11}},
  {id:'storm',top:0x8e9bb6,side:0x525d79,rim:0xffe27a,accent:0x8fe3ff,dark:0x39425a,skyTop:0x2f3a5c,skyBottom:0x7f8bad,fog:0x717d9e,cloud:0x5d6988,hemiSky:0xd6e0ff,hemiGround:0x4a5470,sun:0xdfe8ff,light:.9,mote:{color:0xcfe4ff,vx:-2.2,vy:-5.5,vz:.8,sway:.05,size:.07}},
  {id:'ruins',top:0xd6ccab,side:0x938d70,rim:0xa5d890,accent:0xf4c66a,dark:0x6c6852,skyTop:0x3a3f7a,skyBottom:0xe8c0b6,fog:0xcdaab4,cloud:0xf6d6d0,hemiSky:0xffe2ea,hemiGround:0x6d6a8c,sun:0xffc9b0,light:.98,mote:{color:0xfff0a0,vx:.1,vy:.15,vz:.1,sway:.8,size:.1}},
  {id:'summit',top:0xfff4d9,side:0xdcb86c,rim:0xffd76a,accent:0x9be8ff,dark:0xa9853f,skyTop:0x10143a,skyBottom:0x5d4c9e,fog:0x403c7e,cloud:0x8f86d0,hemiSky:0xf0eaff,hemiGround:0x5b5590,sun:0xfff0c8,light:1,mote:{color:0xffe9a0,vx:.05,vy:.35,vz:.05,sway:.4,size:.12}},
];
/** A rest pad is the gate of the zone that starts on the next floor. */
export const jumpThemeIndexOf=(floor:number)=>Math.max(0,Math.min(JUMP_THEMES.length-1,floor%JUMP_RULES.zoneFloors===0?floor/JUMP_RULES.zoneFloors:Math.floor((floor-1)/JUMP_RULES.zoneFloors)));
export const jumpZoneBase=(zone:number)=>JUMP_COURSE[Math.min(JUMP_RULES.floors,zone*JUMP_RULES.zoneFloors)]!.y;
/** Zone index as a real number: fractions blend neighbouring looks across a gate. */
export function jumpZoneBlend(y:number){
  for(let zone=JUMP_ZONES.length-1;zone>0;zone--){const base=jumpZoneBase(zone);if(y>=base-1.5)return zone-1+Math.min(1,(y-(base-1.5))/3);}
  return 0;
}

/** Axis of the brick shaft that encloses zone 6. */
export const JUMP_SHAFT_CENTRE:readonly [number,number]=[-2,-8];
function seeded(seed:number){let value=seed>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
const polar=(radius:number,angle:number):[number,number]=>[Math.cos(angle)*radius,Math.sin(angle)*radius];

/** Scenery of one zone: a single merged mesh far outside the play area. It is
 * drawn in the backdrop pass, so it can never hide a pad or the climber. */
export function buildJumpBackdrop(zone:number):THREE.BufferGeometry {
  const kit=new Kit(),theme=JUMP_THEMES[zone]!,y0=jumpZoneBase(zone),y1=jumpZoneBase(zone+1),span=y1-y0,random=seeded(zone*977+13);
  const around=(count:number,near:number,far:number,place:(x:number,z:number,angle:number,index:number)=>void)=>{for(let i=0;i<count;i++){const angle=(i+random()*.7)/count*Math.PI*2,[x,z]=polar(near+random()*(far-near),angle);place(x,z,angle,i);}};
  if(theme.id==='garden'){
    // A ring of meadow around the open shaft: the void under the tower stays visible.
    kit.ring(0x9fd088,0,-1.4,0,15,40,40);kit.ring(0x86bd76,0,-1.38,0,15,16.2,40);
    kit.tube(0xa98a66,0,-5.4,0,15,13,8,32);kit.tube(0x8d7458,0,-7.4,0,40,24,12,32);
    around(18,19,36,(x,z,_,i)=>{const h=2.6+random()*2.4;kit.cyl(0x9a7350,x,-1.4+h*.25,z,.28,.4,h*.5,6);kit.ball(i%3?0x7fc27a:0x9bd486,x,-1.4+h*.75,z,1.3+random()*.6,1.5+random()*.5,1.3+random()*.6,7);kit.ball(0xb7e09a,x+.4,-1.4+h*.95,z+.3,.7,.7,.7,6);});
    around(26,17,37,(x,z,_,i)=>{kit.ball([0xf7a8b8,0xffe08a,0xffffff,0xc7a6f0][i%4]!,x,-1.25,z,.22,.16,.22,5);kit.ball(0x86bd76,x+.5,-1.3,z-.4,.55,.3,.55,5);});
    around(7,20,34,(x,z)=>{kit.ball(0xb9b4a8,x,-1.25,z,.9+random()*.6,.5,.7+random()*.5,6);});
    for(let i=0;i<22;i++){const [x,z]=polar(16.6,i/22*Math.PI*2);kit.box(0xf4ecd8,x,-1,z,.16,.8,.16);kit.box(0xf4ecd8,x,-.85,z,.1,.1,4.9,-(i/22*Math.PI*2));}
    kit.cyl(0x8fd3ee,24,-1.36,-8,4.2,4.2,.04,18);kit.cyl(0x8fd3ee,-22,-1.36,14,3,3,.04,16);
  }else if(theme.id==='cliff'){
    // The south face: banded sandstone terraces with pines and a thin waterfall.
    for(let i=0;i<7;i++){const y=y0-6+i*4.4,depth=9-i*.7;kit.box(i%2?0xd3ad84:0xc39a70,0,y,-27-i*.9,70-i*4,4.4,depth);kit.box(0xe9cfa6,0,y+2.25,-23.2-i*.9+depth*.02,70-i*4,.25,1.6);}
    around(5,26,30,(x)=>{const z=-24-random()*3,y=y0+random()*span;kit.box(0xb98f68,x*1.1,y,z,3+random()*3,2+random()*2,2.5);});
    for(let i=0;i<10;i++){const x=-30+i*6.6+random()*2,y=y0-3.6+(i%4)*4.4,z=-22.4-(i%4)*.9;kit.cyl(0x8a6648,x,y+.5,z,.14,.2,1,5);kit.cyl(0x6fa06a,x,y+1.7,z,0,.75,1.7,6);kit.cyl(0x86b67c,x,y+2.6,z,0,.5,1.2,6);}
    kit.box(0xbfe6f5,-16,y0+span*.4,-21.6,1.6,span+10,.2);kit.box(0xffffff,-16,y0+span*.4,-21.5,.5,span+10,.2);
    for(const side of [-1,1])for(let i=0;i<3;i++)kit.cyl(i%2?0xc9a078:0xb98f68,side*(27+i*4),y0+span*.3-i*2,-8+i*9,2.2-i*.3,3-i*.3,span+16-i*5,7);
  }else if(theme.id==='bridge'){
    // Rope-bridge towers standing in a sea of cloud: a floor of it under the bridge and banks half-way up, so depth reads.
    for(let i=0;i<40;i++){const [x,z]=polar(5+Math.sqrt(i/40)*42,i*2.399),size=3.2+random()*2.6,y=y0-7-random()*2;kit.ball(0xdcebf8,x,y,z,size,1.1,size*.78,9);kit.ball(0xffffff,x-size*.2,y+.55,z+size*.1,size*.62,.9,size*.5,8);kit.ball(0xf3f9fd,x+size*.45,y+.35,z-size*.2,size*.4,.7,size*.36,7);}
    around(12,21,44,(x,z)=>{const size=3.5+random()*3;kit.ball(0xffffff,x,y0+span*.5+random()*2,z,size,size*.3,size*.75,7);});
    around(20,25,44,(x,z)=>{const y=y0-3+random()*(span+2),size=3+random()*3;kit.ball(0xffffff,x,y,z,size,size*.42,size*.8,7);kit.ball(0xf1f7fb,x+size*.6,y-.3,z+.5,size*.6,size*.3,size*.55,6);});
    for(const [x,z,turn] of [[-30,-10,0],[-30,12,0],[6,30,Math.PI/2],[28,-6,0]] as const){
      const height=span+12;kit.shade=.3;
      for(const side of [-1,1]){kit.box(0x8f6a47,x+(turn?side*1.6:0),y0+span*.35,z+(turn?0:side*1.6),.5,height,.5);kit.cyl(0xe86f5c,x+(turn?side*1.6:0),y0+span*.35+height*.5+.5,z+(turn?0:side*1.6),0,.6,1,4);}
      for(let i=0;i<5;i++)kit.box(i%2?0xc79a6b:0xb98858,x,y0-2+i*(span+6)/5,z,turn?3.7:.36,.36,turn?.36:3.7);
      kit.shade=.2;
    }
    for(let i=0;i<14;i++){const t=i/13,x=-30+0,z=-10+t*22,sag=Math.sin(t*Math.PI)*2.2;kit.box(i%2?0xd2a878:0xc19464,x,y0+span*.55-sag,z,2.2,.14,1.3);kit.box(0xf7f0df,x-1.1,y0+span*.55-sag+.7,z,.07,.07,1.7);kit.box(0xf7f0df,x+1.1,y0+span*.55-sag+.7,z,.07,.07,1.7);}
  }else if(theme.id==='factory'){
    // Chimneys, gears, tanks and pipe runs on a square plan.
    around(8,27,36,(x,z,_,i)=>{const h=span+3+random()*4;kit.cyl(0x8a94a0,x,y0-6+h/2,z,1.1,1.6,h,10);for(let band=0;band<3;band++)kit.cyl(band%2?0xf4f1ea:0xe2574c,x,y0-6+h-1-band*1.2,z,1.16+band*.02,1.2+band*.02,1.2,10);if(i%2)kit.ball(0xe9dfd2,x+.6,y0-6+h+1.4,z,1.5,1,1.3,6);});
    around(5,26,32,(x,z,angle)=>{const y=y0+2+random()*(span-3),radius=2.2+random()*1.4;kit.cyl(0xf2c552,x,y,z,radius,radius,.6,14,Math.PI/2,-angle+Math.PI/2);kit.cyl(0x47525e,x,y,z,radius*.3,radius*.3,.8,8,Math.PI/2,-angle+Math.PI/2);
      for(let tooth=0;tooth<10;tooth++){const a=tooth/10*Math.PI*2,tx=Math.cos(angle+Math.PI/2)*Math.cos(a)*radius,tz=Math.sin(angle+Math.PI/2)*Math.cos(a)*radius;kit.box(0xe0b040,x+tx,y+Math.sin(a)*radius,z+tz,.7,.7,.6,-angle+Math.PI/2,0,a);}});
    for(let i=0;i<5;i++){const y=y0+1+i*span/5;kit.cyl(i%2?0x7fa9b8:0xc98a7a,0,y,-30,.5,.5,64,8,0,0,Math.PI/2);kit.cyl(i%2?0xc98a7a:0x7fa9b8,30,y+1.2,0,.5,.5,64,8,Math.PI/2);}
    around(6,28,35,(x,z)=>{kit.cyl(0x9aa7b4,x,y0-1,z,2.4,2.4,5,10);kit.ball(0xb4c0cc,x,y0+1.5,z,2.4,1.1,2.4,8);});
    for(const side of [-1,1]){kit.box(0xf2c552,side*29,y0+span*.5-3,-29,.7,span+7,.7);kit.box(0xf2c552,side*29,y1+.5,-22,.7,.7,14);}
  }else if(theme.id==='sky'){
    // Open air and nothing else: balloons, kites on long tails, cloud banks and a few floating islets.
    around(8,22,30,(x,z,angle,i)=>{const y=y0-3+random()*(span+2),color=[0xf2777a,0xffd76a,0x8fe0a8,0xb89af0][i%4]!,turn=-angle+Math.PI/2;kit.box(color,x,y,z,1.7,1.7,.08,turn,0,Math.PI/4);kit.box(0xffffff,x,y,z,.12,2.4,.1,turn);for(let knot=1;knot<5;knot++)kit.box(knot%2?0xffffff:color,x+Math.cos(angle)*knot*.25,y-1.3-knot*.75,z+Math.sin(angle)*knot*.25,.5,.22,.08,turn,0,knot%2?.5:-.5);});
    around(11,23,38,(x,z,_,i)=>{const y=y0-4+random()*(span+2),color=[0xf2777a,0xffd76a,0x7fc8f0,0xb89af0][i%4]!;kit.ball(color,x,y+3.2,z,2.4,2.9,2.4,10);kit.ball(0xffffff,x,y+3.2,z,2.44,.5,2.44,10);kit.cyl(color,x,y+.9,z,1.1,.4,1.4,8);kit.box(0xa67e5a,x,y-.6,z,.9,.7,.9);});
    around(16,24,46,(x,z)=>{const y=y0-4+random()*(span+8),size=2.5+random()*3.5;kit.ball(0xffffff,x,y,z,size,size*.4,size*.75,7);kit.ball(0xeaf5ff,x-size*.5,y+.3,z,size*.55,size*.32,size*.5,6);});
    around(9,25,38,(x,z,angle)=>{const y=y0+2+random()*span;for(const side of [-1,1])kit.box(0x5f7f9f,x+Math.cos(angle+Math.PI/2)*side*.5,y,z+Math.sin(angle+Math.PI/2)*side*.5,1.1,.07,.22,-angle+Math.PI/2+side*.5,0,side*.45);});
    around(4,27,34,(x,z)=>{const y=y0+random()*span;kit.cyl(0x9fd088,x,y,z,2.6,1.6,.9,9);kit.cyl(0xb98f68,x,y-1.4,z,1.6,.2,2,7);kit.cyl(0x7fc27a,x+.6,y+1.4,z,0,.8,2,6);});
  }else if(theme.id==='shaft'){
    // The inside of a great brick chimney. The camera stays inside it, so the wall is the backdrop.
    const [cx,cz]=JUMP_SHAFT_CENTRE,radius=21,rows=Math.ceil((span+4)/2.2);
    for(let row=0;row<rows;row++){const y=y0-2+row*2.2;kit.tube(row%2?0x9b8cc6:0x8d7dba,cx,y,cz,radius,radius,2.2,28,row*.13);if(row%4===0)kit.torus(0xd9ccf5,cx,y-1.1,cz,radius-.25,.3,0,0,0,28);}
    for(let i=0;i<10;i++){const angle=i/10*Math.PI*2,[x,z]=polar(radius-.45,angle);kit.box(0x6a5d99,cx+x,y0+span*.5,cz+z,.7,span+4,.7,-angle);
      for(let lamp=0;lamp<4;lamp++){const [lx,lz]=polar(radius-.9,angle+.31);kit.box(0xffe0a0,cx+lx,y0+2+lamp*span/4+(i%2)*2,cz+lz,1.2,1.7,.2,-angle-.31+Math.PI/2);}}
    for(let i=0;i<3;i++){const angle=1+i*2.1,[x,z]=polar(radius-1.1,angle);kit.cyl(0xffc978,cx+x,y0+span*.5,cz+z,.3,.3,span+4,6);}
  }else if(theme.id==='ridge'){
    // Snow peaks under an evening sky.
    around(13,30,46,(x,z,_,i)=>{const height=26+random()*16,radius=9+random()*6,top=y0+span*.25+random()*span;kit.cyl(i%2?0x8fa3b8:0x7f93aa,x,top-height/2,z,0,radius,height,7);kit.cyl(0xffffff,x,top-height*.14,z,0,radius*.29,height*.285,7);});
    around(22,25,31,(x,z)=>{const y=y0-4+random()*(span*.6);kit.cyl(0x5f8a72,x,y+1,z,0,.9,2.2,6);kit.cyl(0xffffff,x,y+1.9,z,0,.45,1,6);});
    around(8,26,40,(x,z)=>{const y=y0+random()*span,size=3+random()*3;kit.ball(0xffe6d2,x,y,z,size,size*.35,size*.7,7);});
  }else if(theme.id==='storm'){
    // A wall of thunderheads, with bolts and wind streaks running against the climb.
    around(26,24,44,(x,z)=>{const y=y0-5+random()*(span+10),size=4+random()*4;kit.ball(0x55617f,x,y,z,size,size*.5,size*.85,7);kit.ball(0x6c7896,x+size*.5,y+size*.2,z-.5,size*.6,size*.36,size*.55,6);});
    around(7,26,34,(x,z,angle)=>{let y=y0+span*.4+random()*span*.6,offset=0;for(let i=0;i<5;i++){const next=(random()-.5)*2.4;kit.box(0xffe27a,x+Math.cos(angle+Math.PI/2)*(offset+next/2),y-1.1,z+Math.sin(angle+Math.PI/2)*(offset+next/2),Math.hypot(next,2.2),.3,.3,-angle-Math.PI/2,0,Math.atan2(-2.2,next));offset+=next;y-=2.2;}});
    for(let i=0;i<4;i++){const y=y0+1+i*span/4;kit.torus(0xa9b8d6,0,y,0,36+i%3*3,.16,.1*(i%2?1:-1),i*1.3,.06,40);}
  }else if(theme.id==='ruins'){
    // Broken colonnades on drifting rocks.
    around(9,25,38,(x,z,angle,i)=>{const y=y0-2+random()*span;kit.cyl(0xb8b092,x,y,z,3.4,2.2,1.1,8);kit.cyl(0x8f8a6e,x,y-2,z,2.2,.3,3,7);kit.ball(0xa5d890,x+1,y+.55,z,1.2,.2,1,6);
      const columns=2+i%3;for(let c=0;c<columns;c++){const [ox,oz]=polar(1.6,angle+c*2.1),h=2+((i+c)%3)*1.3;kit.cyl(0xdcd3b4,x+ox,y+.55+h/2,z+oz,.36,.42,h,8);kit.box(0xe8e0c4,x+ox,y+.6,z+oz,1,.24,1);if((i+c)%3===2)kit.box(0xe8e0c4,x+ox,y+.55+h+.12,z+oz,1,.24,1);}
      if(i%3===0){const [ax,az]=polar(1.6,angle),[bx,bz]=polar(1.6,angle+2.1);kit.box(0xd2c9a8,x+(ax+bx)/2,y+4.6,z+(az+bz)/2,Math.hypot(ax-bx,az-bz)+.8,.5,.8,-Math.atan2(bz-az,bx-ax));}});
    around(12,24,42,(x,z)=>{const y=y0+random()*span;kit.box(0xc9c0a0,x,y,z,.9+random(),.6+random()*.6,.9+random(),random()*3,random(),random());});
    around(10,26,44,(x,z)=>{const y=y0-3+random()*(span+6),size=3+random()*3;kit.ball(0xf3c3cf,x,y,z,size,size*.34,size*.7,7);});
  }else{
    // Night at the top: stars, a moon, crystal spires and rings of light around the peak.
    around(70,48,70,(x,z,_,i)=>{kit.ball(i%5?0xffffff:0xffe9a0,x,y0-14+random()*(span+50),z,.22+random()*.3,undefined,undefined,4);});
    kit.ball(0xfff3c8,-42,y1+16,-38,5.5,5.5,5.5,14);kit.ball(0x2a2d66,-39.6,y1+17.2,-36.2,4.9,4.9,4.9,12);
    around(11,25,38,(x,z,_,i)=>{const height=8+random()*14,y=y0-6+random()*span;kit.cyl(i%2?0x9be8ff:0xc7b3ff,x,y+height/2,z,0,1.3+random(),height,5);kit.cyl(i%2?0x7fd0ee:0xa894ee,x+1.4,y+height*.3,z+.8,0,.8,height*.6,5);});
    for(let i=0;i<4;i++)kit.torus(i%2?0xffd76a:0xfff0b8,0,y1-3+i*3.2,0,32+i*5,.22,.1*(i%2?1:-1),i,.06,48);
    around(8,27,42,(x,z)=>{const y=y0+random()*span,size=3+random()*3;kit.ball(0x8f86d0,x,y,z,size,size*.3,size*.7,7);});
  }
  return kit.build();
}

/** Vertical gradient dome that follows the camera. */
export function createJumpSky(){
  const material=new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false,
    uniforms:{top:{value:new THREE.Color()},bottom:{value:new THREE.Color()}},
    vertexShader:'varying float h;void main(){h=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform vec3 top;uniform vec3 bottom;varying float h;void main(){float t=smoothstep(-0.25,0.75,h);gl_FragColor=vec4(mix(bottom,top,t),1.0);\n#include <colorspace_fragment>\n}',
  });
  const geometry=new THREE.SphereGeometry(110,20,12),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=-10;
  return{mesh,top:material.uniforms.top!.value as THREE.Color,bottom:material.uniforms.bottom!.value as THREE.Color,dispose(){geometry.dispose();material.dispose();}};
}
