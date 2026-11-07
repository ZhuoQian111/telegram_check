import { it, expect, beforeEach, afterAll, vi } from 'vitest'
import { createApp, toWebHandler, eventHandler } from 'h3'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
vi.mock('../server/utils/telegram',()=>({
 beginLogin:()=>({id:'qr-1'}),loginState:()=>({state:'waiting'}),submitPassword:vi.fn(),cancelLogin:vi.fn(),
 listChats:async()=>({items:[],hasMore:false}),knownChat:(account:string,chat:string)=>account==='a'&&chat==='c'?{peer:'{}',title:'My chat'}:undefined,
 removeAccount:vi.fn(),errorText:()=> '请求失败',withAccount:vi.fn(),sendMessage:vi.fn(),
}))
const directory=mkdtempSync(join(tmpdir(),'telegram-daily-api-'))
process.env.DATABASE_PATH=join(directory,'app.sqlite')
process.env.ADMIN_PASSWORD='api-test-password-12345'
process.env.SESSION_ENCRYPTION_KEY=randomBytes(32).toString('base64')
process.env.APP_ORIGIN='https://test.example'
const {db}=await import('../server/utils/db')
const {default:handler}=await import('../server/api/[...path]')
const app=createApp().use(eventHandler(event=>{event.context.params={path:event.path.split('?')[0]!.replace('/api/','')};return handler(event)}))
const request=toWebHandler(app)
let cookie=''
async function call(path:string,method='GET',body?:unknown,origin='https://test.example'){
 const res=await request(new Request('https://test.example/api/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined}))
 if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie')!.split(';')[0]!
 return {status:res.status,body:await res.json()}
}
async function login(){return call('auth/login','POST',{password:process.env.ADMIN_PASSWORD})}
beforeEach(()=>{cookie='';db().exec('DELETE FROM runs;DELETE FROM tasks;DELETE FROM accounts;DELETE FROM admin_sessions;')})
afterAll(()=>{db().close();rmSync(directory,{recursive:true,force:true})})
it('protects private APIs, rejects incorrect password and cross-site writes',async()=>{
 expect((await call('accounts')).status).toBe(401)
 expect((await call('auth/login','POST',{password:'wrong'})).status).toBe(401)
 expect((await call('auth/login','POST',{password:process.env.ADMIN_PASSWORD},'https://evil.example')).status).toBe(403)
 await login();expect((await call('accounts')).status).toBe(200)
 await call('auth/logout','POST');expect((await call('tasks')).status).toBe(401)
})
it('creates, edits, pauses and deletes an authorized task, excluding account session secrets',async()=>{
 db().prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run('a','My account','','secret','connected',new Date().toISOString())
 await login()
 expect(JSON.stringify((await call('accounts')).body)).not.toContain('secret')
 const input={name:'签到',account_id:'a',chat_id:'c',text:'/checkin\nHello 👋',time:'09:00',timezone:'Asia/Shanghai',enabled:true}
 const created=await call('tasks','POST',input);expect(created.status).toBe(200);expect(created.body.chat_title).toBe('My chat')
 const id=created.body.id
 expect((await call('tasks/'+id,'PUT',{...input,enabled:false})).body.enabled).toBe(0)
 expect((await call('tasks/'+id,'DELETE')).status).toBe(200)
 expect((await call('tasks')).body).toEqual([])
})
it('rejects cross-account peer injection and invalid input',async()=>{
 db().prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run('a','A','','secret','connected',new Date().toISOString());await login()
 const input={name:'Task',account_id:'a',chat_id:'unloaded-chat',text:'hello',time:'09:00',timezone:'Asia/Shanghai',enabled:true,peer:'arbitrary'}
 expect((await call('tasks','POST',input)).status).toBe(400)
 expect((await call('tasks','POST',{...input,text:''})).status).toBe(400)
 expect((await call('tasks','POST',{...input,chat_id:'c',time:'99:99'})).status).toBe(400)
})
