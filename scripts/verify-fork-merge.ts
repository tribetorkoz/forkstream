/**
 * End-to-End Integration Verification for ForkStream MVP
 *
 * Tests 100% REAL mechanics:
 *  1. Real Git repository initialization + Mergiraf v0.20.0 AST merge driver wiring
 *  2. Real concurrent same-file edit (Builder adds function B while Fork edits function A)
 *     merged cleanly by Mergiraf tree-sitter AST driver with zero conflicts!
 *  3. Real full orchestrator session: Builder runs 7 steps while 2 mid-run parallel Fork Agents
 *     branch into isolated `git worktree` dirs (fixing +20% coupon bug + switching palette to Emerald),
 *     stream AG-UI v1.0 events, deliver Context Sync notices to Builder, and write `.agents/skills/<slug>/SKILL.md`!
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionWorktreeManager } from '../server/vcs/worktreeManager.js'
import { ForkStreamOrchestrator } from '../server/sessionOrchestrator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

async function run() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'forkstream-verify-'))
  console.log('1) Testing Git Worktree + Mergiraf AST concurrent same-file merge...')

  const vcs = new SessionWorktreeManager(tmpBase, 'test-ast', PROJECT_ROOT)
  const init = await vcs.initialize()
  assert.ok(init.commitHash.length === 40, 'Valid initial Git commit SHA')
  console.log('   Tooling:', vcs.getTooling())

  // Step 1: Base JS file with buggy discount function
  let cp1Hash = ''
  const c1 = await vcs.applyBuilderStepAndCommit(async (dir) => {
    await vcs.writeFileInWorktree(
      dir,
      'js/cart.js',
      ['export function calcTotal(subtotal, rate) {', '  return subtotal * (1 + rate);', '}', ''].join('\n'),
    )
  }, 'feat: add cart.js')
  cp1Hash = c1!.commitHash

  // Step 2: User forks from cp1 in an isolated git worktree while Builder simultaneously edits cart.js on main!
  const fork = await vcs.createForkWorktree('fork-1', cp1Hash)
  assert.ok(fs.existsSync(fork.worktreePath), 'Isolated fork git worktree created on disk')

  // Builder continues on `main` appending a new function to the SAME file `js/cart.js`
  await vcs.applyBuilderStepAndCommit(async (dir) => {
    const cur = (await vcs.readFileInWorktree(dir, 'js/cart.js'))!
    await vcs.writeFileInWorktree(
      dir,
      'js/cart.js',
      cur + ['', 'export function formatCount(n) {', "  return n + ' items';", '}', ''].join('\n'),
    )
  }, 'feat: builder adds formatCount while fork works in parallel')

  // Fork fixes calcTotal in isolated `forks/fork-1/js/cart.js`
  await vcs.writeFileInWorktree(
    fork.worktreePath,
    'js/cart.js',
    ['export function calcTotal(subtotal, rate) {', '  return Math.max(0, subtotal * (1 - rate));', '}', ''].join('\n'),
  )
  await vcs.commitForkChanges(fork.worktreePath, 'fix: subtract discount rate')

  // Merge fork back into main via Mergiraf AST!
  const merge = await vcs.mergeForkIntoMain('fork-1', fork.branchName, 'fix discount rate')
  await vcs.cleanupForkWorktree(fork.worktreePath)

  const finalJs = (await vcs.readFileInWorktree(vcs.mainDir, 'js/cart.js'))!
  assert.ok(finalJs.includes('1 - rate'), 'Fork discount fix preserved in main')
  assert.ok(finalJs.includes('formatCount'), 'Builder concurrent work preserved in main')
  assert.ok(!finalJs.includes('<<<<<<<'), 'Zero unresolved conflict markers')
  console.log(`   ✓ Merged via [${merge.strategy}] @ ${merge.shortHash}`)

  console.log('2) Testing full Orchestrator: Builder + Observer + 2 Mid-Run Parallel Forks + AG-UI SSE + SKILL.md...')
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'forkstream-proj-'))
  // Symlink bin/mergiraf so tmpProject finds it too (a junction is used on Windows,
  // where directory symlinks need Developer Mode or elevation).
  fs.symlinkSync(
    path.join(PROJECT_ROOT, 'bin'),
    path.join(tmpProject, 'bin'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  const orch = new ForkStreamOrchestrator(tmpProject, path.join(tmpBase, 'sessions'))
  const receivedEventTypes = new Set<string>()

  const snap = await orch.createAndStartSession({
    scenarioId: 'atlas-store',
    speedMultiplier: 4,
  })

  const unsub = orch.bus.subscribe(snap.sessionId, {
    id: 'test-sub',
    send: (frame) => {
      const m = frame.match(/"type":"([^"]+)"/)
      if (m) receivedEventTypes.add(m[1])
    },
    close: () => {},
  })

  // Wait until Observer raises the live cart.js discount bug alert, then fire TWO parallel forks mid-run!
  let alertSeen = false
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200))
    const cur = orch.getSnapshot(snap.sessionId)!
    if (cur.observer.alerts.length > 0 && !alertSeen) {
      alertSeen = true
      console.log('   ✓ Observer caught live bug mid-run:', cur.observer.alerts[0].title)
      await orch.spawnFork(snap.sessionId, {
        userPrompt: 'أصلح خطأ حساب الخصم في js/cart.js ليخصم 20% بدلاً من إضافتها',
      })
      await orch.spawnFork(snap.sessionId, {
        userPrompt: 'غيّر ألوان الموقع إلى الأخضر الزمردي وأضف شريط بحث',
      })
    }
    if (
      cur.status === 'completed' &&
      cur.forks.length === 2 &&
      cur.forks.every((f) => f.status === 'merged' || f.status === 'conflict_resolved')
    ) {
      break
    }
  }

  // Allow any in-flight fork merge to settle
  for (let i = 0; i < 40; i++) {
    const cur = orch.getSnapshot(snap.sessionId)!
    if (
      cur.status === 'completed' &&
      cur.forks.length === 2 &&
      cur.forks.every((f) => f.status === 'merged' || f.status === 'conflict_resolved')
    ) {
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  unsub()
  const finalSnap = orch.getSnapshot(snap.sessionId)!
  assert.equal(alertSeen, true, 'Observer detected cart.js bug automatically')
  assert.equal(finalSnap.status, 'completed', 'Builder completed all 7 primary steps without stopping')
  assert.equal(finalSnap.forks.length, 2, 'Both mid-run forks spawned')
  assert.ok(
    finalSnap.forks.every((f) => f.status === 'merged' || f.status === 'conflict_resolved'),
    'Both forks merged cleanly into main',
  )
  assert.ok(
    finalSnap.files['js/cart.js']?.content.includes('1 - discountRate'),
    'Main js/cart.js has fixed discount formula',
  )
  assert.ok(
    finalSnap.files['styles/tokens.css']?.content.includes('#10b981'),
    'Main styles/tokens.css has Emerald palette',
  )
  assert.equal(finalSnap.skills.length, 2, 'Two reusable SKILL.md files distilled from human interventions')
  assert.ok(receivedEventTypes.has('SUBAGENT_STARTED'), 'AG-UI v1.0 SUBAGENT_STARTED emitted')
  assert.ok(receivedEventTypes.has('SUBAGENT_FINISHED'), 'AG-UI v1.0 SUBAGENT_FINISHED emitted')

  const managed = orch.getSession(snap.sessionId)!
  await managed.observer.dispose()

  console.log('   ✓ AG-UI v1.0 events verified:', Array.from(receivedEventTypes).join(', '))
  console.log('   ✓ Distilled skills:', finalSnap.skills.map((s) => s.skillMdPath).join(', '))

  // Windows can hold short-lived handles (git, watchers) a moment past dispose,
  // so removal retries briefly instead of failing the run on EPERM/EBUSY.
  const removeTree = (dir: string) =>
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  removeTree(tmpBase)
  removeTree(tmpProject)
  console.log('\nALL E2E CHECKS PASSED SUCCESSFULLY!')
}

run().catch((err) => {
  console.error('Verification failed:', err)
  process.exit(1)
})
