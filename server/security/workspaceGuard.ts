import fs from 'node:fs'
import path from 'node:path'

export class WorkspaceAccessError extends Error {
  readonly code = 'WORKSPACE_ACCESS_DENIED'
  constructor(message: string) { super(message); this.name = 'WorkspaceAccessError' }
}

function decodePath(input: string): string {
  let value = input
  for (let i = 0; i < 4; i++) {
    let decoded: string
    try { decoded = decodeURIComponent(value) } catch { throw new WorkspaceAccessError('Malformed encoded path') }
    if (decoded === value) return value
    value = decoded
  }
  if (/%[0-9a-f]{2}/i.test(value)) throw new WorkspaceAccessError('Path encoding is excessively nested')
  return value
}

export function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = normalized.split('/').filter(Boolean)
  const loweredParts = parts.map((part) => part.toLowerCase())
  const base = loweredParts.at(-1) ?? ''
  // Git metadata is outside the model's file-tool capability boundary. In particular,
  // allowing .git/config or .gitattributes could re-enable hooks/filters during git add/commit.
  if (loweredParts.some((part) => ['.git', '.hg', '.svn'].includes(part))) return true
  if (/^\.env(?:\..*)?$/.test(base) && !/^\.env\.(?:example|sample|template|dist)$/.test(base)) return true
  if (['.npmrc', '.pypirc', '.netrc', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa'].includes(base)) return true
  if (/^(?:credentials?|secrets?)(?:[._-].*)?$/.test(base)) return true
  if (/^(?:application_default_credentials|service[-_]account(?:[-_].*)?)\.json$/.test(base)) return true
  if (/\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(base)) return true
  if (parts.some((part) => ['.aws', '.ssh', '.gnupg', '.azure', '.docker', '.kube'].includes(part.toLowerCase()))) return true
  if (parts.some((part, index) => part.toLowerCase() === '.config' && parts[index + 1]?.toLowerCase() === 'gcloud')) return true
  return false
}

export function assertWorkspacePath(rootDir: string, rawPath: string, options: { allowSensitive?: boolean; requireExisting?: boolean } = {}): string {
  if (typeof rawPath !== 'string' || !rawPath || rawPath.includes('\0')) throw new WorkspaceAccessError('A non-empty relative file path is required')
  const decoded = decodePath(rawPath)
  if (decoded.includes('\\') || path.isAbsolute(decoded) || path.win32.isAbsolute(decoded) || /^[a-zA-Z]:/.test(decoded)) {
    throw new WorkspaceAccessError('Absolute, drive-qualified, and backslash paths are not allowed')
  }

  const root = fs.realpathSync(rootDir)
  const absolute = path.resolve(root, decoded)
  const relative = path.relative(root, absolute)
  if (!relative || relative === '.' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new WorkspaceAccessError('Path must resolve to a file strictly inside the workspace')
  }
  if (!options.allowSensitive && isSensitivePath(relative)) {
    throw new WorkspaceAccessError('Access to credential/configuration files is blocked by the workspace policy')
  }

  let cursor = root
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component)
    try {
      const stat = fs.lstatSync(cursor)
      if (stat.isSymbolicLink()) throw new WorkspaceAccessError('Symbolic links are not accessible through agent file tools')
      if (cursor !== absolute && !stat.isDirectory()) throw new WorkspaceAccessError('A parent path component is not a directory')
      if (cursor === absolute && !stat.isFile()) throw new WorkspaceAccessError('Only regular files are accessible through this operation')
    } catch (error) {
      if (error instanceof WorkspaceAccessError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (options.requireExisting) throw new WorkspaceAccessError('Requested file does not exist')
        continue
      }
      throw error
    }
  }
  return absolute
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
]
const ASSIGNMENT_SECRET = /\b(api[_-]?key|access[_-]?(?:key|token)|refresh[_-]?token|client[_-]?secret|(?:aws[_-]?)?secret[_-]?access[_-]?key|private[_-]?key|password|passwd|secret|credential)\b(\s*[:=]\s*)(["']?)([^\s,"'`#]{8,})/gi

export function redactSecrets(text: string): string {
  let safe = text
  for (const pattern of SECRET_PATTERNS) safe = safe.replace(pattern, '[REDACTED_SECRET]')
  safe = safe.replace(ASSIGNMENT_SECRET, (_match, label: string, separator: string, quote: string) => `${label}${separator}${quote}[REDACTED_SECRET]`)
  return safe
}

export function containsLikelySecret(text: string): boolean {
  return redactSecrets(text) !== text
}

export function containsHighConfidenceSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    const safePattern = new RegExp(pattern.source, pattern.flags.replace('g', ''))
    return safePattern.test(text)
  })
}
