import { describe, it, expect, vi, beforeEach } from 'vitest'
import Long from 'long'
import { encodePeer, decodePeer, serial } from '../server/utils/telegram'
describe('Telegram addressing and account isolation',()=>{
 it('persists 64-bit access hash without precision loss',()=>{
  const peer={_:'inputPeerUser' as const,userId:1234567890,accessHash:Long.fromString('9223372036854775806')}
  const encoded=encodePeer(peer)
  expect(JSON.parse(encoded).accessHash).toBe('9223372036854775806')
  expect(JSON.parse(encoded).userId).toBe('1234567890')
  const restored=decodePeer(encoded)
  expect(restored).toEqual(peer)
 })
 it('serializes work on one account but permits another account to progress',async()=>{
  const order:string[]=[];let release!:()=>void
  const barrier=new Promise<void>(resolve=>{release=resolve})
  const a=serial('a',async()=>{order.push('a-start');await barrier;order.push('a-end')})
  const a2=serial('a',async()=>{order.push('a-next')})
  await serial('b',async()=>{order.push('b')})
  expect(order).toEqual(['a-start','b']);release();await Promise.all([a,a2])
  expect(order).toEqual(['a-start','b','a-end','a-next'])
 })
 it('recovers the queue after a rejected call',async()=>{await expect(serial('c',async()=>{throw new Error('failed')})).rejects.toThrow('failed');expect(await serial('c',async()=>42)).toBe(42)})
})
