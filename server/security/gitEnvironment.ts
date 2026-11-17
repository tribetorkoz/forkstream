import os from 'node:os'

/**
 * Git for Windows cannot open the `\\.\nul` path that `os.devNull` returns, so
 * the null device is resolved per platform. Both targets are non-directories,
 * which keeps `core.hooksPath` from ever resolving to a real hooks folder.
 */
const gitNullDevice = process.platform === 'win32' ? 'NUL' : os.devNull

/**
 * Keep repository-controlled Git operations from inheriting user/system config,
 * repo overrides, or alternate Git directories from the server environment.
 * Hooks are forced to a non-directory device so commits cannot execute them.
 */
export function isolatedGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('GIT_')) delete env[key]
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitNullDevice,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: gitNullDevice,
    GIT_TERMINAL_PROMPT: '0',
  })
  return env
}
