// Run inside the built image or locally after npm install. Uses SQLite's online backup API.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
const require = createRequire(existsSync('.output/server/package.json') ? resolve('.output/server/package.json') : resolve('package.json'))
const Database = require('better-sqlite3')
const destination = process.argv[2]
if (!destination) throw new Error('Usage: node scripts/backup.mjs /data/backup.sqlite')
const db = new Database(process.env.DATABASE_PATH || './data/app.sqlite', { readonly: true })
try { await db.backup(destination); console.log('Backup completed') } finally { db.close() }
