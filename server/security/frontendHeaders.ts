const FRONTEND_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "worker-src 'none'",
  "manifest-src 'self'",
].join('; ')

export function frontendResponseHeaders(contentType: string, isHtml: boolean): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(isHtml ? {
      'Content-Security-Policy': FRONTEND_CSP,
      'X-Frame-Options': 'DENY',
    } : {}),
  }
}
