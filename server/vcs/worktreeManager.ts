/**
 * Git Worktree Isolation, Atomic Checkpointing & Mergiraf AST Structural Merge Engine.
 *
 * Implements proven multi-agent VCS patterns from:
 *  - BloopAI/vibe-kanban & smtg-ai/claude-squad: `git worktree add -b fork/<id> <dir> <commit>`
 *  - Mergiraf (codeberg.org/mergiraf/mergiraf): tree-sitter syntax-aware 3-way Git merge driver
 *    configured via `merge.mergiraf.driver = "mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L"`
 *    plus `* merge=mergiraf` in `.git/info/attributes` and `merge.conflictStyle = diff3`
 *  - gfix (gfix.space) 3-layer merge pipeline: Structural AST Merge (Mergiraf) -> diff3 / LLM Resolver -> Commit Gate
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { diffLines } from 'diff'
import { assertWorkspacePath, containsLikelySecret, isSensitivePath, WorkspaceAccessError } from '../security/workspaceGuard.js'
import { FsSafeError } from '@openclaw/fs-safe'
import { openWorkspaceRoot } from '../security/workspaceFs.js'
import { isolatedGitEnv } from '../security/gitEnvironment.js'

const execFileAsync = promisify(execFile)

export interface ToolingInfo {
  gitVersion: string
  mergirafPath: string | null
  mergirafVersion: string | null
}

export interface CommitResult {
  commitHash: string
  shortHash: string
  diffPatch: string
  filesChanged: string[]
  linesAdded: number
  linesRemoved: number
}

export interface MergeOutcome {
  commitHash: string
  shortHash: string
  strategy: 'mergiraf-ast' | 'git-ort-clean' | 'ai-diff3-resolved' | 'fast-forward'
  filesModified: string[]
  conflictedFilesResolved: string[]
  diffPatch: string
  linesAdded: number
  linesRemoved: number
  summary: string
  summaryAr: string
}

export type ConflictResolverFn = (params: {
  filePath: string
  conflictedContent: string
  forkPrompt: string
}) => Promise<string | null>

/**
 * Simple FIFO async mutex ensuring atomic git commits/merges on `main`
 * while Builder Agent and multiple Fork Agents write concurrently to separate worktrees.
 */
class AsyncMutex {
  private queue: Promise<void> = Promise.resolve()

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const prev = this.queue
    this.queue = prev.then(() => next)
    await prev
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

let cachedTooling: ToolingInfo | null = null

export async function detectVcsTooling(projectRoot: string): Promise<ToolingInfo> {
  if (cachedTooling) return cachedTooling

  let gitVersion = 'git'
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { env: isolatedGitEnv() })
    gitVersion = stdout.trim()
  } catch {
    gitVersion = 'git (unavailable)'
  }

  let mergirafPath: string | null = null
  let mergirafVersion: string | null = null

  const localBin = path.join(projectRoot, 'bin', 'mergiraf')
  const candidates = [localBin, 'mergiraf']
  for (const candidate of candidates) {
    try {
      if (candidate === localBin) {
        if (!fs.existsSync(localBin)) continue
        try {
          fs.chmodSync(localBin, 0o755)
        } catch {
          // ignore if read-only fs
        }
      }
      const { stdout } = await execFileAsync(candidate, ['--version'])
      mergirafPath = candidate
      mergirafVersion = stdout.trim()
      break
    } catch {
      // try next candidate
    }
  }

  cachedTooling = { gitVersion, mergirafPath, mergirafVersion }
  return cachedTooling
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: isolatedGitEnv(),
  })
}

/**
 * Deterministic diff3 conflict resolver (preferring the human-requested fork fix
 * while preserving non-overlapping additions when no external LLM key is provided).
 */
export function resolveDiff3PreferTheirs(conflicted: string): string {
  // Matches git conflictStyle=diff3 blocks:
  // <<<<<<< HEAD
  // ...ours...
  // ||||||| base
  // ...base...
  // =======
  // ...theirs (fork)...
  // >>>>>>> fork/...
  const diff3Regex =
    /<<<<<<<[^\n]*\n([\s\S]*?)\|\|\|\|\|\|\|[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n?/g

  if (diff3Regex.test(conflicted)) {
    return conflicted.replace(diff3Regex, (_match, ours: string, base: string, theirs: string) => {
      // If Builder appended brand-new lines beyond base while Fork edited base lines, keep both!
      const baseTrim = base.trim()
      const oursTrim = ours.trim()
      const theirsTrim = theirs.trim()
      if (baseTrim && oursTrim.startsWith(baseTrim) && oursTrim.length > baseTrim.length) {
        const builderAppended = ours.slice(ours.indexOf(base) + base.length)
        return theirs + builderAppended
      }
      if (!theirsTrim) return ours
      return theirs
    })
  }

  // Standard 2-way conflict markers fallback
  const twoWayRegex = /<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n?/g
  return conflicted.replace(twoWayRegex, (_m, _ours: string, theirs: string) => theirs)
}

function countPatchStats(patch: string): { linesAdded: number; linesRemoved: number } {
  let linesAdded = 0
  let linesRemoved = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) linesAdded++
    else if (line.startsWith('-')) linesRemoved++
  }
  return { linesAdded, linesRemoved }
}

/** Directories never copied into a session workspace (secrets, binaries, recursion). */
const SEED_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'data', 'workspaces', '.agents'])
/** Individual files never copied into a session workspace. */
const SEED_SKIP_FILES = new Set(['bin/mergiraf', 'bin/mergiraf.exe'])
const SEED_MAX_FILE_BYTES = 2 * 1024 * 1024
const SEED_MAX_FILES = 5000

function seedWorkspace(sourceRoot: string, targetRoot: string): number {
  let copied = 0
  const walk = (relative: string): void => {
    if (copied >= SEED_MAX_FILES) return
    const absolute = path.join(sourceRoot, relative)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (copied >= SEED_MAX_FILES) return
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      const normalized = rel.split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (SEED_SKIP_DIRS.has(entry.name)) continue
        fs.mkdirSync(path.join(targetRoot, rel), { recursive: true })
        walk(rel)
        continue
      }
      if (!entry.isFile() || SEED_SKIP_FILES.has(normalized)) continue
      try {
        const stat = fs.statSync(path.join(sourceRoot, rel))
        if (stat.size > SEED_MAX_FILE_BYTES) continue
        fs.mkdirSync(path.dirname(path.join(targetRoot, rel)), { recursive: true })
        fs.copyFileSync(path.join(sourceRoot, rel), path.join(targetRoot, rel))
        copied++
      } catch {
        // Skip unreadable/locked files rather than failing the whole session.
      }
    }
  }
  walk('')
  return copied
}

export class SessionWorktreeManager {
  readonly sessionRoot: string
  readonly mainDir: string
  readonly forksRoot: string
  private readonly mainMutex = new AsyncMutex()
  private tooling!: ToolingInfo

  constructor(workspacesRoot: string, readonly sessionId: string, private readonly projectRoot: string) {
    this.sessionRoot = path.join(workspacesRoot, sessionId)
    this.mainDir = path.join(this.sessionRoot, 'main')
    this.forksRoot = path.join(this.sessionRoot, 'forks')
  }

  getTooling(): ToolingInfo {
    return this.tooling
  }

  async attachExisting(): Promise<void> {
    this.tooling = await detectVcsTooling(this.projectRoot)
    if (!fs.existsSync(this.mainDir) || !fs.statSync(this.mainDir).isDirectory()) {
      throw new Error(`Cannot recover session: worktree is missing at ${this.mainDir}`)
    }
    const topLevel = await runGit(this.mainDir, ['rev-parse', '--show-toplevel'])
    if (path.resolve(topLevel.stdout.trim()) !== path.resolve(this.mainDir)) {
      throw new Error('Cannot recover session: stored worktree root does not match the expected session directory')
    }
    await runGit(this.mainDir, ['status', '--porcelain'])
  }

  async initialize(options?: { seedFrom?: string }): Promise<CommitResult> {
    this.tooling = await detectVcsTooling(this.projectRoot)
    fs.mkdirSync(this.mainDir, { recursive: true })
    fs.mkdirSync(this.forksRoot, { recursive: true })

    // Real agents (LLM API / OpenCode) need the actual project files to edit; the
    // sandbox engine fabricates its own content, so it keeps an empty scaffold.
    if (options?.seedFrom) seedWorkspace(options.seedFrom, this.mainDir)

    await runGit(this.mainDir, ['init', '-b', 'main'])
    await runGit(this.mainDir, ['config', 'user.name', 'ForkStream Agent'])
    await runGit(this.mainDir, ['config', 'user.email', 'agent@forkstream.local'])
    await runGit(this.mainDir, ['config', 'merge.conflictStyle', 'diff3'])

    // Wire real Mergiraf syntax-aware AST merge driver if installed (documented at mergiraf.org)
    if (this.tooling.mergirafPath) {
      const driverCmd = `"${this.tooling.mergirafPath}" merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L`
      await runGit(this.mainDir, ['config', 'merge.mergiraf.name', 'mergiraf syntax-aware AST merge'])
      await runGit(this.mainDir, ['config', 'merge.mergiraf.driver', driverCmd])

      const infoDir = path.join(this.mainDir, '.git', 'info')
      fs.mkdirSync(infoDir, { recursive: true })
      fs.writeFileSync(
        path.join(infoDir, 'attributes'),
        [
          '*.js merge=mergiraf',
          '*.jsx merge=mergiraf',
          '*.ts merge=mergiraf',
          '*.tsx merge=mergiraf',
          '*.html merge=mergiraf',
          '*.css merge=mergiraf',
          '*.json merge=mergiraf',
          '*.py merge=mergiraf',
          '*.md merge=union',
        ].join('\n') + '\n',
        'utf8',
      )
    }

    // Create initial root commit so `git worktree add` can branch from step 0 immediately
    const gitkeep = path.join(this.mainDir, '.forkstream')
    fs.writeFileSync(
      gitkeep,
      JSON.stringify({ sessionId: this.sessionId, createdAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    )
    await runGit(this.mainDir, ['add', '-A'])
    await runGit(this.mainDir, ['commit', '-m', 'chore: initialize workspace'])
    const { stdout: hashOut } = await runGit(this.mainDir, ['rev-parse', 'HEAD'])
    const commitHash = hashOut.trim()

    return {
      commitHash,
      shortHash: commitHash.slice(0, 7),
      diffPatch: '',
      filesChanged: [],
      linesAdded: 0,
      linesRemoved: 0,
    }
  }

  /**
   * Write a file inside `main` (serialized via mutex only for git operations so live writes never corrupt).
   */
  async writeFileInWorktree(worktreeDir: string, relPath: string, content: string): Promise<{
    previousContent: string
    linesAdded: number
    linesRemoved: number
  }> {
    if (containsLikelySecret(content)) throw new WorkspaceAccessError('Writing detected credential material is blocked by policy')
    if (isSensitivePath(relPath)) throw new WorkspaceAccessError('Access to credential/configuration files is blocked by the workspace policy')
    // Keep the lexical and policy checks for clear errors; fs-safe's pinned-root operation
    // is the authority that contains the actual read/write across the filesystem boundary.
    const absolutePath = assertWorkspacePath(worktreeDir, relPath)
    const safeRoot = await openWorkspaceRoot(worktreeDir)
    const safeRelPath = path.relative(safeRoot.rootReal, absolutePath).split(path.sep).join('/')
    let previousContent = ''
    try {
      previousContent = await safeRoot.readText(safeRelPath)
    } catch (error) {
      if (!(error instanceof FsSafeError) || error.code !== 'not-found') throw error
    }
    await safeRoot.write(safeRelPath, content)

    let linesAdded = 0
    let linesRemoved = 0
    for (const part of diffLines(previousContent, content)) {
      const count = part.count ?? 0
      if (part.added) linesAdded += count
      if (part.removed) linesRemoved += count
    }
    return { previousContent, linesAdded, linesRemoved }
  }

  async readFileInWorktree(worktreeDir: string, relPath: string): Promise<string | null> {
    if (isSensitivePath(relPath)) return null
    try {
      const absolutePath = assertWorkspacePath(worktreeDir, relPath, { requireExisting: true })
      const safeRoot = await openWorkspaceRoot(worktreeDir)
      const safeRelPath = path.relative(safeRoot.rootReal, absolutePath).split(path.sep).join('/')
      return await safeRoot.readText(safeRelPath)
    } catch (error) {
      if (error instanceof FsSafeError) {
        if (error.code === 'not-found' || error.category === 'policy') return null
      }
      if (error instanceof WorkspaceAccessError) return null
      throw error
    }
  }

  async readFileForAgent(worktreeDir: string, relPath: string): Promise<string | null> {
    const content = await this.readFileInWorktree(worktreeDir, relPath)
    if (content === null) return null
    if (containsLikelySecret(content)) {
      throw new WorkspaceAccessError('File contains detected credentials and is withheld from the model context')
    }
    return content
  }

  async listFilesInWorktree(worktreeDir: string): Promise<string[]> {
    const safeRoot = await openWorkspaceRoot(worktreeDir)
    const results: string[] = []
    const entries = safeRoot.walk('.', {
      symlinkPolicy: 'skip',
      maxDepth: 64,
      maxEntries: 50000,
      order: 'filesystem',
      limitBehavior: 'throw',
      entryFilter: (entry) => {
        const parts = entry.relativePath.split('/')
        if (parts.some((part) => part.startsWith('.') || part === 'node_modules')) return 'skip-subtree'
        if (isSensitivePath(entry.relativePath)) return 'skip-subtree'
        return entry.kind === 'directory' ? 'include' : entry.kind === 'file' ? 'include' : 'skip'
      },
    })
    for await (const entry of entries) {
      if (entry.kind === 'file') results.push(entry.relativePath)
    }
    return results.sort()
  }

  /**
   * Commit a checkpoint atomically on `main` (serialized against concurrent fork merges).
   */
  async commitMainCheckpoint(message: string, authorName = 'Builder Agent'): Promise<CommitResult | null> {
    return this.mainMutex.runExclusive(async () => {
      return this.commitInDir(this.mainDir, message, authorName)
    })
  }

  /**
   * Write file(s) and commit atomically on `main` so a concurrent merge never overwrites uncommitted builder writes.
   */
  async applyBuilderStepAndCommit(
    updater: (mainDir: string) => Promise<void> | void,
    commitMessage: string,
  ): Promise<CommitResult | null> {
    return this.mainMutex.runExclusive(async () => {
      await updater(this.mainDir)
      return this.commitInDir(this.mainDir, commitMessage, 'Builder Agent')
    })
  }

  async commitForkChanges(forkDir: string, message: string): Promise<CommitResult | null> {
    return this.commitInDir(forkDir, message, 'Fork Fixer Agent')
  }

  private async commitInDir(dir: string, message: string, authorName: string): Promise<CommitResult | null> {
    await runGit(dir, ['add', '-A'])
    const { stdout: status } = await runGit(dir, ['status', '--porcelain'])
    if (!status.trim()) return null

    await runGit(dir, [
      'commit',
      '--author',
      `${authorName} <agent@forkstream.local>`,
      '-m',
      message,
    ])
    const { stdout: hashOut } = await runGit(dir, ['rev-parse', 'HEAD'])
    const commitHash = hashOut.trim()

    const { stdout: nameOnly } = await runGit(dir, [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      'HEAD',
    ])
    const filesChanged = nameOnly
      .trim()
      .split('\n')
      .filter((f) => f && !f.startsWith('.'))

    const { stdout: diffPatch } = await runGit(dir, ['show', '--format=', '--unified=3', 'HEAD'])
    const { linesAdded, linesRemoved } = countPatchStats(diffPatch)

    return {
      commitHash,
      shortHash: commitHash.slice(0, 7),
      diffPatch,
      filesChanged,
      linesAdded,
      linesRemoved,
    }
  }

  /**
   * Spawn a real isolated Git Worktree branched from `baseCommitHash` (or current HEAD).
   * Exact command: `git worktree add -b fork/<forkId> <worktreePath> <baseCommitHash>`
   */
  async createForkWorktree(
    forkId: string,
    baseCommitHash?: string,
  ): Promise<{ branchName: string; worktreePath: string; resolvedBaseCommit: string }> {
    return this.mainMutex.runExclusive(async () => {
      const branchName = `fork/${forkId}`
      const worktreePath = path.join(this.forksRoot, forkId)

      let resolvedBaseCommit = baseCommitHash
      if (!resolvedBaseCommit) {
        const { stdout } = await runGit(this.mainDir, ['rev-parse', 'HEAD'])
        resolvedBaseCommit = stdout.trim()
      }

      await runGit(this.mainDir, ['worktree', 'add', '-b', branchName, worktreePath, resolvedBaseCommit])
      return { branchName, worktreePath, resolvedBaseCommit }
    })
  }

  /**
   * 3-Stage Smart Merge from isolated fork branch back into `main`:
   *   Stage 1: Git 3-way merge powered by Mergiraf AST structural driver (auto-merges same-file distinct AST edits!)
   *   Stage 2: If genuine line/entity overlap occurs, run LLM conflict resolver or diff3 resolver
   *   Stage 3: Commit merge checkpoint and record exact diff & strategy
   */
  async mergeForkIntoMain(
    forkId: string,
    branchName: string,
    forkPrompt: string,
    conflictResolver?: ConflictResolverFn,
  ): Promise<MergeOutcome> {
    return this.mainMutex.runExclusive(async () => {
      const { stdout: headBeforeOut } = await runGit(this.mainDir, ['rev-parse', 'HEAD'])
      const headBefore = headBeforeOut.trim()

      // Check whether any same-file edits exist between main and fork since merge-base
      let touchedOverlapFiles: string[] = []
      try {
        const { stdout: mbOut } = await runGit(this.mainDir, ['merge-base', 'main', branchName])
        const mergeBase = mbOut.trim()
        const { stdout: mainTouched } = await runGit(this.mainDir, [
          'diff',
          '--name-only',
          mergeBase,
          'main',
        ])
        const { stdout: forkTouched } = await runGit(this.mainDir, [
          'diff',
          '--name-only',
          mergeBase,
          branchName,
        ])
        const mainSet = new Set(mainTouched.trim().split('\n').filter(Boolean))
        touchedOverlapFiles = forkTouched
          .trim()
          .split('\n')
          .filter((f) => f && mainSet.has(f))
      } catch {
        // ignore merge-base edge case
      }

      const mergeMsg = `merge(${branchName}): ${forkPrompt.slice(0, 72)}`
      let strategy: MergeOutcome['strategy'] =
        touchedOverlapFiles.length > 0 && this.tooling.mergirafPath ? 'mergiraf-ast' : 'git-ort-clean'
      const conflictedFilesResolved: string[] = []

      try {
        await runGit(this.mainDir, ['merge', '--no-ff', '-m', mergeMsg, branchName])
      } catch {
        // Stage 2: Check unmerged conflicted files
        const { stdout: unmergedOut } = await runGit(this.mainDir, [
          'diff',
          '--name-only',
          '--diff-filter=U',
        ])
        const unmerged = unmergedOut.trim().split('\n').filter(Boolean)
        if (unmerged.length === 0) {
          throw new Error(`Merge failed unexpectedly for ${branchName}`)
        }

        strategy = 'ai-diff3-resolved'
        for (const relFile of unmerged) {
          const absFile = path.join(this.mainDir, relFile)
          const rawConflicted = fs.readFileSync(absFile, 'utf8')
          let resolved: string | null = null

          // Try secondary `mergiraf solve` pass first (documented Mergiraf workflow)
          if (this.tooling.mergirafPath) {
            try {
              await execFileAsync(this.tooling.mergirafPath, ['solve', absFile], { cwd: this.mainDir })
              const afterSolve = fs.readFileSync(absFile, 'utf8')
              if (!afterSolve.includes('<<<<<<<')) {
                resolved = afterSolve
                strategy = 'mergiraf-ast'
              }
            } catch {
              // Fall through to LLM / diff3 resolver
            }
          }

          if (!resolved && conflictResolver) {
            try {
              resolved = await conflictResolver({
                filePath: relFile,
                conflictedContent: rawConflicted,
                forkPrompt,
              })
            } catch {
              resolved = null
            }
          }

          if (!resolved || resolved.includes('<<<<<<<')) {
            resolved = resolveDiff3PreferTheirs(rawConflicted)
          }

          fs.writeFileSync(absFile, resolved, 'utf8')
          await runGit(this.mainDir, ['add', relFile])
          conflictedFilesResolved.push(relFile)
        }

        await runGit(this.mainDir, ['commit', '-m', `${mergeMsg} [conflict-resolved]`])
      }

      const { stdout: headAfterOut } = await runGit(this.mainDir, ['rev-parse', 'HEAD'])
      const commitHash = headAfterOut.trim()

      const { stdout: diffPatch } = await runGit(this.mainDir, [
        'diff',
        '--unified=3',
        headBefore,
        commitHash,
      ])
      const { stdout: modFilesOut } = await runGit(this.mainDir, [
        'diff',
        '--name-only',
        headBefore,
        commitHash,
      ])
      const filesModified = modFilesOut
        .trim()
        .split('\n')
        .filter((f) => f && !f.startsWith('.'))
      const { linesAdded, linesRemoved } = countPatchStats(diffPatch)

      const summary =
        strategy === 'mergiraf-ast'
          ? `Mergiraf AST merged ${filesModified.join(', ')} cleanly across concurrent edits (+${linesAdded}/-${linesRemoved})`
          : strategy === 'ai-diff3-resolved'
            ? `Resolved overlapping hunk in ${conflictedFilesResolved.join(', ')} via 3-way diff3/AI merge (+${linesAdded}/-${linesRemoved})`
            : `Cleanly merged ${branchName} (${filesModified.join(', ')}) into main (+${linesAdded}/-${linesRemoved})`

      const summaryAr =
        strategy === 'mergiraf-ast'
          ? `تم الدمج الهيكلي الذكي (Mergiraf AST) للملف ${filesModified.join('، ')} بنجاح رغم التعديل المتزامن (+${linesAdded}/-${linesRemoved})`
          : strategy === 'ai-diff3-resolved'
            ? `تم حل تداخل مباشر في ${conflictedFilesResolved.join('، ')} ودمج تعديلك بنجاح (+${linesAdded}/-${linesRemoved})`
            : `تم دمج الفرع المنقسم ${branchName} في المسار الرئيسي بنجاح (${filesModified.join('، ')})`

      return {
        commitHash,
        shortHash: commitHash.slice(0, 7),
        strategy,
        filesModified,
        conflictedFilesResolved,
        diffPatch,
        linesAdded,
        linesRemoved,
        summary,
        summaryAr,
      }
    })
  }

  async cleanupForkWorktree(worktreePath: string): Promise<void> {
    return this.mainMutex.runExclusive(async () => {
      try {
        if (fs.existsSync(worktreePath)) {
          await runGit(this.mainDir, ['worktree', 'remove', '--force', worktreePath])
        }
      } catch {
        // Keep history safe even if directory already cleaned
      }
    })
  }

  async getCommitLog(): Promise<Array<{ hash: string; shortHash: string; parents: string[]; subject: string }>> {
    const { stdout } = await runGit(this.mainDir, ['log', '--all', '--format=%H|%h|%P|%s', '-n', '50'])
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, parents, ...rest] = line.split('|')
        return {
          hash,
          shortHash,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          subject: rest.join('|'),
        }
      })
  }
}
