import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const COOKIE_NAME = 'forkstream_auth'
const SECURE_COOKIE_NAME = '__Host-forkstream_auth'
const SESSION_TTL_SECONDS = 12 * 60 * 60

function constantTimeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest()
  const right = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(left, right)
}

function loadOwnerToken(): { token: string; newlyCreated: boolean; tokenFile: string } {
  const configured = process.env.FORKSTREAM_API_TOKEN?.trim()
  if (configured) {
    if (configured.length < 32) throw new Error('FORKSTREAM_API_TOKEN must contain at least 32 characters')
    return { token: configured, newlyCreated: false, tokenFile: '' }
  }
  const tokenFile = path.resolve(process.env.FORKSTREAM_API_TOKEN_FILE || path.resolve('data/owner-token'))
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true, mode: 0o700 })
  try {
    const token = fs.readFileSync(tokenFile, 'utf8').trim()
    if (token.length < 32) throw new Error(`Owner token file ${tokenFile} is invalid; replace it or set FORKSTREAM_API_TOKEN`)
    try { fs.chmodSync(tokenFile, 0o600) } catch { /* Windows ACLs are handled by deployment policy */ }
    return { token, newlyCreated: false, tokenFile }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const token = crypto.randomBytes(32).toString('base64url')
  try {
    fs.writeFileSync(tokenFile, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const racedToken = fs.readFileSync(tokenFile, 'utf8').trim()
    return { token: racedToken, newlyCreated: false, tokenFile }
  }
  return { token, newlyCreated: true, tokenFile }
}

export class ApiAuthenticator {
  readonly token: string
  readonly newlyCreated: boolean
  readonly tokenFile: string

  constructor() {
    const loaded = loadOwnerToken()
    this.token = loaded.token
    this.newlyCreated = loaded.newlyCreated
    this.tokenFile = loaded.tokenFile
  }

  verifyOwnerToken(candidate: unknown): boolean {
    return typeof candidate === 'string' && constantTimeEqual(candidate, this.token)
  }

  private cookieValue(expiry: number): string {
    const body = String(expiry)
    const signature = crypto.createHmac('sha256', this.token).update(body).digest('base64url')
    return `${body}.${signature}`
  }

  private verifyCookieValue(value: string): boolean {
    const [expiryText, signature, ...rest] = value.split('.')
    if (!expiryText || !signature || rest.length || !/^\d+$/.test(expiryText)) return false
    const expiry = Number(expiryText)
    if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(Date.now() / 1000)) return false
    const expected = this.cookieValue(expiry).split('.')[1]
    return constantTimeEqual(signature, expected)
  }

  issueCookie(isSecure: boolean): string {
    const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    const name = isSecure ? SECURE_COOKIE_NAME : COOKIE_NAME
    return `${name}=${this.cookieValue(expiry)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${isSecure ? '; Secure' : ''}`
  }

  clearCookie(isSecure: boolean): string {
    const name = isSecure ? SECURE_COOKIE_NAME : COOKIE_NAME
    return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? '; Secure' : ''}`
  }

  authorize(authorization: string | undefined, cookieHeader: string | undefined): boolean {
    if (authorization?.startsWith('Bearer ') && this.verifyOwnerToken(authorization.slice(7))) return true
    const cookie = cookieHeader?.split(';').map((part) => part.trim()).find((part) =>
      part.startsWith(`${COOKIE_NAME}=`) || part.startsWith(`${SECURE_COOKIE_NAME}=`),
    )
    if (!cookie) return false
    const separator = cookie.indexOf('=')
    return this.verifyCookieValue(cookie.slice(separator + 1))
  }
}

export function isTrustedMutationOrigin(origin: string | undefined, requestHost: string | undefined): boolean {
  if (!origin) return true // CLI / server-to-server clients authenticate with a bearer token.
  let parsed: URL
  try { parsed = new URL(origin) } catch { return false }
  const configured = (process.env.FORKSTREAM_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
  if (configured.includes(parsed.origin)) return true
  if (requestHost && parsed.host.toLowerCase() === requestHost.toLowerCase()) return true
  if (process.env.NODE_ENV !== 'production' && ['localhost:5173', '127.0.0.1:5173'].includes(parsed.host)) return true
  if (requestHost && requestHost.startsWith('localhost') && ['http://localhost', 'http://127.0.0.1'].includes(parsed.origin)) return true
  return false
}
