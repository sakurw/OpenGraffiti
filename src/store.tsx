import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { api } from './api';
import type { Snapshot, Document, Failure } from './types';
interface Store { state:Snapshot|null; error:string; refresh:()=>Promise<void>; doc:Document|null; setDoc:(d:Document|null)=>void; notify:(s:string)=>void; failure:Failure; setFailure:(f:Failure)=>void; authenticated:boolean; setAuthenticated:(v:boolean)=>void; }
const Context=createContext<Store>(null!);
export const useApp=()=>useContext(Context);
export function Provider({children}:{children:ReactNode}){
 const [state,setState]=useState<Snapshot|null>(null),[error,setError]=useState(''),[doc,setDoc]=useState<Document|null>(null),[toast,setToast]=useState(''),[failure,setFailure]=useState<Failure>(''),[authenticated,setAuthenticated]=useState(!!sessionStorage.getItem('og-token'));
 const noticeTimer=useRef<ReturnType<typeof setTimeout>>(undefined),latest=useRef<Snapshot|null>(null),loading=useRef(false);
 const notify=(s:string)=>{clearTimeout(noticeTimer.current);setToast(s);noticeTimer.current=setTimeout(()=>setToast(''),4500);};
 const refresh=async()=>{if(loading.current)return;loading.current=true;try{if(failure==='bootstrap')throw new Error('起動データの取得に失敗しました（確認用）。');const value=await api<Snapshot>('/bootstrap');latest.current=value;setState(value);setError('');}catch(e){setError((e as Error).message);}finally{loading.current=false;}};
 useEffect(()=>{void refresh();const timer=setInterval(async()=>{try{const c=await api<Pick<Snapshot,'scenarioId'|'stateVersion'|'now'|'playing'|'speed'>>('/clock');if(!latest.current||latest.current.scenarioId!==c.scenarioId||latest.current.stateVersion!==c.stateVersion){await refresh();}else if(c.now!==latest.current.now||c.playing!==latest.current.playing){const next={...latest.current,...c};latest.current=next;setState(next);}}catch{await refresh();}},state?.playing?500:2000);return()=>clearInterval(timer);},[failure,state?.playing]);
 useEffect(()=>{if(!localStorage.getItem('og-session'))localStorage.setItem('og-session',crypto.randomUUID());},[]);
 return <Context.Provider value={{state,error,refresh,doc,setDoc,notify,failure,setFailure,authenticated,setAuthenticated}}>{children}{toast&&<div className="toast" role="status">{toast}</div>}</Context.Provider>;
}
