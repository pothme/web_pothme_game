import { APPEARANCE_OPTIONS } from '../shared/avatar-appearance';
import { mountAvatarThumbnails } from '../src/avatar-thumbnails';
const slots={top:'상의',bottom:'하의',shoes:'신발',headwear:'모자 · 머리 장식',eyewear:'안경',neckwear:'목 · 가슴 장식',backwear:'등 · 가방'} as const;
const host=document.querySelector<HTMLElement>('#items')!;
for(const slot of Object.keys(slots) as (keyof typeof slots)[]){
  const section=document.createElement('section'),heading=document.createElement('h2'),grid=document.createElement('div');
  heading.textContent=slots[slot];grid.className='items';
  for(const item of APPEARANCE_OPTIONS[slot]){
    if(item.id==='none')continue;
    const card=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');
    // The caption names the item; an empty alt (as in the dressing room) keeps a
    // waiting card a calm blank square instead of a broken-image glyph and a second label.
    card.className='item';image.dataset.avatarSlot=slot;image.dataset.avatarValue=item.id;image.width=160;image.height=160;image.alt='';caption.textContent=item.label;
    card.append(image,caption);grid.append(card);
  }
  section.append(heading,grid);host.append(section);
}
const cleanup=mountAvatarThumbnails(host);
addEventListener('pagehide',cleanup,{once:true});
if(import.meta.hot)import.meta.hot.dispose(cleanup);
