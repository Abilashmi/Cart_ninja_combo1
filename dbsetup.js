#!/usr/bin/env node

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const env = { ...process.env }

// place Sqlite3 database on volume
const source = path.resolve('/dev.sqlite')
const target = '/data/' + path.basename(source)

if (!fs.existsSync(source) && fs.existsSync('/data')) {
  fs.symlinkSync(target, source)
}

const newDb = !fs.existsSync(target)

// ✅ SAFE restore (no crash)
if (newDb && process.env.BUCKET_NAME) {
  try {
    await exec(`npx litestream restore -config litestream.yml -if-replica-exists ${target}`)
  } catch (e) {
    console.log("⚠️ Litestream restore failed, continuing:", e.message)
  }
}

// ✅ SAFE prisma migrate
// --schema is required: prisma/schema.prisma doesn't exist (only
// prisma/session/schema.prisma does, the sole Prisma-managed database in
// this app — see its own header comment). Without this flag, `prisma
// migrate deploy` fails immediately with "Could not find Prisma Schema" on
// every single boot, silently caught below, meaning the session table was
// never actually created/migrated by this script on a fresh volume.
try {
  await exec('npx prisma migrate deploy --schema=prisma/session/schema.prisma')
} catch (e) {
  console.log("⚠️ Prisma migrate failed, continuing:", e.message)
}

// 🚀 launch app (CRITICAL PART)
if (process.env.BUCKET_NAME) {
  try {
    await exec(`npx litestream replicate -config litestream.yml -exec ${JSON.stringify(process.argv.slice(2).join(' '))}`)
  } catch (e) {
    console.log("⚠️ Litestream replicate failed, running app normally:", e.message)
    await exec(process.argv.slice(2).join(' '))
  }
} else {
  await exec(process.argv.slice(2).join(' '))
}

function exec(command) {
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} failed rc=${code}`))
    })
  })
}