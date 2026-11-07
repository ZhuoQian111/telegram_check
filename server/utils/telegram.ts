import { TelegramClient } from '@mtcute/node'
import { MemoryStorage, tl } from '@mtcute/core'
import Long from 'long'
import QRCode from 'qrcode'
import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { settings } from './config'
import { db } from './db'
import { decrypt, encrypt } from './crypto'
import type { Chat } from '../../shared/types'

const clients = new Map<string, Promise<TelegramClient>>()
const queues = new Map<string, Promise<unknown>>()
export function serial<T>(id: string, action: () => Promise<T>): Promise<T> {
  const result = (queues.get(id) || Promise.resolve()).catch(()=>{}).then(action)
  queues.set(id,result)
  void result.finally(()=>{ if(queues.get(id)===result) queues.delete(id) }).catch(()=>{})
  return result
}
function makeClient() {
  const s = settings()
  if (!s.apiId || !s.apiHash) throw createError({statusCode:400,message:'请先配置 TELEGRAM_API_ID 和 TELEGRAM_API_HASH'})
  return new TelegramClient({ apiId:s.apiId, apiHash:s.apiHash, storage:new MemoryStorage(), logLevel:0, network:{middlewares:[(ctx,next)=>next({...ctx,params:{timeout:20_000,...ctx.params}})]} })
}
export async function clientFor(id: string) {
  if (!clients.has(id)) {
    const promise = (async()=>{
      const row = db().prepare('SELECT session FROM accounts WHERE id=?').get(id) as {session:string}|undefined
      if (!row) throw createError({statusCode:404,message:'账号不存在'})
      const c = makeClient()
      try { await c.importSession(decrypt(row.session,settings().key)); await c.getMe(); return c }
      catch(e) { await c.destroy(); throw e }
    })()
    clients.set(id,promise)
    void promise.catch(()=>clients.delete(id))
  }
  return clients.get(id)!
}
export function errorText(e: unknown) {
  if (e instanceof tl.RpcError) return e.text
  if (e instanceof Error && /^SKIPPED:/.test(e.message)) return e.message
  return '网络中断或请求结果无法确定，请检查账号连接和执行记录'
}
export async function withAccount<T>(id:string, action:(c:TelegramClient)=>Promise<T>, deadline?:number) {
  return serial(id,async()=>{
    if(deadline && Date.now()>=deadline)throw new Error('SKIPPED:超过计划分钟')
    try {
      const c=await clientFor(id)
      const result=await action(c)
      db().prepare('UPDATE accounts SET session=?,status=? WHERE id=?').run(encrypt(await c.exportSession(),settings().key),'connected',id)
      return result
    } catch(e) {
      if (e instanceof tl.RpcError && /AUTH_KEY|SESSION_|USER_DEACTIVATED/.test(e.text)) {
        db().prepare("UPDATE accounts SET status='reauth_required' WHERE id=?").run(id)
        const c=clients.get(id); clients.delete(id); if(c) await c.then(c=>c.destroy()).catch(()=>{})
      }
      throw e
    }
  })
}
export function encodePeer(peer:tl.TypeInputPeer) {
  return JSON.stringify(peer, (key,value)=> /^(userId|chatId|channelId|accessHash)$/.test(key)?String(value):value)
}
export function decodePeer(value:string):tl.TypeInputPeer {
  return JSON.parse(value,(key,v)=>key==='accessHash'?Long.fromString(v):/^(userId|chatId|channelId)$/.test(key)?Number(v):v)
}
const chatCache=new Map<string,{items:Chat[]; iterator:AsyncIterableIterator<import('@mtcute/core').Dialog>; done:boolean}>()
export async function listChats(id:string,refresh=false,loadMore=false) {
  return withAccount(id,async c=>{
    if(refresh) chatCache.delete(id)
    let state=chatCache.get(id)
    if(!state) {state={items:[],iterator:c.iterDialogs({archived:'keep'}),done:false}; chatCache.set(id,state)}
    if(!state.items.length || loadMore) {
      for(let i=0;i<100 && !state.done;i++) {
        const item=await state.iterator.next(); if(item.done){state.done=true;break}
        const p=item.value.peer
        if(p.type==='chat' && (!p.isGroup || p.isBanned || !p.isMember || (!p.isAdmin && (p.raw._==='channel' || p.raw._==='chat') && ((p.raw._==='channel' && p.raw.bannedRights?.sendMessages) || p.raw.defaultBannedRights?.sendMessages)))) continue
        if(p.type==='user' && p.isDeleted) continue
        try {
          const chat:Chat={id:String(p.id),title:p.type==='user'?p.displayName:p.title,username:p.username || '',kind:p.type==='user'?(p.isBot?'机器人':'私聊'):'群聊',peer:encodePeer(p.inputPeer)}
          if(!state.items.some(x=>x.id===chat.id)) state.items.push(chat)
        } catch { /* incomplete peers cannot be addressed safely */ }
      }
    }
    return {items:state.items,hasMore:!state.done}
  })
}
export function knownChat(id:string,chatId:string) {return chatCache.get(id)?.items.find(c=>c.id===chatId)}
type Attempt={id:string;state:string;qr?:string;expires?:number;error?:string;accountId?:string;client:TelegramClient;abort:AbortController;password?:(s:string)=>void; timer:ReturnType<typeof setTimeout>}
const attempts=new Map<string,Attempt>()
export function beginLogin() {
  if(attempts.size>=5) throw createError({statusCode:429,message:'请取消已有登录后再试'})
  const c=makeClient();const id=randomUUID();const abort=new AbortController()
  const a:Attempt={id,state:'waiting',client:c,abort,timer:setTimeout(()=>void cancelLogin(id),300_000)}
  attempts.set(id,a)
  void c.signInQr({
    abortSignal:abort.signal,
    onUrlUpdated:(url,expires)=>{ a.expires=expires.getTime(); void QRCode.toDataURL(url,{width:280,margin:2}).then(qr=>{a.qr=qr}) },
    password:()=>{a.state='password';return new Promise<string>((resolve,reject)=>{a.password=resolve;abort.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})})},
    invalidPasswordCallback:()=>{a.error='两步验证密码错误，请重试';a.state='password'},
  }).then(async user=>{
    const accountId=String(user.id)
    await serial(accountId,async()=>{
      abort.signal.throwIfAborted()
      const prior=clients.get(accountId); if(prior) await prior.then(c=>c.destroy()).catch(()=>{})
      db().prepare(`INSERT INTO accounts(id,label,username,session,status,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,username=excluded.username,session=excluded.session,status=excluded.status`).run(accountId,user.displayName,user.username||'',encrypt(await c.exportSession(),settings().key),'connected',new Date().toISOString())
      clients.set(accountId,Promise.resolve(c));chatCache.delete(accountId)
    })
    a.accountId=accountId;a.state='success';a.qr=undefined;clearTimeout(a.timer);a.timer=setTimeout(()=>attempts.delete(id),60_000)
  }).catch(async e=>{a.state='error';a.error=errorText(e);await c.destroy()})
  return {id}
}
export function loginState(id:string) {
  const a=attempts.get(id);if(!a) throw createError({statusCode:410,message:'登录已过期，请重新扫码'})
  return {id:a.id,state:a.state,qr:a.qr,expires:a.expires,error:a.error,accountId:a.accountId}
}
export function submitPassword(id:string,password:string) {
  const a=attempts.get(id);if(!a?.password || a.state!=='password') throw createError({statusCode:409,message:'当前无需输入密码'})
  const resolve=a.password;a.password=undefined;a.error=undefined;a.state='verifying';resolve(password)
}
export async function cancelLogin(id:string) {
  const a=attempts.get(id);if(!a)return
  clearTimeout(a.timer);attempts.delete(id)
  if(a.state!=='success'){a.abort.abort();await a.client.destroy()}
}
export async function removeAccount(id:string) {
  await serial(id,async()=>{
    try {const c=await clientFor(id);await c.logOut()} catch(e) {if(!(e instanceof tl.RpcError && /AUTH_KEY|SESSION_|USER_DEACTIVATED/.test(e.text)))throw e}
    const c=clients.get(id);clients.delete(id);chatCache.delete(id)
    if(c)await c.then(c=>c.destroy()).catch(()=>{})
    db().prepare('DELETE FROM accounts WHERE id=?').run(id)
  })
}
export async function shutdownTelegram(){
  await Promise.all([...attempts.keys()].map(cancelLogin))
  await Promise.all([...clients.values()].map(p=>p.then(c=>c.destroy()).catch(()=>{})))
  clients.clear()
}
export async function sendMessage(c:TelegramClient,peer:string,text:string,randomId:string,signal:AbortSignal) {
  return c.sendText(decodePeer(peer),text,{randomId:Long.fromString(randomId),abortSignal:signal,disableWebPreview:true})
}
