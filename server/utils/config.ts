export function settings() {
  const key = Buffer.from(process.env.SESSION_ENCRYPTION_KEY || '', 'base64')
  const password = process.env.ADMIN_PASSWORD || ''
  if (key.length !== 32 || password.length < 16) throw new Error('请配置 32 字节 Base64 SESSION_ENCRYPTION_KEY 和至少 16 字符的 ADMIN_PASSWORD')
  const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin
  return { key, password, origin, apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH || '', enabled: process.env.SCHEDULER_ENABLED === 'true' }
}
