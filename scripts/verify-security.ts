import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getFsSafeNativeStatus } from '@openclaw/fs-safe'
import { __setFsSafeTestHooksForTest } from '@openclaw/fs-safe/test-hooks'
import { openWorkspaceRoot } from '../server/security/workspaceFs.js'
import { SessionWorktreeManager } from '../server/vcs/worktreeManager.js'
import { ObserverAgent } from '../server/observer/observerAgent.js'
import { assertWorkspacePath, containsHighConfidenceSecret, redactSecrets, WorkspaceAccessError } from '../server/security/workspaceGuard.js'

process.env.NODE_ENV ??= 'test'

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'forkstream-security-'))
const root = path.join(temp, 'workspace')
const outside = path.join(temp, 'outside.txt')
await fs.mkdir(root, { recursive: true })
await fs.writeFile(outside, 'outside secret')
await fs.writeFile(path.join(root, 'app.ts'), 'export const safe = true\n')
await fs.writeFile(path.join(root, '.env'), 'API_KEY=do-not-read-this\n')
await fs.symlink(outside, path.join(root, 'escape.txt'))

try {
  assert.equal(assertWorkspacePath(root, 'app.ts'), path.join(root, 'app.ts'))
  for (const attack of ['../outside.txt', '%2e%2e/outside.txt', '%252e%252e/outside.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'escape.txt', '.env', '.git/config', '.git/hooks/pre-commit', '.hg/hgrc', '.svn/entries']) {
    assert.throws(() => assertWorkspacePath(root, attack), WorkspaceAccessError, `deny ${attack}`)
  }
  const vcs = new SessionWorktreeManager(path.join(temp, 'workspaces'), 'test', temp)
  assert.equal(await vcs.readFileInWorktree(root, '.env'), null, 'sensitive file not readable through workspace API')
  assert.equal(await vcs.readFileInWorktree(root, 'escape.txt'), null, 'symlink target not readable through workspace API')
  assert.ok(!(await vcs.listFilesInWorktree(root)).includes('.env'))
  assert.ok(!(await vcs.listFilesInWorktree(root)).includes('escape.txt'))
  await vcs.writeFileInWorktree(root, 'native-probe.txt', 'native helper probe')
  const nativeStatus = await getFsSafeNativeStatus()
  assert.equal(nativeStatus.mode, 'require')
  assert.ok(nativeStatus.loaded, 'filesystem native binding is required and loaded')
  const readProbe = await (await openWorkspaceRoot(root)).read('app.ts')
  assert.ok(['kernel-atomic', 'best-effort'].includes(readProbe.containment))
  console.log(`[fs-safe] native=${nativeStatus.packageName}@${nativeStatus.packageVersion}; read containment=${readProbe.containment}`)

  const racedReadPath = path.join(root, 'raced-read.txt')
  await fs.writeFile(racedReadPath, 'workspace file')
  let readRaceInjected = false
  __setFsSafeTestHooksForTest({
    afterRootReadPathResolution: async (resolvedPath) => {
      if (readRaceInjected || resolvedPath !== racedReadPath) return
      readRaceInjected = true
      await fs.rename(racedReadPath, `${racedReadPath}.original`)
      await fs.symlink(outside, racedReadPath)
    },
  })
  try {
    assert.equal(await vcs.readFileInWorktree(root, 'raced-read.txt'), null, 'a symlink swapped after resolution is not read')
  } finally {
    __setFsSafeTestHooksForTest()
  }
  assert.ok(readRaceInjected, 'read-race injection hook executed')
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside secret', 'race did not disclose or mutate outside target')

  await assert.rejects(vcs.writeFileInWorktree(root, '../outside.txt', 'overwrite'), WorkspaceAccessError)
  await assert.rejects(vcs.writeFileInWorktree(root, '.env', 'new secret'), WorkspaceAccessError)
  await assert.rejects(vcs.writeFileInWorktree(root, '.git/config', '[filter "exfil"]\\nclean = touch /tmp/pwned'), WorkspaceAccessError)
  await assert.rejects(vcs.writeFileInWorktree(root, 'credential.ts', 'const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"'), WorkspaceAccessError)

  // An agent-controlled .gitattributes must not activate a filter from the server user's global Git config.
  const filterVcs = new SessionWorktreeManager(path.join(temp, 'isolated-git'), 'filter-test', temp)
  await filterVcs.initialize()
  assert.equal(await filterVcs.readFileForAgent(filterVcs.mainDir, '.git/config'), null,
    'agent reads cannot inspect repository metadata')
  await assert.rejects(
    filterVcs.writeFileInWorktree(filterVcs.mainDir, '.git/config', '[core]\\n hooksPath = /tmp/attacker-hooks'),
    WorkspaceAccessError,
  )
  const filterConfig = path.join(temp, 'attacker-gitconfig')
  const filterMarker = path.join(temp, 'git-filter-ran')
  await fs.writeFile(filterConfig, `[filter "exfil"]\\n  clean = touch '${filterMarker}'\\n  required = true\\n`)
  await filterVcs.writeFileInWorktree(filterVcs.mainDir, '.gitattributes', '*.pwn filter=exfil\\n')
  await filterVcs.writeFileInWorktree(filterVcs.mainDir, 'payload.pwn', 'untrusted payload\\n')
  const originalGitConfig = process.env.GIT_CONFIG_GLOBAL
  process.env.GIT_CONFIG_GLOBAL = filterConfig
  try {
    await filterVcs.commitMainCheckpoint('test: isolate git config')
  } finally {
    if (originalGitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = originalGitConfig
  }
  assert.equal(await fs.stat(filterMarker).then(() => true).catch(() => false), false,
    'global Git clean filters must not execute during agent-controlled commits')
  await assert.rejects(vcs.writeFileInWorktree(root, 'config.ts', 'api_key = "custom-secret-value-12345"'), WorkspaceAccessError)
  await fs.writeFile(path.join(root, 'config.ts'), 'password = "custom-secret-value-12345"')
  await assert.rejects(vcs.readFileForAgent(root, 'config.ts'), WorkspaceAccessError)

  const secret = 'const apiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";\n'
  assert.ok(containsHighConfidenceSecret(secret))
  assert.ok(!redactSecrets(secret).includes('sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'))
  let observed = ''
  const observer = new ObserverAgent((event) => { observed = event.snapshot.content }, () => {})
  observer.recordFileMutation('main', 'app.ts', secret)
  assert.ok(!observed.includes('sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'), 'observer snapshot redacts a provider-style key')
  await observer.dispose()

  console.log('Part 02 security slice passed: traversal/encoding/absolute path rejection, injected symlink-swap read race denial, Git metadata protection/global-filter isolation, sensitive-path block, guarded writes, secret write/read detection, and observer redaction.')
} finally {
  await fs.rm(temp, { recursive: true, force: true })
}
