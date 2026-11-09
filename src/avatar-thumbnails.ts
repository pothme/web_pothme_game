const IMAGE_SIZE=160;
const CACHE_ENTRIES=160;
const CACHE_CHARACTERS=12*1024*1024;
const IDLE_RELEASE_MS=5000;
const selector='img[data-avatar-slot][data-avatar-value]';
type Entry={image:HTMLImageElement;root:HTMLElement;slot:string;value:string;key:string;visible:boolean;disposed:boolean};
type Job={key:string;slot:string;value:string;entries:Set<Entry>};
type ThumbnailEngine={render(slot:string,value:string):string;dispose():void};
const cache=new Map<string,string>(), jobs=new Map<string,Job>(), mounts=new Set<object>();
let cacheCharacters=0, frame=0, idleTimer=0, working=false, engine:ThumbnailEngine|undefined;
let enginePromise:Promise<ThumbnailEngine>|undefined, rendererFailed=false;

function cacheGet(key:string){const src=cache.get(key);if(src){cache.delete(key);cache.set(key,src);}return src;}
function cacheSet(key:string,src:string){
  const previous=cache.get(key);if(previous)cacheCharacters-=previous.length;
  cache.delete(key);cache.set(key,src);cacheCharacters+=src.length;
  while(cache.size>CACHE_ENTRIES||cacheCharacters>CACHE_CHARACTERS){const oldest=cache.keys().next().value;if(!oldest)break;cacheCharacters-=cache.get(oldest)!.length;cache.delete(oldest);}
}
function entryIsCurrent(entry:Entry){return !entry.disposed&&entry.image.isConnected&&entry.root.contains(entry.image)&&entry.image.dataset.avatarSlot===entry.slot&&entry.image.dataset.avatarValue===entry.value;}
function entryIsVisible(entry:Entry){
  if(!entryIsCurrent(entry)||!entry.visible||document.hidden)return false;
  // display:none ancestors (including a closed dialog or hidden tab) have no rect.
  if(!entry.image.getClientRects().length)return false;
  const rect=entry.image.getBoundingClientRect();
  return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<window.innerHeight&&rect.right>0&&rect.left<window.innerWidth;
}
function applyImage(entry:Entry,src:string){if(!entryIsCurrent(entry))return;entry.image.src=src;entry.image.dataset.thumbnailState='ready';}
function applyFailure(entry:Entry){
  if(!entryIsCurrent(entry))return;
  // The UI retains its readable item label when WebGL is unavailable.
  entry.image.dataset.thumbnailState='error';
  const label=entry.image.closest('button')?.getAttribute('aria-label')||entry.image.closest('button')?.textContent?.trim()||entry.value;
  entry.image.alt=`${label} · 미리보기 준비 안 됨`;
}
function releaseEngine(){clearTimeout(idleTimer);idleTimer=0;engine?.dispose();engine=undefined;}
function idleRelease(){clearTimeout(idleTimer);if(!engine)return;idleTimer=window.setTimeout(()=>{if(!working)releaseEngine();else idleRelease();},IDLE_RELEASE_MS);}
function requestWork(){
  if(!frame&&!working&&!document.hidden&&jobs.size&&mounts.size)frame=requestAnimationFrame(()=>{frame=0;void renderNext();});
}
function enqueue(entry:Entry){
  if(!entryIsCurrent(entry))return;
  const src=cacheGet(entry.key);if(src){applyImage(entry,src);return;}
  if(entry.image.dataset.thumbnailState==='error')return;
  const job=jobs.get(entry.key)??{key:entry.key,slot:entry.slot,value:entry.value,entries:new Set<Entry>()};
  job.entries.add(entry);jobs.set(entry.key,job);entry.image.dataset.thumbnailState='loading';
  requestWork();
}
function detach(entry:Entry){
  entry.disposed=true;
  const job=jobs.get(entry.key);job?.entries.delete(entry);if(job&&!job.entries.size)jobs.delete(entry.key);
}
function pendingInput(){return (navigator as Navigator&{scheduling?:{isInputPending():boolean}}).scheduling?.isInputPending()??false;}

async function renderNext(){
  if(working||document.hidden||!mounts.size)return;
  if(pendingInput()){requestWork();return;}
  let next:Job|undefined;
  for(const [key,job]of jobs){
    for(const entry of job.entries)if(!entryIsCurrent(entry))job.entries.delete(entry);
    if(!job.entries.size){jobs.delete(key);continue;}
    if([...job.entries].some(entryIsVisible)){next=job;break;}
  }
  if(!next){idleRelease();return;}
  working=true;clearTimeout(idleTimer);idleTimer=0;
  try{
    if(rendererFailed){for(const entry of next.entries)applyFailure(entry);jobs.delete(next.key);return;}
    const renderer=await ensureEngine();
    // Loading the 3D chunk can outlive a tab change, dialog close or disposal.
    if(document.hidden||![...next.entries].some(entryIsVisible))return;
    const src=renderer.render(next.slot,next.value);cacheSet(next.key,src);
    for(const entry of next.entries)applyImage(entry,src);
    jobs.delete(next.key);
  }catch(error){
    if(!mounts.size)return;
    if(error instanceof Error&&error.name==='UnknownAppearanceChoice'){for(const entry of next.entries)applyFailure(entry);jobs.delete(next.key);}
    else{rendererFailed=true;releaseEngine();for(const job of jobs.values())for(const entry of job.entries)applyFailure(entry);jobs.clear();}
  }finally{
    working=false;
    if(!mounts.size)releaseEngine();
    else if([...jobs.values()].some(job=>[...job.entries].some(entryIsVisible)))requestWork();
    else idleRelease();
  }
}

async function ensureEngine():Promise<ThumbnailEngine>{
  if(engine)return engine;
  if(enginePromise)return enginePromise;
  const promise=createEngine();enginePromise=promise;
  try{
    const created=await promise;
    if(!mounts.size){created.dispose();throw new Error('Thumbnail view closed');}
    engine=created;return created;
  }finally{if(enginePromise===promise)enginePromise=undefined;}
}

async function createEngine():Promise<ThumbnailEngine>{
  // No WebGL or model code is downloaded until a visible card needs an image.
  const {createAvatarThumbnailRenderer}=await import('./avatar-thumbnail-renderer');
  if(!mounts.size)throw new Error('Thumbnail view closed');
  return createAvatarThumbnailRenderer(IMAGE_SIZE);
}

/** Attach once per live collection. Attribute/DOM changes and hidden tab
 * transitions are observed; dispose when its dialog or game view closes. */
export function mountAvatarThumbnails(root:HTMLElement):()=>void {
  const owner={},entries=new Map<HTMLImageElement,Entry>();
  let disposed=false,scanFrame=0;
  if(!mounts.size)rendererFailed=false;
  mounts.add(owner);
  function scan(){
    scanFrame=0;if(disposed)return;
    for(const [image,entry]of entries){if(!root.contains(image)||!image.isConnected||image.dataset.avatarSlot!==entry.slot||image.dataset.avatarValue!==entry.value){observer?.unobserve(image);detach(entry);entries.delete(image);}}
    const images=[...root.querySelectorAll<HTMLImageElement>(selector)];
    if(root.matches(selector))images.unshift(root as HTMLImageElement);
    for(const image of images){
      if(entries.has(image))continue;
      const slot=image.dataset.avatarSlot??'',value=image.dataset.avatarValue??'',entry:Entry={image,root,slot,value,key:`${slot}/${value}`,visible:false,disposed:false};
      entries.set(image,entry);image.decoding='async';image.loading='lazy';image.dataset.thumbnailState='loading';
      const cached=cacheGet(entry.key);if(cached)applyImage(entry,cached);
      else if(observer)observer.observe(image);else{entry.visible=true;enqueue(entry);}
    }
    requestWork();
  }
  function scheduleScan(){if(!disposed&&!scanFrame)scanFrame=requestAnimationFrame(scan);}
  const observer=typeof IntersectionObserver==='undefined'?undefined:new IntersectionObserver(changes=>{
    for(const change of changes){const entry=entries.get(change.target as HTMLImageElement);if(!entry)continue;entry.visible=change.isIntersecting&&change.intersectionRatio>0;if(entry.visible)enqueue(entry);}
  },{root:null,threshold:0.01});
  const mutation=new MutationObserver(scheduleScan);
  mutation.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-avatar-slot','data-avatar-value','hidden','open','class','style']});
  function visibleAgain(){if(!document.hidden){scheduleScan();for(const entry of entries.values())if(entry.visible)enqueue(entry);requestWork();}else{cancelAnimationFrame(frame);frame=0;idleRelease();}}
  document.addEventListener('visibilitychange',visibleAgain);
  if(!observer){window.addEventListener('scroll',scheduleScan,true);window.addEventListener('resize',scheduleScan);}
  scan();
  return()=>{
    if(disposed)return;disposed=true;cancelAnimationFrame(scanFrame);observer?.disconnect();mutation.disconnect();document.removeEventListener('visibilitychange',visibleAgain);
    if(!observer){window.removeEventListener('scroll',scheduleScan,true);window.removeEventListener('resize',scheduleScan);}
    for(const entry of entries.values())detach(entry);entries.clear();mounts.delete(owner);
    if(!mounts.size){cancelAnimationFrame(frame);frame=0;jobs.clear();releaseEngine();}
  };
}
