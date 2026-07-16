import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const userDataDir = await mkdtemp(path.join(tmpdir(), 'exedeck-smoke-'))

const child = spawn(electronPath, ['.'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SMOKE: '1',
    EXEDECK_USER_DATA_DIR: userDataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf8')
  output += text
  process.stdout.write(text)
})
child.stderr.pipe(process.stderr)

const timeout = setTimeout(() => {
  child.kill('SIGKILL')
}, 15_000)

try {
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
  if (exitCode !== 0 || !output.includes('SMOKE_OK')) {
    throw new Error(`Electron smoke test failed with exit code ${exitCode ?? 'unknown'}.`)
  }
} finally {
  clearTimeout(timeout)
  await rm(userDataDir, { recursive: true, force: true })
}
