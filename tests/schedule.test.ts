import { describe, it, expect } from 'vitest'
import { nextRun, isOnTime } from '../server/utils/schedule'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt } from '../server/utils/crypto'
describe('daily schedule',()=>{
  it('resolves Shanghai wall time to UTC and rolls past times forward',()=>{
    expect(nextRun('09:00','Asia/Shanghai',new Date('2026-11-06T00:59:00Z'))).toBe('2026-11-06T01:00:00.000Z')
    expect(nextRun('09:00','Asia/Shanghai',new Date('2026-11-06T01:00:00Z'))).toBe('2026-11-07T01:00:00.000Z')
  })
  it('skips nonexistent DST times',()=>{expect(nextRun('02:30','America/New_York',new Date('2026-03-08T00:00:00Z'))).toBe('2026-03-09T06:30:00.000Z')})
  it('only uses first occurrence during DST fallback',()=>{
    expect(nextRun('01:30','America/New_York',new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01T05:30:00.000Z')
    expect(nextRun('01:30','America/New_York',new Date('2026-11-01T05:45:00Z'))).toBe('2026-11-02T06:30:00.000Z')
  })
  it('rejects invalid inputs and expired execution minutes',()=>{
    expect(()=>nextRun('25:61','Asia/Shanghai')).toThrow()
    expect(()=>nextRun('09:00','Invalid/Zone')).toThrow()
    expect(isOnTime('2026-11-06T01:00:00Z',new Date('2026-11-06T01:00:59Z'))).toBe(true)
    expect(isOnTime('2026-11-06T01:00:00Z',new Date('2026-11-06T01:01:00Z'))).toBe(false)
  })
})
describe('session encryption',()=>{
  it('randomizes ciphertext, restores exact session and rejects tampering or wrong keys',()=>{
    const key=randomBytes(32),plain='sensitive telegram session',a=encrypt(plain,key),b=encrypt(plain,key)
    expect(a).not.toBe(b);expect(a).not.toContain(plain);expect(decrypt(a,key)).toBe(plain)
    expect(()=>decrypt(a,randomBytes(32))).toThrow()
    const data=Buffer.from(a,'base64');data[30]=data[30]!^1
    expect(()=>decrypt(data.toString('base64'),key)).toThrow()
  })
})
