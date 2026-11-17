import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { execFile as execFileCallback } from 'node:child_process'
import { desc, eq } from 'drizzle-orm'
import { getDatabase, withDatabaseWriteLock } from '../db/database.js'
import { projects } from '../db/schema.js'
import { isolatedGitEnv } from '../security/gitEnvironment.js'

const execFile = promisify(execFileCallback)
const GIT_TIMEOUT_MS = 8_000

export type ProjectSource = 'local' | 'clone'
export interface ProjectDetection {
  vcs: 'git' | 'none'
  defaultBranch: string | null
  languages: string[]
  packageManagers: string[]
  detectedCommands: Record<string, string>
}
export interface ProjectRecord {
  id: string
  name: string
  canonicalPath: string
  source: ProjectSource
  remoteUrl: string | null
  vcs: 'git' | 'none'
  defaultBranch: string | null
  languages: string[]
  packageManagers: string[]
  detectedCommands: Record<string, string>
  lastOpenedAt: number | null
  createdAt: number
  updatedAt: number
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

function toRecord(row: typeof projects.$inferSelect): ProjectRecord {
  return {
    id: row.id, name: row.name, canonicalPath: row.canonicalPath, source: row.source,
    remoteUrl: row.remoteUrl, vcs: row.vcs, defaultBranch: row.defaultBranch,
    languages: parseJson(row.languagesJson, []), packageManagers: parseJson(row.packageManagersJson, []),
    detectedCommands: parseJson(row.detectedCommandsJson, {}), lastOpenedAt: row.lastOpenedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

async function git(pathname: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['-C', pathname, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true, env: isolatedGitEnv() })
    return stdout.trim()
  } catch {
    return null
  }
}

async function detect(pathname: string): Promise<ProjectDetection> {
  const topLevel = await git(pathname, ['rev-parse', '--show-toplevel'])
  let defaultBranch: string | null = null
  if (topLevel) {
    defaultBranch = await git(pathname, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    if (defaultBranch?.startsWith('origin/')) defaultBranch = defaultBranch.slice('origin/'.length)
    if (!defaultBranch) defaultBranch = await git(pathname, ['branch', '--show-current'])
    if (!defaultBranch) defaultBranch = 'HEAD'
  }

  const names = new Set(await fs.readdir(pathname).catch(() => [] as string[]))
  const languages = new Set<string>()
  if (['package.json', 'tsconfig.json', 'vite.config.ts', 'next.config.js', 'next.config.ts'].some((n) => names.has(n))) languages.add('JavaScript/TypeScript')
  if (['pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py'].some((n) => names.has(n))) languages.add('Python')
  if (names.has('go.mod')) languages.add('Go')
  if (names.has('Cargo.toml')) languages.add('Rust')
  if (names.has('pom.xml') || names.has('build.gradle') || names.has('build.gradle.kts')) languages.add('Java/Kotlin')
  if (names.has('composer.json')) languages.add('PHP')
  if (names.has('Gemfile')) languages.add('Ruby')
  if ([...names].some((name) => name.endsWith('.sln'))) languages.add('C#')

  const packageManagers: string[] = []
  if (names.has('pnpm-lock.yaml')) packageManagers.push('pnpm')
  if (names.has('yarn.lock')) packageManagers.push('yarn')
  if (names.has('package-lock.json')) packageManagers.push('npm')
  if (names.has('bun.lockb') || names.has('bun.lock')) packageManagers.push('bun')
  if (names.has('uv.lock')) packageManagers.push('uv')
  if (names.has('poetry.lock')) packageManagers.push('poetry')
  if (names.has('Cargo.lock')) packageManagers.push('cargo')
  if (names.has('go.sum')) packageManagers.push('go')

  const detectedCommands: Record<string, string> = {}
  if (names.has('package.json')) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(pathname, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
      for (const key of ['dev', 'build', 'test', 'lint', 'typecheck']) {
        if (typeof pkg.scripts?.[key] === 'string') detectedCommands[key] = pkg.scripts[key]
      }
    } catch { /* malformed manifest is reported as absent metadata, never executed here */ }
  }
  if (names.has('pyproject.toml') || names.has('requirements.txt')) detectedCommands.test ??= 'python -m pytest'
  if (names.has('go.mod')) detectedCommands.test ??= 'go test ./...'
  if (names.has('Cargo.toml')) detectedCommands.test ??= 'cargo test'

  return { vcs: topLevel ? 'git' : 'none', defaultBranch, languages: [...languages].sort(), packageManagers, detectedCommands }
}

function assertSafeProjectName(name: string): string {
  const clean = name.trim().replace(/[\\/\0-\x1f]/g, '-').replace(/\s+/g, ' ').slice(0, 120)
  if (!clean) throw new Error('Project name must not be empty')
  return clean
}

export class ProjectRegistry {
  constructor(private readonly cloneRoot: string) {}

  async list(): Promise<ProjectRecord[]> {
    const rows = await getDatabase().select().from(projects).orderBy(desc(projects.lastOpenedAt), desc(projects.createdAt))
    return rows.map(toRecord)
  }

  async get(id: string): Promise<ProjectRecord | null> {
    const [row] = await getDatabase().select().from(projects).where(eq(projects.id, id)).limit(1)
    return row ? toRecord(row) : null
  }

  async createNew(input: { name: string }): Promise<ProjectRecord> {
    const name = assertSafeProjectName(input.name)
    const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project'
    await fs.mkdir(this.cloneRoot, { recursive: true })
    const target = path.join(this.cloneRoot, `new-${slug}-${randomUUID().slice(0, 8)}`)
    await fs.mkdir(target, { recursive: false })
    try {
      return await this.registerLocal({ path: target, name })
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true })
      throw error
    }
  }

  async registerLocal(input: { path: string; name?: string }): Promise<ProjectRecord> {
    const canonicalPath = await fs.realpath(path.resolve(input.path)).catch(() => null)
    if (!canonicalPath) throw new Error('Project path does not exist')
    const stat = await fs.stat(canonicalPath)
    if (!stat.isDirectory()) throw new Error('Project path must be a directory')
    const detection = await detect(canonicalPath)
    const now = Date.now()
    const existing = await getDatabase().select().from(projects).where(eq(projects.canonicalPath, canonicalPath)).limit(1)
    if (existing[0]) {
      await withDatabaseWriteLock(() => getDatabase().update(projects).set({ name: assertSafeProjectName(input.name || path.basename(canonicalPath)), ...this.toColumns(detection), lastOpenedAt: now, updatedAt: now }).where(eq(projects.id, existing[0].id)))
      return (await this.get(existing[0].id))!
    }
    const id = `prj_${randomUUID()}`
    await withDatabaseWriteLock(() => getDatabase().insert(projects).values({
      id, name: assertSafeProjectName(input.name || path.basename(canonicalPath)), canonicalPath,
      source: 'local', remoteUrl: null, ...this.toColumns(detection), lastOpenedAt: now, createdAt: now, updatedAt: now,
    }))
    return (await this.get(id))!
  }

  async cloneHttps(input: { url: string; name?: string }): Promise<ProjectRecord> {
    let url: URL
    try { url = new URL(input.url) } catch { throw new Error('A valid HTTPS Git URL is required') }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) {
      throw new Error('Only credential-free HTTPS Git URLs are accepted')
    }
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
      throw new Error('For this first production slice, cloning is restricted to github.com HTTPS URLs')
    }
    const slug = (path.basename(url.pathname).replace(/\.git$/i, '') || 'repository').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)
    await fs.mkdir(this.cloneRoot, { recursive: true })
    const target = path.join(this.cloneRoot, `${slug}-${randomUUID().slice(0, 8)}`)
    await execFile('git', ['clone', '--', url.toString(), target], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: isolatedGitEnv() })
      .catch(async (error) => { await fs.rm(target, { recursive: true, force: true }); throw new Error(`Git clone failed: ${error instanceof Error ? error.message : String(error)}`) })
    const canonicalPath = await fs.realpath(target)
    const detection = await detect(canonicalPath)
    const now = Date.now()
    const id = `prj_${randomUUID()}`
    try {
      await withDatabaseWriteLock(() => getDatabase().insert(projects).values({
        id, name: assertSafeProjectName(input.name || slug), canonicalPath, source: 'clone', remoteUrl: url.toString(),
        ...this.toColumns(detection), lastOpenedAt: now, createdAt: now, updatedAt: now,
      }))
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true })
      throw error
    }
    return (await this.get(id))!
  }

  async markOpened(id: string): Promise<ProjectRecord | null> {
    const existing = await this.get(id)
    if (!existing) return null
    const canonicalPath = await fs.realpath(existing.canonicalPath).catch(() => null)
    if (!canonicalPath) return null
    const stat = await fs.stat(canonicalPath).catch(() => null)
    if (!stat?.isDirectory()) return null
    const detection = await detect(canonicalPath)
    const now = Date.now()
    await withDatabaseWriteLock(() => getDatabase().update(projects).set({
      canonicalPath, ...this.toColumns(detection), lastOpenedAt: now, updatedAt: now,
    }).where(eq(projects.id, id)))
    return this.get(id)
  }

  private toColumns(detection: ProjectDetection) {
    return {
      vcs: detection.vcs, defaultBranch: detection.defaultBranch,
      languagesJson: JSON.stringify(detection.languages),
      packageManagersJson: JSON.stringify(detection.packageManagers),
      detectedCommandsJson: JSON.stringify(detection.detectedCommands),
    }
  }
}
