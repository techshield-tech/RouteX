import { createContext, useContext } from 'react'
import type { MessageKey, TranslateParams } from '../i18n/types'
import type {
  Listener,
  RouteEntry,
  RouteTargetKind,
  RuleGroup,
  RuleTemplate,
  Settings,
  Upstream,
  UpstreamHealth,
} from '../types'

/**
 * A queued edit, kept as a message key plus its parameters rather than a
 * finished sentence, so the pending-changes list reads in whatever language
 * is active when it is rendered.
 */
export interface PendingChange {
  key: MessageKey
  params?: TranslateParams
}

export interface ConfigContextValue {
  loading: boolean
  ruleTemplates: RuleTemplate[]
  ruleGroups: RuleGroup[]
  routeEntries: RouteEntry[]
  upstreams: Upstream[]
  listeners: Listener[]
  settings: Settings | null
  pendingChanges: PendingChange[]
  applying: boolean
  /** Message from the most recent failed request, for a dismissible banner.
   * `null` when there's nothing to show. */
  error: string | null
  dismissError: () => void
  addRuleTemplate: (input: Omit<RuleTemplate, 'id'>) => Promise<void>
  updateRuleTemplate: (id: string, patch: Omit<RuleTemplate, 'id'>, change: PendingChange) => Promise<void>
  removeRuleTemplate: (id: string, change: PendingChange) => Promise<void>
  duplicateRuleTemplate: (id: string) => Promise<void>
  moveRuleTemplate: (id: string, direction: 'up' | 'down') => Promise<void>
  toggleRuleTemplateEnabled: (id: string) => Promise<void>
  addRuleGroup: (input: Omit<RuleGroup, 'id'>) => Promise<void>
  updateRuleGroup: (id: string, patch: Omit<RuleGroup, 'id'>, change: PendingChange) => Promise<void>
  removeRuleGroup: (id: string, change: PendingChange) => Promise<void>
  toggleRuleGroupEnabled: (id: string) => Promise<void>
  templatesForGroup: (groupId: string | null) => RuleTemplate[]
  templateCountForGroup: (groupId: string | null) => number
  addRouteEntry: (input: Omit<RouteEntry, 'id' | 'hits'>) => Promise<void>
  updateRouteEntry: (id: string, patch: Omit<RouteEntry, 'id' | 'hits'>, change: PendingChange) => Promise<void>
  removeRouteEntry: (id: string, change: PendingChange) => Promise<void>
  duplicateRouteEntry: (id: string) => Promise<void>
  moveRouteEntry: (id: string, direction: 'up' | 'down') => Promise<void>
  toggleRouteEntryEnabled: (id: string) => Promise<void>
  routeEntriesForListener: (listenerId: string) => RouteEntry[]
  routeEntryCountForTarget: (kind: RouteTargetKind, id: string) => number
  routeEntryCountForUpstream: (upstreamId: string) => number
  routeEntryCountForListener: (listenerId: string) => number
  addUpstream: (input: Omit<Upstream, 'id' | 'health' | 'latencyMs'>) => Promise<void>
  updateUpstream: (
    id: string,
    patch: Omit<Upstream, 'id' | 'health' | 'latencyMs'>,
    change: PendingChange,
  ) => Promise<void>
  setUpstreamProbe: (id: string, health: UpstreamHealth, latencyMs: number | null) => void
  addListener: (input: Omit<Listener, 'id' | 'status' | 'connections'>) => Promise<void>
  updateListener: (
    id: string,
    patch: Omit<Listener, 'id' | 'status' | 'connections'>,
    change: PendingChange,
  ) => Promise<void>
  removeListener: (id: string, change: PendingChange) => Promise<void>
  toggleListenerEnabled: (id: string) => Promise<void>
  updateSettings: (patch: Partial<Settings>, change: PendingChange) => Promise<void>
  applyChanges: () => Promise<void>
  discardChanges: () => Promise<void>
}

export const ConfigContext = createContext<ConfigContextValue | null>(null)

export function useConfigStore(): ConfigContextValue {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfigStore must be used within ConfigStoreProvider')
  return ctx
}
