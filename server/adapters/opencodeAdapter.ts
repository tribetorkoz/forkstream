/**
 * OpenCode Headless Server Bridge (`opencode serve`)
 *
 * Directly adapts the verified OpenCode HTTP + SSE contract from
 * VibeTrace (`github.com/idvxlab/VibeTrace/src/services/opencodeApi.ts`)
 * and OpenCode Server OpenAPI (`dev.opencode.ai/docs/server/`):
 *  - `POST /session` with `x-opencode-directory` pointing to main or fork Git worktree
 *  - `POST /session/:id/fork` with `{ messageID? }` for instant context forking
 *  - `POST /session/:id/prompt_async` for non-blocking parallel agent execution
 *  - `GET /session/:id/diff` for structured FileDiff extraction
 *  - `GET /global/event` for streaming SSE events
 *
 * OpenCode 2.x moved the HTTP API under `/api/*` and requires HTTP Basic auth when
 * `opencode serve` prints a generated server password. The adapter detects which
 * surface the server exposes, so both the legacy (v1) and v2 contracts work:
 *  - v2: `POST /api/session` with `location.directory`, `POST /api/session/:id/prompt`
 *        with `{ text }`, `POST /api/session/:id/move` with `{ directory }`,
 *        `POST /api/session/:id/fork` with `{ before }`, `GET /api/event`.
 *  - v1: the `/session`, `/session/:id/message` and `/global/event` routes below.
 */

export interface OpenCodeSession {
  id: string
  title?: string
  parentID?: string
  directory?: string
}

export interface OpenCodeBridgeOptions {
  baseUrl: string
  username?: string
  password?: string
}

/** `GET /api/session/:id/diff` entry (OpenCode `FileDiff.Info`). */
export interface OpenCodeFileDiff {
  file: string
  patch: string
  additions: number
  deletions: number
  status: 'added' | 'deleted' | 'modified'
}

type ApiStyle = 'v2' | 'v1'

const HEALTH_TIMEOUT_MS = 3500

export class OpenCodeAdapter {
  private readonly baseUrl: string
  private readonly authHeader: Record<string, string>
  private style: ApiStyle | null = null

  constructor(opts: OpenCodeBridgeOptions) {
    this.baseUrl = (opts.baseUrl || 'http://127.0.0.1:4096').replace(/\/+$/, '')
    if (opts.password) {
      const user = opts.username || 'opencode'
      const encoded = Buffer.from(`${user}:${opts.password}`).toString('base64')
      this.authHeader = { Authorization: `Basic ${encoded}` }
    } else {
      this.authHeader = {}
    }
  }

  private headers(directory?: string, extra?: Record<string, string>): Record<string, string> {
    return {
      ...this.authHeader,
      ...(directory ? { 'x-opencode-directory': directory } : {}),
      ...extra,
    }
  }

  /**
   * Probe once per adapter instance: a JSON body on `/api/session` proves the v2
   * surface exists (v1 servers answer with a 404 or an HTML shell there).
   */
  private async apiStyle(): Promise<ApiStyle> {
    if (this.style) return this.style
    try {
      const res = await fetch(`${this.baseUrl}/api/session?limit=1`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      const contentType = res.headers.get('content-type') || ''
      this.style = contentType.includes('application/json') ? 'v2' : 'v1'
    } catch {
      this.style = 'v1'
    }
    return this.style
  }

  async checkHealth(): Promise<{ ok: boolean; detail: string }> {
    try {
      if ((await this.apiStyle()) === 'v2') {
        const res = await fetch(`${this.baseUrl}/api/session?limit=1`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        })
        if (!res.ok) {
          const hint = res.status === 401 ? ' — server password required' : ''
          return { ok: false, detail: `HTTP ${res.status}${hint}` }
        }
        return { ok: true, detail: 'OpenCode v2 API' }
      }
      const res = await fetch(`${this.baseUrl}/global/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
      const text = await res.text()
      return { ok: true, detail: text.slice(0, 120) || 'healthy' }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Unable to reach opencode serve',
      }
    }
  }

  private parseModelRef(modelRef?: string): { providerID: string; modelID: string } | undefined {
    if (!modelRef || !modelRef.includes('/')) return undefined
    const idx = modelRef.indexOf('/')
    const providerID = modelRef.slice(0, idx).trim()
    const modelID = modelRef.slice(idx + 1).trim()
    return providerID && modelID ? { providerID, modelID } : undefined
  }

  async createSession(
    directory: string,
    title: string,
    parentID?: string,
    modelRef?: string,
  ): Promise<OpenCodeSession> {
    if ((await this.apiStyle()) === 'v2') {
      const model = this.parseModelRef(modelRef)
      const res = await fetch(`${this.baseUrl}/api/session`, {
        method: 'POST',
        headers: this.headers(directory, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          title,
          ...(parentID ? { parentID } : {}),
          location: { directory },
          // v2 names the model field `id`, v1 names it `modelID`.
          ...(model ? { model: { providerID: model.providerID, id: model.modelID } } : {}),
        }),
      })
      if (!res.ok) throw new Error(`OpenCode POST /api/session failed: ${res.status} ${await res.text()}`)
      const payload = (await res.json()) as { data?: OpenCodeSession } & OpenCodeSession
      return payload.data ?? payload
    }
    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: this.headers(directory, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title, ...(parentID ? { parentID } : {}) }),
    })
    if (!res.ok) throw new Error(`OpenCode POST /session failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as OpenCodeSession
  }

  /**
   * v2 keeps the working directory on the session, so a forked session has to be
   * pointed at the isolated Git worktree before it runs any tool call.
   */
  async moveSession(sessionId: string, directory: string): Promise<void> {
    if ((await this.apiStyle()) !== 'v2') return
    const res = await fetch(`${this.baseUrl}/api/session/${encodeURIComponent(sessionId)}/move`, {
      method: 'POST',
      headers: this.headers(undefined, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ directory }),
    })
    if (!res.ok) {
      throw new Error(`OpenCode POST /api/session/:id/move failed: ${res.status} ${await res.text()}`)
    }
  }

  /**
   * Native OpenCode session fork: `POST /session/:id/fork` (mirrors VibeTrace's `forkSession`).
   */
  async forkSession(
    sessionId: string,
    options?: { messageID?: string; directory?: string },
  ): Promise<OpenCodeSession> {
    if ((await this.apiStyle()) === 'v2') {
      const res = await fetch(`${this.baseUrl}/api/session/${encodeURIComponent(sessionId)}/fork`, {
        method: 'POST',
        headers: this.headers(options?.directory, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(options?.messageID ? { before: options.messageID } : {}),
      })
      if (!res.ok) {
        throw new Error(`OpenCode POST /api/session/:id/fork failed: ${res.status} ${await res.text()}`)
      }
      const payload = (await res.json()) as { data?: OpenCodeSession } & OpenCodeSession
      return payload.data ?? payload
    }
    const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/fork`, {
      method: 'POST',
      headers: this.headers(options?.directory, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(options?.messageID ? { messageID: options.messageID } : {}),
    })
    if (!res.ok) {
      throw new Error(`OpenCode POST /session/:id/fork failed: ${res.status} ${await res.text()}`)
    }
    return (await res.json()) as OpenCodeSession
  }

  async sendPrompt(
    sessionId: string,
    directory: string,
    text: string,
    modelRef?: string,
  ): Promise<void> {
    if ((await this.apiStyle()) === 'v2') {
      // v2 takes the model when the session is created, not per prompt.
      const res = await fetch(`${this.baseUrl}/api/session/${encodeURIComponent(sessionId)}/prompt`, {
        method: 'POST',
        headers: this.headers(directory, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        throw new Error(`OpenCode POST /api/session/:id/prompt failed: ${res.status} ${await res.text()}`)
      }
      return
    }
    const modelBody = this.parseModelRef(modelRef)
    const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/message`, {
      method: 'POST',
      headers: this.headers(directory, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        ...(modelBody ? { model: modelBody } : {}),
        parts: [{ type: 'text', text }],
      }),
    })
    if (!res.ok) {
      throw new Error(`OpenCode POST /session/:id/message failed: ${res.status} ${await res.text()}`)
    }
  }

  /**
   * v2 only: `POST /api/session/:id/prompt` only *admits* the input — it returns
   * as soon as the message is enqueued. Callers that need the agent's actual
   * output must block on the experimental wait route until the loop is idle.
   */
  async waitForIdle(sessionId: string, signal?: AbortSignal, timeoutMs = 15 * 60_000): Promise<void> {
    if ((await this.apiStyle()) !== 'v2') return
    const signals = [AbortSignal.timeout(timeoutMs)]
    if (signal) signals.push(signal)
    const res = await fetch(
      `${this.baseUrl}/api/experimental/session/${encodeURIComponent(sessionId)}/wait`,
      {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.any(signals),
      },
    )
    if (!res.ok && res.status !== 204) {
      throw new Error(`OpenCode POST /api/experimental/session/:id/wait failed: ${res.status}`)
    }
  }

  /** v2 only: structured per-file diff the agent produced in this session. */
  async getDiff(sessionId: string): Promise<OpenCodeFileDiff[]> {
    if ((await this.apiStyle()) !== 'v2') return []
    const res = await fetch(`${this.baseUrl}/api/session/${encodeURIComponent(sessionId)}/diff`, {
      headers: this.headers(),
    })
    if (!res.ok) return []
    const payload = (await res.json()) as { data?: OpenCodeFileDiff[] }
    return payload.data ?? []
  }

  subscribeEvents(onEvent: (ev: Record<string, unknown>) => void, signal: AbortSignal): void {
    ;(async () => {
      const style = await this.apiStyle()
      const eventsPath = style === 'v2' ? '/api/event' : '/global/event'
      const res = await fetch(`${this.baseUrl}${eventsPath}`, {
        headers: this.headers(undefined, { Accept: 'text/event-stream' }),
        signal,
      })
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data:')) {
            try {
              onEvent(JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>)
            } catch {
              // skip heartbeat
            }
          }
        }
      }
    })().catch(() => {})
  }
}
