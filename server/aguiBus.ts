/**
 * AG-UI Protocol v1.0 Event Streaming Bus
 * Uses official @ag-ui/core EventType & @ag-ui/encoder EventEncoder (github.com/ag-ui-protocol/ag-ui)
 * combined with JSONL transcript persistence & snapshot-on-reconnect (observe-agents-do-things pattern).
 */
import fs from 'node:fs'
import path from 'node:path'
import { EventType, PROTOCOL_VERSION, type BaseEvent } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import type { SessionStateSnapshot } from '../shared/types.js'
import { appendEvent, isDatabaseInitialized } from './db/database.js'
import { persistToolInvocation } from './db/sessionRepository.js'

type SseSubscriber = {
  id: string
  send: (encodedFrame: string) => void
  close: () => void
}

export class AguiSessionBus {
  private readonly encoder = new EventEncoder({ accept: 'text/event-stream' })
  private readonly subscribers = new Map<string, Set<SseSubscriber>>()
  private readonly transcriptDir: string
  private persistenceTail: Promise<void> = Promise.resolve()

  constructor(baseDir: string) {
    this.transcriptDir = path.join(baseDir, 'transcripts')
    fs.mkdirSync(this.transcriptDir, { recursive: true })
  }

  getContentType(): string {
    return this.encoder.getContentType()
  }

  async flushPersistence(): Promise<void> {
    await this.persistenceTail.catch(() => undefined)
  }

  encodeEvent(event: BaseEvent): string {
    return this.encoder.encode({
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    } as BaseEvent)
  }

  emit(sessionId: string, event: BaseEvent, persist = true): void {
    const stamped = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    } as BaseEvent

    const encoded = this.encoder.encode(stamped)
    const subs = this.subscribers.get(sessionId)
    if (subs) {
      for (const sub of subs) {
        try {
          sub.send(encoded)
        } catch {
          subs.delete(sub)
        }
      }
    }

    // Persist the durable event record first; the JSONL transcript remains a lightweight export/cache.
    if (persist && event.type !== EventType.STATE_SNAPSHOT) {
      if (isDatabaseInitialized()) {
        this.persistenceTail = this.persistenceTail.then(() => appendEvent({
          streamId: sessionId, eventType: String(stamped.type), payload: stamped,
        })).then(() => undefined).catch((error) => {
          console.error(`[ForkStream] Event persistence failed (${sessionId}):`, error)
        })
      }
      const logPath = path.join(this.transcriptDir, `${sessionId}.jsonl`)
      fs.appendFile(logPath, JSON.stringify(stamped) + '\n', () => {})
    }
  }

  emitRunStarted(sessionId: string, runId: string): void {
    this.emit(sessionId, {
      type: EventType.RUN_STARTED,
      threadId: sessionId,
      runId,
      protocolVersion: PROTOCOL_VERSION,
    } as BaseEvent)
  }

  emitRunFinished(sessionId: string, runId: string): void {
    this.emit(sessionId, {
      type: EventType.RUN_FINISHED,
      threadId: sessionId,
      runId,
    } as BaseEvent)
  }

  emitRunError(sessionId: string, message: string): void {
    this.emit(sessionId, {
      type: EventType.RUN_ERROR,
      message,
    } as BaseEvent)
  }

  emitStepStarted(sessionId: string, stepName: string): void {
    this.emit(sessionId, {
      type: EventType.STEP_STARTED,
      stepName,
    } as BaseEvent)
  }

  emitStepFinished(sessionId: string, stepName: string): void {
    this.emit(sessionId, {
      type: EventType.STEP_FINISHED,
      stepName,
    } as BaseEvent)
  }

  emitSubagentStarted(
    sessionId: string,
    subagentRunId: string,
    name: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.emit(sessionId, {
      type: EventType.SUBAGENT_STARTED,
      subagentRunId,
      subagent: { name },
      ...(metadata ? { rawEvent: metadata } : {}),
    } as BaseEvent)
  }

  emitSubagentFinished(
    sessionId: string,
    subagentRunId: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.emit(sessionId, {
      type: EventType.SUBAGENT_FINISHED,
      subagentRunId,
      outcome: { status: 'success' },
      ...(metadata ? { rawEvent: metadata } : {}),
    } as BaseEvent)
  }

  emitSubagentError(sessionId: string, subagentRunId: string, message: string): void {
    this.emit(sessionId, {
      type: EventType.SUBAGENT_ERROR,
      subagentRunId,
      message,
    } as BaseEvent)
  }

  emitToolCall(
    sessionId: string,
    toolCallId: string,
    toolCallName: string,
    argsJson: string,
    resultText?: string,
  ): void {
    this.emit(sessionId, {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName,
    } as BaseEvent)
    this.emit(sessionId, {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: argsJson,
    } as BaseEvent)
    this.emit(sessionId, {
      type: EventType.TOOL_CALL_END,
      toolCallId,
    } as BaseEvent)
    if (resultText !== undefined) {
      this.emit(sessionId, {
        type: EventType.TOOL_CALL_RESULT,
        messageId: `msg_${toolCallId}`,
        toolCallId,
        content: resultText,
        role: 'tool',
      } as BaseEvent)
      if (isDatabaseInitialized()) {
        this.persistenceTail = this.persistenceTail.then(() => persistToolInvocation({
          id: toolCallId, sessionId, toolName: toolCallName, inputJson: argsJson, outputText: resultText,
        })).then(() => undefined).catch((error) => {
          console.error(`[ForkStream] Tool invocation persistence failed (${sessionId}/${toolCallId}):`, error)
        })
      }
    }
  }

  emitTextChunk(sessionId: string, messageId: string, delta: string, role = 'assistant'): void {
    this.emit(sessionId, {
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId,
      role,
      delta,
    } as BaseEvent)
  }

  emitStateSnapshot(sessionId: string, snapshot: SessionStateSnapshot): void {
    this.emit(
      sessionId,
      {
        type: EventType.STATE_SNAPSHOT,
        snapshot,
      } as BaseEvent,
      false,
    )
  }

  /**
   * Emit RFC 6902 JSON Patch state delta per AG-UI specification.
   */
  emitStateDelta(
    sessionId: string,
    delta: Array<{ op: 'add' | 'replace' | 'remove'; path: string; value?: unknown }>,
  ): void {
    this.emit(
      sessionId,
      {
        type: EventType.STATE_DELTA,
        delta,
      } as BaseEvent,
      false,
    )
  }

  emitCustom(sessionId: string, name: string, value: unknown): void {
    this.emit(sessionId, {
      type: EventType.CUSTOM,
      name,
      value,
    } as BaseEvent)
  }

  subscribe(
    sessionId: string,
    subscriber: SseSubscriber,
    initialSnapshot?: SessionStateSnapshot,
  ): () => void {
    let set = this.subscribers.get(sessionId)
    if (!set) {
      set = new Set()
      this.subscribers.set(sessionId, set)
    }
    set.add(subscriber)

    // Snapshot-on-connect guarantees reconnect safety (oadt & AG-UI best practice)
    if (initialSnapshot) {
      subscriber.send(
        this.encodeEvent({
          type: EventType.STATE_SNAPSHOT,
          snapshot: initialSnapshot,
        } as BaseEvent),
      )
    }

    return () => {
      const current = this.subscribers.get(sessionId)
      if (current) {
        current.delete(subscriber)
        if (current.size === 0) {
          this.subscribers.delete(sessionId)
        }
      }
    }
  }

  readTranscript(sessionId: string, limit = 200): BaseEvent[] {
    const logPath = path.join(this.transcriptDir, `${sessionId}.jsonl`)
    if (!fs.existsSync(logPath)) return []
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map((line) => JSON.parse(line) as BaseEvent)
  }
}
