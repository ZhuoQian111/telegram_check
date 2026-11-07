import { defineEventHandler, getRouterParam, getMethod, readBody, getQuery, setHeader, createError } from 'h3'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { db } from '../utils/db'
import { settings } from '../utils/config'
import { checkOrigin, requireAdmin, validPassword, login, logout, limitLogin } from '../utils/auth'
import { beginLogin, loginState, submitPassword, cancelLogin, listChats, knownChat, removeAccount, errorText } from '../utils/telegram'
import { nextRun } from '../utils/schedule'
import { claim, execute } from '../utils/runner'
import type { Task } from '../../shared/types'
const taskInput=z.object({name:z.string().trim().min(1).max(100),account_id:z.string().min(1),chat_id:z.string().min(1),text:z.string().min(1).max(4096).refine(s=>s.trim().length>0),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timezone:z.string().min(1).max(100),enabled:z.boolean()})
export default defineEventHandler(async event=>{
  setHeader(event,'Cache-Control','no-store')
  setHeader(event,'X-Content-Type-Options','nosniff')
  const path=(getRouterParam(event,'path') || '').split('/').filter(Boolean)
  const method=getMethod(event)
  try {
    if(method!=='GET') checkOrigin(event)
    if(path[0]==='health' && method==='GET') {db().prepare('SELECT 1').get();return {ok:true}}
    if(path.join('/')==='auth/login' && method==='POST') {
      limitLogin();const {password}=z.object({password:z.string().max(1024)}).parse(await readBody(event))
      if(!validPassword(password)) throw createError({statusCode:401,message:'管理员密码错误'})
      login(event);return {ok:true}
    }
    requireAdmin(event)
    if(path[0]==='auth') {
      if(path[1]==='session' && method==='GET')return {authenticated:true,scheduler:settings().enabled}
      if(path[1]==='logout' && method==='POST'){logout(event);return {ok:true}}
    }
    if(path[0]==='logins') {
      if(path.length===1 && method==='POST') return beginLogin()
      const id=path[1]!
      if(method==='GET')return loginState(id)
      if(method==='DELETE'){await cancelLogin(id);return {ok:true}}
      if(method==='POST' && path[2]==='password'){submitPassword(id,z.object({password:z.string().min(1).max(1024)}).parse(await readBody(event)).password);return {ok:true}}
    }
    if(path[0]==='accounts') {
      if(path.length===1 && method==='GET') return db().prepare('SELECT id,label,username,status,created_at FROM accounts ORDER BY created_at DESC').all()
      if(path[2]==='chats' && method==='GET'){const q=getQuery(event);return await listChats(path[1]!,q.refresh==='true',q.more==='true')}
      if(path.length===2 && method==='DELETE'){await removeAccount(path[1]!);return {ok:true}}
    }
    if(path[0]==='tasks') {
      const id=path[1]
      if(!id && method==='GET')return db().prepare('SELECT * FROM tasks ORDER BY created_at DESC').all()
      const existing=id?db().prepare('SELECT * FROM tasks WHERE id=?').get(id) as Task|undefined:undefined
      if(id && !existing)throw createError({statusCode:404,message:'任务不存在'})
      if(method==='POST' && path[2]==='test') {
        const body=z.object({requestId:z.uuid()}).parse(await readBody(event))
        const run=claim(existing!,new Date(),'manual',body.requestId)
        if(run)await execute(existing!,run)
        return db().prepare('SELECT * FROM runs WHERE id=?').get(body.requestId)
      }
      if(method==='DELETE' && id){db().prepare('DELETE FROM tasks WHERE id=?').run(id);return {ok:true}}
      if((!id && method==='POST') || (id && method==='PUT')) {
        const input=taskInput.parse(await readBody(event))
        const account=db().prepare('SELECT id FROM accounts WHERE id=?').get(input.account_id)
        if(!account) throw createError({statusCode:400,message:'请选择有效账号'})
        const cached=knownChat(input.account_id,input.chat_id)
        const unchanged=existing?.account_id===input.account_id && existing.chat_id===input.chat_id
        if(!cached && !unchanged)throw createError({statusCode:400,message:'请加载聊天列表后选择目标聊天'})
        const peer=cached?.peer || existing!.peer;const title=cached?.title || existing!.chat_title
        const next=nextRun(input.time,input.timezone)
        const taskId=id||randomUUID()
        db().prepare(`INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,account_id=excluded.account_id,chat_id=excluded.chat_id,chat_title=excluded.chat_title,peer=excluded.peer,text=excluded.text,time=excluded.time,timezone=excluded.timezone,enabled=excluded.enabled,next_run=excluded.next_run`).run(taskId,input.name,input.account_id,input.chat_id,title,peer,input.text,input.time,input.timezone,Number(input.enabled),next,existing?.created_at||new Date().toISOString())
        return db().prepare('SELECT * FROM tasks WHERE id=?').get(taskId)
      }
    }
    if(path[0]==='runs' && method==='GET') {
      const q=getQuery(event);const page=Math.max(1,Math.min(100000,Number(q.page)||1))
      const filters:string[]=[];const params:string[]=[]
      if(q.account){filters.push('account_id=?');params.push(String(q.account))}
      if(q.task){filters.push('task_id=?');params.push(String(q.task))}
      const where=filters.length?' WHERE '+filters.join(' AND '):''
      return {items:db().prepare(`SELECT * FROM runs${where} ORDER BY scheduled_at DESC LIMIT 50 OFFSET ?`).all(...params,(page-1)*50),total:(db().prepare(`SELECT COUNT(*) AS total FROM runs${where}`).get(...params) as {total:number}).total,page}
    }
    throw createError({statusCode:404,message:'接口不存在'})
  }catch(e){
    if(e instanceof z.ZodError)throw createError({statusCode:400,message:'请检查输入内容',data:e.issues.map(i=>({path:i.path,message:i.message}))})
    if(e && typeof e==='object' && 'statusCode' in e)throw e
    throw createError({statusCode:400,message:errorText(e)})
  }
})
