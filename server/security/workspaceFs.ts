import { configureFsSafeNative, root, type Root } from '@openclaw/fs-safe'
import path from 'node:path'

const nodeMajor = Number(process.versions.node.split('.')[0])
if (!Number.isInteger(nodeMajor) || nodeMajor < 26) {
  throw new Error(`ForkStream workspace security requires Node.js 26 or newer; found ${process.versions.node}`)
}

const configuredMode = process.env.FORKSTREAM_FS_SAFE_NATIVE_MODE ?? 'require'
if (configuredMode !== 'require' && configuredMode !== 'auto') {
  throw new Error('FORKSTREAM_FS_SAFE_NATIVE_MODE must be "require" or "auto"')
}

// Fail closed by default: do not silently downgrade workspace file operations to
// check-then-use pathname logic when the platform binding is unavailable.
configureFsSafeNative({ mode: configuredMode })

const ROOT_DEFAULTS = {
  hardlinks: 'reject' as const,
  symlinks: 'reject' as const,
  mkdir: true,
  maxBytes: 16 * 1024 * 1024,
}

export async function openWorkspaceRoot(rootDir: string): Promise<Root> {
  return root(path.resolve(rootDir), ROOT_DEFAULTS)
}
