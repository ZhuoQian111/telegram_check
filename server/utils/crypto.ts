import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
export function encrypt(value: string, key: Buffer) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}
export function decrypt(value: string, key: Buffer) {
  const data = Buffer.from(value, 'base64')
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
  cipher.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const token = () => randomBytes(32).toString('base64url')
