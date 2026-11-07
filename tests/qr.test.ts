import { it,expect,vi,afterEach,afterAll } from 'vitest'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
const mock=vi.hoisted(()=>({params:null as any,finish:null as any,destroy:vi.fn()}))
vi.mock('@mtcute/node',()=>({TelegramClient:class {
 signInQr(params:any){mock.params=params;return new Promise(resolve=>{mock.finish=resolve})}
 exportSession(){return Promise.resolve('test-private-session')}
 destroy(){mock.destroy();return Promise.resolve()}
}}))
vi.mock('qrcode',()=>({default:{toDataURL:async(url:string)=>'data:'+url}}))
const directory=mkdtempSync(join(tmpdir(),'telegram-daily-qr-'))
process.env.DATABASE_PATH=join(directory,'app.sqlite')
process.env.ADMIN_PASSWORD='qr-test-password-123456'
process.env.SESSION_ENCRYPTION_KEY=randomBytes(32).toString('base64')
process.env.TELEGRAM_API_ID='123456';process.env.TELEGRAM_API_HASH='test-only'
const {beginLogin,loginState,submitPassword,cancelLogin,shutdownTelegram}=await import('../server/utils/telegram')
const {db}=await import('../server/utils/db')
const {decrypt}=await import('../server/utils/crypto')
const {settings}=await import('../server/utils/config')
let active=''
afterEach(async()=>{if(active)await cancelLogin(active);active=''})
afterAll(async()=>{await shutdownTelegram();db().close();rmSync(directory,{recursive:true,force:true})})
it('refreshes QR URLs and supports two-step password retry without persistence',async()=>{
 active=beginLogin().id
 mock.params.onUrlUpdated('tg://login?token=first',new Date(Date.now()+30_000));await Promise.resolve()
 expect(loginState(active).qr).toBe('data:tg://login?token=first')
 mock.params.onUrlUpdated('tg://login?token=second',new Date(Date.now()+30_000));await Promise.resolve()
 expect(loginState(active).qr).toBe('data:tg://login?token=second')
 const first=mock.params.password();expect(loginState(active).state).toBe('password');submitPassword(active,'incorrect');expect(await first).toBe('incorrect')
 mock.params.invalidPasswordCallback();expect(loginState(active).error).toContain('错误')
 const second=mock.params.password();submitPassword(active,'right');expect(await second).toBe('right')
 expect(JSON.stringify(loginState(active))).not.toContain('right')
})
it('encrypts session and upserts the same Telegram account',async()=>{
 active=beginLogin().id;mock.finish({id:42,displayName:'Test',username:'test'});await new Promise(r=>setTimeout(r,30))
 expect(loginState(active).state).toBe('success')
 const row=db().prepare('SELECT session FROM accounts WHERE id=?').get('42') as {session:string}
 expect(row.session).not.toContain('test-private-session');expect(decrypt(row.session,settings().key)).toBe('test-private-session')
 await cancelLogin(active);active=beginLogin().id;mock.finish({id:42,displayName:'Updated',username:'test'});await new Promise(r=>setTimeout(r,30))
 expect(db().prepare('SELECT COUNT(*) count FROM accounts').get()).toEqual({count:1})
 expect(db().prepare('SELECT label FROM accounts').get()).toEqual({label:'Updated'})
})
