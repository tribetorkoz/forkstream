import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendEvent, closeDatabase, getDatabase, initializeDatabase, latestEventSequence, readEvents } from '../server/db/database.js'
import { AguiSessionBus } from '../server/aguiBus.js'
import { listPersistedSessions, markUnfinishedSessionsInterrupted, persistSessionSnapshot, persistToolInvocation, persistUsageRecord, readPersistedSnapshot } from '../server/db/sessionRepository.js'
import { agents, checkpoints, forks, messages, toolInvocations, usageRecords } from '../server/db/schema.js'
import { ProjectRegistry } from '../server/projects/projectRegistry.js'
import { ForkStreamOrchestrator } from '../server/sessionOrchestrator.js'
import { SessionWorktreeManager } from '../server/vcs/worktreeManager.js'
import { getScenarioSteps } from '../server/adapters/sandboxEngine.js'
import type { SessionStateSnapshot } from '../shared/types.js'

const exec = promisify(execFile)
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'forkstream-part01-'))
const dbPath = path.join(temp, 'data', 'app.sqlite')
const repoPath = path.join(temp, 'sample-repository')

try {
  await initializeDatabase(dbPath)
  await fs.mkdir(repoPath, { recursive: true })
  await exec('git', ['init', '-b', 'main'], { cwd: repoPath })
  await fs.writeFile(path.join(repoPath, 'package.json'), JSON.stringify({ name: 'sample', scripts: { test: 'node --test', build: 'vite build' } }))
  await fs.writeFile(path.join(repoPath, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await fs.writeFile(path.join(repoPath, 'tsconfig.json'), '{}')
  await fs.writeFile(path.join(repoPath, 'README.md'), '# Sample\n')

  const registry = new ProjectRegistry(path.join(temp, 'clones'))
  const project = await registry.registerLocal({ path: repoPath })
  assert.equal(project.vcs, 'git')
  assert.equal(project.defaultBranch, 'main')
  assert.deepEqual(project.languages, ['JavaScript/TypeScript'])
  assert.deepEqual(project.packageManagers, ['pnpm'])
  assert.equal(project.detectedCommands.test, 'node --test')
  assert.equal((await registry.registerLocal({ path: repoPath })).id, project.id, 'local path registration is idempotent')
  const blankProject = await registry.createNew({ name: 'Blank Project' })
  assert.equal(blankProject.source, 'local')
  assert.deepEqual(await fs.readdir(blankProject.canonicalPath), [], 'new project directory is created empty and persisted')

  const event1 = await appendEvent({ streamId: 'session:test', eventType: 'session.created', payload: { prompt: 'persist me' } })
  const event2 = await appendEvent({ streamId: 'session:test', eventType: 'agent.started', payload: { role: 'builder' } })
  assert.equal(event1.sequence, 1)
  assert.equal(event2.sequence, 2)
  assert.equal(await latestEventSequence('session:test'), 2)
  assert.deepEqual(await readEvents('session:test', 1), [event2])
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => appendEvent({
    streamId: 'session:concurrent', eventType: 'concurrent.test', payload: { index },
  })))
  assert.deepEqual(concurrent.map((event) => event.sequence).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8])
  const bus = new AguiSessionBus(path.join(temp, 'transcripts'))
  bus.emitCustom('ses_bus_test', 'test.persisted', { ok: true })
  await bus.flushPersistence()
  assert.equal((await readEvents('ses_bus_test'))[0]?.eventType, 'CUSTOM', 'AG-UI events flow into durable event log')

  const snapshot = {
    sessionId: 'ses_persistence_test', title: 'Persistence test', prompt: 'test', mode: 'sandbox', status: 'running',
    speedMultiplier: 1, totalSteps: 1, completedSteps: 0, currentBuilderAction: '', currentBuilderActionAr: '',
    mergirafAvailable: false, mergirafVersion: null, gitVersion: 'git', repoPath: repoPath, previewUrl: '',
    files: {}, forkFiles: {}, checkpoints: [{
      id: 'cp_0', commitHash: '0123456789abcdef', shortHash: '0123456', stepIndex: 0,
      title: 'Initial checkpoint', titleAr: 'نقطة البداية', agentId: 'builder', agentRole: 'builder',
      filesChanged: [], linesAdded: 0, linesRemoved: 0, timestamp: Date.now(), diffPatch: '',
    }], forks: [{
      id: 'fork_test', branchName: 'fork/test', worktreePath: path.join(temp, 'fork-test'), baseCheckpointId: 'cp_0',
      baseCommitHash: '0123456789abcdef', baseShortHash: '0123456', userPrompt: 'test fork', targetFiles: [],
      status: 'working', currentAction: 'working', currentActionAr: 'يعمل', filesModified: [], diffPatch: '',
      linesAdded: 0, linesRemoved: 0, previewUrl: '', syncNoticeSentToBuilder: false, createdAt: Date.now(),
    }], observer: {}, consoleLogs: [], activity: [{ 
      id: 'act_1', agentId: 'builder', agentRole: 'builder', eventType: 'TEST',
      message: 'Persist activity', messageAr: 'حفظ النشاط', timestamp: Date.now(),
    }],
    syncNoticesDelivered: [], skills: [], createdAt: Date.now(),
  } as unknown as SessionStateSnapshot
  await persistSessionSnapshot(snapshot, project.id)
  await persistToolInvocation({ id: 'tc_test', sessionId: snapshot.sessionId, toolName: 'read_file', inputJson: '{"path":"README.md"}', outputText: '# Sample' })
  const priorPricing = process.env.FORKSTREAM_MODEL_PRICING_JSON
  process.env.FORKSTREAM_MODEL_PRICING_JSON = JSON.stringify({ 'test/test-model': { inputUsdPerMillion: 2, outputUsdPerMillion: 4 } })
  await persistUsageRecord({ id: 'usage_test', sessionId: snapshot.sessionId, provider: 'test', model: 'test-model', inputTokens: 123, outputTokens: 45 })
  if (priorPricing === undefined) delete process.env.FORKSTREAM_MODEL_PRICING_JSON
  else process.env.FORKSTREAM_MODEL_PRICING_JSON = priorPricing
  assert.equal((await readPersistedSnapshot(snapshot.sessionId))?.title, 'Persistence test')
  assert.equal((await getDatabase().select().from(agents)).length, 3, 'builder, observer, and fork agent rows are persisted')
  assert.equal((await getDatabase().select().from(forks)).length, 1, 'fork row is persisted')
  assert.equal((await getDatabase().select().from(checkpoints)).length, 1, 'checkpoint rows are persisted')
  assert.equal((await getDatabase().select().from(messages)).length, 2, 'initial prompt and activity/message rows are persisted')
  assert.equal((await getDatabase().select().from(toolInvocations)).length, 1, 'tool invocation rows are persisted')
  const usage = (await getDatabase().select().from(usageRecords))[0]
  assert.equal(usage.inputTokens, 123)
  assert.equal(usage.costMicrousd, 426, 'configured per-million-token rates are converted to micro-USD')
  assert.match(usage.metadataJson, /explicitly configured/)

  await closeDatabase()
  await initializeDatabase(dbPath)
  const reopened = new ProjectRegistry(path.join(temp, 'clones'))
  const saved = await reopened.get(project.id)
  assert.equal(saved?.canonicalPath, await fs.realpath(repoPath), 'project survives server/database restart')
  assert.ok(await reopened.get(blankProject.id), 'new project registry entry survives restart')
  assert.equal((await getDatabase().select().from(toolInvocations)).length, 1, 'tool call record survives restart')
  assert.equal((await getDatabase().select().from(usageRecords))[0]?.outputTokens, 45, 'token usage survives restart')
  assert.equal((await readEvents('session:test')).length, 2, 'event log survives restart')
  assert.equal((await readPersistedSnapshot(snapshot.sessionId))?.sessionId, snapshot.sessionId, 'session snapshot survives restart')
  assert.equal(await markUnfinishedSessionsInterrupted(), 1, 'unfinished session is recognized on restart')
  assert.equal((await listPersistedSessions()).find((item) => item.id === snapshot.sessionId)?.status, 'interrupted')
  assert.equal((await readPersistedSnapshot(snapshot.sessionId))?.status, 'interrupted', 'recovered snapshot status is explicit')

  const recoverySessionId = 'ses_recovery_integration'
  const recoveryWorkspaces = path.join(temp, 'recovery-workspaces')
  const vcs = new SessionWorktreeManager(recoveryWorkspaces, recoverySessionId, temp)
  const root = await vcs.initialize()
  const scenario = getScenarioSteps('atlas-store')
  const firstContent = await scenario[0].apply(vcs, vcs.mainDir, 'Build a store')
  const firstCommit = await vcs.commitMainCheckpoint('recovery fixture: step one')
  assert.ok(firstCommit)
  const recoverySnapshot = {
    sessionId: recoverySessionId, title: 'Recoverable sandbox', prompt: 'Build a store', scenarioId: 'atlas-store',
    mode: 'sandbox', status: 'running', speedMultiplier: 4, totalSteps: scenario.length, completedSteps: 1,
    currentBuilderAction: 'step one complete', currentBuilderActionAr: 'اكتملت الخطوة الأولى',
    mergirafAvailable: false, mergirafVersion: null, gitVersion: 'git', repoPath: vcs.mainDir, previewUrl: '',
    files: { [scenario[0].filePath]: { path: scenario[0].filePath, content: firstContent, previousContent: '', diffPatch: '', linesAdded: 1, linesRemoved: 0, updatedAt: Date.now(), updatedBy: 'builder', worktree: 'main', touchCount: 1 } },
    forkFiles: {}, checkpoints: [
      { id: 'cp_0', commitHash: root.commitHash, shortHash: root.shortHash, stepIndex: 0, title: 'root', titleAr: 'الجذر', agentId: 'builder', agentRole: 'builder', filesChanged: [], linesAdded: 0, linesRemoved: 0, timestamp: Date.now(), diffPatch: '' },
      { id: 'cp_1', commitHash: firstCommit.commitHash, shortHash: firstCommit.shortHash, stepIndex: 1, title: scenario[0].title, titleAr: scenario[0].titleAr, agentId: 'builder', agentRole: 'builder', parentCheckpointId: 'cp_0', filesChanged: firstCommit.filesChanged, linesAdded: firstCommit.linesAdded, linesRemoved: firstCommit.linesRemoved, timestamp: Date.now(), diffPatch: firstCommit.diffPatch },
    ],
    forks: [], observer: {}, consoleLogs: [], activity: [], syncNoticesDelivered: [], skills: [], createdAt: Date.now(),
  } as unknown as SessionStateSnapshot
  await persistSessionSnapshot(recoverySnapshot)
  assert.equal(await markUnfinishedSessionsInterrupted(), 1, 'a running sandbox is converted to interrupted for the recovery test')
  const recoveryOrchestrator = new ForkStreamOrchestrator(temp, recoveryWorkspaces)
  const resumed = await recoveryOrchestrator.recoverSandboxSession(recoverySessionId)
  assert.equal(resumed.status, 'running')
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const live = recoveryOrchestrator.getSnapshot(recoverySessionId)
    if (live?.status === 'completed' || live?.status === 'error') break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const recoveredResult = recoveryOrchestrator.getSnapshot(recoverySessionId)
  assert.equal(recoveredResult?.status, 'completed', 'sandbox builder continues after the persisted checkpoint')
  assert.equal(recoveredResult?.completedSteps, scenario.length)
  assert.equal(new Set(recoveredResult?.checkpoints.map((checkpoint) => checkpoint.id)).size, scenario.length + 1, 'recovery does not duplicate completed checkpoint IDs')
  await recoveryOrchestrator.getSession(recoverySessionId)?.observer.dispose()

  await assert.rejects(() => reopened.cloneHttps({ url: 'https://example.com/owner/repo.git' }), /restricted to github.com/)
  console.log('Part 01 passed: WAL/migrations, persistent new+local projects, Git/language/command discovery, atomic session/agent/fork/checkpoint/message/tool/usage storage, AG-UI event persistence/replay, concurrent local event sequencing, interrupted-session recovery, and clone-host validation.')
} finally {
  await closeDatabase()
  await fs.rm(temp, { recursive: true, force: true })
}
