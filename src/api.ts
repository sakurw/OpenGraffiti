import type { Revision } from './types';
export class ApiError extends Error { code:string; constructor(code:string,message:string){super(message);this.code=code;} }
export async function api<T>(url:string,body?:unknown):Promise<T> {
 const response=await fetch('/api/v1'+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${sessionStorage.getItem('og-token')||''}`},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(!response.ok){const error=await response.json();const requestId=error.requestId||response.headers.get('x-request-id');throw new ApiError(error.code,`${error.message} [HTTP ${response.status} / ${error.code}${requestId?' / '+requestId:''}]`);} return response.json();
}
export function progress(r:Revision,at:number){return r.no===0?1000:Math.max(0,Math.min(1000,Math.floor((at-r.start)/15)));}
export function stage(p:number){return p<333?'鮮明':p<667?'色あせ':p<1000?'輪郭のみ':'元の壁面';}
export function renderUrl(r:Revision,at:number){return `/api/v1/renders/${r.id}?p=${progress(r,at)}`;}
export function revisionAt(rs:Revision[],at:number){return [...rs].reverse().find(r=>r.start<=at&&(r.end===null||at<r.end))||rs[0];}
export function jst(t:number){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(t);}
export function dateInput(t:number){return new Date(t+9*3600000).toISOString().slice(0,19);}
export function readDate(v:string){return Date.parse(v+'+09:00');}
export function loadImage(url:string):Promise<HTMLImageElement>{return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('作品画像を読み込めませんでした。'));image.src=url;});}
