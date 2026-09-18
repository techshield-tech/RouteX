// HTTP client for the real RouteX server API. Every export returns a Promise
// shaped the same way the earlier mock layer's did, so call sites in the
// store/components don't need to change just because this module's
// internals now hit the network instead of returning canned data.

import type {
  AuthSession,
  AuthStatusResponse,
  Connection,
  DefaultAction,
  Listener,
  ListenerAuth,
  ListenerProtocol,
  MatchType,
  Metrics,
  RouteAction,
  RouteEntry,
  RouteTargetKind,
  RuleGroup,
  RuleTemplate,
  Settings,
  TrafficRange,
  TrafficSeries,
  Upstream,
  UpstreamHealth,
  UpstreamScheme,
} from '../types'

// `import.meta.env.VITE_API_BASE` is index-typed as `string | boolean |
// undefined` by vite/client, so narrow it here rather than adding an env.d.ts
// override for one variable.
const rawBase = import.meta.env.VITE_API_BASE
export const API_BASE = typeof rawBase === 'string' && rawBase.length > 0 ? rawBase : '/api'

/** Error body shape from `apps/server/src/error.rs`'s `ErrorBody`. */
interface ApiErrorBody {
  error: string
  message: string
}

/** Thrown for any non-2xx response. `status` + `code` let a caller branch on
 * a specific failure (e.g. `code === 'upstream_in_use'`) without parsing
 * `message`, which is just a technical note for logs/UI display. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/* ---- Auth token store ---------------------------------------------------- */

const TOKEN_KEY = 'routex.token'

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    // localStorage unavailable (private mode, blocked storage) — fall through.
    return null
  }
}

// Cached in memory so every request doesn't have to touch storage, and so the
// token still works for the lifetime of the tab even if storage is blocked.
let currentToken: string | null = readStoredToken()

export function getToken(): string | null {
  return currentToken
}

export function setToken(token: string | null): void {
  currentToken = token
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Ignore write failures — the token still applies for this session.
  }
}

/**
 * Fired when a request other than the auth endpoints themselves comes back
 * 401 — i.e. the session died underneath the app (expired token, server
 * restart). The auth layer subscribes to fall back to the login screen
 * instead of leaving the console showing stale or broken data.
 */
type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

function handleUnauthorized(path: string) {
  // The auth endpoints report their own 401s for the caller to handle
  // directly (e.g. "wrong password" on login) — those aren't a dead session.
  if (path.startsWith('/auth/')) return
  setToken(null)
  for (const listener of unauthorizedListeners) listener()
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
        ...init?.headers,
      },
    })
  } catch (err) {
    throw new ApiError(0, 'network_error', err instanceof Error ? err.message : 'network error')
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      // Non-JSON error body (proxy/network failure page, etc.) — fall back
      // to the status text below.
    }
    if (res.status === 401) handleUnauthorized(path)
    throw new ApiError(res.status, body?.error ?? 'unknown', body?.message ?? res.statusText ?? `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

function get<T>(path: string): Promise<T> {
  return request<T>(path)
}
function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}
function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
}
function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

/* ---- Rule Templates ---------------------------------------------------- */

export interface RuleTemplateInput {
  name: string
  enabled: boolean
  matchType: MatchType
  pattern: string
  note: string
  groupId: string | null
}

export function fetchRuleTemplates(): Promise<RuleTemplate[]> {
  return get('/rule-templates')
}
export function createRuleTemplate(input: RuleTemplateInput): Promise<RuleTemplate> {
  return post('/rule-templates', input)
}
export function updateRuleTemplateRequest(id: string, input: RuleTemplateInput): Promise<RuleTemplate> {
  return put(`/rule-templates/${id}`, input)
}
export function deleteRuleTemplate(id: string): Promise<{ ok: true }> {
  return del(`/rule-templates/${id}`)
}
export function reorderRuleTemplates(groupId: string | null, orderedIds: string[]): Promise<{ ok: true }> {
  return put('/rule-templates/reorder', { groupId, orderedIds })
}

/* ---- Rule Groups --------------------------------------------------------- */

export interface RuleGroupInput {
  name: string
  note: string
  enabled: boolean
}

export function fetchRuleGroups(): Promise<RuleGroup[]> {
  return get('/rule-groups')
}
export function createRuleGroup(input: RuleGroupInput): Promise<RuleGroup> {
  return post('/rule-groups', input)
}
export function updateRuleGroupRequest(id: string, input: RuleGroupInput): Promise<RuleGroup> {
  return put(`/rule-groups/${id}`, input)
}
export function deleteRuleGroup(id: string): Promise<{ ok: true }> {
  return del(`/rule-groups/${id}`)
}

/* ---- Route Entries -------------------------------------------------------- */

export interface RouteEntryInput {
  name: string
  enabled: boolean
  listenerIds: string[]
  targetKind: RouteTargetKind
  targetId: string
  action: RouteAction
  upstreamId: string | null
  note: string
  hits: number
}

export function fetchRouteEntries(): Promise<RouteEntry[]> {
  return get('/route-entries')
}
export function createRouteEntry(input: RouteEntryInput): Promise<RouteEntry> {
  return post('/route-entries', input)
}
export function updateRouteEntryRequest(id: string, input: RouteEntryInput): Promise<RouteEntry> {
  return put(`/route-entries/${id}`, input)
}
export function deleteRouteEntry(id: string): Promise<{ ok: true }> {
  return del(`/route-entries/${id}`)
}
export function reorderRouteEntries(orderedIds: string[]): Promise<{ ok: true }> {
  return put('/route-entries/reorder', { orderedIds })
}

/* ---- Upstreams ------------------------------------------------------------ */

export interface UpstreamInput {
  name: string
  scheme: UpstreamScheme
  host: string
  port: number
  hasAuth: boolean
  health: UpstreamHealth
  latencyMs: number | null
}

export function fetchUpstreams(): Promise<Upstream[]> {
  return get('/upstreams')
}
export function createUpstream(input: UpstreamInput): Promise<Upstream> {
  return post('/upstreams', input)
}
export function updateUpstreamRequest(id: string, input: UpstreamInput): Promise<Upstream> {
  return put(`/upstreams/${id}`, input)
}

/** Machine-readable failure reason; the UI decides how to word it. */
export type TestConnectionError = 'timeout' | 'refused'

export interface TestConnectionResult {
  ok: boolean
  latencyMs: number | null
  health: UpstreamHealth
  error?: TestConnectionError
}

/** Real TCP-connect probe run server-side (`apps/server/src/routes/upstreams.rs`). */
export function testUpstreamConnection(upstreamId: string): Promise<TestConnectionResult> {
  return post(`/upstreams/${upstreamId}/test`)
}

/* ---- Listeners --------------------------------------------------------------- */

export interface ListenerInput {
  name: string
  protocol: ListenerProtocol
  bind: string
  port: number
  enabled: boolean
  defaultAction: DefaultAction
  auth: ListenerAuth
  /** Observed runtime state — server-owned, but required on write since the
   * backend's `ListenerInput` has no way to "leave it as-is"; callers must
   * pass the listener's current value through on every update. */
  status: Listener['status']
  connections: number
}

export function fetchListeners(): Promise<Listener[]> {
  return get('/listeners')
}
export function createListener(input: ListenerInput): Promise<Listener> {
  return post('/listeners', input)
}
export function updateListenerRequest(id: string, input: ListenerInput): Promise<Listener> {
  return put(`/listeners/${id}`, input)
}
export function deleteListener(id: string): Promise<{ ok: true }> {
  return del(`/listeners/${id}`)
}

/* ---- Settings ------------------------------------------------------------------ */

export function fetchSettings(): Promise<Settings> {
  return get('/settings')
}
export function updateSettingsRequest(settings: Settings): Promise<Settings> {
  return put('/settings', settings)
}

/* ---- Host ports ------------------------------------------------------------------ */

/**
 * Snapshot of TCP port usage on the host RouteX runs on. Backs the "pick a
 * free port" panel in the listener form (`apps/server/src/routes/host_ports.rs`
 * scans `/proc/net/tcp[6]`, Linux-only, best-effort).
 */
export interface HostPort {
  port: number
  inUse: boolean
  process: string | null
}

export function fetchHostPorts(): Promise<HostPort[]> {
  return get('/host-ports')
}

/* ---- Metrics --------------------------------------------------------------------- */

export function fetchMetrics(): Promise<Metrics> {
  return get('/metrics')
}

export function fetchTrafficSeries(range: TrafficRange): Promise<TrafficSeries> {
  return get(`/metrics/traffic?range=${range}`)
}

/* ---- Auth ------------------------------------------------------------------------ */

export function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return get('/auth/status')
}

export interface SetupInput {
  username: string
  password: string
}
export function setupAccount(input: SetupInput): Promise<AuthSession> {
  return post('/auth/setup', input)
}

export interface LoginInput {
  username: string
  password: string
}
export function login(input: LoginInput): Promise<AuthSession> {
  return post('/auth/login', input)
}

export function logout(): Promise<void> {
  return post('/auth/logout')
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}
export function changePassword(input: ChangePasswordInput): Promise<AuthSession> {
  return post('/auth/password', input)
}

/* ---- Connections ------------------------------------------------------------------- */

export function fetchConnectionsSeed(count = 40): Promise<Connection[]> {
  return get(`/connections?limit=${count}`)
}

/**
 * Opens the live connection-events stream
 * (`apps/server/src/routes/connections.rs`'s `/connections/stream`, backed
 * by a broadcast channel on the engine) and calls `onConnection` for every
 * event: one when a connection starts, another when it closes or fails.
 * Caller owns the returned `EventSource` and must `.close()` it on unmount.
 */
export function openConnectionsStream(onConnection: (conn: Connection) => void): EventSource | null {
  // `EventSource` can't set an `Authorization` header, so the token travels
  // as a query param instead — the server accepts it there for this route
  // only. With no session yet, don't open the stream at all.
  if (!currentToken) return null
  const source = new EventSource(`${API_BASE}/connections/stream?token=${encodeURIComponent(currentToken)}`)
  source.onmessage = (event) => {
    try {
      onConnection(JSON.parse(event.data) as Connection)
    } catch {
      // Malformed event payload — drop it rather than crash the stream.
    }
  }
  return source
}

/* ---- Config apply ------------------------------------------------------------------- */

export interface FailedListener {
  listenerId: string
  code: string
  message: string
}

export interface ApplyResult {
  ok: boolean
  appliedAt: string
  failedListeners?: FailedListener[]
}

/**
 * Reloads the engine from the DB. Unlike other routes, a partial failure
 * here (some listener(s) failed to rebind) is still a meaningful body, not
 * just an error — the server reports it with HTTP 409 and the same JSON
 * shape as success (`ok: false` plus `failedListeners`), so it's handled
 * directly instead of going through the generic `request()` (which would
 * otherwise turn it into a thrown `ApiError` and discard the detail).
 */
export async function applyConfig(): Promise<ApplyResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/config/apply`, {
      method: 'POST',
      headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : undefined,
    })
  } catch (err) {
    throw new ApiError(0, 'network_error', err instanceof Error ? err.message : 'network error')
  }
  const text = await res.text()
  const body = text ? (JSON.parse(text) as ApplyResult) : undefined
  if (res.ok || (res.status === 409 && body)) {
    return body ?? { ok: res.ok, appliedAt: new Date().toISOString() }
  }
  if (res.status === 401) handleUnauthorized('/config/apply')
  throw new ApiError(res.status, 'apply_failed', res.statusText || `HTTP ${res.status}`)
}
