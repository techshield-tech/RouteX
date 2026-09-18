import type { MessageKey } from '../i18n/types'
import type { MatchType } from '../types'

const octet = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const ipRe = new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}$`)
const cidrRe = new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}/(3[0-2]|[12]?\\d)$`)

/** Message key of the example hint shown under the pattern field. */
export const patternHintKeys: Record<MatchType, MessageKey> = {
  domain: 'drawer.rule.patternHint.domain',
  'domain-suffix': 'drawer.rule.patternHint.domain-suffix',
  'domain-keyword': 'drawer.rule.patternHint.domain-keyword',
  ip: 'drawer.rule.patternHint.ip',
  cidr: 'drawer.rule.patternHint.cidr',
  port: 'drawer.rule.patternHint.port',
  process: 'drawer.rule.patternHint.process',
}

/**
 * Returns the message key of the error when the pattern is invalid for the
 * given match type, or null when it's fine. The caller translates it, so the
 * rule itself stays language-independent.
 */
export function validatePattern(matchType: MatchType, pattern: string): MessageKey | null {
  const value = pattern.trim()
  if (value === '') {
    return 'validate.pattern.empty'
  }
  switch (matchType) {
    case 'ip':
      return ipRe.test(value) ? null : 'validate.pattern.ip'
    case 'cidr':
      return cidrRe.test(value) ? null : 'validate.pattern.cidr'
    case 'port': {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return 'validate.port'
      }
      return null
    }
    case 'domain':
    case 'domain-suffix':
      if (!/^[a-z0-9*]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9*]([a-z0-9-]*[a-z0-9])?)*$/i.test(value)) {
        return 'validate.pattern.domain'
      }
      return null
    case 'domain-keyword':
    case 'process':
      return null
    default:
      return null
  }
}
