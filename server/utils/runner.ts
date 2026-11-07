import { randomBytes, randomUUID } from 'node:crypto'
import { tl } from '@mtcute/core'
import { db } from './db'
import { nextRun, isOnTime } from './schedule'
import { withAccount, sendMessage, errorText } from './telegram'
import type { Task, Run } from '../../shared/types'
export function claim(task:Task,now:Date,kind='scheduled',id:string=randomUUID()):Run|undefined {
  const scheduled=kind==='scheduled'?task.next_run:now.toISOString()
  const randomId=randomBytes(8).readBigInt64BE().toString()
  const result=db().prepare(`INSERT OR IGNORE INTO runs(id,task_id,task_name,account_id,chat_title,scheduled_at,status,random_id,kind) VALUES (?,?,?,?,?,?,?,?,?)`).run(id,task.id,task.name,task.account_id,task.chat_title,scheduled,'pending',randomId,kind)
  if(!result.changes) return
  return db().prepare('SELECT * FROM runs WHERE id=?').get(id) as Run
}
export async function execute(task:Task,run:Run) {
  try {
    await withAccount(task.account_id,async c=>{
      const now=new Date()
      const current=db().prepare('SELECT * FROM tasks WHERE id=?').get(task.id) as Task|undefined
      if(!current || (run.kind==='scheduled' && (!current.enabled || !isOnTime(run.scheduled_at,now))))throw new Error('SKIPPED:任务已暂停、删除或超过计划分钟')
      db().prepare("UPDATE runs SET status='running',started_at=? WHERE id=?").run(now.toISOString(),run.id)
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(), Math.min(30_000,run.kind==='scheduled'?Math.max(1,Date.parse(run.scheduled_at)+60_000-Date.now()):30_000))
      try {
        const message=await sendMessage(c,task.peer,task.text,run.random_id,controller.signal)
        db().prepare("UPDATE runs SET status='success',message_id=?,finished_at=? WHERE id=?").run(String(message.id),new Date().toISOString(),run.id)
      } finally {clearTimeout(timer)}
    },run.kind==='scheduled'?Date.parse(run.scheduled_at)+60_000:undefined)
  } catch(e) {
    const skipped=e instanceof Error && e.message.startsWith('SKIPPED:')
    const status=skipped?'skipped':e instanceof tl.RpcError?'failed':'unknown'
    db().prepare('UPDATE runs SET status=?,error=?,finished_at=? WHERE id=? AND status<>?').run(status,errorText(e),new Date().toISOString(),run.id,'success')
  }
}
export function recover(now=new Date()) {
  db().prepare("UPDATE runs SET status='unknown',error='服务在执行期间重启，未自动重发',finished_at=? WHERE status IN ('running','pending')").run(now.toISOString())
  const overdue=db().prepare('SELECT * FROM tasks WHERE enabled=1 AND next_run<=?').all(now.toISOString()) as Task[]
  for(const task of overdue) {
    db().transaction(()=>{
      const run=claim(task,now)
      if(run) db().prepare("UPDATE runs SET status='skipped',error='服务离线期间错过发送时间',finished_at=? WHERE id=?").run(now.toISOString(),run.id)
      db().prepare('UPDATE tasks SET next_run=? WHERE id=?').run(nextRun(task.time,task.timezone,now),task.id)
    })()
  }
}
export async function tick(now=new Date()) {
  const due=db().prepare('SELECT * FROM tasks WHERE enabled=1 AND next_run<=? ORDER BY next_run').all(now.toISOString()) as Task[]
  await Promise.all(due.map(async task=>{
    const run=db().transaction(()=>{
      const r=claim(task,now)
      db().prepare('UPDATE tasks SET next_run=? WHERE id=?').run(nextRun(task.time,task.timezone,now),task.id)
      return r
    })()
    if(!run)return
    if(!isOnTime(task.next_run,now)){db().prepare("UPDATE runs SET status='skipped',error='超过计划分钟',finished_at=? WHERE id=?").run(now.toISOString(),run.id);return}
    await execute(task,run)
  }))
}
