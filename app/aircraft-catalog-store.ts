import {apiFetch} from './client-fetch';
export type CatalogSnapshot={items:any[];ready:boolean;refreshing:boolean;error:string;updatedAt:string|null};
type CatalogFetch=(url:string,init?:RequestInit)=>Promise<Response>;
export function createAircraftCatalogStore(fetcher:CatalogFetch=apiFetch,enabled=true){
 let snapshot:CatalogSnapshot={items:[],ready:false,refreshing:false,error:'',updatedAt:null},sequence=0,disposed=false,pending:Promise<boolean>|null=null,controller:AbortController|null=null;
 const listeners=new Set<()=>void>(),savedListeners=new Set<()=>void>();
 const emit=(next:CatalogSnapshot)=>{snapshot=next;for(const listener of listeners)listener()};
 const getSnapshot=()=>snapshot;
 const refresh=(force=false):Promise<boolean>=>{
  if(disposed||!enabled)return Promise.resolve(false);if(pending&&!force)return pending;
  controller?.abort();controller=new AbortController();const signal=controller.signal,request=++sequence;
  emit({...snapshot,refreshing:true});
  const task=Promise.resolve().then(async()=>{try{const response=await fetcher('/api/aircraft-references',{cache:'no-store',signal}),body:any=await response.json();if(!response.ok)throw Error(body.error||'تعذر تحديث البيانات الأساسية للطائرات');if(!Array.isArray(body.items))throw Error('استجابة قوائم الطائرات غير مكتملة');if(disposed||request!==sequence)return false;emit({items:body.items,ready:true,refreshing:false,error:'',updatedAt:new Date().toISOString()});return true;}catch(error:any){if(disposed||request!==sequence)return false;emit({...snapshot,refreshing:false,error:error?.message||'تعذر تحديث قوائم الطائرات'});return false;}finally{if(request===sequence)pending=null;}});pending=task;return task;
 };
 const subscribe=(listener:()=>void)=>{listeners.add(listener);if(listeners.size===1)queueMicrotask(()=>{if(listeners.size)void refresh()});return()=>{listeners.delete(listener)}};
 const save=async(payload:any)=>{if(disposed||!enabled)throw Error('جلسة القوائم غير متاحة');const response=await fetcher('/api/aircraft-references',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),result:any=await response.json();if(!response.ok)throw Error(result.error||'تعذر حفظ التعريف');for(const listener of savedListeners)try{listener()}catch{/* Notification failure cannot undo a committed save. */}return {result,synchronized:await refresh(true)};};
 return {getSnapshot,subscribe,refresh,save,hasSubscribers:()=>listeners.size>0,cancel:()=>{sequence++;controller?.abort();pending=null;snapshot={...snapshot,refreshing:false}},onSaved:(listener:()=>void)=>{savedListeners.add(listener);return()=>{savedListeners.delete(listener)}},dispose:()=>{disposed=true;sequence++;controller?.abort();listeners.clear();savedListeners.clear();pending=null;snapshot={items:[],ready:false,refreshing:false,error:'',updatedAt:null}}};
}
export type AircraftCatalogStore=ReturnType<typeof createAircraftCatalogStore>;
export function connectAircraftCatalogSync(store:AircraftCatalogStore,host:Window&{BroadcastChannel?:typeof BroadcastChannel}=window,documentHost:Document=document){
 const channelName='aeroplan-aircraft-catalog-v1',storageKey='aeroplan.aircraft-catalog.changed';let channel:BroadcastChannel|null=null;
 const visible=()=>documentHost.visibilityState!=='hidden',refreshVisible=(force=false)=>{if(visible()&&store.hasSubscribers())void store.refresh(force)};
 const receive=(event:MessageEvent)=>{if(event.data?.type==='aircraft-catalog-changed')refreshVisible(true)};
 try{const Channel=host.BroadcastChannel;if(Channel){const opened=new Channel(channelName);opened.addEventListener('message',receive);channel=opened}}catch{channel=null}
 const publish=()=>{const message={type:'aircraft-catalog-changed',nonce:Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')};try{if(channel){channel.postMessage(message);return}}catch{/* Fall back to a storage signal. */}try{host.localStorage.setItem(storageKey,JSON.stringify(message))}catch{/* Focus and visible polling remain available without storage. */}};
 const storage=(event:StorageEvent)=>{if(event.key===storageKey&&event.newValue)refreshVisible(true)},foreground=()=>refreshVisible();
 host.addEventListener('focus',foreground);host.addEventListener('storage',storage);documentHost.addEventListener('visibilitychange',foreground);
 const timer=host.setInterval(()=>refreshVisible(),15000),offSaved=store.onSaved(publish);
 return()=>{offSaved();host.clearInterval(timer);host.removeEventListener('focus',foreground);host.removeEventListener('storage',storage);documentHost.removeEventListener('visibilitychange',foreground);channel?.close()};
}
