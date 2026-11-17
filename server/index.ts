/**
 * ForkStream HTTP + AG-UI SSE + Live Worktree Preview Server
 *
 * Built on Hono (`github.com/honojs/hono`) + `@hono/node-server` (mirroring `simple10/agents-observe`)
 * and `@ag-ui/encoder` (`github.com/ag-ui-protocol/ag-ui`).
 * Binds to loopback by default for a single local owner; set FORKSTREAM_HOST=0.0.0.0 only when a remote preview proxy requires it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { ForkStreamOrchestrator } from './sessionOrchestrator.js'
import { injectObserverPreviewBridge } from './observer/previewInjector.js'
import { initializeDatabase, readEvents } from './db/database.js'
import { listPersistedSessions, markUnfinishedSessionsInterrupted, readPersistedSnapshot } from './db/sessionRepository.js'
import { ProjectRegistry } from './projects/projectRegistry.js'
import { z } from 'zod'
import { isSensitivePath, redactSecrets } from './security/workspaceGuard.js'
import { openWorkspaceRoot } from './security/workspaceFs.js'
import { FsSafeError } from '@openclaw/fs-safe'
import { ApiAuthenticator, isTrustedMutationOrigin } from './security/apiAuth.js'
import { previewResponseHeaders } from './security/previewHeaders.js'
import { frontendResponseHeaders } from './security/frontendHeaders.js'
import type { ConsoleTelemetryEntry, ProviderConfig, SelectedDomElement } from '../shared/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const WORKSPACES_ROOT = path.join(PROJECT_ROOT, 'workspaces')
const DIST_ROOT = path.join(PROJECT_ROOT, 'dist')
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.FORKSTREAM_HOST || '127.0.0.1'
const DATABASE_PATH = process.env.FORKSTREAM_DB_PATH || path.join(PROJECT_ROOT, 'data', 'forkstream.sqlite')
const PROJECTS_ROOT = process.env.FORKSTREAM_PROJECTS_ROOT || path.join(WORKSPACES_ROOT, 'projects')

fs.mkdirSync(WORKSPACES_ROOT, { recursive: true })
fs.mkdirSync(PROJECTS_ROOT, { recursive: true })
process.env.FORKSTREAM_API_TOKEN_FILE ??= path.join(PROJECT_ROOT, 'data', 'owner-token')
export const apiAuthenticator = new ApiAuthenticator()

export const databaseReady = initializeDatabase(DATABASE_PATH)
export const recoveryReady = databaseReady.then(() => markUnfinishedSessionsInterrupted())
export const projectRegistry = new ProjectRegistry(PROJECTS_ROOT)
export const orchestrator = new ForkStreamOrchestrator(PROJECT_ROOT, WORKSPACES_ROOT)
export const app = new Hono()

app.use('/api/*', async (c, next) => {
  const pathName = c.req.path
  const publicAuthRoute = pathName === '/api/auth/status' || pathName === '/api/auth/unlock'
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method.toUpperCase())
  const hasValidBearer = c.req.header('authorization')?.startsWith('Bearer ') === true &&
    apiAuthenticator.verifyOwnerToken(c.req.header('authorization')!.slice(7))
  const hasCookie = Boolean(c.req.header('cookie'))
  if (mutation && c.req.header('origin') && !isTrustedMutationOrigin(c.req.header('origin'), c.req.header('host'))) {
    return c.json({ error: 'Request origin is not allowed' }, 403)
  }
  if (mutation && !c.req.header('origin') && hasCookie && !hasValidBearer) {
    return c.json({ error: 'Origin header required for cookie-authenticated changes' }, 403)
  }
  if (mutation && c.req.header('sec-fetch-site') === 'cross-site') {
    return c.json({ error: 'Cross-site state-changing requests are blocked' }, 403)
  }
  if (!publicAuthRoute && !apiAuthenticator.authorize(c.req.header('authorization'), c.req.header('cookie'))) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  await recoveryReady
  await next()
})

app.get('/api/auth/status', (c) => {
  const authenticated = apiAuthenticator.authorize(c.req.header('authorization'), c.req.header('cookie'))
  return c.json({ required: true, authenticated, sessionMaxAgeSeconds: 12 * 60 * 60 })
})

app.post('/api/auth/unlock', async (c) => {
  const origin = c.req.header('origin')
  if (!origin || !isTrustedMutationOrigin(origin, c.req.header('host'))) return c.json({ error: 'A trusted Origin header is required' }, 403)
  const body = await c.req.json().catch(() => null) as { token?: unknown } | null
  if (!apiAuthenticator.verifyOwnerToken(body?.token)) return c.json({ error: 'Invalid owner token' }, 401)
  const isSecure = process.env.NODE_ENV === 'production' || c.req.url.startsWith('https:') || c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
  c.header('Set-Cookie', apiAuthenticator.issueCookie(isSecure))
  return c.json({ ok: true })
})

app.use('/preview/*', async (c, next) => {
  if (!apiAuthenticator.authorize(c.req.header('authorization'), c.req.header('cookie'))) {
    return c.text('Authentication required', 401)
  }
  await next()
})

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function getMime(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function isTextLikeAsset(filePath: string, mime: string): boolean {
  return mime.startsWith('text/') || /javascript|json|xml/.test(mime) ||
    /\.(?:html?|css|[cm]?js|json|xml|svg|txt|md|ya?ml|toml|ini|conf|sh|py|rb|go|rs|java|tsx?|jsx?|vue|svelte|sql|graphql|env|properties|log|csv|diff|patch|map)$/i.test(filePath)
}

// ── Durable Project Registry (Part 01) ────────────────────────────────────────

const projectCreateSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('new'), name: z.string().min(1).max(120) }),
  z.object({ source: z.literal('local'), path: z.string().min(1).max(4096), name: z.string().max(120).optional() }),
  z.object({ source: z.literal('clone'), url: z.string().url().max(2048), name: z.string().max(120).optional() }),
])

app.get('/api/projects', async (c) => {
  await recoveryReady
  return c.json({ projects: await projectRegistry.list() })
})

app.post('/api/projects', async (c) => {
  await recoveryReady
  const parsed = projectCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid project registration request', issues: parsed.error.issues }, 400)
  try {
    const project = parsed.data.source === 'local'
      ? await projectRegistry.registerLocal({ path: parsed.data.path, name: parsed.data.name })
      : parsed.data.source === 'clone'
        ? await projectRegistry.cloneHttps({ url: parsed.data.url, name: parsed.data.name })
        : await projectRegistry.createNew({ name: parsed.data.name })
    return c.json({ project }, 201)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Project registration failed' }, 422)
  }
})

app.get('/api/projects/:id', async (c) => {
  await recoveryReady
  const project = await projectRegistry.get(c.req.param('id'))
  if (!project) return c.json({ error: 'Project not found' }, 404)
  return c.json({ project })
})

app.post('/api/projects/:id/open', async (c) => {
  await recoveryReady
  const project = await projectRegistry.markOpened(c.req.param('id'))
  if (!project) return c.json({ error: 'Project not found' }, 404)
  return c.json({ project })
})

// ── System & Settings Endpoints ───────────────────────────────────────────────

app.get('/api/system', async (c) => {
  await databaseReady
  const info = await orchestrator.getSystemInfo()
  return c.json(info)
})

app.post('/api/settings', async (c) => {
  const body = (await c.req.json()) as Partial<ProviderConfig>
  const updated = orchestrator.updateProviderConfig(body)
  return c.json({ ok: true, provider: updated })
})

// ── Distilled Skills Pool Endpoints (VibeTrace paradigm) ──────────────────────

app.get('/api/skills', (c) => {
  return c.json({ skills: orchestrator.distiller.listSkills() })
})

app.patch('/api/skills/:skillId', async (c) => {
  const { enabled } = (await c.req.json()) as { enabled: boolean }
  const skill = orchestrator.distiller.toggleSkill(c.req.param('skillId'), Boolean(enabled))
  if (!skill) return c.json({ error: 'Skill not found' }, 404)
  return c.json({ skill })
})

// ── Session & Fork Orchestration Endpoints ────────────────────────────────────

app.get('/api/sessions', (c) => {
  return c.json({ sessions: orchestrator.listSessions() })
})

app.get('/api/sessions/history', async (c) => {
  await recoveryReady
  return c.json({ sessions: await listPersistedSessions() })
})

app.post('/api/sessions', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    prompt?: string
    scenarioId?: string
    speedMultiplier?: number
    modeOverride?: ProviderConfig['mode']
  }
  const snapshot = await orchestrator.createAndStartSession(body)
  return c.json({ snapshot })
})

app.get('/api/sessions/:id', async (c) => {
  const id = c.req.param('id')
  const liveSnapshot = orchestrator.getSnapshot(id)
  if (liveSnapshot) return c.json({ snapshot: liveSnapshot, recoveryStatus: 'live' })
  await recoveryReady
  const snapshot = await readPersistedSnapshot(id)
  if (!snapshot) return c.json({ error: 'Session not found' }, 404)
  const persisted = (await listPersistedSessions()).find((session) => session.id === id)
  return c.json({ snapshot, recoveryStatus: persisted?.status === 'interrupted' ? 'interrupted' : 'stored' })
})

app.post('/api/sessions/:id/recover', async (c) => {
  await recoveryReady
  try {
    const snapshot = await orchestrator.recoverSandboxSession(c.req.param('id'))
    return c.json({ snapshot, recoveryStatus: 'resuming' }, 202)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Session recovery failed' }, 409)
  }
})

app.get('/api/sessions/:id/git-log', async (c) => {
  const s = orchestrator.getSession(c.req.param('id'))
  if (!s) return c.json({ error: 'Session not found' }, 404)
  const commits = await s.vcs.getCommitLog()
  return c.json({ commits })
})

app.get('/api/sessions/:id/transcript', async (c) => {
  await recoveryReady
  const stored = await readEvents(c.req.param('id'), 0, 5000)
  const events = stored.length
    ? stored.map((event) => event.payload)
    : orchestrator.bus.readTranscript(c.req.param('id'))
  return c.json({ events })
})

app.post('/api/sessions/:id/control', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json()) as { paused?: boolean; speedMultiplier?: number }
  let snapshot = orchestrator.getSnapshot(id) ?? null
  if (typeof body.paused === 'boolean') {
    snapshot = orchestrator.setPauseState(id, body.paused)
  }
  if (typeof body.speedMultiplier === 'number') {
    snapshot = orchestrator.setSpeed(id, body.speedMultiplier)
  }
  if (!snapshot) return c.json({ error: 'Session not found' }, 404)
  return c.json({ snapshot })
})

app.post('/api/sessions/:id/fork', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json()) as {
    userPrompt: string
    fromCheckpointId?: string
    selectedElement?: SelectedDomElement
  }
  if (!body.userPrompt || !body.userPrompt.trim()) {
    return c.json({ error: 'userPrompt is required' }, 400)
  }
  try {
    const fork = await orchestrator.spawnFork(id, {
      userPrompt: body.userPrompt.trim(),
      fromCheckpointId: body.fromCheckpointId,
      selectedElement: body.selectedElement,
    })
    return c.json({ fork })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

app.post('/api/sessions/:id/telemetry', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as {
    level: ConsoleTelemetryEntry['level']
    message: string
    source: string
    fileHint?: string
  } | null
  if (body?.message) {
    orchestrator.recordTelemetry(id, body)
  }
  return c.json({ ok: true })
})

// ── Standardized AG-UI v1.0 SSE Event Stream ──────────────────────────────────

app.get('/api/sessions/:id/events', (c) => {
  const sessionId = c.req.param('id')
  const initial = orchestrator.getSnapshot(sessionId)
  if (!initial) return c.json({ error: 'Session not found' }, 404)

  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const subId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
      cleanup = orchestrator.bus.subscribe(
        sessionId,
        {
          id: subId,
          send: (frame: string) => {
            controller.enqueue(encoder.encode(frame))
          },
          close: () => {
            try {
              controller.close()
            } catch {}
          },
        },
        initial,
      )

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ag-ui-heartbeat\n\n'))
        } catch {
          if (heartbeat) clearInterval(heartbeat)
        }
      }, 15_000)
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
      if (cleanup) cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': orchestrator.bus.getContentType(),
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

// ── Live Worktree Preview Server (Main & Parallel Fork Worktrees) ─────────────

async function serveWorktreeAsset(
  rootDir: string,
  subPath: string,
  sessionId: string,
  source: 'main' | string,
): Promise<Response> {
  const cleanRel = subPath || 'index.html'
  const isHtml = /\.html?$/i.test(cleanRel)
  if (cleanRel.split('/').some((part) => part.startsWith('.') || part === 'node_modules') || isSensitivePath(cleanRel)) {
    return new Response('Workspace path denied by security policy', { status: 403 })
  }

  let safeRoot
  try {
    safeRoot = await openWorkspaceRoot(rootDir)
  } catch {
    return new Response('Workspace unavailable', { status: 503 })
  }

  const mime = getMime(cleanRel)
  const textual = isHtml || isTextLikeAsset(cleanRel, mime)
  let body: string | Buffer
  try {
    body = textual
      ? redactSecrets(await safeRoot.readText(cleanRel))
      : await safeRoot.readBytes(cleanRel)
  } catch (error) {
    if (error instanceof FsSafeError && error.category === 'policy') {
      return new Response('Workspace path denied by security policy', { status: 403 })
    }
    if (!(error instanceof FsSafeError) || error.code !== 'not-found') {
      return new Response('Workspace asset unavailable', { status: 503 })
    }
    if (cleanRel === 'index.html') {
      // Graceful live placeholder while Builder finishes Step 1 (e.g. tokens.css)
      const waitingHtml = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><style>
        body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090d16;color:#94a3b8;font-family:system-ui,sans-serif;text-align:center;padding:24px;}
        .pulse{width:12px;height:12px;border-radius:50%;background:#22d3ee;margin:0 auto 14px;animation:p 1.2s infinite;}
        @keyframes p{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.6);opacity:.4}}
        h3{color:#e2e8f0;font-size:15px;margin:0 0 6px;} p{font-size:13px;margin:0;}
      </style></head><body><div><div class="pulse"></div><h3>الوكيل المشاهد يجهّز البث الحي للنتيجة...</h3><p>يكتب الوكيل الأول ملفات التأسيس الآن — ستظهر الواجهة تلقائياً خلال لحظات.</p></div></body></html>`
      return new Response(waitingHtml, {
        headers: previewResponseHeaders('text/html; charset=utf-8', true),
      })
    }
    return new Response('/* Pending asset creation by Builder Agent */', {
      status: 200,
      headers: previewResponseHeaders(getMime(cleanRel), isHtml),
    })
  }

  if (isHtml) {
    body = injectObserverPreviewBridge(body as string, sessionId, source)
  }
  const responseBody = Buffer.isBuffer(body) ? new Uint8Array(body) : body
  return new Response(responseBody, {
    headers: previewResponseHeaders(isHtml ? 'text/html; charset=utf-8' : mime, isHtml),
  })
}

app.get('/preview/:sessionId/main', (c) =>
  c.redirect(`/preview/${c.req.param('sessionId')}/main/`),
)

app.get('/preview/:sessionId/main/*', (c) => {
  const sessionId = c.req.param('sessionId')
  const s = orchestrator.getSession(sessionId)
  if (!s) return c.text('Session not found', 404)
  const prefix = `/preview/${sessionId}/main/`
  const subPath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : 'index.html'
  return serveWorktreeAsset(s.vcs.mainDir, subPath, sessionId, 'main')
})

app.get('/preview/:sessionId/fork/:forkId', (c) =>
  c.redirect(`/preview/${c.req.param('sessionId')}/fork/${c.req.param('forkId')}/`),
)

app.get('/preview/:sessionId/fork/:forkId/*', (c) => {
  const sessionId = c.req.param('sessionId')
  const forkId = c.req.param('forkId')
  const s = orchestrator.getSession(sessionId)
  if (!s) return c.text('Session not found', 404)
  const fork = s.snapshot.forks.find((f) => f.id === forkId)
  const prefix = `/preview/${sessionId}/fork/${forkId}/`
  const subPath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : 'index.html'
  // If fork already merged & cleaned up, seamlessly serve main (which now contains the merged fork!)
  const dir = fork && fs.existsSync(fork.worktreePath) ? fork.worktreePath : s.vcs.mainDir
  return serveWorktreeAsset(dir, subPath, sessionId, forkId)
})

// ── Serve Built Frontend SPA (`dist/`) ────────────────────────────────────────

app.get('*', (c) => {
  if (!fs.existsSync(DIST_ROOT)) {
    return c.text('ForkStream API running. Run `npm run build` to serve UI.', 200)
  }
  const reqPath = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\/+/, '').replace(/\.\./g, '')
  const candidate = path.join(DIST_ROOT, reqPath)
  const finalPath =
    fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(DIST_ROOT, 'index.html')

  if (!fs.existsSync(finalPath)) return c.text('Not found', 404)
  const content = fs.readFileSync(finalPath)
  const isHtml = finalPath.endsWith('.html')
  return new Response(content, {
    headers: {
      ...frontendResponseHeaders(getMime(finalPath), isHtml),
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
    },
  })
})

// Start server when run directly (skip during imported unit tests)
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  void recoveryReady.then(() => {
    serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
      console.log(`[ForkStream] Live server listening on http://${HOST}:${PORT}`)
      console.log(`[ForkStream] Runtime: Node.js ${process.versions.node}`)
      console.log(`[ForkStream] SQLite WAL database: ${DATABASE_PATH}`)
      if (apiAuthenticator.newlyCreated) {
        console.log(`[ForkStream] One-time owner unlock token: ${apiAuthenticator.token}`)
        console.log('[ForkStream] Save it securely; the value is not exposed by any API.')
      } else if (!process.env.FORKSTREAM_API_TOKEN) {
        console.log(`[ForkStream] Owner token file: ${apiAuthenticator.tokenFile} (run npm run auth:token locally to display it)`)
      }
    })
  }).catch((error) => {
    console.error('[ForkStream] Database initialization failed:', error)
    process.exitCode = 1
  })
}
