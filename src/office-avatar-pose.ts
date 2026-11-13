import type { OfficeAvatar } from './office-avatar';
import { isMarketReaction, type AvatarActionView } from '../shared/avatar-actions';
import { jumpHeightAt, JUMP_RULES } from '../shared/avatar-jump';
import type { ShoulderLinkView } from '../shared/shoulder-links';
import { AVATAR_HEAD_CENTER_Y, AVATAR_TORSO_Y } from '../shared/avatar-rig';

const HEAD_Y = AVATAR_HEAD_CENTER_Y - AVATAR_TORSO_Y;
const blink = (local: number, start: number) => { const x = (local - start) / 150; return x <= 0 || x >= 1 ? 0 : Math.pow(Math.sin(Math.PI * x), .55); };

/** Ambient life: blinking, breathing, a squashy waddling walk and the secondary
 * motion of ears, tails and wings. It only touches joints, scales and offsets
 * that no gameplay pose owns (eyes, ears, tail, wings, the upper body's scale
 * and sideways offset, the head's offset), so gestures, seats, trays and
 * shoulder links are unaffected. `time` is the local animation clock in ms;
 * every figure has its own phase. `air` is the vertical speed of a jump,
 * normalised to -1 (falling) … 1 (rising), and left out on the ground. */
export function poseAvatarLife(model: OfficeAvatar, time: number, moving: boolean, air?: number) {
  const phase = model.lifePhase, t = time + phase * 20000;
  // Blink every 3–5 s, now and then twice in a row.
  const period = 3100 + phase * 1900, local = t % period, cycle = Math.floor(t / period) + Math.floor(phase * 7);
  const closed = Math.max(blink(local, 0), cycle % 4 === 0 ? blink(local, 270) : 0);
  model.eyes.scale.y = 1 - .9 * closed;
  // The office lifts a walking figure by |sin(stride)|: stretch on the way up,
  // squash on landing, with the head arriving a moment later.
  const flying = air !== undefined, flight = flying ? Math.max(-1, Math.min(1, air)) : 0, walking = moving && !flying;
  const stride = time * .016, hop = Math.abs(Math.sin(stride)), late = Math.abs(Math.sin(stride - .5));
  const breath = Math.sin(t * .0022);
  const squash = flying ? Math.abs(flight) * .07 : walking ? (hop - .6) * .06 : breath * .016;
  model.upperBody.scale.set(1 - squash * .45, 1 + squash, 1 - squash * .45);
  // A toddler's waddle: the body leans over the standing foot and the big head
  // follows a beat behind. Offsets only, so every pinned rotation stays put.
  model.upperBody.position.x = walking ? Math.cos(stride) * .024 : 0;
  model.head.position.x = walking ? Math.cos(stride - .45) * .032 : 0;
  model.head.position.y = HEAD_Y + (flying ? flight * -.012 : walking ? (late - .6) * .024 : Math.sin(t * .0022 - .9) * .006);
  const flex = model.earFlex;
  model.ears.forEach((ear, index) => {
    const side = index === 0 ? -1 : 1;
    // In the air the ears trail the body: swept back on the way up, lifted and spread on the way down.
    if (flying) { ear.rotation.x = flight * -.3 * flex; ear.rotation.z = side * flight * -.14 * flex; return; }
    if (walking) { ear.rotation.x = (late - .55) * -.3 * flex; ear.rotation.z = side * (late - .55) * .1 * flex; return; }
    // Idle: a slow sway, and each ear flicks by itself every few seconds.
    const flickAt = (t + index * 1900) % (4300 + phase * 2600), flick = flickAt < 260 ? Math.sin(Math.PI * flickAt / 260) : 0;
    ear.rotation.x = Math.sin(t * .0017 + index) * .02 * flex - flick * .1 * flex;
    ear.rotation.z = side * (Math.sin(t * .0013 + index * 2) * .025 * flex - flick * .16);
  });
  if (model.tail) {
    model.tail.rotation.y = flying ? Math.sin(t * .02) * .12 : walking ? Math.sin(stride) * .32 : Math.sin(t * .0026) * .16 + Math.sin(t * .0011) * .06;
    model.tail.rotation.x = flying ? flight * .32 : walking ? (late - .55) * .2 : Math.sin(t * .0019) * .04;
  }
  model.wings.forEach((wing, index) => {
    // Wings work hardest in the air, harder on a walk than at rest.
    const side = index === 0 ? -1 : 1, beat = model.wingBeat * (flying ? 2.4 : walking ? 1.6 : 1);
    wing.rotation.y = side * (.1 + (.5 + .5 * Math.sin(t * beat)) * (model.wingBeat > .02 ? .22 : .5));
  });
}
/** A gesture's own squash and stretch, layered on the ambient breathing. */
function bounce(model: OfficeAvatar, amount: number) {
  const scale = model.upperBody.scale;
  scale.set(scale.x - amount * .45, scale.y + amount, scale.z - amount * .45);
  model.head.position.y += amount * .3;
}

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
  const jumping=!seated&&action?.kind==='jump'&&serverNow>=action.startedAt&&serverNow<action.expiresAt;
  // Vertical speed of the cosmetic jump, about 6 units/s at take-off.
  poseAvatarLife(model,time,moving,jumping?(jumpHeightAt(action,serverNow+30)-jumpHeightAt(action,serverNow-30))/.36:undefined);
  // Open eyes unless a joyful gesture below closes them into "^ ^" arcs.
  model.setExpression('normal');
  model.upperBody.rotation.set(0,0,0);
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
    // Short arms cannot reach round the big head: the hand stops just in
    // front of the chin and the cup or snack covers the rest of the way.
    arm.rotation.x+=(-2.12-arm.rotation.x)*weight;
    arm.rotation.z+=((index===0?.56:-.56)-arm.rotation.z)*weight;
    model.forearms[index].rotation.x=-.05*weight;
    const nibble=Math.sin((serverNow-action.startedAt)*.014);
    model.head.rotation.x=(action.kind==='drink'?-.06:nibble*.03)*weight;
    // A snack is a happy moment: eyes closed in delight while nibbling.
    if(action.kind==='eat'){bounce(model,nibble*.012*weight);model.setExpression('happy',weight);}
    model.head.rotation.z=(action.kind==='drink'?-.035:.025)*weight;
    return;
  }
  const elapsed=(serverNow-action.startedAt)/1000;
  const duration=(action.expiresAt-action.startedAt)/1000;
  const weight=smooth(elapsed/.22)*smooth((duration-elapsed)/.3);
  const blend=(current:number,target:number)=>current+(target-current)*weight;
  // Joy closes the eyes: the cheering market reaction always (it is head-only
  // with full hands), the hand gestures only when the hands are free to play them.
  if(action.kind==='lets-go'||!carrying&&(action.kind==='cheer'||action.kind==='heart'||action.kind==='dance'||action.kind==='clap'))model.setExpression('happy',weight);
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
        bounce(model,Math.sin(elapsed*10)*.035*weight);
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
    bounce(model,(Math.abs(beat)-.5)*.05*weight);
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
    // The heart rests on the cupped hands, under the chin and clear of the
    // mouth: a soft pulse, a little plumper than it is drawn, turning gently so
    // it still reads as a heart from the side.
    const pulse=weight*(1+Math.sin(elapsed*9)*.04);
    model.heartEffect.visible=weight>.02;
    model.heartEffect.scale.set(pulse,pulse,pulse*1.7);
    model.heartEffect.position.set(0,.315+Math.sin(elapsed*3)*.008,.405);
    model.heartEffect.rotation.y=Math.sin(elapsed*2.6)*.32*weight;
    bounce(model,Math.sin(elapsed*9)*.012*weight);
  } else if(action.kind==='wave') {
    // The raised hand stays in front of the hair, and the head leans away from it.
    const arm=model.arms[1]; arm.rotation.x=blend(arm.rotation.x,.42); arm.rotation.z=blend(arm.rotation.z,2.35);
    model.forearms[1].rotation.z=Math.sin(elapsed*15)*.32*weight;
    model.forearms[1].rotation.x=-.15*weight;
    model.head.rotation.z=-.09*weight;
    bounce(model,Math.sin(elapsed*7.5)*.012*weight);
  } else if(action.kind==='bow') {
    model.upperBody.rotation.x=.48*weight;
    model.head.rotation.x=.11*weight;
    model.arms.forEach(arm=>arm.rotation.x=blend(arm.rotation.x,-.12));
    // Long ears and antennae tip forward with the bow.
    model.ears.forEach(ear=>ear.rotation.x+=.22*model.earFlex*weight);
  } else if(action.kind==='clap') {
    model.arms.forEach((arm,index)=>{
      const side=index===0?-1:1;
      arm.rotation.x=blend(arm.rotation.x,-1.12);
      arm.rotation.z=blend(arm.rotation.z,-side*(.42+.14*Math.sin(elapsed*17)));
      model.forearms[index].rotation.x=-.35*weight;
      model.forearms[index].rotation.z=-side*.24*weight;
    });
    bounce(model,Math.sin(elapsed*17)*.012*weight);
  } else if(action.kind==='cheer') {
    model.arms.forEach((arm,index)=>{
      arm.rotation.x=blend(arm.rotation.x,.42);
      arm.rotation.z=blend(arm.rotation.z,(index===0?-1:1)*(2.45+Math.sin(elapsed*12)*.12));
      model.forearms[index].rotation.x=-.22*weight;
    });
    model.upperBody.rotation.z=Math.sin(elapsed*8)*.045*weight;
    bounce(model,Math.sin(elapsed*12)*.035*weight);
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
  // The whole line beams while it sways to the group cheer.
  if(cheering)model.setExpression('happy',cheerWeight);
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
