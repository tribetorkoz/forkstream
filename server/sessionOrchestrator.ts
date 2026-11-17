/**
 * Master Session Orchestrator
 *
 * Coordinates the 4 actors of ForkStream in real time:
 *  1. Builder Agent   — executes primary task on `main` worktree without stopping
 *  2. Observer Agent  — watches files (`chokidar` + `jsdiff`), steers preview camera, flags bugs, routes forks
 *  3. Fork Agent(s)   — spawned on user mid-run intervention in isolated `git worktree`, run in parallel
 *  4. Smart Merger    — merges forks via Mergiraf AST + diff3/LLM, syncs Builder context, distills SKILL.md
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ActivityFeedItem,
  AgentFork,
  ConsoleTelemetryEntry,
  FileSnapshot,
  GitCheckpoint,
  ProviderConfig,
  SelectedDomElement,
  SessionStateSnapshot,
} from '../shared/types.js'
import { AguiSessionBus } from './aguiBus.js'
import { isDatabaseInitialized } from './db/database.js'
import { redactSecrets } from './security/workspaceGuard.js'
import { listPersistedSessions, persistSessionSnapshot, persistUsageRecord, readPersistedSnapshot } from './db/sessionRepository.js'
import { SessionWorktreeManager, detectVcsTooling } from './vcs/worktreeManager.js'
import { ObserverAgent } from './observer/observerAgent.js'
import { SkillDistiller } from './skills/skillDistiller.js'
import {
  SCENARIO_PRESETS,
  applySandboxForkIntervention,
  getScenarioSteps,
} from './adapters/sandboxEngine.js'
import {
  resolveConflictWithLLM,
  runRealBuilderAgent,
  runRealForkAgent,
} from './adapters/llmRunner.js'
import { OpenCodeAdapter } from './adapters/opencodeAdapter.js'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface ManagedSession {
  snapshot: SessionStateSnapshot
  vcs: SessionWorktreeManager
  observer: ObserverAgent
  abortController: AbortController
  pendingSyncNotices: string[]
  opencodeSessionId?: string
  forkCounter: number
}

export class ForkStreamOrchestrator {
  readonly bus: AguiSessionBus
  readonly distiller: SkillDistiller
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly snapshotPersistTails = new Map<string, Promise<void>>()
  private readonly snapshotPersistTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private providerConfig: ProviderConfig = {
    mode: 'sandbox',
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-sonnet-4-5',
    fastModel: 'claude-haiku-4-5',
    baseUrl: '',
    opencodeUrl: 'http://127.0.0.1:4096',
    opencodeUsername: 'opencode',
  }

  constructor(
    private readonly projectRoot: string,
    private readonly workspacesRoot: string,
  ) {
    this.bus = new AguiSessionBus(workspacesRoot)
    this.distiller = new SkillDistiller(projectRoot)
  }

  getProviderConfig(): Omit<ProviderConfig, 'apiKey' | 'opencodePassword'> & {
    hasApiKey: boolean
    hasOpencodePassword: boolean
  } {
    const { apiKey, opencodePassword, ...rest } = this.providerConfig
    return {
      ...rest,
      hasApiKey: Boolean(apiKey && apiKey.trim().length > 0),
      hasOpencodePassword: Boolean(opencodePassword && opencodePassword.trim().length > 0),
    }
  }

  updateProviderConfig(next: Partial<ProviderConfig>): Omit<ProviderConfig, 'apiKey' | 'opencodePassword'> & {
    hasApiKey: boolean
    hasOpencodePassword: boolean
  } {
    this.providerConfig = {
      ...this.providerConfig,
      ...next,
      // Keep existing API key if caller sends empty placeholder while preserving key
      apiKey: next.apiKey !== undefined ? next.apiKey : this.providerConfig.apiKey,
      opencodePassword:
        next.opencodePassword !== undefined ? next.opencodePassword : this.providerConfig.opencodePassword,
    }
    return this.getProviderConfig()
  }

  /** Builds an adapter with the configured URL and optional v2 Basic auth pair. */
  private openCodeAdapter(): OpenCodeAdapter {
    return new OpenCodeAdapter({
      baseUrl: this.providerConfig.opencodeUrl || 'http://127.0.0.1:4096',
      username: this.providerConfig.opencodeUsername,
      password: this.providerConfig.opencodePassword,
    })
  }

  async getSystemInfo() {
    const tooling = await detectVcsTooling(this.projectRoot)
    let opencodeHealth: { ok: boolean; detail: string } | null = null
    if (this.providerConfig.mode === 'opencode' && this.providerConfig.opencodeUrl) {
      opencodeHealth = await this.openCodeAdapter().checkHealth()
    }
    return {
      tooling,
      provider: this.getProviderConfig(),
      scenarios: SCENARIO_PRESETS,
      skillsCount: this.distiller.listSkills().length,
      opencodeHealth,
    }
  }

  listSessions(): Array<Pick<SessionStateSnapshot, 'sessionId' | 'title' | 'status' | 'mode' | 'createdAt'>> {
    return Array.from(this.sessions.values())
      .map((s) => ({
        sessionId: s.snapshot.sessionId,
        title: s.snapshot.title,
        status: s.snapshot.status,
        mode: s.snapshot.mode,
        createdAt: s.snapshot.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  getSession(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId)
  }

  getSnapshot(sessionId: string): SessionStateSnapshot | undefined {
    const s = this.sessions.get(sessionId)
    if (!s) return undefined
    s.snapshot.skills = this.distiller.listSkills()
    return s.snapshot
  }

  private pushActivity(
    managed: ManagedSession,
    item: Omit<ActivityFeedItem, 'id' | 'timestamp'>,
  ): ActivityFeedItem {
    const full: ActivityFeedItem = {
      ...item,
      id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    }
    managed.snapshot.activity = [full, ...managed.snapshot.activity].slice(0, 120)
    this.bus.emitCustom(managed.snapshot.sessionId, 'activity.added', full)
    this.scheduleSnapshotPersistence(managed)
    return full
  }

  private queueSnapshotPersistence(managed: ManagedSession): Promise<void> {
    if (!isDatabaseInitialized()) return Promise.resolve()
    const id = managed.snapshot.sessionId
    const snapshot = structuredClone(managed.snapshot)
    const prior = this.snapshotPersistTails.get(id) ?? Promise.resolve()
    const next = prior.catch(() => undefined).then(() => persistSessionSnapshot(snapshot))
    this.snapshotPersistTails.set(id, next)
    return next
  }

  private scheduleSnapshotPersistence(managed: ManagedSession): void {
    if (!isDatabaseInitialized()) return
    const id = managed.snapshot.sessionId
    const existing = this.snapshotPersistTimers.get(id)
    if (existing) clearTimeout(existing)
    this.snapshotPersistTimers.set(id, setTimeout(() => {
      this.snapshotPersistTimers.delete(id)
      void this.queueSnapshotPersistence(managed).catch((error) => {
        console.error(`[ForkStream] Failed to persist session ${id}:`, error)
      })
    }, 120))
  }

  private broadcastSnapshot(managed: ManagedSession): void {
    managed.snapshot.observer = { ...managed.observer.state }
    managed.snapshot.skills = this.distiller.listSkills()
    this.bus.emitStateSnapshot(managed.snapshot.sessionId, managed.snapshot)
    this.scheduleSnapshotPersistence(managed)
  }

  private async flushSessionPersistence(managed: ManagedSession): Promise<void> {
    const id = managed.snapshot.sessionId
    const timer = this.snapshotPersistTimers.get(id)
    if (timer) clearTimeout(timer)
    this.snapshotPersistTimers.delete(id)
    await this.queueSnapshotPersistence(managed)
    await this.bus.flushPersistence()
  }

  async createAndStartSession(params: {
    prompt?: string
    scenarioId?: string
    speedMultiplier?: number
    modeOverride?: ProviderConfig['mode']
  }): Promise<SessionStateSnapshot> {
    const sessionId = `ses_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`
    const mode = params.modeOverride ?? this.providerConfig.mode
    const scenario =
      SCENARIO_PRESETS.find((s) => s.id === params.scenarioId) ?? SCENARIO_PRESETS[0]
    const prompt = params.prompt?.trim() || scenario.defaultPromptAr

    const vcs = new SessionWorktreeManager(this.workspacesRoot, sessionId, this.projectRoot)
    const rootCommit = await vcs.initialize({
      seedFrom: mode === 'sandbox' ? undefined : this.projectRoot,
    })
    const tooling = vcs.getTooling()

    let managedRef!: ManagedSession

    const observer = new ObserverAgent(
      ({ worktree, snapshot, cameraSection }) => {
        if (!managedRef) return
        if (worktree === 'main') {
          managedRef.snapshot.files[snapshot.path] = snapshot
        } else {
          if (!managedRef.snapshot.forkFiles[worktree]) {
            managedRef.snapshot.forkFiles[worktree] = {}
          }
          managedRef.snapshot.forkFiles[worktree][snapshot.path] = snapshot
        }
        managedRef.snapshot.observer = { ...observer.state }
        this.bus.emitCustom(sessionId, 'observer.file_stream', {
          worktree,
          file: snapshot,
          cameraSection,
          observer: managedRef.snapshot.observer,
        })
        this.scheduleSnapshotPersistence(managedRef)
      },
      (alert) => {
        if (!managedRef) return
        managedRef.snapshot.observer = { ...observer.state }
        this.pushActivity(managedRef, {
          agentId: 'observer',
          agentRole: 'observer',
          eventType: 'OBSERVER_ALERT',
          message: alert.title,
          messageAr: alert.titleAr,
          filePath: alert.targetFile,
          badge: 'ALERT',
        })
        this.bus.emitCustom(sessionId, 'observer.alert', alert)
        this.broadcastSnapshot(managedRef)
      },
    )

    await observer.startWatchingMain(vcs.mainDir)

    const rootCheckpoint: GitCheckpoint = {
      id: 'cp_0',
      commitHash: rootCommit.commitHash,
      shortHash: rootCommit.shortHash,
      stepIndex: 0,
      title: 'Initialize Git Repository & Mergiraf AST Driver',
      titleAr: 'تهيئة مستودع Git وتفعيل محرك الدمج الهيكلي Mergiraf AST',
      agentId: 'builder',
      agentRole: 'builder',
      filesChanged: [],
      linesAdded: 0,
      linesRemoved: 0,
      timestamp: Date.now(),
      diffPatch: '',
    }
    observer.recordCheckpoint(rootCheckpoint.id, rootCheckpoint.commitHash)

    const stepsCount = mode === 'sandbox' ? getScenarioSteps(scenario.id).length : 7

    const snapshot: SessionStateSnapshot = {
      sessionId,
      title: mode === 'sandbox' ? scenario.nameAr : prompt.slice(0, 48),
      prompt,
      scenarioId: mode === 'sandbox' ? scenario.id : undefined,
      mode,
      status: 'running',
      speedMultiplier: params.speedMultiplier ?? 1,
      totalSteps: stepsCount,
      completedSteps: 0,
      currentBuilderAction: 'Planning project architecture...',
      currentBuilderActionAr: 'يخطط هيكل المشروع ويجهّز الملفات...',
      mergirafAvailable: Boolean(tooling.mergirafPath),
      mergirafVersion: tooling.mergirafVersion,
      gitVersion: tooling.gitVersion,
      repoPath: vcs.mainDir,
      previewUrl: `/preview/${sessionId}/main/`,
      files: {},
      forkFiles: {},
      checkpoints: [rootCheckpoint],
      forks: [],
      observer: { ...observer.state },
      consoleLogs: [],
      activity: [],
      syncNoticesDelivered: [],
      skills: this.distiller.listSkills(),
      createdAt: Date.now(),
    }

    managedRef = {
      snapshot,
      vcs,
      observer,
      abortController: new AbortController(),
      pendingSyncNotices: [],
      forkCounter: 0,
    }
    this.sessions.set(sessionId, managedRef)

    this.pushActivity(managedRef, {
      agentId: 'observer',
      agentRole: 'observer',
      eventType: 'OBSERVER_ARMED',
      message: `Observer attached (chokidar + AG-UI SSE + ${tooling.mergirafVersion || 'git diff3'})`,
      messageAr: `الوكيل المشاهد متّصل الآن ويراقب الملفات والنتيجة حياً (${tooling.mergirafVersion || 'Git diff3'})`,
      commitHash: rootCommit.shortHash,
      badge: 'LIVE',
    })
    await this.queueSnapshotPersistence(managedRef)

    // Fire builder loop asynchronously in background so HTTP response returns immediately
    void this.executeBuilderLoop(managedRef, scenario.id)

    return snapshot
  }

  async recoverSandboxSession(sessionId: string): Promise<SessionStateSnapshot> {
    if (this.sessions.has(sessionId)) throw new Error('Session is already active in this server process')
    const row = (await listPersistedSessions()).find((item) => item.id === sessionId)
    if (!row) throw new Error('Persisted session not found')
    if (row.status !== 'interrupted') throw new Error(`Only interrupted sessions can be recovered (current state: ${row.status})`)
    const snapshot = await readPersistedSnapshot(sessionId)
    if (!snapshot) throw new Error('Stored session snapshot is missing or invalid')
    if (snapshot.mode !== 'sandbox' || !snapshot.scenarioId) {
      throw new Error('Automatic recovery currently supports deterministic sandbox sessions only; model-agent continuation requires the later runtime checkpoint layer')
    }
    if (snapshot.forks.some((fork) => ['spawning', 'working', 'verifying', 'merging'].includes(fork.status))) {
      throw new Error('This session has an unfinished parallel fork; recover it manually after inspecting its saved transcript')
    }

    const expectedMain = path.resolve(this.workspacesRoot, sessionId, 'main')
    if (path.resolve(snapshot.repoPath) !== expectedMain) {
      throw new Error('Stored worktree path does not match the server-owned session directory; refusing unsafe recovery')
    }
    const vcs = new SessionWorktreeManager(this.workspacesRoot, sessionId, this.projectRoot)
    await vcs.attachExisting()
    let managedRef!: ManagedSession
    const observer = new ObserverAgent(
      ({ worktree, snapshot: fileSnapshot, cameraSection }) => {
        if (!managedRef) return
        if (worktree === 'main') managedRef.snapshot.files[fileSnapshot.path] = fileSnapshot
        else {
          managedRef.snapshot.forkFiles[worktree] ??= {}
          managedRef.snapshot.forkFiles[worktree][fileSnapshot.path] = fileSnapshot
        }
        managedRef.snapshot.observer = { ...observer.state }
        this.bus.emitCustom(sessionId, 'observer.file_stream', { worktree, file: fileSnapshot, cameraSection, observer: managedRef.snapshot.observer })
        this.scheduleSnapshotPersistence(managedRef)
      },
      (alert) => {
        if (!managedRef) return
        managedRef.snapshot.observer = { ...observer.state }
        this.pushActivity(managedRef, {
          agentId: 'observer', agentRole: 'observer', eventType: 'OBSERVER_ALERT',
          message: alert.title, messageAr: alert.titleAr, filePath: alert.targetFile, badge: 'ALERT',
        })
        this.bus.emitCustom(sessionId, 'observer.alert', alert)
        this.broadcastSnapshot(managedRef)
      },
    )
    await observer.startWatchingMain(vcs.mainDir)
    for (const checkpoint of snapshot.checkpoints) {
      observer.recordCheckpoint(checkpoint.id, checkpoint.commitHash, checkpoint.previewSection)
    }
    for (const fork of snapshot.forks) {
      if (fs.existsSync(fork.worktreePath)) await observer.startWatchingFork(fork.id, fork.worktreePath)
    }

    snapshot.status = 'running'
    const recoveredMetadata = snapshot as SessionStateSnapshot & { recoveryState?: string }
    delete recoveredMetadata.recoveryState
    managedRef = {
      snapshot, vcs, observer, abortController: new AbortController(), pendingSyncNotices: [],
      forkCounter: snapshot.forks.reduce((max, fork) => Math.max(max, Number(fork.id.match(/^fork-(\d+)$/)?.[1] || 0)), 0),
    }
    this.sessions.set(sessionId, managedRef)
    this.pushActivity(managedRef, {
      agentId: 'user', agentRole: 'user', eventType: 'SESSION_RECOVERED',
      message: `Sandbox session recovered from checkpoint ${snapshot.completedSteps}/${snapshot.totalSteps}.`,
      messageAr: `استُعيدت جلسة الاختبار من نقطة ${snapshot.completedSteps}/${snapshot.totalSteps}.`, badge: 'RECOVERED',
    })
    this.bus.emitCustom(sessionId, 'session.recovered', { completedSteps: snapshot.completedSteps, totalSteps: snapshot.totalSteps })
    await this.flushSessionPersistence(managedRef)
    void this.executeBuilderLoop(managedRef, snapshot.scenarioId)
    return snapshot
  }

  setPauseState(sessionId: string, paused: boolean): SessionStateSnapshot | null {
    const m = this.sessions.get(sessionId)
    if (!m) return null
    if (m.snapshot.status === 'running' && paused) {
      m.snapshot.status = 'paused'
      this.pushActivity(m, {
        agentId: 'builder',
        agentRole: 'builder',
        eventType: 'PAUSED',
        message: 'Builder paused by user (you can still inspect files or launch forks!)',
        messageAr: 'تم إيقاف الوكيل الأول مؤقتاً (يمكنك فحص الكود أو إطلاق انقسام تعديلي)',
      })
      this.broadcastSnapshot(m)
    } else if (m.snapshot.status === 'paused' && !paused) {
      m.snapshot.status = 'running'
      this.pushActivity(m, {
        agentId: 'builder',
        agentRole: 'builder',
        eventType: 'RESUMED',
        message: 'Builder resumed primary task execution',
        messageAr: 'استأنف الوكيل الأول تنفيذ المهمة الأساسية',
      })
      this.broadcastSnapshot(m)
    }
    return m.snapshot
  }

  setSpeed(sessionId: string, speedMultiplier: number): SessionStateSnapshot | null {
    const m = this.sessions.get(sessionId)
    if (!m) return null
    m.snapshot.speedMultiplier = Math.max(0.25, Math.min(4, speedMultiplier))
    this.broadcastSnapshot(m)
    return m.snapshot
  }

  recordTelemetry(
    sessionId: string,
    payload: { level: ConsoleTelemetryEntry['level']; message: string; source: string; fileHint?: string },
  ): void {
    const m = this.sessions.get(sessionId)
    if (!m) return
    const entry: ConsoleTelemetryEntry = {
      id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      level: payload.level,
      message: redactSecrets(payload.message),
      source: payload.source || 'main',
      fileHint: payload.fileHint,
      timestamp: Date.now(),
    }
    m.snapshot.consoleLogs = [entry, ...m.snapshot.consoleLogs].slice(0, 60)
    m.observer.recordConsoleTelemetry(entry)
    this.bus.emitCustom(sessionId, 'preview.console', entry)
  }

  private async waitRespectingPauseAndSpeed(managed: ManagedSession, baseMs: number): Promise<boolean> {
    const slice = 150
    let elapsed = 0
    while (elapsed < baseMs) {
      if (managed.abortController.signal.aborted) return false
      if (managed.snapshot.status === 'paused') {
        await sleep(200)
        continue
      }
      await sleep(slice)
      elapsed += slice * managed.snapshot.speedMultiplier
    }
    return !managed.abortController.signal.aborted
  }

  private latestMainCheckpoint(managed: ManagedSession): GitCheckpoint {
    const mainCps = managed.snapshot.checkpoints.filter(
      (c) => c.agentRole === 'builder' || c.agentRole === 'merge',
    )
    return mainCps[mainCps.length - 1] ?? managed.snapshot.checkpoints[0]
  }

  private async executeBuilderLoop(managed: ManagedSession, scenarioId: string): Promise<void> {
    const { sessionId } = managed.snapshot
    const runId = `run_${Date.now().toString(36)}`
    this.bus.emitRunStarted(sessionId, runId)

    try {
      if (managed.snapshot.mode === 'llm') {
        await this.executeLlmBuilder(managed)
      } else if (managed.snapshot.mode === 'opencode') {
        await this.executeOpenCodeBuilder(managed)
      } else {
        await this.executeSandboxBuilder(managed, scenarioId)
      }

      if (!managed.abortController.signal.aborted) {
        managed.snapshot.status = 'completed'
        managed.snapshot.currentBuilderAction =
          'Primary task completed — you can still fork & refine any component or checkpoint!'
        managed.snapshot.currentBuilderActionAr =
          'اكتملت المهمة الأساسية بنجاح — يمكنك شطر أي خطوة سابقة أو إرسال تعديل إضافي في أي لحظة!'
        this.pushActivity(managed, {
          agentId: 'builder',
          agentRole: 'builder',
          eventType: 'RUN_FINISHED',
          message: 'Builder Agent finished all primary task steps.',
          messageAr: 'أنهى الوكيل الأول جميع خطوات المهمة الأساسية بنجاح.',
          badge: 'DONE',
        })
        this.bus.emitRunFinished(sessionId, runId)
        this.broadcastSnapshot(managed)
        await this.flushSessionPersistence(managed)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      managed.snapshot.status = 'error'
      managed.snapshot.currentBuilderAction = `Error: ${msg}`
      managed.snapshot.currentBuilderActionAr = `خطأ أثناء التنفيذ: ${msg}`
      this.pushActivity(managed, {
        agentId: 'builder',
        agentRole: 'builder',
        eventType: 'RUN_ERROR',
        message: msg,
        messageAr: `خطأ: ${msg}`,
        badge: 'ERROR',
      })
      this.bus.emitRunError(sessionId, msg)
      this.broadcastSnapshot(managed)
      await this.flushSessionPersistence(managed)
    }
  }

  private async executeSandboxBuilder(managed: ManagedSession, scenarioId: string): Promise<void> {
    const { sessionId, prompt } = managed.snapshot
    const steps = getScenarioSteps(scenarioId)
    managed.snapshot.totalSteps = steps.length

    // Brief initial pause so SSE clients attach and watch step 1 unfold live
    await sleep(600)

    const firstPendingStep = Math.max(0, Math.min(steps.length, managed.snapshot.completedSteps))
    for (let i = firstPendingStep; i < steps.length; i++) {
      const step = steps[i]
      const stepIndex = i + 1

      // Consume any Context Sync Notices delivered from merged parallel forks!
      if (managed.pendingSyncNotices.length > 0) {
        const notices = managed.pendingSyncNotices.splice(0)
        managed.snapshot.syncNoticesDelivered.push(...notices)
        for (const notice of notices) {
          this.pushActivity(managed, {
            agentId: 'builder',
            agentRole: 'builder',
            eventType: 'CONTEXT_SYNC_RECEIVED',
            message: `Builder absorbed fork sync: ${notice}`,
            messageAr: `استلم الوكيل الأول تحديث الدمج وأكمل متوافقاً معه: ${notice}`,
            badge: 'SYNC',
          })
        }
      }

      managed.snapshot.currentBuilderAction = `[Step ${stepIndex}/${steps.length}] ${step.title}`
      managed.snapshot.currentBuilderActionAr = `[خطوة ${stepIndex}/${steps.length}] ${step.titleAr}`
      this.bus.emitStepStarted(sessionId, step.title)
      this.broadcastSnapshot(managed)

      // Half the step duration represents Builder reasoning & typing before commit
      const cont1 = await this.waitRespectingPauseAndSpeed(managed, step.durationMs * 0.55)
      if (!cont1) return

      const prevMainCp = this.latestMainCheckpoint(managed)
      let writtenContent = ''
      const commit = await managed.vcs.applyBuilderStepAndCommit(async (mainDir) => {
        writtenContent = await step.apply(managed.vcs, mainDir, prompt)
      }, `feat(step-${stepIndex}): ${step.title}`)

      // Trigger PostToolUse observation immediately (chokidar dedupes seamlessly)
      managed.observer.recordFileMutation('main', step.filePath, writtenContent, step.previewSection)

      const toolCallId = `tc_step_${stepIndex}`
      this.bus.emitToolCall(
        sessionId,
        toolCallId,
        'write_file',
        JSON.stringify({ path: step.filePath }),
        `Committed ${commit?.shortHash ?? 'HEAD'}`,
      )

      if (commit) {
        const cp: GitCheckpoint = {
          id: `cp_${stepIndex}`,
          commitHash: commit.commitHash,
          shortHash: commit.shortHash,
          stepIndex,
          title: step.title,
          titleAr: step.titleAr,
          agentId: 'builder',
          agentRole: 'builder',
          parentCheckpointId: prevMainCp.id,
          filesChanged: commit.filesChanged,
          linesAdded: commit.linesAdded,
          linesRemoved: commit.linesRemoved,
          previewSection: step.previewSection,
          timestamp: Date.now(),
          diffPatch: commit.diffPatch,
        }
        managed.snapshot.checkpoints.push(cp)
        managed.observer.recordCheckpoint(cp.id, cp.commitHash, step.previewSection)

        this.pushActivity(managed, {
          agentId: 'builder',
          agentRole: 'builder',
          eventType: 'TOOL_CALL_RESULT',
          message: `${step.title} (+${commit.linesAdded}/-${commit.linesRemoved})`,
          messageAr: `${step.titleAr} (+${commit.linesAdded}/-${commit.linesRemoved})`,
          filePath: step.filePath,
          commitHash: commit.shortHash,
          badge: `STEP ${stepIndex}`,
        })
      }

      managed.snapshot.completedSteps = stepIndex
      this.bus.emitStepFinished(sessionId, step.title)
      this.broadcastSnapshot(managed)
      await this.flushSessionPersistence(managed)

      // Breathing window so Observer streams live preview & user can watch and intervene
      if (i < steps.length - 1) {
        const cont2 = await this.waitRespectingPauseAndSpeed(managed, step.durationMs * 0.45)
        if (!cont2) return
      }
    }
  }

  private async executeLlmBuilder(managed: ManagedSession): Promise<void> {
    const { sessionId, prompt } = managed.snapshot
    const msgId = `msg_${Date.now().toString(36)}`
    let stepIdx = 0

    await runRealBuilderAgent({
      config: this.providerConfig,
      prompt,
      skillBlock: this.distiller.buildSkillPromptBlock(),
      vcs: managed.vcs,
      callbacks: {
        abortSignal: managed.abortController.signal,
        drainSyncNotices: () => {
          const drained = managed.pendingSyncNotices.splice(0)
          if (drained.length) managed.snapshot.syncNoticesDelivered.push(...drained)
          return drained
        },
        onStepChange: (idx, desc) => {
          managed.snapshot.currentBuilderAction = `[Step ${idx}] ${desc}`
          managed.snapshot.currentBuilderActionAr = `[خطوة ${idx}] ${desc}`
          this.bus.emitStepStarted(sessionId, desc)
          this.broadcastSnapshot(managed)
        },
        onToolExecuted: async ({ toolName, filePath, summary, content }) => {
          stepIdx += 1
          const prevCp = this.latestMainCheckpoint(managed)
          managed.observer.recordFileMutation('main', filePath, content)
          const log = await managed.vcs.getCommitLog()
          const head = log[0]
          const snap: FileSnapshot | undefined = managed.snapshot.files[filePath]

          const cp: GitCheckpoint = {
            id: `cp_${stepIdx}`,
            commitHash: head?.hash ?? prevCp.commitHash,
            shortHash: head?.shortHash ?? prevCp.shortHash,
            stepIndex: stepIdx,
            title: summary,
            titleAr: summary,
            agentId: 'builder',
            agentRole: 'builder',
            parentCheckpointId: prevCp.id,
            filesChanged: [filePath],
            linesAdded: snap?.linesAdded ?? 0,
            linesRemoved: snap?.linesRemoved ?? 0,
            timestamp: Date.now(),
            diffPatch: snap?.diffPatch ?? '',
          }
          managed.snapshot.checkpoints.push(cp)
          managed.snapshot.completedSteps = stepIdx
          if (stepIdx >= managed.snapshot.totalSteps) {
            managed.snapshot.totalSteps = stepIdx + 1
          }
          managed.observer.recordCheckpoint(cp.id, cp.commitHash)
          this.bus.emitToolCall(sessionId, `tc_${stepIdx}`, toolName, JSON.stringify({ path: filePath }), summary)
          this.pushActivity(managed, {
            agentId: 'builder',
            agentRole: 'builder',
            eventType: 'TOOL_CALL_RESULT',
            message: `${summary} (${filePath})`,
            messageAr: `${summary} (${filePath})`,
            filePath,
            commitHash: cp.shortHash,
            badge: toolName,
          })
          this.broadcastSnapshot(managed)
          await this.flushSessionPersistence(managed)
        },
        onTextDelta: (delta) => {
          this.bus.emitTextChunk(sessionId, msgId, delta)
        },
        onUsage: async ({ inputTokens, outputTokens }) => {
          if (!isDatabaseInitialized()) return
          await persistUsageRecord({
            id: `usage_${crypto.randomUUID()}`, sessionId,
            provider: this.providerConfig.provider, model: this.providerConfig.model,
            inputTokens, outputTokens,
          })
        },
      },
    })
    managed.snapshot.totalSteps = Math.max(1, managed.snapshot.completedSteps)
  }

  private async executeOpenCodeBuilder(managed: ManagedSession): Promise<void> {
    const { sessionId } = managed.snapshot
    const adapter = this.openCodeAdapter()
    const health = await adapter.checkHealth()
    if (!health.ok) {
      throw new Error(
        `OpenCode server unreachable at ${this.providerConfig.opencodeUrl} (${health.detail}). Start 'opencode serve --port 4096' or switch to Sandbox / LLM API mode.`,
      )
    }

    managed.snapshot.currentBuilderAction = 'Opening OpenCode session…'
    managed.snapshot.currentBuilderActionAr = 'جارٍ فتح جلسة OpenCode…'
    this.broadcastSnapshot(managed)

    const ocSession = await adapter.createSession(
      managed.vcs.mainDir,
      managed.snapshot.title,
      undefined,
      this.providerConfig.model,
    )
    managed.opencodeSessionId = ocSession.id
    managed.snapshot.totalSteps = 1

    // Live telemetry from the OpenCode event stream (tool calls, execution state).
    adapter.subscribeEvents(
      (ev) => {
        const type = typeof ev.type === 'string' ? ev.type : ''
        if (type === 'session.execution.started') {
          managed.snapshot.currentBuilderAction = 'OpenCode agent is working…'
          managed.snapshot.currentBuilderActionAr = 'وكيل OpenCode يعمل الآن…'
          this.broadcastSnapshot(managed)
        } else if (type === 'session.execution.succeeded') {
          managed.snapshot.currentBuilderAction = 'OpenCode agent finished the task'
          managed.snapshot.currentBuilderActionAr = 'أنهى وكيل OpenCode المهمة'
          this.broadcastSnapshot(managed)
        } else if (type === 'session.execution.failed') {
          managed.snapshot.currentBuilderAction = 'OpenCode agent reported a failed execution'
          managed.snapshot.currentBuilderActionAr = 'أبلغ وكيل OpenCode عن فشل في التنفيذ'
          this.broadcastSnapshot(managed)
        }
        this.bus.emitCustom(sessionId, 'opencode.event', ev)
      },
      managed.abortController.signal,
    )

    await adapter.sendPrompt(
      ocSession.id,
      managed.vcs.mainDir,
      `Work only inside the current working directory. Do not read or write files outside it.\n\n${managed.snapshot.prompt}${this.distiller.buildSkillPromptBlock()}`,
      this.providerConfig.model,
    )

    // `prompt` only enqueues the message on v2 — block until the agent loop is idle
    // so the checkpoint below captures the files the agent actually wrote.
    try {
      await adapter.waitForIdle(ocSession.id, managed.abortController.signal)
    } catch (err) {
      if (managed.abortController.signal.aborted) return
      throw err
    }
    if (managed.abortController.signal.aborted) return

    const diffs = await adapter.getDiff(ocSession.id)
    for (const entry of diffs) {
      const absolute = path.isAbsolute(entry.file) ? entry.file : path.resolve(managed.vcs.mainDir, entry.file)
      const relPath = path.relative(managed.vcs.mainDir, absolute).split(path.sep).join('/')
      try {
        const stat = await fs.promises.stat(absolute)
        if (stat.isFile() && stat.size <= 512 * 1024) {
          const content = await fs.promises.readFile(absolute, 'utf8')
          managed.observer.recordFileMutation('main', relPath, content)
        }
      } catch {
        // File deleted by the agent — nothing to snapshot.
      }
      this.pushActivity(managed, {
        agentId: 'builder',
        agentRole: 'builder',
        eventType: 'TOOL_CALL_RESULT',
        message: `${entry.status} ${relPath} (+${entry.additions}/-${entry.deletions})`,
        messageAr: `${entry.status} ${relPath} (+${entry.additions}/-${entry.deletions})`,
        filePath: relPath,
        badge: 'OPENCODE',
      })
    }
    managed.snapshot.totalSteps = Math.max(1, diffs.length)
    this.bus.emitToolCall(
      sessionId,
      `tc_opencode_${Date.now().toString(36)}`,
      'opencode.run',
      JSON.stringify({ session: ocSession.id, files: diffs.map((d) => d.file) }),
      `OpenCode modified ${diffs.length} file(s)`,
    )
    this.broadcastSnapshot(managed)

    const commit = await managed.vcs.commitMainCheckpoint('feat: opencode primary task')
    if (commit) {
      const prev = this.latestMainCheckpoint(managed)
      managed.snapshot.checkpoints.push({
        id: `cp_${managed.snapshot.checkpoints.length}`,
        commitHash: commit.commitHash,
        shortHash: commit.shortHash,
        stepIndex: 1,
        title: 'OpenCode Session Output',
        titleAr: 'مخرجات جلسة OpenCode الأساسية',
        agentId: 'builder',
        agentRole: 'builder',
        parentCheckpointId: prev.id,
        filesChanged: commit.filesChanged,
        linesAdded: commit.linesAdded,
        linesRemoved: commit.linesRemoved,
        timestamp: Date.now(),
        diffPatch: commit.diffPatch,
      })
      managed.observer.recordCheckpoint(
        `cp_${managed.snapshot.checkpoints.length - 1}`,
        commit.commitHash,
      )
      managed.snapshot.completedSteps = managed.snapshot.totalSteps
      this.pushActivity(managed, {
        agentId: 'builder',
        agentRole: 'builder',
        eventType: 'TOOL_CALL_RESULT',
        message: `OpenCode checkpoint (+${commit.linesAdded}/-${commit.linesRemoved})`,
        messageAr: `نقطة تحقق OpenCode (+${commit.linesAdded}/-${commit.linesRemoved})`,
        commitHash: commit.shortHash,
        badge: 'COMMIT',
      })
      this.broadcastSnapshot(managed)
      await this.flushSessionPersistence(managed)
    } else {
      managed.snapshot.completedSteps = managed.snapshot.totalSteps
      this.pushActivity(managed, {
        agentId: 'builder',
        agentRole: 'builder',
        eventType: 'TOOL_CALL_RESULT',
        message: 'OpenCode finished without changing any file',
        messageAr: 'انتهى OpenCode دون تغيير أي ملف',
        badge: 'OPENCODE',
      })
      this.broadcastSnapshot(managed)
    }
  }

  /**
   * CORE INNOVATION: Mid-Execution Parallel Agent Forking!
   * While Builder Agent continues running undisturbed on `main`:
   *  1. Observer captures active focus + target files + base checkpoint (or user's chosen Time-Travel checkpoint)
   *  2. VCS runs real `git worktree add -b fork/<forkId> <dir> <baseCommitHash>`
   *  3. Fork Agent runs concurrently inside isolated worktree + streams its own live PiP preview
   *  4. Mergiraf AST + Git 3-way merges fork cleanly back into `main`
   *  5. Observer refreshes `main` live files + delivers Context Sync notice to Builder + distills reusable `SKILL.md`!
   */
  async spawnFork(
    sessionId: string,
    params: {
      userPrompt: string
      fromCheckpointId?: string
      selectedElement?: SelectedDomElement
    },
  ): Promise<AgentFork> {
    const managed = this.sessions.get(sessionId)
    if (!managed) throw new Error(`Session not found: ${sessionId}`)

    managed.forkCounter += 1
    const forkId = `fork-${managed.forkCounter}`

    // Resolve base checkpoint (supports both Live Mid-Run Fork AND Historical Time-Travel Fork!)
    const requestedCp = params.fromCheckpointId
      ? managed.snapshot.checkpoints.find((c) => c.id === params.fromCheckpointId)
      : undefined
    const baseCp = requestedCp ?? this.latestMainCheckpoint(managed)

    // Create real isolated Git Worktree on disk
    const { branchName, worktreePath, resolvedBaseCommit } = await managed.vcs.createForkWorktree(
      forkId,
      baseCp.commitHash,
    )

    const availableFiles = await managed.vcs.listFilesInWorktree(worktreePath)
    const targetFiles = managed.observer.resolveTargetFilesForFork(
      params.userPrompt,
      availableFiles,
      params.selectedElement,
    )

    const fork: AgentFork = {
      id: forkId,
      branchName,
      worktreePath,
      baseCheckpointId: baseCp.id,
      baseCommitHash: resolvedBaseCommit,
      baseShortHash: resolvedBaseCommit.slice(0, 7),
      userPrompt: params.userPrompt,
      targetFiles,
      selectedElement: params.selectedElement,
      status: 'spawning',
      currentAction: `Creating isolated Git worktree (${branchName}) from ${baseCp.shortHash}...`,
      currentActionAr: `انقسام الوكيل: إنشاء مساحة معزولة (${branchName}) من النقطة ${baseCp.shortHash}...`,
      filesModified: [],
      diffPatch: '',
      linesAdded: 0,
      linesRemoved: 0,
      previewUrl: `/preview/${sessionId}/fork/${forkId}/`,
      syncNoticeSentToBuilder: false,
      createdAt: Date.now(),
    }

    managed.snapshot.forks = [fork, ...managed.snapshot.forks]
    await managed.observer.startWatchingFork(forkId, worktreePath)

    // Emit official AG-UI v1.0 SUBAGENT_STARTED event!
    this.bus.emitSubagentStarted(sessionId, forkId, `Fork Fixer (${branchName})`, {
      baseCommit: baseCp.shortHash,
      targetFiles,
      userPrompt: params.userPrompt,
    })

    this.pushActivity(managed, {
      agentId: 'user',
      agentRole: 'user',
      eventType: 'USER_MIDRUN_FORK',
      message: `Mid-run command: "${params.userPrompt}"`,
      messageAr: `أمر تعديل أثناء العمل: "${params.userPrompt}"`,
      commitHash: baseCp.shortHash,
      badge: 'INTERVENE',
    })

    this.pushActivity(managed, {
      agentId: forkId,
      agentRole: 'fork',
      eventType: 'SUBAGENT_STARTED',
      message: `Agent split! Builder continues on main while ${forkId} edits [${targetFiles.join(', ') || 'workspace'}] in isolated Git worktree`,
      messageAr: `انقسم الوكيل لجزأين! الأول مستمر في المهمة، و(${forkId}) يعمل بالتوازي على [${targetFiles.join('، ') || 'المشروع'}]`,
      filePath: targetFiles[0],
      commitHash: baseCp.shortHash,
      badge: 'FORK',
    })

    this.broadcastSnapshot(managed)

    // Run the parallel Fork Agent lifecycle asynchronously without blocking Builder!
    void this.runForkLifecycle(managed, fork)

    return fork
  }

  private async runForkLifecycle(managed: ManagedSession, fork: AgentFork): Promise<void> {
    const { sessionId } = managed.snapshot
    try {
      await sleep(750)
      fork.status = 'working'
      fork.currentAction = `Applying fix to ${fork.targetFiles.join(', ') || 'workspace'} in parallel...`
      fork.currentActionAr = `يُجري التعديل المطلوب بالتوازي على ${fork.targetFiles.join('، ') || 'الملفات'}...`
      this.broadcastSnapshot(managed)

      if (managed.snapshot.mode === 'llm') {
        const res = await runRealForkAgent({
          config: this.providerConfig,
          forkId: fork.id,
          forkDir: fork.worktreePath,
          userPrompt: fork.userPrompt,
          targetFiles: fork.targetFiles,
          observerDigest: managed.observer.state.cappedDigest,
          selectedElement: fork.selectedElement,
          vcs: managed.vcs,
          onForkStatus: (action) => {
            fork.currentAction = action
            fork.currentActionAr = action
            this.broadcastSnapshot(managed)
          },
          onForkFileEdited: (relPath, content) => {
            managed.observer.recordFileMutation(fork.id, relPath, content)
          },
        })
        fork.filesModified = res.filesModified
      } else if (managed.snapshot.mode === 'opencode' && managed.opencodeSessionId) {
        const adapter = this.openCodeAdapter()
        const forkedSession = await adapter.forkSession(managed.opencodeSessionId, {
          directory: fork.worktreePath,
        })
        // v2 stores the working directory on the session itself, so point the
        // forked context at the isolated Git worktree before prompting it.
        await adapter.moveSession(forkedSession.id, fork.worktreePath)
        await adapter.sendPrompt(
          forkedSession.id,
          fork.worktreePath,
          `Apply this targeted fix cleanly: ${fork.userPrompt}`,
          this.providerConfig.fastModel || this.providerConfig.model,
        )
        // Same v2 rule as the builder: wait for the forked agent loop to go idle
        // before committing, otherwise the fork branch is committed empty.
        try {
          await adapter.waitForIdle(forkedSession.id, managed.abortController.signal)
        } catch {
          // Best-effort: a wait timeout must not kill the merge pipeline.
        }
        const forkDiff = await adapter.getDiff(forkedSession.id)
        if (forkDiff.length) {
          fork.filesModified = forkDiff.map((entry) => entry.file)
          for (const entry of forkDiff) {
            const absolute = path.isAbsolute(entry.file)
              ? entry.file
              : path.resolve(fork.worktreePath, entry.file)
            const relPath = path.relative(fork.worktreePath, absolute).split(path.sep).join('/')
            try {
              const stat = await fs.promises.stat(absolute)
              if (stat.isFile() && stat.size <= 512 * 1024) {
                const content = await fs.promises.readFile(absolute, 'utf8')
                managed.observer.recordFileMutation(fork.id, relPath, content)
              }
            } catch {
              // Deleted by the fork agent.
            }
          }
          fork.currentAction = `OpenCode fork agent edited ${forkDiff.length} file(s)`
          fork.currentActionAr = `وكيل الشطر عدّل ${forkDiff.length} ملف`
          this.broadcastSnapshot(managed)
        }
      } else {
        await sleep(1400)
        const sandboxRes = await applySandboxForkIntervention({
          vcs: managed.vcs,
          forkDir: fork.worktreePath,
          userPrompt: fork.userPrompt,
          selectedElement: fork.selectedElement,
          onFileChanged: (relPath, content) => {
            managed.observer.recordFileMutation(fork.id, relPath, content)
          },
        })
        fork.filesModified = sandboxRes.filesModified
        fork.currentAction = sandboxRes.summary
        fork.currentActionAr = sandboxRes.summaryAr
      }

      // Commit Fork Agent's work on its isolated branch
      const forkCommit = await managed.vcs.commitForkChanges(
        fork.worktreePath,
        `fix(${fork.id}): ${fork.userPrompt.slice(0, 68)}`,
      )

      let forkCheckpointId = fork.baseCheckpointId
      if (forkCommit) {
        fork.filesModified = forkCommit.filesChanged
        fork.diffPatch = forkCommit.diffPatch
        fork.linesAdded = forkCommit.linesAdded
        fork.linesRemoved = forkCommit.linesRemoved

        forkCheckpointId = `cp_${fork.id}`
        managed.snapshot.checkpoints.push({
          id: forkCheckpointId,
          commitHash: forkCommit.commitHash,
          shortHash: forkCommit.shortHash,
          stepIndex: managed.snapshot.completedSteps,
          title: `[${fork.id}] ${fork.userPrompt.slice(0, 48)}`,
          titleAr: `[${fork.id}] ${fork.userPrompt.slice(0, 48)}`,
          agentId: fork.id,
          agentRole: 'fork',
          parentCheckpointId: fork.baseCheckpointId,
          filesChanged: forkCommit.filesChanged,
          linesAdded: forkCommit.linesAdded,
          linesRemoved: forkCommit.linesRemoved,
          timestamp: Date.now(),
          diffPatch: forkCommit.diffPatch,
        })
      }

      // Hold in `verifying` so user sees the live Picture-in-Picture Fork Preview before auto-merge!
      fork.status = 'verifying'
      fork.currentAction = `Previewing isolated fork result (${fork.filesModified.join(', ')}) before AST merge...`
      fork.currentActionAr = `يعرض النتيجة المُعدّلة في نافذة الفرع (${fork.filesModified.join('، ')}) ويتحقق قبل الدمج...`
      this.broadcastSnapshot(managed)
      await sleep(2200)

      // Merge fork cleanly back into `main` via Mergiraf AST + Git 3-way merge!
      fork.status = 'merging'
      fork.currentAction = `Merging ${fork.branchName} → main via Mergiraf AST driver...`
      fork.currentActionAr = `يدمج تعديل (${fork.branchName}) في المسار الرئيسي عبر Mergiraf AST...`
      this.broadcastSnapshot(managed)

      const prevMainCp = this.latestMainCheckpoint(managed)
      const mergeOutcome = await managed.vcs.mergeForkIntoMain(
        fork.id,
        fork.branchName,
        fork.userPrompt,
        ({ filePath, conflictedContent, forkPrompt }) =>
          resolveConflictWithLLM({
            config: this.providerConfig,
            filePath,
            conflictedContent,
            forkPrompt,
          }),
      )

      // The terminal status is published only after SUBAGENT_FINISHED is emitted
      // (see below), so a client that waits for `merged` can never miss the event.
      const resolvedStatus: AgentFork['status'] =
        mergeOutcome.strategy === 'ai-diff3-resolved' ? 'conflict_resolved' : 'merged'
      fork.mergeCommitHash = mergeOutcome.commitHash
      fork.mergeStrategy = mergeOutcome.strategy
      fork.mergeSummary = mergeOutcome.summary
      fork.mergeSummaryAr = mergeOutcome.summaryAr
      fork.currentAction = mergeOutcome.summary
      fork.currentActionAr = mergeOutcome.summaryAr
      fork.completedAt = Date.now()

      // Refresh merged files in Observer so Live Code & Live Main Preview update instantly!
      for (const relFile of mergeOutcome.filesModified) {
        const mergedContent = await managed.vcs.readFileInWorktree(managed.vcs.mainDir, relFile)
        if (mergedContent !== null) {
          managed.observer.recordFileMutation('main', relFile, mergedContent)
        }
      }
      managed.observer.markAlertsResolvedForFiles(mergeOutcome.filesModified)

      // Add Merge Checkpoint node uniting Main trunk + Fork branch on the React Flow DAG!
      const mergeCp: GitCheckpoint = {
        id: `cp_merge_${fork.id}`,
        commitHash: mergeOutcome.commitHash,
        shortHash: mergeOutcome.shortHash,
        stepIndex: managed.snapshot.completedSteps,
        title: `Merged ${fork.id} (${mergeOutcome.strategy})`,
        titleAr: `دمج ${fork.id} (${mergeOutcome.strategy === 'mergiraf-ast' ? 'Mergiraf AST' : 'دمج ثلاثي ذكي'})`,
        agentId: fork.id,
        agentRole: 'merge',
        parentCheckpointId: prevMainCp.id,
        secondParentCheckpointId: forkCheckpointId,
        filesChanged: mergeOutcome.filesModified,
        linesAdded: mergeOutcome.linesAdded,
        linesRemoved: mergeOutcome.linesRemoved,
        timestamp: Date.now(),
        diffPatch: mergeOutcome.diffPatch,
        mergeStrategy: mergeOutcome.strategy,
      }
      managed.snapshot.checkpoints.push(mergeCp)
      managed.observer.recordCheckpoint(mergeCp.id, mergeCp.commitHash)

      // Inject Context Sync Notice into Builder Agent if still running!
      const syncText = `[${fork.id} @ ${mergeOutcome.shortHash}] Updated ${mergeOutcome.filesModified.join(', ')}: "${fork.userPrompt}"`
      if (managed.snapshot.status === 'running' || managed.snapshot.status === 'paused') {
        managed.pendingSyncNotices.push(syncText)
        fork.syncNoticeSentToBuilder = true
      }

      // VibeTrace Trace-to-Skill Distillation: persist reusable SKILL.md!
      const skill = this.distiller.distillFromMergedFork({ sessionId, fork })
      fork.distilledSkillId = skill.id

      // Stop fork watcher & clean up temporary worktree directory (Git commit history remains intact!)
      await managed.observer.stopWatchingFork(fork.id)
      await managed.vcs.cleanupForkWorktree(fork.worktreePath)

      this.bus.emitSubagentFinished(sessionId, fork.id, {
        mergeCommit: mergeOutcome.shortHash,
        strategy: mergeOutcome.strategy,
        skillId: skill.id,
      })
      fork.status = resolvedStatus

      this.pushActivity(managed, {
        agentId: fork.id,
        agentRole: 'merger',
        eventType: 'FORK_MERGED',
        message: `${mergeOutcome.summary} • Skill saved: ${skill.slug}`,
        messageAr: `${mergeOutcome.summaryAr} • تم حفظ مهارة جديدة (${skill.nameAr})`,
        filePath: mergeOutcome.filesModified[0],
        commitHash: mergeOutcome.shortHash,
        badge: mergeOutcome.strategy.toUpperCase(),
      })

      this.broadcastSnapshot(managed)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fork.status = 'failed'
      fork.error = msg
      fork.currentAction = `Fork failed: ${msg}`
      fork.currentActionAr = `فشل الفرع المنقسم: ${msg}`
      this.bus.emitSubagentError(sessionId, fork.id, msg)
      this.pushActivity(managed, {
        agentId: fork.id,
        agentRole: 'fork',
        eventType: 'SUBAGENT_ERROR',
        message: `${fork.id} error: ${msg}`,
        messageAr: `خطأ في ${fork.id}: ${msg}`,
        badge: 'ERROR',
      })
      this.broadcastSnapshot(managed)
    }
  }
}
