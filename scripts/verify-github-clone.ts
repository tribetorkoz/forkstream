import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { closeDatabase, initializeDatabase } from '../server/db/database.js'
import { ProjectRegistry } from '../server/projects/projectRegistry.js'

const exec = promisify(execFile)
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'forkstream-github-clone-'))
try {
  await initializeDatabase(path.join(temp, 'data', 'test.sqlite'))
  const registry = new ProjectRegistry(path.join(temp, 'projects'))
  const project = await registry.cloneHttps({ url: 'https://github.com/octocat/Hello-World.git', name: 'Clone integration fixture' })
  const { stdout: head } = await exec('git', ['-C', project.canonicalPath, 'rev-parse', '--verify', 'HEAD'])
  const { stdout: remote } = await exec('git', ['-C', project.canonicalPath, 'remote', 'get-url', 'origin'])
  assert.ok(head.trim().length >= 40, 'a real commit exists in the cloned worktree')
  assert.equal(remote.trim(), 'https://github.com/octocat/Hello-World.git')
  assert.equal(project.vcs, 'git')
  assert.ok(await registry.get(project.id), 'cloned repository is recorded in persistent project registry')
  console.log(`GitHub clone integration passed: ${project.name} at ${head.trim().slice(0, 12)} (${project.canonicalPath})`)
} finally {
  await closeDatabase()
  await fs.rm(temp, { recursive: true, force: true })
}
