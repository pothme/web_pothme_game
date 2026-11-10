import { createAvatarPreview } from '../src/avatar-preview';
import { DEFAULT_APPEARANCE, type AvatarAppearance } from '../shared/avatar-appearance';

/** Local visual review only. This HTML is not a Vite production entry point. */
const styles: { name: string; species: string; detail: string; colors: string[]; appearance: AvatarAppearance }[] = [
  {
    name: '가볍게 시작', species: '무료 기본 복장', detail: '흰 러닝셔츠 · 반바지 · 슬리퍼',
    colors: ['#fffdf5', '#6f8bc0', '#fff0cf', '#a86a42'],
    appearance: { ...DEFAULT_APPEARANCE, face: 'soft', hairColor: 'chestnut' },
  },
  {
    name: '스트리트 고양이', species: '의상 + 액세서리', detail: '후드 · 조거 팬츠 · 볼캡 · 백팩',
    colors: ['#ffb9a3', '#a8e3c9', '#baa0f2', '#fad097'],
    appearance: { ...DEFAULT_APPEARANCE, species:'cat', top:'hoodie-peach',bottom:'joggers-mint',shoes:'high-top-purple',headwear:'cap-mint',backwear:'backpack-mint' },
  },
  {
    name: '하늘빛 산책', species: '한복 콘셉트', detail: '생활한복 · 한복 바지 · 꽃 화관',
    colors: ['#acdaf2','#f5ecd4','#ffa9c2','#c99a6c'],
    appearance: { ...DEFAULT_APPEARANCE, face:'round',hair:'bob',hairColor:'chestnut',top:'hanbok-sky',bottom:'hanbok-pants',shoes:'maryjane-black',headwear:'flower-crown',backwear:'satchel-brown' },
  },
  {
    name: '달나라 탐험', species: '우주 콘셉트', detail: '우주복 · 문워크 부츠 · 로켓 팩',
    colors: ['#e0eaf5','#a9bcd6','#fff5ec','#ff9fb0'],
    appearance: { ...DEFAULT_APPEARANCE,species:'rabbit',skin:'porcelain',hairColor:'rose',top:'space-silver',bottom:'space-pants',shoes:'spaceboots-silver',headwear:'space-helmet',backwear:'rocket-pack' },
  },
];

const gallery = document.getElementById('gallery')!;
const previews: ReturnType<typeof createAvatarPreview>[] = [];
for (const [index, style] of styles.entries()) {
  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = `<div class="card-top"><span class="number">0${index + 1}</span><span class="species">${style.species}</span></div><div class="preview"></div><div class="card-info"><h2>${style.name}</h2><p>${style.detail}</p><div class="swatches" aria-hidden="true">${style.colors.map(color => `<span class="swatch" style="background:${color}"></span>`).join('')}<span class="swatch-label">SELECTED PALETTE</span></div></div>`;
  gallery.append(card);
  previews.push(createAvatarPreview(card.querySelector<HTMLElement>('.preview')!, style.appearance));
}

Object.assign(window, { labPreviews: previews, labStyles: styles }); // for the console: labPreviews[0].update(labStyles[1].appearance)
function disposePreviews() { previews.splice(0).forEach(preview => preview.dispose()); }
window.addEventListener('pagehide', disposePreviews, { once: true });
if (import.meta.hot) import.meta.hot.dispose(disposePreviews);
