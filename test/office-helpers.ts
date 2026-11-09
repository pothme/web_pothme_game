import assert from 'node:assert/strict';
import type { Miniflare, WebSocket as LocalSocket } from 'miniflare';
export type Message = Record<string, any>;
export const origin = 'http://podeumgo.test', password = 'podeumgo-local-fixture-admin-2026-only';
export async function identity(mf: Miniflare) { return (await mf.dispatchFetch(`${origin}/api/session`)).headers.get('set-cookie')!.split(';')[0]!; }
export function observe(socket: LocalSocket) {
 const messages:Message[]=[],listeners=new Set<()=>void>();
 socket.addEventListener('message',event=>{messages.push(JSON.parse(String(event.data)));for(const listener of listeners)listener();});socket.accept();
 return {socket,messages,send(value:Message){socket.send(JSON.stringify(value));},wait(predicate:(value:Message)=>boolean):Promise<Message>{return new Promise((resolve,reject)=>{
 const check=()=>{const index=messages.findIndex(predicate);if(index<0)return;clearTimeout(timer);listeners.delete(check);resolve(messages.splice(index,1)[0]!);};
 const timer=setTimeout(()=>{listeners.delete(check);reject(new Error(`Missing expected message: ${JSON.stringify(messages)}`));},5000);listeners.add(check);check();
 });}};
}
export async function join(mf:Miniflare,cookie:string,nickname='첫동료',positions:'delta'|null='delta') { const response=await mf.dispatchFetch(`${origin}/api/room?nickname=${encodeURIComponent(nickname)}${positions === 'delta' ? '&positions=delta' : ''}`,{headers:{Cookie:cookie,Origin:origin,Upgrade:'websocket'}});assert.equal(response.status,101);const client=observe(response.webSocket!);return {...client,welcome:await client.wait(value=>value.type==='welcome')}; }
export async function admin(mf:Miniflare,path:string,body?:unknown,cookie='',csrf='',extra:Record<string,string>={}) {return mf.dispatchFetch(`${origin}/api/admin/${path}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
export async function login(mf:Miniflare) {const response=await admin(mf,'login',{password});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);return {cookie:cookie.split(';')[0]!,csrf:(await response.json() as Message).csrfToken as string};}
export async function manage(mf:Miniflare,auth:{cookie:string;csrf:string},body:Record<string,unknown>) {return admin(mf,'manage',body,auth.cookie,auth.csrf);}
export async function setCharts(mf:Miniflare,auth:{cookie:string;csrf:string},symbols:string[],interval='1') {const response=await manage(mf,auth,{action:'charts',symbols,interval});assert.equal(response.status,200,await response.clone().text());return response.json()as Promise<Message>;}
