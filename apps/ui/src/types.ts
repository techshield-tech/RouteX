// Shared domain types for the RouteX console. Mirrors the shape the real
// RouteX server API is expected to use, so the mock layer in `src/api` can
// be swapped for real `fetch` calls later without touching components.

export type MatchType =
  | 'domain'
  | 'domain-suffix'
  | 'domain-keyword'
  | 'ip'
  | 'cidr'
  | 'port'
  | 'process'

export type RouteAction = 'proxy' | 'direct' | 'block'

/**
 * A reusable match condition. Templates describe *what* to match only — no
 * listener, action or upstream — so the same template can be routed
 * differently by different `RouteEntry`s.
 */
export interface RuleTemplate {
  id: string
  name: string
  enabled: boolean
  matchType: MatchType
  pattern: string
  note: string
  /** Which `RuleGroup` this belongs to; null = standalone (not grouped). */
  groupId: string | null
}

/** A named, ordered bundle of templates. Order inside a group is the match
 * priority when the group is routed as a single `RouteEntry` target. */
export interface RuleGroup {
  id: string
  name: string
  note: string
  enabled: boolean
}

export type RouteTargetKind = 'template' | 'group'

/**
 * A routing decision: which listener(s) it applies to, which template or
 * group it matches against, and what happens on a match. Priority is the
 * array order of `routeEntries` — the first entry that matches wins.
 */
export interface RouteEntry {
  id: string
  name: string
  enabled: boolean
  /** 1..n listeners this entry applies to. */
  listenerIds: string[]
  /** Whether `targetId` names a single template or a whole group. */
  targetKind: RouteTargetKind
  targetId: string
  action: RouteAction
  upstreamId: string | null
  note: string
  hits: number
}

export type UpstreamScheme = 'http' | 'socks5'
export type UpstreamHealth = 'healthy' | 'degraded' | 'unreachable'

export interface Upstream {
  id: string
  name: string
  scheme: UpstreamScheme
  host: string
  port: number
  hasAuth: boolean
  health: UpstreamHealth
  latencyMs: number | null
}

export type ConnectionStatus = 'active' | 'closed' | 'failed'

export interface Connection {
  id: string
  time: string
  client: string
  target: string
  matchedRule: string
  route: RouteAction
  bytesUp: number
  bytesDown: number
  durationMs: number
  status: ConnectionStatus
  listenerId: string
}

export interface TrafficPoint {
  t: number
  proxied: number
  direct: number
}

export type TrafficRange = '15m' | '1h' | '7d' | '30d'

export interface TrafficSeries {
  range: TrafficRange
  bucketSeconds: number
  points: TrafficPoint[]
}

export interface TopRule {
  name: string
  hits: number
  share: number
}

export interface Metrics {
  activeConnections: number
  throughputUpBps: number
  throughputDownBps: number
  proxiedSharePct: number
  directSharePct: number
  rulesEnabled: number
  rulesTotal: number
  uptimeSeconds: number
  traffic: TrafficPoint[]
  topRules: TopRule[]
  recentConnections: Connection[]
}

export type DefaultAction = 'direct' | 'block'
export type DnsResolveMode = 'system' | 'remote' | 'off'
export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export type ListenerProtocol = 'http' | 'socks5'

/**
 * Credentials clients must present to use a listener. This is a mock-layer
 * value only — the console has no real secret storage or hashing behind it,
 * so `password` sits here in plain text the same way the rest of the mock
 * config does.
 */
export interface ListenerAuth {
  enabled: boolean
  username: string
  password: string
}

export interface Listener {
  id: string
  name: string
  protocol: ListenerProtocol
  bind: string
  port: number
  enabled: boolean
  /** Action taken when no rule in this listener's own rule set matches. */
  defaultAction: DefaultAction
  auth: ListenerAuth
  /** Observed runtime state — not something a form edits directly. */
  status: 'up' | 'down'
  connections: number
}

export interface Settings {
  routing: {
    dnsResolveMode: DnsResolveMode
  }
  logging: {
    level: LogLevel
    accessLog: boolean
  }
}

/* ---- Auth --------------------------------------------------------------- */

/**
 * Response from `GET /api/auth/status`. Checked once on load (and after any
 * session-invalidating 401) to decide whether the app shows setup, login, or
 * the console itself. This endpoint never fails with a 401 of its own.
 */
export interface AuthStatusResponse {
  needsSetup: boolean
  authenticated: boolean
  username: string | null
}

/**
 * Response from setup, login or a password change: a fresh bearer token plus
 * who it belongs to and when it expires. A password change revokes every
 * other session server-side, so the returned token is the one to keep.
 */
export interface AuthSession {
  token: string
  username: string
  expiresAt: string
}
