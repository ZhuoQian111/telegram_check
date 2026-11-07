import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createError, getCookie, getHeader, setCookie, deleteCookie, type H3Event } from 'h3'
import { settings } from './config'
import { db } from './db'
import { hash, token } from './crypto'
let verifier: { fingerprint: string; salt: Buffer; derived: Buffer } | undefined
export function validPassword(password: string) {
  const expected = settings().password
  const fingerprint = hash(expected)
  if (verifier?.fingerprint !== fingerprint) { const salt = randomBytes(16); verifier = { fingerprint, salt, derived: scryptSync(expected, salt, 64) } }
  return timingSafeEqual(verifier.derived, scryptSync(password, verifier.salt, 64))
}
export function checkOrigin(event: H3Event) {
  if (getHeader(event, 'origin') !== settings().origin) throw createError({ statusCode: 403, statusMessage: 'Origin rejected' })
}
export function requireAdmin(event: H3Event) {
  const session = getCookie(event, 'daily_session')
  const found = session && db().prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>? AND password_fingerprint=?').get(hash(session), Date.now(), hash(settings().password))
  if (!found) throw createError({ statusCode: 401, message:'请先登录' })
}
export function login(event: H3Event) {
  const value = token()
  db().prepare('DELETE FROM admin_sessions WHERE expires_at<?').run(Date.now())
  db().prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(hash(value), Date.now()+7*86400_000, hash(settings().password))
  setCookie(event, 'daily_session', value, { httpOnly: true, secure: settings().origin.startsWith('https:'), sameSite: 'strict', path: '/', maxAge: 7*86400 })
}
export function logout(event: H3Event) {
  db().prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hash(getCookie(event,'daily_session') || ''))
  deleteCookie(event,'daily_session',{path:'/'})
}
const attempts: number[] = []
export function limitLogin() {
  const now = Date.now()
  while (attempts.length && attempts[0]! < now-60_000) attempts.shift()
  if (attempts.length >= 10) throw createError({ statusCode: 429, message:'尝试过于频繁，请一分钟后重试' })
  attempts.push(now)
}
