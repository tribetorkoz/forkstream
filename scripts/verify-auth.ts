import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'forkstream-auth-'))
const ownerToken = 'test-owner-token-0123456789abcdef-0123456789abcdef'
process.env.FORKSTREAM_API_TOKEN = ownerToken
process.env.FORKSTREAM_DB_PATH = path.join(temp, 'db', 'auth.sqlite')
process.env.FORKSTREAM_PROJECTS_ROOT = path.join(temp, 'projects')

try {
  const { app, apiAuthenticator, databaseReady } = await import('../server/index.js')
  await databaseReady
  const denied = await app.request('http://localhost/api/system')
  assert.equal(denied.status, 401, 'protected API rejects anonymous requests')
  const previewDenied = await app.request('http://localhost/preview/nonexistent/main/')
  assert.equal(previewDenied.status, 401, 'private workspace preview rejects anonymous requests')
  const authorized = await app.request('http://localhost/api/system', { headers: { Authorization: `Bearer ${ownerToken}` } })
  assert.equal(authorized.status, 200, 'owner bearer token authorizes CLI clients')

  const hostileOrigin = await app.request('http://localhost/api/auth/unlock', {
    method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ownerToken }),
  })
  assert.equal(hostileOrigin.status, 403, 'unlock rejects hostile Origin')

  const unlock = await app.request('http://localhost/api/auth/unlock', {
    method: 'POST', headers: { Host: 'localhost', Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ownerToken }),
  })
  assert.equal(unlock.status, 200)
  const cookie = unlock.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie, 'unlock returns an HttpOnly session cookie')
  assert.match(unlock.headers.get('set-cookie') || '', /HttpOnly/)
  assert.match(unlock.headers.get('set-cookie') || '', /SameSite=Strict/)
  assert.match(apiAuthenticator.issueCookie(true), /^__Host-forkstream_auth=/)
  assert.match(apiAuthenticator.issueCookie(true), /; Secure/)
  const cookieAuthorized = await app.request('http://localhost/api/system', { headers: { Cookie: cookie! } })
  assert.equal(cookieAuthorized.status, 200, 'signed session cookie authorizes same-origin browser calls')
  assert.equal(cookieAuthorized.headers.get('access-control-allow-origin'), null, 'wildcard CORS is not enabled')
  const originlessCookieMutation = await app.request('http://localhost/api/sessions', {
    method: 'POST', headers: { Cookie: cookie!, 'Content-Type': 'application/json' }, body: '{}',
  })
  assert.equal(originlessCookieMutation.status, 403, 'cookie-authenticated state changes require Origin')
  const opaqueOriginMutation = await app.request('http://localhost/api/sessions', {
    method: 'POST', headers: { Cookie: cookie!, Origin: 'null', 'Content-Type': 'application/json' }, body: '{}',
  })
  assert.equal(opaqueOriginMutation.status, 403, 'opaque-origin preview frames cannot mutate authenticated APIs')

  const badUnlock = await app.request('http://localhost/api/auth/unlock', {
    method: 'POST', headers: { Host: 'localhost', Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'wrong token' }),
  })
  assert.equal(badUnlock.status, 401)
  console.log('Part 02 auth slice passed: anonymous API denial, bearer owner auth, same-origin signed HttpOnly/SameSite cookie, hostile-Origin rejection, and no wildcard CORS.')
} finally {
  const { closeDatabase } = await import('../server/db/database.js')
  await closeDatabase()
  // Windows can hold the WAL/SHM handles a moment past closeDatabase().
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  delete process.env.FORKSTREAM_API_TOKEN
  delete process.env.FORKSTREAM_DB_PATH
  delete process.env.FORKSTREAM_PROJECTS_ROOT
}
