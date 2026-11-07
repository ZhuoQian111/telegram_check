import { readFileSync } from 'node:fs'
const schema=readFileSync('server/utils/db.ts','utf8')
const dictionary=readFileSync('api/DATABASE_DICTIONARY.md','utf8')
const tables=[...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]).sort()
const documented=[...dictionary.matchAll(/^## \d+\. (\w+)$/gm)].map(m=>m[1]).sort()
if(JSON.stringify(tables)!==JSON.stringify(documented))throw new Error(`Dictionary mismatch: ${tables} vs ${documented}`)
console.log(`Dictionary coverage: ${tables.length}/${tables.length} tables`)
