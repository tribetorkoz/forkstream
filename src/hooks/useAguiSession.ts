/**
 * Real-time AG-UI v1.0 SSE Consumer Hook
 *
 * Uses the streaming fetch SSE line dispatcher from VibeTrace
 * (`github.com/idvxlab/VibeTrace/src/services/opencodeApi.ts`) combined with
 * pure incremental event folding (`Dri-water/observe-agents-do-things`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityFeedItem,
  ConsoleTelemetryEntry,
  FileSnapshot,
  ObserverAlert,
  ObserverFocusState,
  SessionStateSnapshot,
} from '../../shared/types'

interface AguiWireEvent {
  type: string
  name?: string
  value?: unknown
  snapshot?: SessionStateSnapshot
  delta?: string
  timestamp?: number
}

function createSseLineDispatcher(onJsonFrame: (ev: AguiWireEvent) => void) {
  const dataLines: string[] = []
  return (rawLine: string) => {
    const line = rawLine.replace(/\r$/, '')
    if (line === '') {
      if (dataLines.length > 0) {
        const joined = dataLines.join('\n')
        dataLines.length = 0
        try {
          onJsonFrame(JSON.parse(joined) as AguiWireEvent)
        } catch {
          // ignore malformed/comment frame
        }
      }
      return
    }
    if (line.startsWith(':')) return
    if (line.startsWith('data:')) {
      const rest = line.slice(5)
      dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest)
    }
  }
}

export function useAguiSession(sessionId: string | null) {
  const [snapshot, setSnapshot] = useState<SessionStateSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [eventCount, setEventCount] = useState(0)
  const [lastStreamedFile, setLastStreamedFile] = useState<{
    worktree: string
    path: string
    cameraSection: string | null
    ts: number
  } | null>(null)
  const [streamedAssistantText, setStreamedAssistantText] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const applyEvent = useCallback((ev: AguiWireEvent) => {
    setEventCount((c) => c + 1)

    if (ev.type === 'STATE_SNAPSHOT' && ev.snapshot) {
      setSnapshot(ev.snapshot)
      return
    }

    if (ev.type === 'TEXT_MESSAGE_CHUNK' && typeof ev.delta === 'string') {
      setStreamedAssistantText((prev) => (prev + ev.delta).slice(-4000))
      return
    }

    if (ev.type === 'CUSTOM') {
      if (ev.name === 'observer.file_stream' && ev.value) {
        const payload = ev.value as {
          worktree: string
          file: FileSnapshot
          cameraSection: string | null
          observer: ObserverFocusState
        }
        setLastStreamedFile({
          worktree: payload.worktree,
          path: payload.file.path,
          cameraSection: payload.cameraSection,
          ts: Date.now(),
        })
        setSnapshot((prev) => {
          if (!prev) return prev
          if (payload.worktree === 'main') {
            return {
              ...prev,
              files: { ...prev.files, [payload.file.path]: payload.file },
              observer: payload.observer,
            }
          }
          return {
            ...prev,
            forkFiles: {
              ...prev.forkFiles,
              [payload.worktree]: {
                ...(prev.forkFiles[payload.worktree] || {}),
                [payload.file.path]: payload.file,
              },
            },
            observer: payload.observer,
          }
        })
      } else if (ev.name === 'activity.added' && ev.value) {
        const item = ev.value as ActivityFeedItem
        setSnapshot((prev) => {
          if (!prev) return prev
          if (prev.activity.some((a) => a.id === item.id)) return prev
          return { ...prev, activity: [item, ...prev.activity].slice(0, 120) }
        })
      } else if (ev.name === 'observer.alert' && ev.value) {
        const alert = ev.value as ObserverAlert
        setSnapshot((prev) => {
          if (!prev) return prev
          const exists = prev.observer.alerts.some((a) => a.id === alert.id)
          if (exists) return prev
          return {
            ...prev,
            observer: {
              ...prev.observer,
              status: 'alerting',
              alerts: [alert, ...prev.observer.alerts],
            },
          }
        })
      } else if (ev.name === 'preview.console' && ev.value) {
        const log = ev.value as ConsoleTelemetryEntry
        setSnapshot((prev) => {
          if (!prev) return prev
          return { ...prev, consoleLogs: [log, ...prev.consoleLogs].slice(0, 60) }
        })
      }
    }
  }, [])

  useEffect(() => {
    if (!sessionId) {
      setSnapshot(null)
      setConnected(false)
      setEventCount(0)
      setStreamedAssistantText('')
      return
    }

    const ac = new AbortController()
    abortRef.current = ac
    setEventCount(0)
    setStreamedAssistantText('')

    ;(async () => {
      while (!ac.signal.aborted) {
        try {
          const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/events`, {
            headers: { Accept: 'text/event-stream' },
            signal: ac.signal,
          })
          if (!res.ok || !res.body) {
            setConnected(false)
            await new Promise((r) => setTimeout(r, 2000))
            continue
          }
          setConnected(true)
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          const dispatch = createSseLineDispatcher(applyEvent)
          let buf = ''

          while (!ac.signal.aborted) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) dispatch(line)
          }
        } catch {
          setConnected(false)
          if (ac.signal.aborted) break
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
    })()

    return () => {
      ac.abort()
      setConnected(false)
    }
  }, [sessionId, applyEvent])

  return {
    snapshot,
    setSnapshot,
    connected,
    eventCount,
    lastStreamedFile,
    streamedAssistantText,
  }
}
