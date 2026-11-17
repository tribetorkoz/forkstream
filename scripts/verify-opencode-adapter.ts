import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { OpenCodeAdapter } from '../server/adapters/opencodeAdapter.js'

const requests: Array<{ method: string; url: string; directory?: string; authorization?: string; body?: unknown }> = []
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const rawBody = Buffer.concat(chunks).toString('utf8')
  const request = {
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    directory: req.headers['x-opencode-directory'] as string | undefined,
    authorization: req.headers.authorization,
    ...(rawBody ? { body: JSON.parse(rawBody) as unknown } : {}),
  }
  requests.push(request)

  if (req.method === 'GET' && req.url === '/global/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ healthy: true, version: 'test' }))
    return
  }
  if (req.method === 'GET' && req.url === '/global/event') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"type":"test.event","value":1}\n\n')
    return
  }
  if (req.method === 'POST' && req.url === '/session') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'session-main', title: 'Test task', directory: request.directory }))
    return
  }
  if (req.method === 'POST' && req.url === '/session/session-main/fork') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'session-fork', parentID: 'session-main', directory: request.directory }))
    return
  }
  if (req.method === 'POST' && /^\/session\/[^/]+\/message$/.test(req.url ?? '')) {
    res.writeHead(204)
    res.end()
    return
  }
  res.writeHead(404)
  res.end('not found')
})

server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
assert.ok(address && typeof address === 'object')
const controller = new AbortController()

try {
  const adapter = new OpenCodeAdapter({
    baseUrl: `http://127.0.0.1:${address.port}`,
    username: 'opencode',
    password: 'test-password',
  })
  assert.deepEqual(await adapter.checkHealth(), { ok: true, detail: '{"healthy":true,"version":"test"}' })

  const directory = '/tmp/forkstream-opencode-test'
  const main = await adapter.createSession(directory, 'Test task')
  assert.equal(main.id, 'session-main')
  await adapter.sendPrompt(main.id, directory, 'Create a minimal page', 'anthropic/claude-sonnet-4-5')
  const fork = await adapter.forkSession(main.id, { directory })
  assert.equal(fork.id, 'session-fork')
  await adapter.sendPrompt(fork.id, directory, 'Fix the page', 'anthropic/claude-haiku-4-5')

  const event = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('OpenCode SSE event timeout')), 2_000)
    adapter.subscribeEvents((value) => {
      clearTimeout(timeout)
      resolve(value)
    }, controller.signal)
  })
  assert.deepEqual(await event, { type: 'test.event', value: 1 })

  const expectedAuth = `Basic ${Buffer.from('opencode:test-password').toString('base64')}`
  assert.ok(requests.every((request) => request.authorization === expectedAuth), 'Basic auth is sent consistently')
  assert.equal(requests.find((request) => request.url === '/session')?.directory, directory)
  assert.equal(requests.find((request) => request.url === '/session/session-main/fork')?.directory, directory)
  const messages = requests.filter((request) => request.url.endsWith('/message'))
  assert.equal(messages.length, 2)
  assert.deepEqual((messages[0]?.body as { model?: unknown }).model, {
    providerID: 'anthropic', modelID: 'claude-sonnet-4-5',
  })
  assert.deepEqual((messages[1]?.body as { model?: unknown }).model, {
    providerID: 'anthropic', modelID: 'claude-haiku-4-5',
  })
  console.log('OpenCode adapter passed: health, session creation, fork, prompt/model payloads, worktree directory headers, Basic auth, and SSE events.')
} finally {
  controller.abort()
  server.close()
  await once(server, 'close')
}
