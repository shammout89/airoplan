'use client';
import {createContext,useContext,useEffect,useMemo,useSyncExternalStore,type ReactNode} from 'react';
import {createAircraftCatalogStore,connectAircraftCatalogSync,type AircraftCatalogStore} from '../aircraft-catalog-store';
const CatalogContext=createContext<AircraftCatalogStore|null>(null);
export function AircraftCatalogProvider({identity,epoch,children}:{identity:string;epoch:string;children:ReactNode}){
 const store=useMemo(()=>createAircraftCatalogStore(undefined,!!identity),[identity,epoch]);
 useEffect(()=>{if(!identity)return;const disconnect=connectAircraftCatalogSync(store);return()=>{disconnect();store.cancel()}},[identity,store]);
 return <CatalogContext.Provider value={store}>{children}</CatalogContext.Provider>;
}
export function useAircraftCatalog(){const store=useContext(CatalogContext);if(!store)throw Error('يجب عرض قوائم الطائرات داخل مزود البيانات المشترك');const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);return {...snapshot,refresh:store.refresh,save:store.save}}
