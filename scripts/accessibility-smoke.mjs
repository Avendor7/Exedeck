import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import WebSocket from 'ws'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
const userDataDir = await mkdtemp(path.join(tmpdir(), 'exedeck-a11y-'))
const debugPort = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      reject(new Error('Could not allocate a debugging port.'))
      return
    }
    server.close(() => resolve(address.port))
  })
})

await writeFile(
  path.join(userDataDir, 'exedeck.config.json'),
  JSON.stringify({
    schemaVersion: 5,
    onboardingCompleted: true,
    projects: [
      {
        id: 'a11y-project',
        name: 'Example workspace',
        path: process.cwd(),
        framework: 'custom',
        autoStart: false,
        tasks: [
          {
            id: 'a11y-task',
            name: 'Development server',
            command: 'npm',
            args: ['run', 'start'],
            cwd: process.cwd(),
            autoStart: false,
          },
        ],
      },
    ],
    agentWorkspaces: [],
  }),
  'utf8',
)

const child = spawn(electronPath, ['.', `--remote-debugging-port=${debugPort}`], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ACCESSIBILITY_TEST: '1',
    EXEDECK_USER_DATA_DIR: userDataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)

let socket
const pending = new Map()
let nextId = 1

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function getRendererPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page) return page
    } catch {
      // Electron may still be starting.
    }
    await delay(100)
  }
  throw new Error('Timed out waiting for the Electron renderer.')
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text)
  }
  return response.result.value
}

async function waitFor(expression) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await evaluate(`Boolean(${expression})`)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

async function runAxe(label) {
  const result = JSON.parse(
    await evaluate('axe.run(document, { resultTypes: ["violations"] }).then((result) => JSON.stringify(result))', true),
  )
  if (result.violations.length > 0) {
    const summary = result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    }))
    throw new Error(`${label} has accessibility violations:\n${JSON.stringify(summary, null, 2)}`)
  }
  process.stdout.write(`A11Y_OK ${label}\n`)
}

try {
  const page = await getRendererPage()
  socket = new WebSocket(page.webSocketDebuggerUrl)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  await send('Runtime.enable')
  await waitFor('document.querySelector(".main-panel")')
  await evaluate(axeSource)

  await runAxe('workspace')
  await evaluate('document.querySelector(".workspace-project-row .icon-button").click()')
  await waitFor('document.querySelector("[aria-labelledby=settings-title]")')
  await runAxe('settings')
  await evaluate('document.querySelector(".subtle-danger").click()')
  await waitFor('document.querySelector("[role=alertdialog]")')
  await runAxe('delete confirmation')
} finally {
  socket?.close()
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000).then(() => child.kill('SIGKILL')),
  ])
  await rm(userDataDir, { recursive: true, force: true })
}
