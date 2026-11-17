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

export class OpenCodeAdapter {
  private readonly baseUrl: string
  private readonly authHeader: Record<string, string>

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

  async checkHealth(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3500),
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

  async createSession(directory: string, title: string, parentID?: string): Promise<OpenCodeSession> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: this.headers(directory, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title, ...(parentID ? { parentID } : {}) }),
    })
    if (!res.ok) throw new Error(`OpenCode POST /session failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as OpenCodeSession
  }

  /**
   * Native OpenCode session fork: `POST /session/:id/fork` (mirrors VibeTrace's `forkSession`).
   */
  async forkSession(
    sessionId: string,
    options?: { messageID?: string; directory?: string },
  ): Promise<OpenCodeSession> {
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
    let modelBody: { providerID: string; modelID: string } | undefined
    if (modelRef && modelRef.includes('/')) {
      const idx = modelRef.indexOf('/')
      modelBody = {
        providerID: modelRef.slice(0, idx).trim(),
        modelID: modelRef.slice(idx + 1).trim(),
      }
    }
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

  subscribeEvents(onEvent: (ev: Record<string, unknown>) => void, signal: AbortSignal): void {
    ;(async () => {
      const res = await fetch(`${this.baseUrl}/global/event`, {
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
