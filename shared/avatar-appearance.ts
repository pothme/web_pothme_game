import { ACCESSORY_ADDITIONS, ACCESSORY_SLOTS, CLOTHING_ADDITIONS } from './avatar-wardrobe';

export const APPEARANCE_OPTIONS = {
  species: [{id:'human',label:'사람'},{id:'cat',label:'고양이'},{id:'rabbit',label:'토끼'},{id:'fox',label:'여우'},{id:'bear',label:'곰'},{id:'bee',label:'꿀벌'},{id:'butterfly',label:'나비'}],
  face: [{id:'round',label:'동글동글'},{id:'oval',label:'달걀형'},{id:'soft',label:'말랑한 볼'}],
  hair: [{id:'wave',label:'포근한 웨이브'},{id:'bob',label:'둥근 단발'},{id:'curtain',label:'가르마'},{id:'pony',label:'포니테일'},{id:'bun',label:'묶음머리'},{id:'crop',label:'짧은 머리'}],
  skin: [{id:'porcelain',label:'아이보리',color:'#f6dec9'},{id:'peach',label:'피치',color:'#f0c5a6'},{id:'rose',label:'로즈',color:'#dfad99'},{id:'tan',label:'허니',color:'#c38d65'},{id:'brown',label:'모카',color:'#986346'},{id:'deep',label:'딥 브라운',color:'#654333'}],
  hairColor: [{id:'espresso',label:'에스프레소',color:'#49362f'},{id:'chestnut',label:'밤색',color:'#865b49'},{id:'black',label:'소프트 블랙',color:'#2e303d'},{id:'ash',label:'애시 브라운',color:'#80756b'},{id:'silver',label:'실버',color:'#c5c8d3'},{id:'rose',label:'로즈 브라운',color:'#ae7787'}],
  top: [{id:'tank-white',label:'흰색 러닝셔츠',color:'#f7f4eb'},{id:'blazer-blue',label:'파우더 블루 재킷',color:'#90a5c1'},{id:'blazer-lilac',label:'라일락 재킷',color:'#b69db6'},{id:'cardigan-mint',label:'민트 카디건',color:'#95baa9'},{id:'knit-cream',label:'크림 니트',color:'#e6d6b8'},{id:'blazer-night',label:'미드나이트 재킷',color:'#263e64'},{id:'cardigan-coral',label:'코랄 카디건',color:'#df8e7b'},{id:'blazer-gold',label:'챔피언 재킷',color:'#c8a45d'},...CLOTHING_ADDITIONS.filter(item=>item.slot==='top')],
  bottom: [{id:'shorts-navy',label:'기본 반바지',color:'#61758a'},{id:'trousers-slate',label:'슬레이트 팬츠',color:'#526076'},{id:'trousers-plum',label:'플럼 팬츠',color:'#796073'},{id:'trousers-cream',label:'크림 팬츠',color:'#d5c5ad'},{id:'skirt-navy',label:'네이비 스커트',color:'#3c506a'},{id:'trousers-ivory',label:'아이보리 와이드 팬츠',color:'#ece7d5'},...CLOTHING_ADDITIONS.filter(item=>item.slot==='bottom')],
  shoes: [{id:'slippers-ivory',label:'기본 슬리퍼',color:'#e9dfcb'},{id:'loafers-cream',label:'크림 로퍼',color:'#eee2cd'},{id:'loafers-navy',label:'네이비 로퍼',color:'#3c485e'},{id:'sneakers-white',label:'화이트 스니커즈',color:'#f3f0e7'},{id:'sneakers-rose',label:'로즈 스니커즈',color:'#cc8a9c'},...CLOTHING_ADDITIONS.filter(item=>item.slot==='shoes')],
  headwear: [{id:'none',label:'없음'},...ACCESSORY_ADDITIONS.filter(item=>item.slot==='headwear')],
  eyewear: [{id:'none',label:'없음'},...ACCESSORY_ADDITIONS.filter(item=>item.slot==='eyewear')],
  neckwear: [{id:'none',label:'없음'},...ACCESSORY_ADDITIONS.filter(item=>item.slot==='neckwear')],
  backwear: [{id:'none',label:'없음'},...ACCESSORY_ADDITIONS.filter(item=>item.slot==='backwear')],
} as const;
export type AppearanceKey = keyof typeof APPEARANCE_OPTIONS;
export type AvatarAppearance = {[K in AppearanceKey]: typeof APPEARANCE_OPTIONS[K][number]['id']};
export const DEFAULT_APPEARANCE: AvatarAppearance = {species:'human',face:'round',hair:'wave',skin:'peach',hairColor:'espresso',top:'tank-white',bottom:'shorts-navy',shoes:'slippers-ivory',headwear:'none',eyewear:'none',neckwear:'none',backwear:'none'};
export function validateAvatarAppearance(value: unknown): AvatarAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('캐릭터 설정을 확인해 주세요.');
  const record = value as Record<string,unknown>, result = {} as AvatarAppearance;
  for (const key of Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]) {
    // Older saved profiles and open tabs predate accessories. Missing new slots
    // mean no accessory; explicitly invalid values still fail server validation.
    const missingAccessory=(ACCESSORY_SLOTS as readonly string[]).includes(key)&&!Object.prototype.hasOwnProperty.call(record,key);
    const selected=missingAccessory?'none':record[key];
    if (!APPEARANCE_OPTIONS[key].some(option => option.id === selected)) throw new Error('선택할 수 없는 캐릭터 옵션이에요.');
    (result as Record<string,string>)[key] = selected as string;
  }
  return result;
}
export function normalizeAvatarAppearance(value: unknown, color = 0): AvatarAppearance {
  const seed=Math.abs(color>>>0), result:AvatarAppearance={...DEFAULT_APPEARANCE,hair:APPEARANCE_OPTIONS.hair[seed%6].id,skin:APPEARANCE_OPTIONS.skin[Math.floor(seed/7)%6].id};
  if(!value||typeof value!=='object'||Array.isArray(value))return result;
  const record=value as Record<string,unknown>;
  for(const key of Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[])if(APPEARANCE_OPTIONS[key].some(option=>option.id===record[key]))(result as Record<string,string>)[key]=record[key] as string;
  return result;
}
export function appearanceKey(value: AvatarAppearance): string { return (Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]).map(key=>value[key]).join('/'); }
