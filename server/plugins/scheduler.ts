import { db } from '../utils/db'
import { settings } from '../utils/config'
import { recover, tick } from '../utils/runner'
import { shutdownTelegram } from '../utils/telegram'
export default defineNitroPlugin(nitro=>{
  settings();db()
  db().prepare("UPDATE runs SET status='unknown',error='服务在执行期间重启，未自动重发',finished_at=? WHERE status IN ('running','pending')").run(new Date().toISOString())
  let timer:ReturnType<typeof setInterval>|undefined
  const active=new Set<Promise<void>>()
  if(settings().enabled){
    recover()
    timer=setInterval(()=>{const pending=tick().catch(()=>console.error('Scheduler tick failed; inspect database and configuration')).finally(()=>active.delete(pending));active.add(pending)},10_000)
  }
  nitro.hooks.hook('close',async()=>{if(timer)clearInterval(timer);await Promise.all(active);await shutdownTelegram()})
})
