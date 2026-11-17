import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { injectObserverPreviewBridge } from '../server/observer/previewInjector.js'
import { PREVIEW_HTML_CSP, previewResponseHeaders } from '../server/security/previewHeaders.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const injected = injectObserverPreviewBridge('<html><head></head><body><main>preview</main></body></html>', 'session-test', 'main')
assert.match(injected, /window\.parent\.postMessage/)
assert.match(injected, /FORKSTREAM_CONSOLE/)
assert.doesNotMatch(injected, /fetch\s*\(\s*['"]\/api\//, 'untrusted preview code must not make privileged same-origin API calls')

const component = await fs.readFile(path.join(root, 'src/components/LivePreviewPane.tsx'), 'utf8')
const iframes = component.match(/<iframe\b[\s\S]*?\/>/g) ?? []
assert.equal(iframes.length, 3, 'main, split-fork, and PiP previews must all be isolated')
for (const iframe of iframes) {
  assert.match(iframe, /sandbox="allow-scripts"/)
  assert.doesNotMatch(iframe, /allow-same-origin|allow-top-navigation|allow-forms/)
}
assert.match(component, /e\.origin !== 'null'/, 'bridge accepts only opaque-origin sandbox messages')
assert.match(component, /e\.source === mainIframeRef\.current\?\.contentWindow/)
assert.match(component, /e\.source === forkIframeRef\.current\?\.contentWindow/)
assert.match(component, /\/api\/sessions\/\$\{encodeURIComponent\(snapshot\.sessionId\)\}\/telemetry/,
  'telemetry is relayed by the authenticated parent rather than the preview frame')
const server = await fs.readFile(path.join(root, 'server/index.ts'), 'utf8')
assert.equal((server.match(/previewResponseHeaders\(/g) ?? []).length, 3,
  'normal HTML, index placeholders, and pending assets must all use shared preview headers')
assert.match(server, /const isHtml = \/\\.html\?\$\/i/)
assert.match(PREVIEW_HTML_CSP, /connect-src 'none'/)
assert.match(PREVIEW_HTML_CSP, /form-action 'none'/)
assert.match(PREVIEW_HTML_CSP, /frame-src 'none'/)
assert.match(PREVIEW_HTML_CSP, /worker-src 'none'/)
assert.match(PREVIEW_HTML_CSP, /sandbox allow-scripts/,
  'response-level sandbox should independently block forms, popups, and top-level navigation')
const htmlResponse = new Response('preview', {
  headers: previewResponseHeaders('text/html; charset=utf-8', true),
})
assert.match(htmlResponse.headers.get('content-security-policy') ?? '', /connect-src 'none'/)
assert.equal(htmlResponse.headers.get('referrer-policy'), 'no-referrer')
assert.equal(htmlResponse.headers.get('x-content-type-options'), 'nosniff')
const assetResponse = new Response('asset', {
  headers: previewResponseHeaders('text/css; charset=utf-8', false),
})
assert.equal(assetResponse.headers.get('content-security-policy'), null,
  'non-HTML preview assets should not inherit the document CSP')
assert.equal(assetResponse.headers.get('x-content-type-options'), 'nosniff')

console.log('Preview isolation passed: sandboxed opaque-origin frames, authenticated-parent telemetry relay, and restrictive preview CSP.')
