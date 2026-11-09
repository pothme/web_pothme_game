import { DEFAULT_APPEARANCE, validateAvatarAppearance, type AvatarAppearance, type AppearanceKey } from './avatar-appearance';
import { ACCESSORY_ADDITIONS, CLOTHING_ADDITIONS, type AccessorySlot } from './avatar-wardrobe';
export type ShopItem = { id:string; name:string; description:string; category:'outfit'|'accessory'|'emoji'|'action'; price:number; icon:string; slot?:'top'|'bottom'|'shoes'|AccessorySlot; value?:string; action?:'dance'|'heart'; emoji?:string; concept?:string };
export const SHOP_ITEMS: readonly ShopItem[] = [
  {id:'outfit-night',name:'미드나이트 재킷',description:'깊은 네이비 컬러의 오피스 재킷',category:'outfit',price:100,icon:'🧥',slot:'top',value:'blazer-night'},
  {id:'outfit-coral',name:'코랄 카디건',description:'포근한 코랄 컬러 카디건',category:'outfit',price:100,icon:'🧶',slot:'top',value:'cardigan-coral'},
  {id:'outfit-gold',name:'챔피언 재킷',description:'게임룸에서 빛나는 골드 재킷',category:'outfit',price:250,icon:'🏅',slot:'top',value:'blazer-gold'},
  {id:'outfit-ivory',name:'아이보리 팬츠',description:'차분한 아이보리 와이드 팬츠',category:'outfit',price:80,icon:'👖',slot:'bottom',value:'trousers-ivory'},
  {id:'outfit-rose-shoes',name:'로즈 스니커즈',description:'발끝을 꾸미는 로즈 스니커즈',category:'outfit',price:80,icon:'👟',slot:'shoes',value:'sneakers-rose'},
  ...CLOTHING_ADDITIONS.map(item=>({id:`outfit-${item.id}`,name:item.label,description:`${item.concept} 콘셉트 · 내 캐릭터에 자유롭게 조합해 보세요.`,category:'outfit' as const,price:item.price,icon:item.icon,slot:item.slot,value:item.id,concept:item.concept})),
  ...ACCESSORY_ADDITIONS.map(item=>({id:`accessory-${item.id}`,name:item.label,description:`${item.concept} 콘셉트 · 다른 부위의 장식과 함께 착용할 수 있어요.`,category:'accessory' as const,price:item.price,icon:item.icon,slot:item.slot,value:item.id,concept:item.concept})),
  {id:'emoji-party',name:'축하 이모티콘',description:'채팅과 머리 위에 축하 이모티콘 보내기',category:'emoji',price:60,icon:'🎉',emoji:'🎉 축하해요!'},
  {id:'emoji-diamond',name:'다이아 손 이모티콘',description:'채팅과 머리 위에 다이아 손 보내기',category:'emoji',price:60,icon:'💎',emoji:'💎 다이아 손!'},
  {id:'emoji-cat',name:'고양이 응원 이모티콘',description:'채팅과 머리 위에 고양이 응원 보내기',category:'emoji',price:60,icon:'😺',emoji:'😺 할 수 있어!'},
  {id:'action-dance',name:'신나는 댄스',description:'리듬에 맞춰 몸을 흔드는 액션',category:'action',price:120,icon:'🪩',action:'dance'},
  {id:'action-heart',name:'하트 보내기',description:'두 팔로 하트를 만드는 액션',category:'action',price:120,icon:'🫶',action:'heart'},
];
export interface AvatarProfile { appearance:AvatarAppearance; points:number; owned:string[]; earned:number; matches:number }
export function shopItem(id: unknown): ShopItem | undefined { return SHOP_ITEMS.find(item=>item.id===id); }
export function appearanceUnlock(key: AppearanceKey, value:string): ShopItem | undefined { return SHOP_ITEMS.find(item=>(item.category==='outfit'||item.category==='accessory')&&item.slot===key&&item.value===value); }
export function validateOwnedAppearance(value:unknown, owned:readonly string[]): AvatarAppearance {
  const appearance=validateAvatarAppearance(value);
  for(const key of Object.keys(appearance) as AppearanceKey[]) { const item=appearanceUnlock(key,appearance[key]); if(item&&!owned.includes(item.id)) throw new Error('상점에서 의상이나 액세서리를 먼저 구매해 주세요.'); }
  return appearance;
}
export function defaultAvatarProfile(): AvatarProfile { return {appearance:{...DEFAULT_APPEARANCE},points:0,owned:[],earned:0,matches:0}; }
