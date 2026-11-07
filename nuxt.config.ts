export default defineNuxtConfig({
  compatibilityDate: '2026-11-06',
  devtools: { enabled: false },
  ssr: false,
  css: ['~/assets/main.css'],
  nitro: { preset: 'node-server', externals: { external: ['better-sqlite3', '@mtcute/node', '@mtcute/core'] } },
  app: { head: { title: 'Telegram Daily · 定时发送', htmlAttrs: { lang: 'zh-CN' }, meta: [{ name: 'description', content: '个人 Telegram 多账号定时发送管理台' }] } },
})
