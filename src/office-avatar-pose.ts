import type { OfficeAvatar } from './office-avatar';
import { isMarketReaction, type AvatarActionView } from '../shared/avatar-actions';
import { jumpHeightAt, JUMP_RULES } from '../shared/avatar-jump';
import type { ShoulderLinkView } from '../shared/shoulder-links';

function actionProgress(action:AvatarActionView|null|undefined, now:number) {
  if(!action||now<action.startedAt||now>=action.expiresAt)return null;
  return (now-action.startedAt)/(action.expiresAt-action.startedAt);
}
function smooth(x:number) { const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t); }

/** Cosmetic height only: X/Z movement, wall collision and server speed remain authoritative. */
export function avatarJumpHeight(action:AvatarActionView|null|undefined, now:number, seated=false) {
  return seated ? 0 : jumpHeightAt(action,now);
}
export function avatarConsumeWeight(action:AvatarActionView|null|undefined,now:number,moving=false) {
  if(moving||!action||!['eat','drink'].includes(action.kind))return 0;
  const p=actionProgress(action,now); return p===null?0:smooth(p/.24)*smooth((1-p)/.22);
}

/** Adds gestures after the walking/seated base pose, without touching world
 * position, heading, collision or knee joints. All clients use server time. */
export function poseOfficeAvatar(model:OfficeAvatar, time:number, serverNow:number, action:AvatarActionView|null|undefined, moving:boolean, carrying:boolean, seated=false) {
  model.heartEffect.visible=false;
  model.upperBody.rotation.set(0,0,0);
  model.upperBody.scale.y=1+(moving?0:Math.sin(time*.0018)*.003);
  model.head.rotation.set(0,0,0);
  model.arms.forEach((arm,index)=>{arm.rotation.y=0;arm.rotation.z=(index===0?-1:1)*.12;});
  model.forearms.forEach(arm=>arm.rotation.set(carrying?-.12:0,0,0));
  if(!action||serverNow<action.startedAt||serverNow>=action.expiresAt)return;
  if(action.kind==='jump') {
    if(seated)return;
    const lift=Math.min(1,avatarJumpHeight(action,serverNow)/JUMP_RULES.height);
    if(!carrying)model.arms.forEach((arm,index)=>{arm.rotation.x=-.35*lift;arm.rotation.z=(index===0?-1:1)*(.12+.25*lift);});
    model.lowerLegs.forEach(leg=>leg.rotation.x+=.28*lift);
    return;
  }
  if(moving)return;
  if(action.kind==='drink'||action.kind==='eat') {
    if(!carrying)return;
    const weight=avatarConsumeWeight(action,serverNow), index=action.kind==='drink'?0:1;
    const arm=model.arms[index];
    arm.rotation.x+=(action.kind==='drink'?-2.15-arm.rotation.x:-2.25-arm.rotation.x)*weight;
    arm.rotation.z+=((index===0?.45:-.45)-arm.rotation.z)*weight;
    model.forearms[index].rotation.x=-.05*weight;
    model.head.rotation.x=(action.kind==='drink'?.045:Math.sin((serverNow-action.startedAt)*.014)*.025)*weight;
    model.head.rotation.z=(action.kind==='drink'?-.035:.025)*weight;
    return;
  }
  const elapsed=(serverNow-action.startedAt)/1000;
  const duration=(action.expiresAt-action.startedAt)/1000;
  const weight=smooth(elapsed/.22)*smooth((duration-elapsed)/.3);
  const blend=(current:number,target:number)=>current+(target-current)*weight;
  if(isMarketReaction(action.kind)) {
    // The gesture is upper-body only so a seated visitor keeps both feet and
    // knees on the chair pose. Busy hands stay still, with a head-only reaction.
    if(action.kind==='lets-go') {
      model.head.rotation.x=(-.06+Math.sin(elapsed*10)*.08)*weight;
      if(!carrying) {
        model.upperBody.rotation.z=Math.sin(elapsed*8)*.035*weight;
        model.arms.forEach((arm,index)=>{
          const side=index===0?-1:1;
          arm.rotation.x=blend(arm.rotation.x,-.35);
          arm.rotation.z=blend(arm.rotation.z,side*(1.9+Math.sin(elapsed*10)*.2));
          model.forearms[index].rotation.x=-.8*weight;
        });
      }
    } else {
      model.head.rotation.x=.1*weight;
      model.head.rotation.z=Math.sin(elapsed*12)*.11*weight;
      if(!carrying) {
        model.upperBody.rotation.x=.08*weight;
        model.arms.forEach((arm,index)=>{
          const side=index===0?-1:1;
          arm.rotation.x=blend(arm.rotation.x,-1.55);
          arm.rotation.z=blend(arm.rotation.z,side*.18);
          model.forearms[index].rotation.x=(-.65+Math.sin(elapsed*13+index*Math.PI)*.12)*weight;
          model.forearms[index].rotation.z=side*.12*weight;
        });
      }
    }
    return;
  }
  if(carrying)return;
  const kind: string=action.kind;
  if(kind==='dance') {
    const beat=Math.sin(elapsed*7.4), counterBeat=Math.sin(elapsed*7.4+Math.PI);
    model.upperBody.rotation.z=beat*(seated?.065:.10)*weight;
    model.upperBody.rotation.y=Math.sin(elapsed*3.7)*.16*weight;
    model.head.rotation.z=-beat*.07*weight;
    model.head.rotation.x=(.025+Math.sin(elapsed*14.8)*.035)*weight;
    model.arms.forEach((arm,index)=>{
      const side=index===0?-1:1, rhythm=index===0?beat:counterBeat;
      arm.rotation.x=blend(arm.rotation.x,-.7+rhythm*.3);
      arm.rotation.z=blend(arm.rotation.z,side*(.65+rhythm*.17));
      model.forearms[index].rotation.x=(-.85-rhythm*.3)*weight;
    });
  } else if(kind==='heart') {
    model.head.rotation.z=-.07*weight;
    model.head.rotation.x=.04*weight;
    model.arms.forEach((arm,index)=>{
      const side=index===0?-1:1;
      arm.rotation.x=blend(arm.rotation.x,-1.1);
      arm.rotation.z=blend(arm.rotation.z,-side*.34);
      model.forearms[index].rotation.x=-.75*weight;
      model.forearms[index].rotation.z=-side*.4*weight;
    });
    model.heartEffect.visible=weight>.02;
    model.heartEffect.scale.setScalar(weight*(1+Math.sin(elapsed*9)*.07));
    model.heartEffect.position.y=.44+Math.sin(elapsed*3)*.014;
  } else if(action.kind==='wave') {
    const arm=model.arms[1]; arm.rotation.x=blend(arm.rotation.x,.2); arm.rotation.z=blend(arm.rotation.z,2.35);
    model.forearms[1].rotation.z=Math.sin(elapsed*15)*.32*weight;
    model.forearms[1].rotation.x=-.15*weight;
    model.head.rotation.z=-.055*weight;
  } else if(action.kind==='bow') {
    model.upperBody.rotation.x=.48*weight;
    model.head.rotation.x=.11*weight;
    model.arms.forEach(arm=>arm.rotation.x=blend(arm.rotation.x,-.12));
  } else if(action.kind==='clap') {
    model.arms.forEach((arm,index)=>{
      const side=index===0?-1:1;
      arm.rotation.x=blend(arm.rotation.x,-1.12);
      arm.rotation.z=blend(arm.rotation.z,-side*(.42+.14*Math.sin(elapsed*17)));
      model.forearms[index].rotation.x=-.35*weight;
      model.forearms[index].rotation.z=-side*.24*weight;
    });
  } else if(action.kind==='cheer') {
    model.arms.forEach((arm,index)=>{
      arm.rotation.x=blend(arm.rotation.x,.18);
      arm.rotation.z=blend(arm.rotation.z,(index===0?-1:1)*(2.45+Math.sin(elapsed*12)*.12));
      model.forearms[index].rotation.x=-.22*weight;
    });
    model.upperBody.rotation.z=Math.sin(elapsed*8)*.045*weight;
  }
}

/** A voluntary, persistent group pose layered after the ordinary avatar pose.
 * Indices run along the group's local +X axis. The server owns the formation;
 * this only bends joints, with a shared clock keeping the gentle sway in sync. */
export function poseOfficeShoulderLink(model:OfficeAvatar, shoulder:ShoulderLinkView|null|undefined, serverNow:number) {
  if(!shoulder||!Number.isFinite(serverNow)||!Number.isFinite(shoulder.since)||serverNow<shoulder.since)return;
  const weight=smooth((serverNow-shoulder.since)/320);
  const waiting=shoulder.count===1, sway=Math.sin(serverNow*.0018);
  const cheer=shoulder.cheer;
  const cheering=!waiting&&cheer&&Number.isFinite(cheer.startedAt)&&Number.isFinite(cheer.expiresAt)&&serverNow>=cheer.startedAt&&serverNow<cheer.expiresAt;
  const cheerWeight=cheering?smooth((serverNow-cheer.startedAt)/300)*smooth((cheer.expiresAt-serverNow)/400):0;
  const cheerRoll=cheering?Math.sin((serverNow-cheer.startedAt)*Math.PI*2/1200)*.14*cheerWeight:0;
  const blend=(current:number,target:number)=>current+(target-current)*weight;
  model.upperBody.rotation.x=blend(model.upperBody.rotation.x,-.015);
  model.upperBody.rotation.z=blend(model.upperBody.rotation.z,sway*.009*(1-cheerWeight)+cheerRoll);
  model.upperBody.scale.y=1+Math.sin(serverNow*.0018)*.002;
  model.head.rotation.x=blend(model.head.rotation.x,-.025);
  const headTilt=waiting?.04:shoulder.index===0?.025:shoulder.index===shoulder.count-1?-.025:0;
  model.head.rotation.z=blend(model.head.rotation.z,headTilt-cheerRoll*.28);
  model.arms.forEach((arm,index)=>{
    const side=index===0?-1:1;
    const linked=index===0?shoulder.index>0:shoulder.index<shoulder.count-1;
    const forearm=model.forearms[index];
    if(waiting) {
      arm.rotation.x=blend(arm.rotation.x,-.22);
      arm.rotation.y=blend(arm.rotation.y,0);
      arm.rotation.z=blend(arm.rotation.z,side*(1.08+sway*.025));
      forearm.rotation.x=blend(forearm.rotation.x,-.35);
      forearm.rotation.y=blend(forearm.rotation.y,0);
      forearm.rotation.z=blend(forearm.rotation.z,side*.12);
    } else if(linked) {
      // One arm sits a little higher than the opposite neighbor's arm so their
      // sleeves do not occupy the same line. Bent elbows wrap behind shoulders.
      arm.rotation.x=blend(arm.rotation.x,index===0?.025:-.025);
      arm.rotation.y=blend(arm.rotation.y,0);
      // Counter-roll the linked sleeves so hands stay near the neighboring
      // shoulder while the torso sways. Feet and formation positions stay put.
      arm.rotation.z=blend(arm.rotation.z,side*(index===0?1.72:1.92)-cheerRoll*.65);
      forearm.rotation.x=blend(forearm.rotation.x,index===0?1.04:.96);
      forearm.rotation.y=blend(forearm.rotation.y,0);
      forearm.rotation.z=blend(forearm.rotation.z,0);
    } else {
      arm.rotation.x=blend(arm.rotation.x,-.08);
      arm.rotation.y=blend(arm.rotation.y,0);
      arm.rotation.z=blend(arm.rotation.z,side*.14);
      forearm.rotation.x=blend(forearm.rotation.x,-.08);
      forearm.rotation.y=blend(forearm.rotation.y,0);
      forearm.rotation.z=blend(forearm.rotation.z,0);
    }
  });
}
