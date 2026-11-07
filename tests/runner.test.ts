import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { send }=vi.hoisted(()=>({send:vi.fn(async()=>({id:123}))}))
vi.mock('../server/utils/telegram',()=>({withAccount:async(_id:string,fn:Function)=>fn({}),sendMessage:send,errorText:(e:Error)=>e.message}))
const directory=mkdtempSync(join(tmpdir(),'telegram-daily-test-'))
process.env.DATABASE_PATH=join(directory,'app.sqlite')
const {db}=await import('../server/utils/db')
const {claim,execute,recover,tick}=await import('../server/utils/runner')
import type {Task} from '../shared/types'
const now=new Date('2026-11-06T01:00:15Z')
function fixture(){
 db().prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run('account','Example','','encrypted','connected',now.toISOString())
 db().prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('task','Daily','account','chat','Target','{}','/checkin','09:00','Asia/Shanghai',1,'2026-11-06T01:00:00.000Z',now.toISOString())
 return db().prepare('SELECT * FROM tasks').get() as Task
}
beforeEach(()=>{db().exec('DELETE FROM runs; DELETE FROM tasks; DELETE FROM accounts;');send.mockClear();vi.useRealTimers()})
afterAll(()=>{vi.useRealTimers();db().close();rmSync(directory,{recursive:true,force:true})})
describe('persisted scheduling',()=>{
 it('claims only once and advances next date',async()=>{
   vi.useFakeTimers();vi.setSystemTime(now);fixture();await tick(now);await tick(now)
   expect(send).toHaveBeenCalledTimes(1)
   expect((db().prepare('SELECT status,message_id FROM runs').get())).toEqual({status:'success',message_id:'123'})
   expect((db().prepare('SELECT next_run FROM tasks').get() as Task).next_run).toBe('2026-11-07T01:00:00.000Z')
 })
 it('skips overdue runs after recovery and never sends',()=>{fixture();recover(now);expect(send).not.toHaveBeenCalled();expect(db().prepare('SELECT status FROM runs').get()).toEqual({status:'skipped'})})
 it('marks interrupted sends unknown without replay',()=>{const t=fixture();const r=claim(t,now)!;db().prepare("UPDATE runs SET status='running' WHERE id=?").run(r.id);recover(now);expect(db().prepare('SELECT status FROM runs WHERE id=?').get(r.id)).toEqual({status:'unknown'});expect(send).not.toHaveBeenCalled()})
 it('does not send paused or deleted tasks even if already queued',async()=>{const t=fixture();const r=claim(t,now)!;db().prepare('UPDATE tasks SET enabled=0').run();await execute(t,r);expect(send).not.toHaveBeenCalled();expect(db().prepare('SELECT status FROM runs').get()).toEqual({status:'skipped'})})
 it('deduplicates manual requests and retains history on deletion',()=>{const t=fixture();expect(claim(t,now,'manual','request-id')).toBeTruthy();expect(claim(t,now,'manual','request-id')).toBeUndefined();db().prepare('DELETE FROM accounts').run();expect(db().prepare('SELECT COUNT(*) n FROM tasks').get()).toEqual({n:0});expect(db().prepare('SELECT task_id FROM runs').get()).toEqual({task_id:null})})
 it('skips late ticks without sending',async()=>{fixture();await tick(new Date('2026-11-06T01:01:00Z'));expect(send).not.toHaveBeenCalled();expect(db().prepare('SELECT status FROM runs').get()).toEqual({status:'skipped'})})
})
