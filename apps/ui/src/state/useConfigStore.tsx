import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as api from '../api'
import { useI18n } from '../i18n/context'
import type {
  Listener,
  RouteEntry,
  RouteTargetKind,
  RuleGroup,
  RuleTemplate,
  Settings,
  Upstream,
} from '../types'
import { ConfigContext, type ConfigContextValue, type PendingChange } from './configContext'

interface Snapshot {
  ruleTemplates: RuleTemplate[]
  ruleGroups: RuleGroup[]
  routeEntries: RouteEntry[]
  upstreams: Upstream[]
  listeners: Listener[]
  settings: Settings
}

async function loadSnapshot(): Promise<Snapshot> {
  const [ruleTemplates, ruleGroups, routeEntries, upstreams, listeners, settings] = await Promise.all([
    api.fetchRuleTemplates(),
    api.fetchRuleGroups(),
    api.fetchRouteEntries(),
    api.fetchUpstreams(),
    api.fetchListeners(),
    api.fetchSettings(),
  ])
  return { ruleTemplates, ruleGroups, routeEntries, upstreams, listeners, settings }
}

export function ConfigStoreProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [ruleTemplates, setRuleTemplates] = useState<RuleTemplate[]>([])
  const [ruleGroups, setRuleGroups] = useState<RuleGroup[]>([])
  const [routeEntries, setRouteEntries] = useState<RouteEntry[]>([])
  const [upstreams, setUpstreams] = useState<Upstream[]>([])
  const [listeners, setListeners] = useState<Listener[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([])
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tRef = useRef(t)
  // Assigned in an effect rather than during render: `reportError` only ever
  // reads it from async callbacks and event handlers, never while rendering.
  useEffect(() => {
    tRef.current = t
  }, [t])

  // Kept stable across renders (unlike a plain closure over `t`) so effects
  // and callbacks below don't need `t` itself in their dependency arrays.
  const reportError = useCallback((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err)
    setError(tRef.current('error.requestFailed', { message: detail }))
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  const applySnapshot = useCallback((snap: Snapshot) => {
    setRuleTemplates(snap.ruleTemplates)
    setRuleGroups(snap.ruleGroups)
    setRouteEntries(snap.routeEntries)
    setUpstreams(snap.upstreams)
    setListeners(snap.listeners)
    setSettings(snap.settings)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadSnapshot()
      .then((snap) => {
        if (cancelled) return
        applySnapshot(snap)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        reportError(err)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Both deps are stable (useCallback with an empty dep array), so this
    // still runs once on mount only.
  }, [applySnapshot, reportError])

  const pushChange = useCallback((change: PendingChange) => {
    setPendingChanges((prev) => [...prev, change])
  }, [])

  /* ---- Rule Templates -------------------------------------------------- */

  const addRuleTemplate = useCallback<ConfigContextValue['addRuleTemplate']>(
    async (input) => {
      try {
        const created = await api.createRuleTemplate(input)
        setRuleTemplates((prev) => [...prev, created])
        pushChange({ key: 'change.template.added', params: { name: created.name } })
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const updateRuleTemplate = useCallback<ConfigContextValue['updateRuleTemplate']>(
    async (id, patch, change) => {
      try {
        const updated = await api.updateRuleTemplateRequest(id, patch)
        setRuleTemplates((prev) => prev.map((tpl) => (tpl.id === id ? updated : tpl)))
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  // Cascades: a template that route entries point to directly has nowhere to
  // be matched once it's gone, so those entries are deleted with it — the
  // server does the same cascade, this just mirrors it locally. The caller
  // supplies the message (it already knows the affected count).
  const removeRuleTemplate = useCallback<ConfigContextValue['removeRuleTemplate']>(
    async (id, change) => {
      try {
        await api.deleteRuleTemplate(id)
        setRuleTemplates((prev) => prev.filter((tpl) => tpl.id !== id))
        setRouteEntries((prev) => prev.filter((e) => !(e.targetKind === 'template' && e.targetId === id)))
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const duplicateRuleTemplate = useCallback<ConfigContextValue['duplicateRuleTemplate']>(
    async (id) => {
      const source = ruleTemplates.find((tpl) => tpl.id === id)
      if (!source) return
      try {
        const created = await api.createRuleTemplate({
          name: tRef.current('templates.duplicateSuffix', { name: source.name }),
          enabled: source.enabled,
          matchType: source.matchType,
          pattern: source.pattern,
          note: source.note,
          groupId: source.groupId,
        })
        // The server appends new templates at the end of their bucket;
        // reorder right after so the copy lands next to its source, same as
        // the old mock's in-memory splice did.
        const bucket = ruleTemplates.filter((tpl) => tpl.groupId === source.groupId)
        const sourceIdx = bucket.findIndex((tpl) => tpl.id === id)
        const orderedIds = [
          ...bucket.slice(0, sourceIdx + 1).map((tpl) => tpl.id),
          created.id,
          ...bucket.slice(sourceIdx + 1).map((tpl) => tpl.id),
        ]
        await api.reorderRuleTemplates(source.groupId, orderedIds)
        setRuleTemplates((prev) => {
          const idx = prev.findIndex((tpl) => tpl.id === id)
          if (idx === -1) return [...prev, created]
          const next = [...prev]
          next.splice(idx + 1, 0, created)
          return next
        })
        pushChange({ key: 'change.template.duplicated', params: { name: source.name } })
      } catch (err) {
        reportError(err)
      }
    },
    [ruleTemplates, pushChange, reportError],
  )

  // Reorder within the group's own subset (including "no group"): find the
  // nearest neighbour that shares `groupId` in the requested direction and
  // swap positions with it, then persist the new order for that bucket.
  const moveRuleTemplate = useCallback<ConfigContextValue['moveRuleTemplate']>(
    async (id, direction) => {
      const idx = ruleTemplates.findIndex((tpl) => tpl.id === id)
      if (idx === -1) return
      const item = ruleTemplates[idx]
      let swapWith = -1
      if (direction === 'up') {
        for (let i = idx - 1; i >= 0; i -= 1) {
          if (ruleTemplates[i].groupId === item.groupId) {
            swapWith = i
            break
          }
        }
      } else {
        for (let i = idx + 1; i < ruleTemplates.length; i += 1) {
          if (ruleTemplates[i].groupId === item.groupId) {
            swapWith = i
            break
          }
        }
      }
      if (swapWith === -1) return
      const next = [...ruleTemplates]
      ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
      const orderedIds = next.filter((tpl) => tpl.groupId === item.groupId).map((tpl) => tpl.id)
      try {
        await api.reorderRuleTemplates(item.groupId, orderedIds)
        setRuleTemplates(next)
        pushChange({ key: 'change.template.reordered', params: { name: item.name } })
      } catch (err) {
        reportError(err)
      }
    },
    [ruleTemplates, pushChange, reportError],
  )

  const toggleRuleTemplateEnabled = useCallback<ConfigContextValue['toggleRuleTemplateEnabled']>(
    async (id) => {
      const tpl = ruleTemplates.find((t2) => t2.id === id)
      if (!tpl) return
      try {
        const updated = await api.updateRuleTemplateRequest(id, {
          name: tpl.name,
          enabled: !tpl.enabled,
          matchType: tpl.matchType,
          pattern: tpl.pattern,
          note: tpl.note,
          groupId: tpl.groupId,
        })
        setRuleTemplates((prev) => prev.map((t2) => (t2.id === id ? updated : t2)))
        pushChange({
          key: updated.enabled ? 'change.template.enabled' : 'change.template.disabled',
          params: { name: updated.name },
        })
      } catch (err) {
        reportError(err)
      }
    },
    [ruleTemplates, pushChange, reportError],
  )

  /* ---- Rule Groups ------------------------------------------------------ */

  const addRuleGroup = useCallback<ConfigContextValue['addRuleGroup']>(
    async (input) => {
      try {
        const created = await api.createRuleGroup(input)
        setRuleGroups((prev) => [...prev, created])
        pushChange({ key: 'change.group.added', params: { name: created.name } })
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const updateRuleGroup = useCallback<ConfigContextValue['updateRuleGroup']>(
    async (id, patch, change) => {
      try {
        const updated = await api.updateRuleGroupRequest(id, patch)
        setRuleGroups((prev) => prev.map((g) => (g.id === id ? updated : g)))
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  // Cascades: templates in the group become standalone (never deleted), and
  // route entries that target the group directly are deleted with it — the
  // server does the same cascade; the caller supplies the message (it
  // already knows both counts).
  const removeRuleGroup = useCallback<ConfigContextValue['removeRuleGroup']>(
    async (id, change) => {
      try {
        await api.deleteRuleGroup(id)
        setRuleGroups((prev) => prev.filter((g) => g.id !== id))
        setRuleTemplates((prev) => prev.map((tpl) => (tpl.groupId === id ? { ...tpl, groupId: null } : tpl)))
        setRouteEntries((prev) => prev.filter((e) => !(e.targetKind === 'group' && e.targetId === id)))
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const toggleRuleGroupEnabled = useCallback<ConfigContextValue['toggleRuleGroupEnabled']>(
    async (id) => {
      const group = ruleGroups.find((g) => g.id === id)
      if (!group) return
      try {
        const updated = await api.updateRuleGroupRequest(id, {
          name: group.name,
          note: group.note,
          enabled: !group.enabled,
        })
        setRuleGroups((prev) => prev.map((g) => (g.id === id ? updated : g)))
        pushChange({
          key: updated.enabled ? 'change.group.enabled' : 'change.group.disabled',
          params: { name: updated.name },
        })
      } catch (err) {
        reportError(err)
      }
    },
    [ruleGroups, pushChange, reportError],
  )

  const templatesForGroup = useCallback(
    (groupId: string | null) => ruleTemplates.filter((tpl) => tpl.groupId === groupId),
    [ruleTemplates],
  )

  const templateCountForGroup = useCallback(
    (groupId: string | null) => ruleTemplates.filter((tpl) => tpl.groupId === groupId).length,
    [ruleTemplates],
  )

  /* ---- Route Entries ------------------------------------------------------ */

  const addRouteEntry = useCallback<ConfigContextValue['addRouteEntry']>(
    async (input) => {
      try {
        const created = await api.createRouteEntry({ ...input, hits: 0 })
        setRouteEntries((prev) => [...prev, created])
        pushChange({ key: 'change.route.added', params: { name: created.name } })
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const updateRouteEntry = useCallback<ConfigContextValue['updateRouteEntry']>(
    async (id, patch, change) => {
      const current = routeEntries.find((e) => e.id === id)
      if (!current) return
      try {
        const updated = await api.updateRouteEntryRequest(id, { ...patch, hits: current.hits })
        setRouteEntries((prev) => prev.map((e) => (e.id === id ? updated : e)))
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [routeEntries, pushChange, reportError],
  )

  const removeRouteEntry = useCallback<ConfigContextValue['removeRouteEntry']>(
    async (id, change) => {
      try {
        await api.deleteRouteEntry(id)
        setRouteEntries((prev) => prev.filter((e) => e.id !== id))
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const duplicateRouteEntry = useCallback<ConfigContextValue['duplicateRouteEntry']>(
    async (id) => {
      const source = routeEntries.find((e) => e.id === id)
      if (!source) return
      try {
        const created = await api.createRouteEntry({
          name: tRef.current('routing.duplicateSuffix', { name: source.name }),
          enabled: source.enabled,
          listenerIds: source.listenerIds,
          targetKind: source.targetKind,
          targetId: source.targetId,
          action: source.action,
          upstreamId: source.upstreamId,
          note: source.note,
          hits: 0,
        })
        // Route entries have one global priority order (server-side too),
        // so reorder the whole list to land the copy right after its source.
        const sourceIdx = routeEntries.findIndex((e) => e.id === id)
        const orderedIds = [
          ...routeEntries.slice(0, sourceIdx + 1).map((e) => e.id),
          created.id,
          ...routeEntries.slice(sourceIdx + 1).map((e) => e.id),
        ]
        await api.reorderRouteEntries(orderedIds)
        setRouteEntries((prev) => {
          const idx = prev.findIndex((e) => e.id === id)
          if (idx === -1) return [...prev, created]
          const next = [...prev]
          next.splice(idx + 1, 0, created)
          return next
        })
        pushChange({ key: 'change.route.duplicated', params: { name: source.name } })
      } catch (err) {
        reportError(err)
      }
    },
    [routeEntries, pushChange, reportError],
  )

  // Route entries have one global priority order, so moving one just swaps
  // it with its immediate neighbour — no subset to find first.
  const moveRouteEntry = useCallback<ConfigContextValue['moveRouteEntry']>(
    async (id, direction) => {
      const idx = routeEntries.findIndex((e) => e.id === id)
      if (idx === -1) return
      const swapWith = direction === 'up' ? idx - 1 : idx + 1
      if (swapWith < 0 || swapWith >= routeEntries.length) return
      const next = [...routeEntries]
      ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
      try {
        await api.reorderRouteEntries(next.map((e) => e.id))
        setRouteEntries(next)
        pushChange({ key: 'change.route.reordered', params: { name: routeEntries[idx].name } })
      } catch (err) {
        reportError(err)
      }
    },
    [routeEntries, pushChange, reportError],
  )

  const toggleRouteEntryEnabled = useCallback<ConfigContextValue['toggleRouteEntryEnabled']>(
    async (id) => {
      const entry = routeEntries.find((e) => e.id === id)
      if (!entry) return
      try {
        const updated = await api.updateRouteEntryRequest(id, {
          name: entry.name,
          enabled: !entry.enabled,
          listenerIds: entry.listenerIds,
          targetKind: entry.targetKind,
          targetId: entry.targetId,
          action: entry.action,
          upstreamId: entry.upstreamId,
          note: entry.note,
          hits: entry.hits,
        })
        setRouteEntries((prev) => prev.map((e) => (e.id === id ? updated : e)))
        pushChange({
          key: updated.enabled ? 'change.route.enabled' : 'change.route.disabled',
          params: { name: updated.name },
        })
      } catch (err) {
        reportError(err)
      }
    },
    [routeEntries, pushChange, reportError],
  )

  const routeEntriesForListener = useCallback(
    (listenerId: string) => routeEntries.filter((e) => e.listenerIds.includes(listenerId)),
    [routeEntries],
  )

  const routeEntryCountForTarget = useCallback(
    (kind: RouteTargetKind, id: string) =>
      routeEntries.filter((e) => e.targetKind === kind && e.targetId === id).length,
    [routeEntries],
  )

  const routeEntryCountForUpstream = useCallback(
    (upstreamId: string) => routeEntries.filter((e) => e.upstreamId === upstreamId).length,
    [routeEntries],
  )

  const routeEntryCountForListener = useCallback(
    (listenerId: string) => routeEntries.filter((e) => e.listenerIds.includes(listenerId)).length,
    [routeEntries],
  )

  /* ---- Upstreams ---------------------------------------------------------- */

  const addUpstream = useCallback<ConfigContextValue['addUpstream']>(
    async (input) => {
      try {
        const created = await api.createUpstream({ ...input, health: 'healthy', latencyMs: null })
        setUpstreams((prev) => [...prev, created])
        pushChange({ key: 'change.upstream.added', params: { name: created.name } })
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const updateUpstream = useCallback<ConfigContextValue['updateUpstream']>(
    async (id, patch, change) => {
      const current = upstreams.find((u) => u.id === id)
      if (!current) return
      try {
        // `health`/`latencyMs` are observed probe results, not form fields —
        // carry the current values through so an edit never clobbers them.
        const updated = await api.updateUpstreamRequest(id, {
          ...patch,
          health: current.health,
          latencyMs: current.latencyMs,
        })
        setUpstreams((prev) => prev.map((u) => (u.id === id ? updated : u)))
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [upstreams, pushChange, reportError],
  )

  // Probe results are observed status, already persisted server-side by the
  // `/upstreams/{id}/test` route itself — this just syncs the local copy.
  const setUpstreamProbe = useCallback<ConfigContextValue['setUpstreamProbe']>((id, health, latencyMs) => {
    setUpstreams((prev) => prev.map((u) => (u.id === id ? { ...u, health, latencyMs } : u)))
  }, [])

  /* ---- Listeners ------------------------------------------------------------ */

  const addListener = useCallback<ConfigContextValue['addListener']>(
    async (input) => {
      try {
        // Runtime status starts "down" — it only becomes "up" once Apply
        // makes the engine actually bind it (see `engine::supervisor`).
        const created = await api.createListener({ ...input, status: 'down', connections: 0 })
        setListeners((prev) => [...prev, created])
        pushChange({ key: 'change.listener.added', params: { name: created.name } })
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const updateListener = useCallback<ConfigContextValue['updateListener']>(
    async (id, patch, change) => {
      const current = listeners.find((l) => l.id === id)
      if (!current) return
      try {
        // `status`/`connections` are engine-owned observed state — carry the
        // current values through so a config edit never resets them.
        const updated = await api.updateListenerRequest(id, {
          ...patch,
          status: current.status,
          connections: current.connections,
        })
        setListeners((prev) => prev.map((l) => (l.id === id ? updated : l)))
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [listeners, pushChange, reportError],
  )

  // Cascades: gone listener means its route entries can no longer apply to
  // it — dropped from `listenerIds`, and any entry left with zero listeners
  // is removed outright. The server does the same cascade; the caller
  // supplies the message.
  const removeListener = useCallback<ConfigContextValue['removeListener']>(
    async (id, change) => {
      try {
        await api.deleteListener(id)
        setListeners((prev) => prev.filter((l) => l.id !== id))
        setRouteEntries((prev) =>
          prev
            .map((e) => (e.listenerIds.includes(id) ? { ...e, listenerIds: e.listenerIds.filter((lid) => lid !== id) } : e))
            .filter((e) => e.listenerIds.length > 0),
        )
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [pushChange, reportError],
  )

  const toggleListenerEnabled = useCallback<ConfigContextValue['toggleListenerEnabled']>(
    async (id) => {
      const listener = listeners.find((l) => l.id === id)
      if (!listener) return
      try {
        const updated = await api.updateListenerRequest(id, {
          name: listener.name,
          protocol: listener.protocol,
          bind: listener.bind,
          port: listener.port,
          enabled: !listener.enabled,
          defaultAction: listener.defaultAction,
          auth: listener.auth,
          status: listener.status,
          connections: listener.connections,
        })
        setListeners((prev) => prev.map((l) => (l.id === id ? updated : l)))
        pushChange({
          key: updated.enabled ? 'change.listener.enabled' : 'change.listener.disabled',
          params: { name: updated.name },
        })
      } catch (err) {
        reportError(err)
      }
    },
    [listeners, pushChange, reportError],
  )

  const updateSettings = useCallback<ConfigContextValue['updateSettings']>(
    async (patch, change) => {
      if (!settings) return
      const merged: Settings = { ...settings, ...patch }
      try {
        const updated = await api.updateSettingsRequest(merged)
        setSettings(updated)
        pushChange(change)
      } catch (err) {
        reportError(err)
      }
    },
    [settings, pushChange, reportError],
  )

  const applyChanges = useCallback(async () => {
    setApplying(true)
    try {
      const result = await api.applyConfig()
      if (result.ok) {
        setPendingChanges([])
      } else {
        const names = (result.failedListeners ?? []).map((f) => f.listenerId).join(', ') || 'unknown'
        reportError(new Error(`listener(s) failed to apply: ${names}`))
      }
    } catch (err) {
      reportError(err)
    } finally {
      setApplying(false)
    }
  }, [reportError])

  // Reloads every resource fresh from the server — replaces the old
  // "revert to last applied snapshot" behaviour, since mutations now save
  // immediately and there's no local-only draft to revert to.
  const discardChanges = useCallback(async () => {
    try {
      const snap = await loadSnapshot()
      applySnapshot(snap)
      setPendingChanges([])
    } catch (err) {
      reportError(err)
    }
  }, [applySnapshot, reportError])

  const value = useMemo<ConfigContextValue>(
    () => ({
      loading,
      ruleTemplates,
      ruleGroups,
      routeEntries,
      upstreams,
      listeners,
      settings,
      pendingChanges,
      applying,
      error,
      dismissError,
      addRuleTemplate,
      updateRuleTemplate,
      removeRuleTemplate,
      duplicateRuleTemplate,
      moveRuleTemplate,
      toggleRuleTemplateEnabled,
      addRuleGroup,
      updateRuleGroup,
      removeRuleGroup,
      toggleRuleGroupEnabled,
      templatesForGroup,
      templateCountForGroup,
      addRouteEntry,
      updateRouteEntry,
      removeRouteEntry,
      duplicateRouteEntry,
      moveRouteEntry,
      toggleRouteEntryEnabled,
      routeEntriesForListener,
      routeEntryCountForTarget,
      routeEntryCountForUpstream,
      routeEntryCountForListener,
      addUpstream,
      updateUpstream,
      setUpstreamProbe,
      addListener,
      updateListener,
      removeListener,
      toggleListenerEnabled,
      updateSettings,
      applyChanges,
      discardChanges,
    }),
    [
      loading,
      ruleTemplates,
      ruleGroups,
      routeEntries,
      upstreams,
      listeners,
      settings,
      pendingChanges,
      applying,
      error,
      dismissError,
      addRuleTemplate,
      updateRuleTemplate,
      removeRuleTemplate,
      duplicateRuleTemplate,
      moveRuleTemplate,
      toggleRuleTemplateEnabled,
      addRuleGroup,
      updateRuleGroup,
      removeRuleGroup,
      toggleRuleGroupEnabled,
      templatesForGroup,
      templateCountForGroup,
      addRouteEntry,
      updateRouteEntry,
      removeRouteEntry,
      duplicateRouteEntry,
      moveRouteEntry,
      toggleRouteEntryEnabled,
      routeEntriesForListener,
      routeEntryCountForTarget,
      routeEntryCountForUpstream,
      routeEntryCountForListener,
      addUpstream,
      updateUpstream,
      setUpstreamProbe,
      addListener,
      updateListener,
      removeListener,
      toggleListenerEnabled,
      updateSettings,
      applyChanges,
      discardChanges,
    ],
  )

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}
