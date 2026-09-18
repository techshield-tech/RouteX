// Technical enum values keep their wire value everywhere; only the label they
// render with is translated. These maps are the single place that binds a
// value to its label key, and they are exhaustive by type.

import type {
  ConnectionStatus,
  DnsResolveMode,
  ListenerProtocol,
  LogLevel,
  MatchType,
  RouteAction,
  UpstreamHealth,
} from '../types'
import type { MessageKey } from './types'

export const routeActionKey: Record<RouteAction, MessageKey> = {
  proxy: 'enum.route.proxy',
  direct: 'enum.route.direct',
  block: 'enum.route.block',
}

/** Rule match types, in the order they are offered in the UI. */
export const matchTypeOrder: MatchType[] = [
  'domain',
  'domain-suffix',
  'domain-keyword',
  'ip',
  'cidr',
  'port',
  'process',
]

export const matchTypeKey: Record<MatchType, MessageKey> = {
  domain: 'enum.matchType.domain',
  'domain-suffix': 'enum.matchType.domain-suffix',
  'domain-keyword': 'enum.matchType.domain-keyword',
  ip: 'enum.matchType.ip',
  cidr: 'enum.matchType.cidr',
  port: 'enum.matchType.port',
  process: 'enum.matchType.process',
}

export const upstreamHealthKey: Record<UpstreamHealth, MessageKey> = {
  healthy: 'enum.health.healthy',
  degraded: 'enum.health.degraded',
  unreachable: 'enum.health.unreachable',
}

export const connectionStatusKey: Record<ConnectionStatus, MessageKey> = {
  active: 'enum.connStatus.active',
  closed: 'enum.connStatus.closed',
  failed: 'enum.connStatus.failed',
}

export const listenerStatusKey: Record<'up' | 'down', MessageKey> = {
  up: 'enum.listenerStatus.up',
  down: 'enum.listenerStatus.down',
}

/** Technical protocol labels — same wording in every locale, still routed
 * through the enum map for consistency with how this file works. */
export const listenerProtocolKey: Record<ListenerProtocol, MessageKey> = {
  http: 'enum.listenerProtocol.http',
  socks5: 'enum.listenerProtocol.socks5',
}

export const listenerProtocolOrder: ListenerProtocol[] = ['http', 'socks5']

export const dnsResolveModeKey: Record<DnsResolveMode, MessageKey> = {
  system: 'enum.dns.system',
  remote: 'enum.dns.remote',
  off: 'enum.dns.off',
}

export const dnsResolveModeOrder: DnsResolveMode[] = ['system', 'remote', 'off']

export const logLevelKey: Record<LogLevel, MessageKey> = {
  error: 'enum.logLevel.error',
  warn: 'enum.logLevel.warn',
  info: 'enum.logLevel.info',
  debug: 'enum.logLevel.debug',
}

export const logLevelOrder: LogLevel[] = ['error', 'warn', 'info', 'debug']
