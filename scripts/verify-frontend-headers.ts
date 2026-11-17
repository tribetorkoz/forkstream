import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { frontendResponseHeaders } from '../server/security/frontendHeaders.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await fs.readFile(path.join(root, 'server/index.ts'), 'utf8')
assert.match(server, /\.\.\.frontendResponseHeaders\(getMime\(finalPath\), isHtml\)/,
  'the built app shell must receive the shared security headers')

const htmlResponse = new Response('<html></html>', {
  headers: frontendResponseHeaders('text/html; charset=utf-8', true),
})
const csp = htmlResponse.headers.get('content-security-policy') ?? ''
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "frame-src 'self'",
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
]) assert.ok(csp.includes(directive), `frontend CSP must include ${directive}`)
assert.doesNotMatch(csp, /unsafe-eval|\*\s*;/)
assert.equal(htmlResponse.headers.get('x-frame-options'), 'DENY')
assert.equal(htmlResponse.headers.get('x-content-type-options'), 'nosniff')
assert.equal(htmlResponse.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
assert.equal(htmlResponse.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()')

const assetResponse = new Response('asset', {
  headers: frontendResponseHeaders('text/javascript; charset=utf-8', false),
})
assert.equal(assetResponse.headers.get('content-security-policy'), null)
assert.equal(assetResponse.headers.get('x-content-type-options'), 'nosniff')

console.log('Frontend headers passed: restrictive app-shell CSP, no framing, strict MIME/referrer/permissions headers, and nosniff assets.')
