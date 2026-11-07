import { afterEach, describe, expect, it, vi } from 'vitest'
import { settings } from '../server/utils/config'

afterEach(() => vi.unstubAllEnvs())

function configure(password = '1234567890') {
  vi.stubEnv('SESSION_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'))
  vi.stubEnv('ADMIN_PASSWORD', password)
  vi.stubEnv('APP_ORIGIN', '')
}

describe('startup configuration', () => {
  it('allows a 10-character password and first deployment without a public origin', () => {
    configure()
    expect(settings().password).toBe('1234567890')
    expect(settings().origin).toBe('http://localhost:3000')
  })

  it('rejects a 9-character password and names the failing variable', () => {
    configure('123456789')
    expect(() => settings()).toThrow('至少 10 字符的 ADMIN_PASSWORD')
  })

  it('continues to accept longer passwords', () => {
    configure('a-longer-admin-password')
    expect(settings().password).toBe('a-longer-admin-password')
  })

  it('retains the 32-byte encryption key requirement', () => {
    configure()
    vi.stubEnv('SESSION_ENCRYPTION_KEY', Buffer.alloc(31, 1).toString('base64'))
    expect(() => settings()).toThrow('32 字节的 SESSION_ENCRYPTION_KEY')
  })

  it('uses the configured public origin after deployment', () => {
    configure()
    vi.stubEnv('APP_ORIGIN', 'https://deployed.example/')
    expect(settings().origin).toBe('https://deployed.example')
  })
})
