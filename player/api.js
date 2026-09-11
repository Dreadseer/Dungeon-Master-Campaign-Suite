// Single place the player app talks to the server.
//
// Every /api/ route except /api/join now requires the session token minted at
// join time (PlayerServer._requireSession). Scattering `Authorization` headers
// across four components is how one gets forgotten, so all of them go through
// here instead.

let sessionToken = null

/** Called on join, and on reload from sessionStorage. */
export function setToken(token) {
  sessionToken = token ?? null
}

export function getToken() {
  return sessionToken
}

export function clearToken() {
  sessionToken = null
}

/**
 * fetch() against the player API with the session token attached.
 * Throws an Error carrying the server's message on any non-2xx response.
 */
export async function apiFetch(pathname, options = {}) {
  const headers = { ...(options.headers ?? {}) }
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`

  const res = await fetch(pathname, { ...options, headers })

  if (!res.ok) {
    // 401 means the DM restarted the server — tokens live in memory only, so a
    // restart invalidates every session and the player must re-join.
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch { /* not JSON — keep the status message */ }
    const err = new Error(message)
    err.status = res.status
    throw err
  }

  return res.json()
}

/**
 * URL for a resource loaded by the browser rather than by fetch — an <img src>
 * cannot set an Authorization header, so the token goes in the query string.
 * PlayerServer._tokenFromRequest accepts both.
 */
export function apiUrl(pathname) {
  if (!sessionToken) return pathname
  const sep = pathname.includes('?') ? '&' : '?'
  return `${pathname}${sep}token=${encodeURIComponent(sessionToken)}`
}

/**
 * Authorization header for a caller that does its own fetch — MapView reads the
 * map image as a blob, so it can set a header rather than putting the token in
 * a query string.
 */
export function authHeaders() {
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}
}
